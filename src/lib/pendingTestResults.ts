import type { TestHistory, TestMistake } from './supabase';

export type CompletedTestResult = Omit<TestHistory, 'created_at'>;

const storagePrefix = 'vocab_pending_test';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isMistake(value: unknown): value is TestMistake {
  return isObject(value) && typeof value.english_word === 'string' &&
    typeof value.user_answer === 'string' && Array.isArray(value.correct_definitions) &&
    value.correct_definitions.every(definition => typeof definition === 'string') &&
    (value.question_prompt === undefined || typeof value.question_prompt === 'string') &&
    (value.description == null || typeof value.description === 'string');
}

function isResult(value: unknown, userId: string): value is CompletedTestResult {
  return isObject(value) && typeof value.id === 'string' && uuid.test(value.id) &&
    value.user_id === userId && typeof value.test_date === 'string' &&
    Number.isFinite(Date.parse(value.test_date)) &&
    (value.test_direction === 'en-to-geo' || value.test_direction === 'geo-to-en') &&
    Number.isInteger(value.total_words) && Number(value.total_words) > 0 &&
    Number.isInteger(value.correct_count) && Number(value.correct_count) >= 0 &&
    Number(value.correct_count) <= Number(value.total_words) &&
    Array.isArray(value.mistakes) && value.mistakes.every(isMistake) &&
    value.mistakes.length === Number(value.total_words) - Number(value.correct_count);
}

function accountPrefix(userId: string) {
  return `${storagePrefix}:${encodeURIComponent(userId)}:`;
}

export function pendingTestKey(result: Pick<CompletedTestResult, 'user_id' | 'id'>) {
  return `${accountPrefix(result.user_id)}${result.id}`;
}

// Whitelist payload fields; never replay arbitrary extra properties from storage.
function snapshot(result: CompletedTestResult): CompletedTestResult {
  return {
    id: result.id, user_id: result.user_id, test_date: result.test_date,
    test_direction: result.test_direction, total_words: result.total_words,
    correct_count: result.correct_count,
    mistakes: result.mistakes.map(mistake => ({
      english_word: mistake.english_word, user_answer: mistake.user_answer,
      correct_definitions: [...mistake.correct_definitions],
      ...(mistake.question_prompt === undefined ? {} : { question_prompt: mistake.question_prompt }),
      ...(mistake.description === undefined ? {} : { description: mistake.description }),
    })),
  };
}

export function readPendingTests(userId: string): { results: CompletedTestResult[]; warning: string } {
  const results: CompletedTestResult[] = [];
  let warning = '';
  try {
    const storage = window.localStorage;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(accountPrefix(userId))) continue;
      try {
        const stored: unknown = JSON.parse(storage.getItem(key) ?? 'null');
        if (!isObject(stored) || stored.version !== 1 || !isResult(stored.result, userId) ||
          pendingTestKey(stored.result) !== key) throw new Error('Invalid pending result');
        results.push(snapshot(stored.result));
      } catch {
        // Keep unreadable/newer-version entries intact rather than deleting user data.
        warning = 'Some pending test data could not be restored. Its browser copy has been left unchanged.';
      }
    }
  } catch {
    warning = 'Browser storage is unavailable. Pending test results could not be read.';
  }
  results.sort((a, b) => a.test_date.localeCompare(b.test_date) || a.id.localeCompare(b.id));
  return { results, warning };
}

export function persistPendingTest(result: CompletedTestResult): boolean {
  try {
    // One key per result avoids overwriting completed tests from another tab.
    window.localStorage.setItem(pendingTestKey(result), JSON.stringify({ version: 1, result: snapshot(result) }));
    return true;
  } catch {
    return false;
  }
}

export function removePendingTest(result: CompletedTestResult): boolean {
  try {
    window.localStorage.removeItem(pendingTestKey(result));
    return true;
  } catch {
    return false;
  }
}

export function matchesCompletedTest(value: unknown, expected: CompletedTestResult): boolean {
  if (!isResult(value, expected.user_id)) return false;
  // PostgreSQL may return an equivalent timestamp with a different timezone spelling.
  // JSONB object key order also differs, so compare a canonical field projection.
  return JSON.stringify({ ...snapshot(value), test_date: new Date(value.test_date).toISOString() }) ===
    JSON.stringify({ ...snapshot(expected), test_date: new Date(expected.test_date).toISOString() });
}
