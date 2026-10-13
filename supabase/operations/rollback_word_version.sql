-- INCIDENT RECOVERY ONLY, after separate owner approval and fencing all writes.
-- This restores the old, weaker version semantics; keep editing unavailable
-- until a reviewed forward fix is installed. It does not roll back word data.
BEGIN;
SET LOCAL search_path = '';
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '60s';
LOCK TABLE public.words IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF current_user <> 'postgres'
    OR pg_catalog.to_regprocedure('public.update_updated_at_column()') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.words'::regclass AND tgname = 'update_words_updated_at'
        AND NOT tgisinternal AND tgenabled = 'O' AND tgtype = 19
        AND tgattr = ''::pg_catalog.int2vector AND tgqual IS NULL AND tgnargs = 0
        AND tgfoid = pg_catalog.to_regprocedure('public.advance_word_updated_at()')
    ) THEN
    RAISE EXCEPTION 'R3-A01 rollback: unexpected role or trigger binding; inspect before recovery';
  END IF;
END;
$$;
DROP TRIGGER update_words_updated_at ON public.words;
CREATE TRIGGER update_words_updated_at BEFORE UPDATE ON public.words
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- RESTRICT is intentional: unknown dependents abort the whole rollback.
DROP FUNCTION public.advance_word_updated_at() RESTRICT;
COMMIT;
