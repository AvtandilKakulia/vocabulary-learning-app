import type { TestHistory, Word } from '@/lib/supabase';

export function word(overrides: Partial<Word> = {}): Word {
  return {
    id: 'word-1', user_id: 'user-a', english_word: 'yield',
    georgian_definitions: ['დათმობა', 'მოსავლიანობა'], description: 'Road context',
    part_of_speech: 'verb', is_irregular_verb: false,
    past_simple: null, past_participle: null,
    created_at: '2026-01-01T10:00:00.000Z', updated_at: '2026-01-02T10:00:00.000Z',
    ...overrides,
  };
}

export function historyRecord(overrides: Partial<TestHistory> = {}): TestHistory {
  return {
    id: 'history-1', user_id: 'user-a', test_date: '2026-01-01T10:00:00.000Z',
    created_at: '2026-01-01T10:00:00.000Z', test_direction: 'en-to-geo',
    total_words: 2, correct_count: 1, mistakes: [], ...overrides,
  };
}
