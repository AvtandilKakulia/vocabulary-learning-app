-- Issue 7A: reconcile the audited production schema, NOT a clean-project baseline.
-- Run manually as the trusted database owner after review. No production access
-- or Supabase migration-history repair is performed by this file.
-- Requires the existing audited tables/functions/triggers. Expected RPC return
-- types are void for delete_user_account and integer for search_words_count;
-- CREATE OR REPLACE fails (without dropping objects) if those differ.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = '';

-- Reject unexpected state instead of guessing at policy/constraint semantics.
DO $$
DECLARE
  r record;
  expected_functions regprocedure[] := ARRAY[
    'public.search_words(uuid,text,integer,integer,text)'::regprocedure,
    'public.search_words_count(uuid,text)'::regprocedure,
    'public.delete_user_account()'::regprocedure,
    'public.handle_new_user()'::regprocedure,
    'public.set_english_word_norm()'::regprocedure,
    'public.update_updated_at_column()'::regprocedure
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.words'::regclass AND attname = 'georgian_definitions'
      AND atttypid = 'jsonb'::regtype AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Reconciliation requires public.words.georgian_definitions to be jsonb';
  END IF;

  FOR r IN SELECT oid::regclass AS table_name FROM pg_catalog.pg_class
    WHERE oid IN ('public.profiles'::regclass, 'public.words'::regclass, 'public.test_history'::regclass)
      AND NOT relrowsecurity
  LOOP
    RAISE EXCEPTION 'Expected RLS enabled on %; review schema drift before deployment', r.table_name;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('search_words', 'search_words_count', 'delete_user_account',
        'handle_new_user', 'set_english_word_norm', 'update_updated_at_column')
      AND NOT (p.oid = ANY(expected_functions::oid[]))
  ) THEN
    RAISE EXCEPTION 'Unexpected overload of a reconciled function; review before deployment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
    WHERE oid IN ('public.delete_user_account()'::regprocedure, 'public.handle_new_user()'::regprocedure)
      AND (proowner <> 'postgres'::regrole OR NOT prosecdef)
  ) THEN
    RAISE EXCEPTION 'Expected postgres-owned SECURITY DEFINER account/profile functions';
  END IF;

  FOR r IN SELECT polname, polcmd, polpermissive, pg_catalog.pg_get_expr(polqual, polrelid) AS expression
    FROM pg_catalog.pg_policy WHERE polrelid = 'public.words'::regclass
      AND (polcmd IN ('r', '*') OR polname IN ('Authenticated users can view all words', 'Users can view own words'))
  LOOP
    IF r.polcmd <> 'r' OR NOT r.polpermissive OR NOT COALESCE((
      (r.polname = 'Authenticated users can view all words'
        AND pg_catalog.regexp_replace(pg_catalog.lower(r.expression), '[[:space:]()]', '', 'g') = 'auth.uidisnotnull')
      OR (r.polname = 'Users can view own words'
        AND pg_catalog.regexp_replace(pg_catalog.lower(r.expression), '[[:space:]()]', '', 'g') = 'auth.uid=user_id')
    ), false) THEN
      RAISE EXCEPTION 'Unexpected words read policy "%"; review before replacing policies', r.polname;
    END IF;
  END LOOP;
END;
$$;

-- Keep effective service_role access when removing inherited PUBLIC privileges.
-- No privileges are added that service_role did not already have.
DO $$
DECLARE
  r record;
  f regprocedure;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS table_name, a.privilege_type
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(pg_catalog.acldefault('r', c.relowner)) a
    WHERE c.oid IN ('public.profiles'::regclass, 'public.words'::regclass, 'public.test_history'::regclass)
  LOOP
    IF pg_catalog.has_table_privilege('service_role', r.table_name, r.privilege_type) THEN
      EXECUTE pg_catalog.format('GRANT %s ON TABLE %s TO service_role', r.privilege_type, r.table_name);
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.search_words(uuid,text,integer,integer,text)'::regprocedure,
    'public.search_words_count(uuid,text)'::regprocedure,
    'public.delete_user_account()'::regprocedure,
    'public.handle_new_user()'::regprocedure,
    'public.set_english_word_norm()'::regprocedure,
    'public.update_updated_at_column()'::regprocedure
  ] LOOP
    IF pg_catalog.has_function_privilege('service_role', f, 'EXECUTE') THEN
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END;
$$;

