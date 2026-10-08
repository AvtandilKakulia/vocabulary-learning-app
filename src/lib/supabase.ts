import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase configuration. Set non-empty VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
    "in .env.local for development or in Vercel Environment Variables for Preview/Production, then restart or rebuild."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Word {
  id: string;
  user_id: string;
  english_word: string;
  part_of_speech: string | null;
  is_irregular_verb: boolean;
  past_simple: string | null;
  past_participle: string | null;
  georgian_definitions: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestHistory {
  id: string;
  user_id: string;
  test_date: string;
  test_direction: "en-to-geo" | "geo-to-en";
  total_words: number;
  correct_count: number;
  mistakes: TestMistake[];
  created_at: string;
}

export interface TestMistake {
  english_word: string;
  user_answer: string;
  correct_definitions: string[];
  question_prompt?: string;
  description?: string | null;
}
