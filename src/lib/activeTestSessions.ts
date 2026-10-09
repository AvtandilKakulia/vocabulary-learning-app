import type { Word, TestHistory } from './supabase';
import { completedTestSnapshot, isCompletedTestResult, readPendingTests, type CompletedTestResult } from './pendingTestResults';

export interface TestQuestion extends Pick<Word, 'id' | 'english_word' | 'georgian_definitions' | 'description'> {
  userAnswer: string;
  isCorrect: boolean;
  options: string[];
}

export interface ActiveTestSession {
  id: string;
  userId: string;
  startedAt: string;
  direction: TestHistory['test_direction'];
  inputType: 'multiple' | 'text';
  wordCount: number;
  customCount: string;
  questions: TestQuestion[];
  currentQuestion: number;
  draftAnswer: string;
}

const prefix = (userId: string) => `vocab_active_test:${encodeURIComponent(userId)}:`;
export const activeTestKey = (userId: string, id: string) => `${prefix(userId)}${id}`;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

function validSession(value: unknown, userId: string): value is ActiveTestSession {
  if (!object(value) || value.userId !== userId || typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) ||
    typeof value.startedAt !== 'string' || !Number.isFinite(Date.parse(value.startedAt)) ||
    (value.direction !== 'en-to-geo' && value.direction !== 'geo-to-en') ||
    (value.inputType !== 'text' && value.inputType !== 'multiple') ||
    !Number.isInteger(value.wordCount) || Number(value.wordCount) < 0 || typeof value.customCount !== 'string' ||
    !Array.isArray(value.questions) || !value.questions.length ||
    !Number.isInteger(value.currentQuestion) || Number(value.currentQuestion) < 0 ||
    Number(value.currentQuestion) >= value.questions.length || typeof value.draftAnswer !== 'string') return false;
  const count = value.wordCount === 0 ? Number.parseInt(value.customCount, 10) : value.wordCount;
  if (count !== value.questions.length) return false;
  return value.questions.every((question: unknown, index: number) => {
    if (!object(question) || typeof question.id !== 'string' || typeof question.english_word !== 'string' ||
      !strings(question.georgian_definitions) || !(question.description === null || typeof question.description === 'string') ||
      typeof question.userAnswer !== 'string' || typeof question.isCorrect !== 'boolean' || !strings(question.options)) return false;
    if (index >= Number(value.currentQuestion) && (question.userAnswer !== '' || question.isCorrect)) return false;
    if (value.inputType === 'text') return question.options.length === 0;
    const label = value.direction === 'en-to-geo' ? question.georgian_definitions.join(', ') : question.english_word;
    return question.options.length > 0 && question.options.length <= 4 && question.options.includes(label) &&
      new Set(question.options).size === question.options.length &&
      (index !== value.currentQuestion || value.draftAnswer === '' || question.options.includes(value.draftAnswer as string));
  });
}

function snapshot(session: ActiveTestSession): ActiveTestSession {
  return {
    id: session.id, userId: session.userId, startedAt: session.startedAt,
    direction: session.direction, inputType: session.inputType,
    wordCount: session.wordCount, customCount: session.customCount,
    currentQuestion: session.currentQuestion, draftAnswer: session.draftAnswer,
    questions: session.questions.map(question => ({
      id: question.id, english_word: question.english_word,
      georgian_definitions: [...question.georgian_definitions], description: question.description,
      userAnswer: question.userAnswer, isCorrect: question.isCorrect, options: [...question.options],
    })),
  };
}

export function persistActiveTest(session: ActiveTestSession): boolean {
  try {
    window.localStorage.setItem(activeTestKey(session.userId, session.id),
      JSON.stringify({ version: 1, phase: 'active', session: snapshot(session) }));
    return true;
  } catch { return false; }
}

// Replacing the larger active record is an atomic fallback when a new pending key
// cannot be allocated (e.g. quota). It retains the exact completed payload and ID.
export function checkpointCompletedTest(result: CompletedTestResult): boolean {
  try {
    window.localStorage.setItem(activeTestKey(result.user_id, result.id),
      JSON.stringify({ version: 1, phase: 'completed', result: completedTestSnapshot(result) }));
    return true;
  } catch { return false; }
}

export function removeActiveTest(userId: string, id: string): boolean {
  try {
    window.localStorage.removeItem(activeTestKey(userId, id));
    return true;
  } catch { return false; }
}

export function readTestRecovery(userId: string) {
  const pending = readPendingTests(userId);
  const results = new Map(pending.results.map(result => [result.id, result]));
  const sessions: ActiveTestSession[] = [];
  const activeCopyIds = new Set<string>();
  const completedCopyIds = new Set<string>();
  const warnings = [pending.warning];
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix(userId))) continue;
      // Even an unreadable copy must be accounted for before clearing the completed
      // record with the same ID; it could become readable again on a later mount.
      activeCopyIds.add(key.slice(prefix(userId).length));
      try {
        const stored: unknown = JSON.parse(storage.getItem(key) ?? 'null');
        if (!object(stored) || stored.version !== 1) throw new Error('Invalid session');
        if (stored.phase === 'active' && validSession(stored.session, userId) &&
          activeTestKey(userId, stored.session.id) === key) {
          sessions.push(snapshot(stored.session));
        } else if (stored.phase === 'completed' && isCompletedTestResult(stored.result, userId) &&
          activeTestKey(userId, stored.result.id) === key) {
          if (!results.has(stored.result.id)) results.set(stored.result.id, completedTestSnapshot(stored.result));
          completedCopyIds.add(stored.result.id);
        } else throw new Error('Invalid session');
      } catch {
        warnings.push('Some active test data could not be restored. Its browser copy has been left unchanged.');
      }
    }
  } catch {
    warnings.push('Browser storage is unavailable. Navigation or refresh may lose the current session.');
  }
  return {
    results: [...results.values()].sort((a, b) => a.test_date.localeCompare(b.test_date) || a.id.localeCompare(b.id)),
    // A pending result always supersedes the active record for that same ID.
    sessions: sessions.filter(session => !results.has(session.id))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id)),
    activeCopyIds,
    completedCopyIds,
    pendingCopyIds: new Set(pending.results.map(result => result.id)),
    warning: [...new Set(warnings.filter(Boolean))].join(' '),
  };
}
