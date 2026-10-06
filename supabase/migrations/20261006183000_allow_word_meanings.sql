-- Each row is an independent meaning; normalized matches are a UI warning.
BEGIN;

-- Handle both a constraint-backed index and the standalone index created by
-- 20240620_word_uniqueness.sql without changing existing rows or normalization.
ALTER TABLE public.words DROP CONSTRAINT IF EXISTS words_user_word_unique;
DROP INDEX IF EXISTS public.words_user_word_unique;

CREATE INDEX IF NOT EXISTS words_user_word_norm_idx
  ON public.words (user_id, english_word_norm);

COMMIT;
