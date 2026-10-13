-- R3-A01. Apply only after the separate deployment approval in supabase/README.md.
-- No bootstrap, data rewrite, RLS change, or migration-ledger adoption.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
SET LOCAL row_security = off;

-- DROP TRIGGER needs ACCESS EXCLUSIVE. Acquire it up front, without a lock
-- upgrade, and keep every precondition and the replacement in one transaction.
LOCK TABLE public.words IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF current_user <> 'postgres' OR pg_catalog.current_setting('session_replication_role') <> 'origin' OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = 'public.words'::regclass AND relkind = 'r'
      AND relowner = 'postgres'::regrole AND relrowsecurity AND NOT relispartition
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits
    WHERE inhrelid = 'public.words'::regclass OR inhparent = 'public.words'::regclass
  ) THEN
    RAISE EXCEPTION 'R3-A01: expected a standalone postgres-owned RLS-enabled words table, postgres role and origin replication mode';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.words'::regclass AND attname = 'updated_at'
      AND NOT attisdropped AND atttypid = 'pg_catalog.timestamptz'::regtype
      AND atttypmod IN (-1, 6) AND attnotnull AND attgenerated = ''
  ) THEN
    RAISE EXCEPTION 'R3-A01: updated_at must be a full-precision NOT NULL timestamptz column';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'advance_word_updated_at'
  ) THEN
    RAISE EXCEPTION 'R3-A01: advance_word_updated_at already exists; inspect rather than replacing or rerunning';
  END IF;

  -- pg_trigger bit masks: ROW(1) | BEFORE(2) | UPDATE(16) = 19;
  -- normalization additionally handles INSERT(4), giving 23.
  IF (SELECT count(*) FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.words'::regclass AND NOT tgisinternal) <> 2
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.words'::regclass AND tgname = 'update_words_updated_at'
        AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
        AND tgattr = ''::pg_catalog.int2vector AND tgqual IS NULL AND tgnargs = 0
        AND tgfoid = pg_catalog.to_regprocedure('public.update_updated_at_column()')
    ) OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_attribute a ON a.attrelid = t.tgrelid AND a.attname = 'english_word'
      WHERE t.tgrelid = 'public.words'::regclass AND t.tgname = 'trg_set_english_word_norm'
        AND NOT t.tgisinternal AND t.tgenabled = 'O' AND t.tgtype = 23
        AND t.tgattr::text = a.attnum::text AND t.tgqual IS NULL AND t.tgnargs = 0
        AND t.tgfoid = pg_catalog.to_regprocedure('public.set_english_word_norm()')
    ) OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_rewrite
      WHERE ev_class = 'public.words'::regclass AND rulename <> '_RETURN'
    ) THEN
    RAISE EXCEPTION 'R3-A01: unexpected words triggers or rewrite rules; review schema drift';
  END IF;

  -- row_security=off prevents an incomplete scan hidden by RLS. It does not
  -- disable or alter policies: an insufficiently privileged scan fails.
  IF EXISTS (
    SELECT 1 FROM public.words
    WHERE updated_at IS NULL OR NOT pg_catalog.isfinite(updated_at)
  ) THEN
    RAISE EXCEPTION 'R3-A01: existing invalid word versions; no automatic data repair';
  END IF;
END;
$$;

CREATE FUNCTION public.advance_word_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.updated_at IS NULL OR NOT pg_catalog.isfinite(OLD.updated_at) THEN
    RAISE EXCEPTION 'R3-A01: cannot advance an invalid word version';
  END IF;
  -- Ignore any client-supplied updated_at. The old-version branch handles equal
  -- clock readings, same-transaction updates, and clocks moving backwards.
  NEW.updated_at := GREATEST(
    pg_catalog.clock_timestamp(),
    OLD.updated_at + interval '1 microsecond'
  );
  IF NOT pg_catalog.isfinite(NEW.updated_at) OR NEW.updated_at <= OLD.updated_at THEN
    RAISE EXCEPTION 'R3-A01: word version did not advance';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger invocation does not require an application RPC execution grant.
-- Only this NEW function's ACL changes; all existing object ACLs stay intact.
REVOKE ALL ON FUNCTION public.advance_word_updated_at() FROM PUBLIC, anon, authenticated, service_role;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p,
      LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.advance_word_updated_at()'::regprocedure AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION 'R3-A01: unexpected default function grants; review before deployment';
  END IF;
END;
$$;

DROP TRIGGER update_words_updated_at ON public.words;
CREATE TRIGGER update_words_updated_at
BEFORE UPDATE ON public.words
FOR EACH ROW EXECUTE FUNCTION public.advance_word_updated_at();
COMMIT;