-- Add enforcement before validation. The explicit orphan check gives a readable
-- diagnostic; VALIDATE also protects against races. Any failure rolls back ALL
-- changes. No orphan repair/deletion is attempted.
-- Locks are held until COMMIT (including validation): schedule a deployment
-- window for large tables. lock_timeout makes lock contention fail safely.
DO $$
DECLARE
  t text;
  table_oid regclass;
  user_column smallint;
  auth_id_column smallint;
  constraint_name text;
  existing_name text;
  orphan_exists boolean;
  c record;
BEGIN
  SELECT attnum INTO auth_id_column FROM pg_catalog.pg_attribute
    WHERE attrelid = 'auth.users'::regclass AND attname = 'id' AND NOT attisdropped;
  FOREACH t IN ARRAY ARRAY['words', 'test_history'] LOOP
    table_oid := pg_catalog.to_regclass('public.' || t);
    SELECT attnum INTO user_column FROM pg_catalog.pg_attribute
      WHERE attrelid = table_oid AND attname = 'user_id' AND NOT attisdropped;
    IF user_column IS NULL THEN
      RAISE EXCEPTION 'Missing public.%.user_id; reconciliation requires the audited schema', t;
    END IF;
    constraint_name := t || '_user_id_fkey';
    existing_name := NULL;
    FOR c IN SELECT * FROM pg_catalog.pg_constraint
      WHERE conrelid = table_oid AND
        (conname = constraint_name OR (contype = 'f' AND user_column = ANY(conkey)))
    LOOP
      IF c.contype <> 'f' OR c.conkey <> ARRAY[user_column]
        OR c.confrelid <> 'auth.users'::regclass OR c.confkey <> ARRAY[auth_id_column]
        OR c.confdeltype <> 'c' OR c.confupdtype <> 'a' OR c.confmatchtype <> 's'
        OR c.condeferrable THEN
        RAISE EXCEPTION 'Incompatible constraint public.%.%; expected user_id -> auth.users(id) ON DELETE CASCADE', t, c.conname;
      END IF;
      IF existing_name IS NOT NULL THEN
        RAISE EXCEPTION 'Multiple user_id foreign keys on public.%; review before deployment', t;
      END IF;
      existing_name := c.conname;
    END LOOP;
    IF existing_name IS NULL THEN
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID',
        t, constraint_name);
      existing_name := constraint_name;
    END IF;
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM public.%I child WHERE NOT EXISTS (SELECT 1 FROM auth.users parent WHERE parent.id = child.user_id))', t)
      INTO orphan_exists;
    IF orphan_exists THEN
      RAISE EXCEPTION 'Orphan user_id rows in public.%; migration aborted, no data repaired or deleted', t;
    END IF;
    EXECUTE pg_catalog.format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', t, existing_name);
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS "Authenticated users can view all words" ON public.words;
DROP POLICY IF EXISTS "Users can view own words" ON public.words;
CREATE POLICY "Users can view own words" ON public.words
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.search_words(
  p_user_id uuid, p_term text, p_offset integer, p_limit integer,
  p_sort text DEFAULT 'alpha-asc'
)
RETURNS SETOF public.words
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_sort text := CASE
    WHEN p_sort IN ('alpha-asc', 'alpha-desc', 'recent') THEN p_sort
    ELSE 'alpha-asc'
  END;
