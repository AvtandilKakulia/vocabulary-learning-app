import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bimejdjsqusxzrdkmovn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpbWVqZGpzcXVzeHpyZGttb3ZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MTI2NTIsImV4cCI6MjA3OTE4ODY1Mn0.SvYknLOcQKQaKl2PJOvjmvH_EP26hdxudXB-uHAgmIg';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface Word {
  id: string;
  user_id: string;
  english_word: string;
  georgian_definitions: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestHistory {
  id: string;
  user_id: string;
  test_date: string;
  test_direction: 'en-to-geo' | 'geo-to-en';
  total_words: number;
  correct_count: number;
  mistakes: TestMistake[];
  created_at: string;
}

export interface TestMistake {
  english_word: string;
  user_answer: string;
  correct_definitions: string[];
}
