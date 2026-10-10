import type { TestHistory, TestMistake } from './supabase';

export const legacyPracticeKey = 'vocab_practice_session_state_v2';
export const practiceSessionKey = (userId: string) => `${legacyPracticeKey}:${encodeURIComponent(userId)}`;
export type PracticeResult = Omit<TestHistory, 'id' | 'created_at'>;
export type PracticeMistake = TestMistake & { word_id?: string };
export interface StoredPracticeSession {
  userId: string;
  queueIds: string[];
  direction: 'en-to-geo' | 'geo-to-en';
  orderMode: 'random' | 'db-order';
  allowReguess: boolean;
  correctCount: number;
  totalAttempts: number;
  mistakes: PracticeMistake[];
  attemptedWordIds?: string[];
  hasChecked?: boolean;
  completed?: boolean;
  completedResult?: PracticeResult;
}

const object = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const count = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const mistakes = (value: unknown): value is PracticeMistake[] => Array.isArray(value) && value.every(item =>
  object(item) && typeof item.english_word === 'string' && typeof item.user_answer === 'string' && strings(item.correct_definitions) &&
  (item.word_id === undefined || typeof item.word_id === 'string') &&
  (item.question_prompt === undefined || typeof item.question_prompt === 'string') &&
  (item.description == null || typeof item.description === 'string'));

function parse(raw: string, userId: string): StoredPracticeSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.userId !== userId || !strings(value.queueIds)) return null;
    // Older sessions omitted these fields; preserve their existing restore defaults.
    const session: Record<string, any> = { direction: 'en-to-geo', orderMode: 'random', allowReguess: false,
      correctCount: 0, totalAttempts: 0, mistakes: [], ...value };
    if (!['en-to-geo', 'geo-to-en'].includes(session.direction) || !['random', 'db-order'].includes(session.orderMode) ||
      typeof session.allowReguess !== 'boolean' || !count(session.correctCount) || !count(session.totalAttempts) ||
      session.correctCount > session.totalAttempts || !mistakes(session.mistakes) ||
      (session.attemptedWordIds !== undefined && !strings(session.attemptedWordIds)) ||
      (session.hasChecked !== undefined && typeof session.hasChecked !== 'boolean') ||
      (session.completed !== undefined && typeof session.completed !== 'boolean')) return null;
    const result = session.completedResult;
    if (result !== undefined && (!object(result) || result.user_id !== userId ||
      typeof result.test_date !== 'string' || !Number.isFinite(Date.parse(result.test_date)) ||
      !['en-to-geo', 'geo-to-en'].includes(result.test_direction) || !count(result.total_words) ||
      !count(result.correct_count) || result.correct_count > result.total_words || !mistakes(result.mistakes))) return null;
    if (result) session.completedResult = {
      user_id: result.user_id, test_date: result.test_date, test_direction: result.test_direction,
      total_words: result.total_words, correct_count: result.correct_count,
      mistakes: result.mistakes.map((item: PracticeMistake) => ({
        english_word: item.english_word, user_answer: item.user_answer, correct_definitions: item.correct_definitions,
        ...(item.question_prompt === undefined ? {} : { question_prompt: item.question_prompt }),
        ...(item.description === undefined ? {} : { description: item.description }),
      })),
    };
    return session as StoredPracticeSession;
  } catch { return null; }
}

export function readPracticeSession(userId: string): { session: StoredPracticeSession | null; writable: boolean; warning: string } {
  try {
    const storage = window.localStorage;
    const key = practiceSessionKey(userId);
    const scoped = storage.getItem(key);
    if (scoped !== null) {
      const session = parse(scoped, userId);
      return { session, writable: !!session, warning: session ? '' : 'Saved Practice data could not be restored. Its browser copy has been kept unchanged.' };
    }
    const legacy = storage.getItem(legacyPracticeKey);
    if (legacy === null) return { session: null, writable: true, warning: '' };
    const session = parse(legacy, userId);
    // Never alter a malformed, incompatible, or another account's legacy copy.
    if (!session) return { session: null, writable: true, warning: '' };
    try {
      storage.setItem(key, legacy);
      if (storage.getItem(key) !== legacy) throw new Error('Copy verification failed');
      // A different tab may have replaced the shared entry while it was copied.
      if (storage.getItem(legacyPracticeKey) === legacy) storage.removeItem(legacyPracticeKey);
      return { session, writable: true, warning: '' };
    } catch {
      return { session, writable: false, warning: 'Practice storage migration could not finish. Your original browser copy has been kept.' };
    }
  } catch {
    return { session: null, writable: false, warning: 'Browser storage is unavailable. Practice progress cannot be saved locally.' };
  }
}

export function persistPracticeSession(session: StoredPracticeSession): string | null {
  try {
    const raw = JSON.stringify(session);
    window.localStorage.setItem(practiceSessionKey(session.userId), raw);
    return raw;
  } catch { return null; }
}

// expected protects a newer session from cleanup by an older asynchronous save.
export function removePracticeSession(userId: string, expected?: string): boolean {
  try {
    const storage = window.localStorage;
    const key = practiceSessionKey(userId);
    const raw = storage.getItem(key);
    if (expected !== undefined && raw !== expected) return false;
    if (raw !== null) {
      if (!parse(raw, userId)) return false;
      storage.removeItem(key);
    }
    const legacy = storage.getItem(legacyPracticeKey);
    if (legacy !== null && parse(legacy, userId)) storage.removeItem(legacyPracticeKey);
    return true;
  } catch { return false; }
}
