-- Executed only by run.mjs in its private cluster, after the real migration.
CREATE FUNCTION pg_temp.assert(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
END;
$$;

-- Same transaction and successive statements: no sleeps or mocked clock.
BEGIN;
DO $$
DECLARE initial timestamptz; first_version timestamptz; second_version timestamptz; third_version timestamptz;
BEGIN
  SELECT updated_at INTO initial FROM public.words WHERE id = '10000000-0000-0000-0000-000000000001';
  UPDATE public.words SET description = 'first' WHERE id = '10000000-0000-0000-0000-000000000001'
    RETURNING updated_at INTO first_version;
  UPDATE public.words SET description = 'second' WHERE id = '10000000-0000-0000-0000-000000000001'
    RETURNING updated_at INTO second_version;
  PERFORM pg_temp.assert(first_version > initial AND second_version > first_version, 'two updates in one transaction advance');
  PERFORM pg_temp.assert(first_version >= transaction_timestamp(), 'normal update uses wall-clock time');
  UPDATE public.words SET description = description WHERE id = '10000000-0000-0000-0000-000000000001'
    RETURNING updated_at INTO third_version;
  PERFORM pg_temp.assert(third_version > second_version, 'even a no-op update advances');
END;
$$;
COMMIT;

-- Future timestamp gives a deterministic one-microsecond increment and proves
-- that payload-supplied versions cannot override the trigger, in any time zone.
INSERT INTO public.words (id, user_id, english_word, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'future', '2500-01-01 00:00:00.123456+00');
SET TIME ZONE 'Asia/Tbilisi';
UPDATE public.words SET updated_at = '2000-01-01', description = 'future changed'
  WHERE id = '10000000-0000-0000-0000-000000000003';
SELECT pg_temp.assert(updated_at = '2500-01-01 00:00:00.123457+00'::timestamptz, 'future clock and six-digit precision')
  FROM public.words WHERE id = '10000000-0000-0000-0000-000000000003';
SET TIME ZONE 'UTC';

DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.words SET description = 'stale must not win'
    WHERE id = '10000000-0000-0000-0000-000000000003'
      AND user_id = '00000000-0000-0000-0000-000000000001'
      AND updated_at = '2500-01-01 00:00:00.123456+00';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM pg_temp.assert(affected = 0, 'stale equality rejects update');
  UPDATE public.words SET description = 'fresh succeeds'
    WHERE id = '10000000-0000-0000-0000-000000000003'
      AND user_id = '00000000-0000-0000-0000-000000000001'
      AND updated_at = '2500-01-01 00:00:00.123457+00';
  GET DIAGNOSTICS affected = ROW_COUNT;
  PERFORM pg_temp.assert(affected = 1, 'fresh equality updates exactly one row');
END;
$$;

UPDATE public.words SET english_word = E' \tYield   Now\n '
  WHERE id = '10000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(english_word_norm = 'yield now', 'normalization on update')
  FROM public.words WHERE id = '10000000-0000-0000-0000-000000000001';
INSERT INTO public.words (user_id, english_word) VALUES
  ('00000000-0000-0000-0000-000000000001', E' \tYield   Now\n ');
SELECT pg_temp.assert(count(*) = 2, 'normalization on insert and independent meanings coexist')
  FROM public.words WHERE english_word_norm = 'yield now';

-- The shared profiles function retains its previous transaction-start behavior.
BEGIN;
UPDATE public.profiles SET display_name = 'first' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(updated_at = transaction_timestamp(), 'profiles trigger unaffected')
  FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE public.profiles SET display_name = 'second' WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(updated_at = transaction_timestamp(), 'shared function remains unchanged')
  FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000001';
COMMIT;

SELECT pg_temp.assert(NOT has_function_privilege('authenticated', 'public.advance_word_updated_at()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.advance_word_updated_at()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'public.advance_word_updated_at()', 'EXECUTE'), 'no new RPC grants');
SELECT pg_temp.assert(NOT prosecdef AND proowner = 'postgres'::regrole, 'invoker function and owner')
  FROM pg_proc WHERE oid = 'public.advance_word_updated_at()'::regprocedure;

-- Real RLS/privileges with a synthetic auth.uid(); no external Auth service.
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE affected integer;
BEGIN
  UPDATE public.words SET description = 'owner update' WHERE id = '10000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN RAISE EXCEPTION 'owner cannot update through trigger'; END IF;
  UPDATE public.words SET description = 'must not change other owner' WHERE id = '10000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'RLS exposed other owner'; END IF;
  BEGIN
    UPDATE public.words SET user_id = '00000000-0000-0000-0000-000000000002'
      WHERE id = '10000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'ownership reassignment unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

-- Values introduced by an unreviewed writer AFTER migration fail closed too.
DO $$
DECLARE bad timestamptz;
BEGIN
  FOREACH bad IN ARRAY ARRAY['infinity'::timestamptz, '-infinity'::timestamptz,
                            '294276-12-31 23:59:59.999999+00'::timestamptz] LOOP
    INSERT INTO public.words (id, user_id, english_word, updated_at) VALUES
      ('10000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000001', 'invalid', bad);
    BEGIN
      UPDATE public.words SET description = 'must fail' WHERE id = '10000000-0000-0000-0000-000000000099';
      RAISE EXCEPTION 'unexpected successful invalid update' USING ERRCODE = 'ZX001';
    EXCEPTION
      WHEN raise_exception OR datetime_field_overflow THEN NULL;
    END;
    PERFORM pg_temp.assert((SELECT updated_at = bad AND description IS NULL FROM public.words
      WHERE id = '10000000-0000-0000-0000-000000000099'), 'invalid update rolled back');
    DELETE FROM public.words WHERE id = '10000000-0000-0000-0000-000000000099';
  END LOOP;
END;
$$;
