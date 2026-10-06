-- Replace the incomplete RPC without rewriting the original migration.
-- Remove the old signature so PostgREST resolves a single function, including
-- callers that omit p_sort and use its backwards-compatible default.
BEGIN;

DROP FUNCTION public.search_words(uuid, text, int, int);

CREATE FUNCTION public.search_words(
  p_user_id uuid,
  p_term text,
  p_offset int,
  p_limit int,
  p_sort text DEFAULT 'alpha-asc'
)
RETURNS SETOF public.words
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  -- Unsupported or null sort values safely fall back to alphabetical order.
  v_sort text := CASE
    WHEN p_sort IN ('alpha-asc', 'alpha-desc', 'recent') THEN p_sort
    ELSE 'alpha-asc'
  END;
BEGIN
  RETURN QUERY
  SELECT w.*
  FROM public.words w
  WHERE w.user_id = p_user_id
    AND (
      w.english_word ILIKE '%' || p_term || '%'
      OR EXISTS (
        SELECT 1
        FROM unnest(w.georgian_definitions) AS d
        WHERE d ILIKE '%' || p_term || '%'
      )
    )
  ORDER BY
    CASE WHEN v_sort = 'alpha-asc' THEN w.english_word END ASC,
    CASE WHEN v_sort = 'alpha-desc' THEN w.english_word END DESC,
    CASE WHEN v_sort = 'recent' THEN w.created_at END DESC,
    w.id ASC
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

COMMIT;
