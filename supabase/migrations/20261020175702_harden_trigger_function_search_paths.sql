-- R4-SEC-04: separately approved forward deployment only; no ledger adoption.
-- Change only the function-local search_path, never bodies, ACLs or bindings.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

-- Stabilize trigger bindings against concurrent table/trigger DDL while allowing
-- ordinary reads/writes. Also serialize privileged function DDL operationally.
LOCK TABLE public.words, public.profiles IN SHARE UPDATE EXCLUSIVE MODE;

DO $preflight$
DECLARE
  target regprocedure;
  f record;
BEGIN
  IF current_user <> 'postgres'
    OR pg_catalog.current_setting('session_replication_role') <> 'origin' THEN
    RAISE EXCEPTION 'R4-SEC-04: expected postgres role and origin replication mode';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('set_english_word_norm', 'update_updated_at_column')) <> 2 THEN
    RAISE EXCEPTION 'R4-SEC-04: missing function or unexpected overload; inspect schema drift';
  END IF;

  FOREACH target IN ARRAY ARRAY[
    'public.set_english_word_norm()'::regprocedure,
    'public.update_updated_at_column()'::regprocedure
  ] LOOP
    SELECT * INTO STRICT f FROM pg_catalog.pg_proc WHERE oid = target;
    IF f.proowner <> 'postgres'::regrole OR f.prosecdef OR f.prokind <> 'f'
      OR f.prorettype <> 'pg_catalog.trigger'::regtype OR f.proretset
      OR f.pronargs <> 0
      OR f.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
      OR f.proconfig IS NOT NULL THEN
      RAISE EXCEPTION 'R4-SEC-04: % must be a postgres-owned zero-argument plpgsql SECURITY INVOKER trigger function with NULL configuration; do not rerun or overwrite drift', target;
    END IF;
    IF pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(COALESCE(f.proacl, pg_catalog.acldefault('f', f.proowner)))
        WHERE grantee = 0 AND privilege_type = 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'R4-SEC-04: unexpected application/PUBLIC EXECUTE on %; no grant repair', target;
    END IF;
  END LOOP;

  -- ROW | BEFORE | INSERT | UPDATE = 23; ROW | BEFORE | UPDATE = 19.
  -- Reject missing, disabled, redirected, conditional or extra uses of either
  -- function, including the old words timestamp binding from before R3-A01.
  IF (SELECT count(*) FROM pg_catalog.pg_trigger WHERE tgfoid IN (
      'public.set_english_word_norm()'::regprocedure,
      'public.update_updated_at_column()'::regprocedure)) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_attribute a ON a.attrelid = t.tgrelid
        AND a.attname = 'english_word' AND NOT a.attisdropped
      WHERE t.tgrelid = 'public.words'::regclass AND t.tgname = 'trg_set_english_word_norm'
        AND t.tgfoid = 'public.set_english_word_norm()'::regprocedure
        AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 23
        AND t.tgattr::text = a.attnum::text AND t.tgqual IS NULL AND t.tgnargs = 0
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'update_profiles_updated_at'
        AND tgfoid = 'public.update_updated_at_column()'::regprocedure
        AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
        AND tgattr = ''::pg_catalog.int2vector AND tgqual IS NULL AND tgnargs = 0
    ) THEN
    RAISE EXCEPTION 'R4-SEC-04: unexpected normalization/profile trigger bindings; inspect schema drift';
  END IF;
END;
$preflight$;

ALTER FUNCTION public.set_english_word_norm() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

COMMIT;
