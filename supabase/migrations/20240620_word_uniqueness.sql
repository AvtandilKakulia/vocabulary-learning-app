-- Enforce normalized uniqueness of english words per user
ALTER TABLE words
  ADD COLUMN IF NOT EXISTS english_word_norm text;

CREATE OR REPLACE FUNCTION set_english_word_norm()
RETURNS trigger AS $$
BEGIN
  NEW.english_word_norm := lower(regexp_replace(trim(NEW.english_word), '\s+', ' ', 'g'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_english_word_norm ON words;

CREATE TRIGGER trg_set_english_word_norm
BEFORE INSERT OR UPDATE OF english_word ON words
FOR EACH ROW
EXECUTE FUNCTION set_english_word_norm();

UPDATE words
SET english_word_norm = lower(regexp_replace(trim(english_word), '\s+', ' ', 'g'))
WHERE english_word IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS words_user_word_unique
  ON words (user_id, english_word_norm);
