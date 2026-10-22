import type { TestHistory, TestMistake } from './supabase';
import { ownsPractice, type PracticeWriteAccess } from './practiceOwnership';
import { legacyPracticeKey, practiceSessionKey, recoveryStore } from './recoveryStorage';
export { legacyPracticeKey, practiceSessionKey } from './recoveryStorage';

// ID is optional only for recovery copies written before stable IDs were added.
export type PracticeResult = Omit<TestHistory, 'id' | 'created_at'> & { id?: string };
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
  // Absent in older copies: historical mistakes cannot establish retry eligibility.
  unresolvedWordIds?: string[];
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

export function parsePracticeSession(raw: string, userId: string): StoredPracticeSession | null {
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
      (session.unresolvedWordIds !== undefined && (!strings(session.unresolvedWordIds) ||
        session.unresolvedWordIds.some((id: string) => !id) ||
        new Set(session.unresolvedWordIds).size !== session.unresolvedWordIds.length)) ||
      (session.hasChecked !== undefined && typeof session.hasChecked !== 'boolean') ||
      (session.completed !== undefined && typeof session.completed !== 'boolean')) return null;
    const result = session.completedResult;
    if (result !== undefined && (!object(result) || result.user_id !== userId ||
      (result.id !== undefined && (typeof result.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.id))) ||
      typeof result.test_date !== 'string' || !Number.isFinite(Date.parse(result.test_date)) ||
      !['en-to-geo', 'geo-to-en'].includes(result.test_direction) || !count(result.total_words) ||
      !count(result.correct_count) || result.correct_count > result.total_words || !mistakes(result.mistakes))) return null;
    if (result) session.completedResult = {
      ...(result.id === undefined ? {} : { id: result.id }),
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

export function readPracticeSession(userId: string, access?: PracticeWriteAccess): { session: StoredPracticeSession | null; writable: boolean; warning: string } {
  const blocked = { session: null, writable: false, warning: recoveryStore.state(userId) === 'retired'
    ? 'Practice recovery is unavailable for this retired account.'
    : 'Browser storage is unavailable or its recovery status could not be verified. Practice progress cannot be saved locally.' };
  if (recoveryStore.state(userId) !== 'active') return blocked;
  try {
    const storage = window.localStorage;
    const key = practiceSessionKey(userId);
    const scoped = storage.getItem(key);
    if (scoped !== null) {
      const session = parsePracticeSession(scoped, userId);
      if (recoveryStore.state(userId) !== 'active') return blocked;
      return { session, writable: !!session, warning: session ? '' : 'Saved Practice data could not be restored. Its browser copy has been kept unchanged.' };
    }
    const legacy = storage.getItem(legacyPracticeKey);
    if (legacy === null) return { session: null, writable: true, warning: '' };
    const session = parsePracticeSession(legacy, userId);
    if (recoveryStore.state(userId) !== 'active') return blocked;
    // Never alter a malformed, incompatible, or another account's legacy copy.
    if (!session) return { session: null, writable: true, warning: '' };
    // Passive readers may inspect legacy progress but must never migrate it.
    if (!ownsPractice(access, userId)) return { session, writable: false, warning: '' };
    try {
      if (!recoveryStore.write(userId, key, legacy)) throw new Error('Copy failed');
      if (storage.getItem(key) !== legacy) throw new Error('Copy verification failed');
      // A different tab may have replaced the shared entry while it was copied.
      if (storage.getItem(legacyPracticeKey) === legacy) storage.removeItem(legacyPracticeKey);
      return recoveryStore.state(userId) === 'active' ? { session, writable: true, warning: '' } : blocked;
    } catch {
      if (recoveryStore.state(userId) === 'retired') return blocked;
      return { session, writable: false, warning: 'Practice storage migration could not finish. Your original browser copy has been kept.' };
    }
  } catch {
    return { session: null, writable: false, warning: 'Browser storage is unavailable. Practice progress cannot be saved locally.' };
  }
}

export function persistPracticeSession(session: StoredPracticeSession, access: PracticeWriteAccess, verify = false): string | null {
  if (!ownsPractice(access, session.userId)) return null;
  try {
    const raw = JSON.stringify(session);
    const existing = window.localStorage.getItem(practiceSessionKey(session.userId));
    if (recoveryStore.state(session.userId) !== 'active') return null;
    if (existing !== null && !parsePracticeSession(existing, session.userId)) return null;
    if (existing !== raw) {
      if (!recoveryStore.write(session.userId, practiceSessionKey(session.userId), raw)) return null;
    }
    if (verify && window.localStorage.getItem(practiceSessionKey(session.userId)) !== raw) return null;
    return recoveryStore.state(session.userId) === 'active' ? raw : null;
  } catch { return null; }
}

// expected protects a newer session from cleanup by an older asynchronous save.
export function removePracticeSession(userId: string, access: PracticeWriteAccess, expected?: string): boolean {
  if (!ownsPractice(access, userId)) return false;
  try {
    const storage = window.localStorage;
    const key = practiceSessionKey(userId);
    const raw = storage.getItem(key);
    if (expected !== undefined && raw !== expected) return false;
    if (raw !== null) {
      if (!parsePracticeSession(raw, userId)) return false;
      storage.removeItem(key);
    }
    const legacy = storage.getItem(legacyPracticeKey);
    if (legacy !== null && parsePracticeSession(legacy, userId)) storage.removeItem(legacyPracticeKey);
    return true;
  } catch { return false; }
}
