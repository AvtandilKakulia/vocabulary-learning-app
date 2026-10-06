-- Each row is an independent meaning; normalized matches are a UI warning.
BEGIN;

-- Production may not have applied the legacy normalization migration.
ALTER TABLE public.words
  ADD COLUMN IF NOT EXISTS english_word_norm text;

-- Handle both a constraint-backed index and the standalone index created by
-- 20240620_word_uniqueness.sql. Drop uniqueness before backfilling because
-- whitespace normalization can make previously distinct keys match.
ALTER TABLE public.words DROP CONSTRAINT IF EXISTS words_user_word_unique;
DROP INDEX IF EXISTS public.words_user_word_unique;

CREATE OR REPLACE FUNCTION public.set_english_word_norm()
RETURNS trigger AS $$
BEGIN
  -- Collapse whitespace before trimming so boundary tabs/newlines are removed.
  NEW.english_word_norm := lower(trim(regexp_replace(NEW.english_word, '\s+', ' ', 'g')));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_english_word_norm ON public.words;

CREATE TRIGGER trg_set_english_word_norm
BEFORE INSERT OR UPDATE OF english_word ON public.words
FOR EACH ROW
EXECUTE FUNCTION public.set_english_word_norm();

-- Repair missing or stale values without rewriting correct rows on reruns.
UPDATE public.words
SET english_word_norm = lower(trim(regexp_replace(english_word, '\s+', ' ', 'g')))
WHERE english_word_norm IS DISTINCT FROM
  lower(trim(regexp_replace(english_word, '\s+', ' ', 'g')));

CREATE INDEX IF NOT EXISTS words_user_word_norm_idx
  ON public.words (user_id, english_word_norm);

COMMIT;