BEGIN
  RETURN QUERY
  SELECT w.* FROM public.words w
  WHERE w.user_id = p_user_id
    AND (
      w.english_word ILIKE '%' || p_term || '%'
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements_text(w.georgian_definitions) AS d(value)
        WHERE d.value ILIKE '%' || p_term || '%'
      )
    )
  ORDER BY
    CASE WHEN v_sort = 'alpha-asc' THEN w.english_word END ASC,
    CASE WHEN v_sort = 'alpha-desc' THEN w.english_word END DESC,
    CASE WHEN v_sort = 'recent' THEN w.created_at END DESC,
    w.id ASC
  OFFSET p_offset LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_words_count(p_user_id uuid, p_term text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE c integer;
BEGIN
  SELECT count(*) INTO c FROM public.words w
  WHERE w.user_id = p_user_id
    AND (
      w.english_word ILIKE '%' || p_term || '%'
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements_text(w.georgian_definitions) AS d(value)
        WHERE d.value ILIKE '%' || p_term || '%'
      )
    );
  RETURN c;
END;
$$;

-- Retain explicit deletes and the zero-argument, current-account-only API.
-- These DELETE statements run only when the RPC is called, not at migration time.
CREATE OR REPLACE FUNCTION public.delete_user_account()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE current_user_id uuid := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to delete account' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.profiles WHERE id = current_user_id;
  DELETE FROM public.words WHERE user_id = current_user_id;
  DELETE FROM public.test_history WHERE user_id = current_user_id;
  DELETE FROM auth.users WHERE id = current_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

-- CREATE OR REPLACE preserves owners and existing trigger bindings. Do not
-- recreate triggers; their execution does not need application RPC grants.
REVOKE ALL ON FUNCTION public.delete_user_account(),
  public.search_words(uuid, text, integer, integer, text),
  public.search_words_count(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(),
  public.search_words(uuid, text, integer, integer, text),
  public.search_words_count(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user(), public.set_english_word_norm(),
  public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.profiles, public.words, public.test_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.words TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.test_history TO authenticated;

-- Inherited or column-specific grants must not silently defeat the intended
-- matrix. Fail rather than changing unreviewed role memberships/column grants.
DO $$
DECLARE
  t text;
  privilege text;
  required boolean;
  f regprocedure;
  app_rpc boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'words', 'test_history'] LOOP
    FOR privilege IN
      SELECT privilege_type FROM pg_catalog.aclexplode(pg_catalog.acldefault('r', 'postgres'::regrole))
    LOOP
      required := privilege IN ('SELECT', 'INSERT')
        OR (privilege = 'UPDATE' AND t IN ('profiles', 'words'))
        OR (privilege = 'DELETE' AND t IN ('words', 'test_history'));
      IF pg_catalog.has_table_privilege('anon', 'public.' || t, privilege)
        OR pg_catalog.has_table_privilege('authenticated', 'public.' || t, privilege) <> required THEN
        RAISE EXCEPTION 'Unexpected effective % grant on public.%; review role inheritance', privilege, t;
      END IF;
      IF privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') THEN
        IF pg_catalog.has_any_column_privilege('anon', 'public.' || t, privilege)
          OR (NOT required AND pg_catalog.has_any_column_privilege('authenticated', 'public.' || t, privilege)) THEN
          RAISE EXCEPTION 'Unexpected column-level % grant on public.%; review before deployment', privilege, t;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'public.search_words(uuid,text,integer,integer,text)'::regprocedure,
    'public.search_words_count(uuid,text)'::regprocedure,
    'public.delete_user_account()'::regprocedure,
    'public.handle_new_user()'::regprocedure,
    'public.set_english_word_norm()'::regprocedure,
    'public.update_updated_at_column()'::regprocedure
  ] LOOP
    app_rpc := f IN ('public.search_words(uuid,text,integer,integer,text)'::regprocedure,
      'public.search_words_count(uuid,text)'::regprocedure, 'public.delete_user_account()'::regprocedure);
    IF pg_catalog.has_function_privilege('anon', f, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', f, 'EXECUTE') <> app_rpc THEN
      RAISE EXCEPTION 'Unexpected effective EXECUTE privilege on %; review role inheritance', f;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
