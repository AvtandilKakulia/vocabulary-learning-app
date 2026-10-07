-- Fresh-project prerequisites only. Never apply to the existing production DB.
-- Supabase supplies auth.users, auth.uid(), postgres and application roles.
-- Apply the entire migration chain before connecting the application.
BEGIN;
SET LOCAL search_path = '';

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
    OR pg_catalog.to_regclass('public.words') IS NOT NULL
    OR pg_catalog.to_regclass('public.test_history') IS NOT NULL THEN
    RAISE EXCEPTION 'Fresh-project bootstrap baseline only: an application table already exists. Do not apply this baseline to an existing database.';
  END IF;
END;
$$;

CREATE TABLE public.profiles (
  id uuid NOT NULL PRIMARY KEY,
  display_name text,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.words (
  id uuid NOT NULL PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL,
  english_word text NOT NULL,
  georgian_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  part_of_speech text DEFAULT 'unspecified',
  is_irregular_verb boolean DEFAULT false,
  past_simple text,
  past_participle text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  CONSTRAINT words_part_of_speech_check CHECK (
    part_of_speech IN ('unspecified', 'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'pronoun')
  ),
  CONSTRAINT irregular_verb_consistency_check CHECK (
    (is_irregular_verb = false AND past_simple IS NULL AND past_participle IS NULL)
    OR (is_irregular_verb = true AND past_simple IS NOT NULL AND past_participle IS NOT NULL)
  )
);

CREATE TABLE public.test_history (
  id uuid NOT NULL PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id uuid NOT NULL,
  test_date timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  test_direction text NOT NULL,
  total_words integer NOT NULL,
  correct_count integer NOT NULL,
  mistakes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  CONSTRAINT test_history_test_direction_check CHECK (test_direction IN ('en-to-geo', 'geo-to-en'))
);

CREATE INDEX idx_test_history_test_date ON public.test_history (test_date DESC);
CREATE INDEX idx_test_history_user_id ON public.test_history (user_id);
CREATE INDEX idx_words_english_word ON public.words (english_word);
CREATE INDEX idx_words_english_word_lower ON public.words (pg_catalog.lower(english_word));
CREATE INDEX idx_words_georgian_definitions ON public.words USING gin (georgian_definitions);
CREATE INDEX idx_words_user_id ON public.words (user_id);

-- Normalization column/function/trigger and its indexes belong to later files.
-- The words/history auth FKs are added and validated by Issue 7A, not here.
CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.timezone('utc', pg_catalog.now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_words_updated_at BEFORE UPDATE ON public.words
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE FUNCTION public.delete_user_account()
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
ALTER FUNCTION public.delete_user_account() OWNER TO postgres;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view own words" ON public.words
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own words" ON public.words
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);
CREATE POLICY "Users can update own words" ON public.words
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own words" ON public.words
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can view own test history" ON public.test_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own test history" ON public.test_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own test history" ON public.test_history
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Override any broad Supabase default grants for these newly created objects.
REVOKE ALL ON TABLE public.profiles, public.words, public.test_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.words TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.test_history TO authenticated;
GRANT ALL ON TABLE public.profiles, public.words, public.test_history TO service_role;

REVOKE ALL ON FUNCTION public.delete_user_account(), public.handle_new_user(),
  public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(), public.handle_new_user(),
  public.update_updated_at_column() TO service_role;

COMMIT;
