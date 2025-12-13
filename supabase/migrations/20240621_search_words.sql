-- Enable case-insensitive partial search across english words and georgian definitions
CREATE OR REPLACE FUNCTION search_words(
  p_user_id uuid,
  p_term text,
  p_offset int,
  p_limit int
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  english_word text,
  georgian_definitions text[],
  description text,
  created_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT w.id, w.user_id, w.english_word, w.georgian_definitions, w.description, w.created_at
  FROM words w
  WHERE w.user_id = p_user_id
    AND (
      w.english_word ILIKE '%' || p_term || '%'
      OR EXISTS (
        SELECT 1
        FROM unnest(w.georgian_definitions) AS d
        WHERE d ILIKE '%' || p_term || '%'
      )
    )
  ORDER BY w.english_word ASC
  OFFSET p_offset
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION search_words_count(p_user_id uuid, p_term text)
RETURNS int AS $$
DECLARE c int;
BEGIN
  SELECT count(*) INTO c
  FROM words w
  WHERE w.user_id = p_user_id
    AND (
      w.english_word ILIKE '%' || p_term || '%'
      OR EXISTS (
        SELECT 1 FROM unnest(w.georgian_definitions) d WHERE d ILIKE '%' || p_term || '%'
      )
    );
  RETURN c;
END;
$$ LANGUAGE plpgsql STABLE;
