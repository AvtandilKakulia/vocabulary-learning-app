import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import type { TestHistory, Word } from '@/lib/supabase';
import TestMode from './TestMode';
import { pendingTestKey, persistPendingTest, type CompletedTestResult } from '@/lib/pendingTestResults';

type Direction = TestHistory['test_direction'];

beforeEach(() => {
  // Keep fixture question selection deterministic; assertions do not rely on option order.
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
});

async function start(vocabulary: Word[], options: {
  direction?: Direction; count?: number; input?: 'text' | 'multiple';
  save?: ReturnType<typeof query>;
} = {}) {
  const load = query({ data: vocabulary, error: null });
  const save = options.save ?? query();
  supabaseMock.from.mockImplementation((table) => {
    if (table === 'words') return load;
    if (table === 'test_history') return save;
    throw new Error(`Unexpected table: ${table}`);
  });
  const user = userEvent.setup();
  const view = render(<TestMode />);
  await user.click(screen.getByRole('button', {
    name: options.direction === 'geo-to-en' ? 'Georgian → English' : 'English → Georgian',
  }));
  await user.type(screen.getByPlaceholderText('Custom'), String(options.count ?? 1));
  await user.click(screen.getByRole('button', { name: options.input === 'multiple' ? 'Multiple Choice' : 'Text Input' }));
  await user.click(screen.getByRole('button', { name: 'Start Test' }));
  await screen.findByText(`Question 1 of ${options.count ?? 1}`);
  expect(load.eq).toHaveBeenCalledWith('user_id', 'user-a');
  return { user, save, ...view };
}

async function answerText(answer: string) {
  fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: answer } });
  await userEvent.click(screen.getByRole('button', { name: /^(Next Question|Finish Test)$/ }));
}

function optionLabels() {
  return screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value);
}

describe('TestMode answer evaluation and history snapshots', () => {
  it.each([
    ['en-to-geo', 'დათმობა', 1],
    ['en-to-geo', '  მოსავლიანობა  ', 1],
    ['en-to-geo', 'unrelated', 0],
    ['en-to-geo', 'მოსავალი', 0],
    ['geo-to-en', '  YIELD  ', 1],
    ['geo-to-en', 'დათმობა', 0],
  ] as const)('%s evaluates %j against the current sense (score %i)', async (direction, answer, score) => {
    const { save } = await start([
      word(), word({ id: 'other-sense', georgian_definitions: ['მოსავალი'] }),
    ], { direction });
    await answerText(answer);
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledOnce();
    expect(save.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-a', test_direction: direction, total_words: 1, correct_count: score,
      mistakes: score ? [] : [expect.objectContaining({ user_answer: answer })],
    }));
  });

  it.each(['en-to-geo', 'geo-to-en'] as const)('captures %s prompt, description, and direction-aware answers', async (direction) => {
    const current = word({ description: '<strong>Road sense</strong>',
      is_irregular_verb: true, past_simple: 'yielded', past_participle: 'yielded' });
    const { save } = await start([current], { direction });
    // TestMode retains its single-answer behavior even for an irregular word.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await answerText('wrong');
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[0][0].mistakes).toEqual([{
      english_word: 'yield', user_answer: 'wrong', description: '<strong>Road sense</strong>',
      question_prompt: direction === 'en-to-geo' ? 'yield' : 'დათმობა, მოსავლიანობა',
      correct_definitions: direction === 'en-to-geo' ? ['დათმობა', 'მოსავლიანობა'] : ['yield'],
    }]);
  });
});

function completed(overrides: Partial<CompletedTestResult> = {}): CompletedTestResult {
  return {
    id: '2e0e550a-23b3-40c7-bde1-9f3b60a087f1', user_id: 'user-a',
    test_date: '2026-01-02T10:00:00.000Z', test_direction: 'geo-to-en',
    total_words: 2, correct_count: 1, mistakes: [{
      english_word: 'yield', question_prompt: 'დათმობა, მოსავლიანობა', user_answer: 'wrong',
      description: '<strong>Original context</strong>', correct_definitions: ['yield'],
    }], ...overrides,
  };
}

describe('TestMode pending result recovery', () => {
  it.each(['returned', 'thrown'] as const)('persists the exact payload before a %s save failure, then retries it', async (kind) => {
    const failure = new Error('Network unavailable');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query();
    save.insert.mockImplementationOnce((result: CompletedTestResult) => {
      expect(JSON.parse(localStorage.getItem(pendingTestKey(result))!)).toEqual({ version: 1, result });
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      return kind === 'returned' ? Promise.resolve({ error: failure }) : Promise.reject(failure);
    });
    const { user } = await start([word()], { save });
    await answerText('wrong');
    await screen.findByText('Failed to save result');
    const original = structuredClone(save.insert.mock.calls[0][0]);
    const stored = localStorage.getItem(pendingTestKey(original));
    expect(Object.keys(JSON.parse(stored!).result).sort()).toEqual([
      'correct_count', 'id', 'mistakes', 'test_date', 'test_direction', 'total_words', 'user_id',
    ]);
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(original);
    expect(localStorage.getItem(pendingTestKey(original))).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Take Another Test' }));
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
  });

  it('requires explicit discard after failure, and Cancel keeps the result and browser copy', async () => {
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: failure });
    const { user } = await start([word()], { save });
    await answerText('wrong');
    await screen.findByText('Failed to save result');
    const payload = save.insert.mock.calls[0][0];
    const stored = localStorage.getItem(pendingTestKey(payload));
    await user.click(screen.getByRole('button', { name: 'Take Another Test' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('cannot retry it here');
    expect(screen.getByRole('button', { name: 'Retry Save' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(localStorage.getItem(pendingTestKey(payload))).toBe(stored);
    expect(screen.getByRole('heading', { name: 'Test Results' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take Another Test' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard result' }));
    expect(localStorage.getItem(pendingTestKey(payload))).toBeNull();
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
  });

  it('recovers after navigating away and returning without fetching vocabulary or automatically saving', async () => {
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: failure });
    const { user, rerender } = await start([word()], { save, direction: 'geo-to-en' });
    await answerText('wrong');
    await screen.findByText('Failed to save result');
    const original = structuredClone(save.insert.mock.calls[0][0]);
    // App.tsx switches views by conditionally unmounting TestMode in this way.
    rerender(<div>Another view</div>);
    supabaseMock.from.mockClear();
    rerender(<TestMode />);
    expect(screen.getByRole('status')).toHaveTextContent('Recovered a completed test');
    expect(screen.getByText('0 out of 1 correct')).toBeInTheDocument();
    expect(screen.getByText('დათმობა, მოსავლიანობა')).toBeInTheDocument();
    expect(screen.getByText('Road context')).toBeInTheDocument();
    expect(supabaseMock.from).not.toHaveBeenCalled();
    save.insert.mockResolvedValueOnce({ error: null });
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(original);
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
  });

  it('restores only the authenticated account on a fresh mount and hides it immediately on account changes', () => {
    const a = completed();
    const b = completed({ id: 'cf2c1807-58a2-43fa-952a-970da720bb9b', user_id: 'user-b',
      total_words: 5, correct_count: 5, mistakes: [] });
    persistPendingTest(a);
    persistPendingTest(b);
    const view = render(<React.StrictMode><TestMode /></React.StrictMode>);
    expect(screen.getByText('1 out of 2 correct')).toBeInTheDocument();
    authMock.user = { id: 'user-b' };
    view.rerender(<React.StrictMode><TestMode /></React.StrictMode>);
    expect(screen.getByText('5 out of 5 correct')).toBeInTheDocument();
    expect(screen.queryByText('Original context')).not.toBeInTheDocument();
    authMock.user = null;
    view.rerender(<TestMode />);
    expect(screen.queryByRole('heading', { name: 'Test Results' })).not.toBeInTheDocument();
    view.unmount();
    authMock.user = { id: 'user-a' };
    render(<TestMode />);
    expect(screen.getByText('Original context')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(pendingTestKey(a))!).result).toEqual(a);
    expect(JSON.parse(localStorage.getItem(pendingTestKey(b))!).result).toEqual(b);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('keeps another account’s result when the current account discards its own', async () => {
    const a = completed();
    const b = completed({ id: 'cf2c1807-58a2-43fa-952a-970da720bb9b', user_id: 'user-b' });
    persistPendingTest(a);
    persistPendingTest(b);
    authMock.user = { id: 'user-b' };
    const view = render(<TestMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Take Another Test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard result' }));
    expect(localStorage.getItem(pendingTestKey(b))).toBeNull();
    expect(JSON.parse(localStorage.getItem(pendingTestKey(a))!).result).toEqual(a);
    authMock.user = { id: 'user-a' };
    view.rerender(<TestMode />);
    expect(screen.getByText('1 out of 2 correct')).toBeInTheDocument();
  });

  it('keeps the current account isolated from a previous account’s late save response', async () => {
    const a = completed();
    const b = completed({ user_id: 'user-b', total_words: 5, correct_count: 5, mistakes: [] });
    persistPendingTest(a);
    persistPendingTest(b);
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    supabaseMock.from.mockReturnValue(save);
    const view = render(<TestMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry Save' }));
    authMock.user = { id: 'user-b' };
    view.rerender(<TestMode />);
    await act(async () => { pending.resolve({ error: null }); });
    expect(screen.getByText('5 out of 5 correct')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Recovered');
    expect(localStorage.getItem(pendingTestKey(a))).toBeNull();
    expect(JSON.parse(localStorage.getItem(pendingTestKey(b))!).result).toEqual(b);
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(a);
  });

  it.each([
    '{broken json',
    JSON.stringify({ version: 2, result: completed() }),
    JSON.stringify({ version: 1, result: completed({ user_id: 'user-b' }) }),
    JSON.stringify({ version: 1, result: { ...completed(), mistakes: [null] } }),
    JSON.stringify({ version: 1, result: completed({ correct_count: 99 }) }),
  ])('does not crash, replay or delete malformed/incompatible data: %s', (raw) => {
    const key = pendingTestKey(completed());
    localStorage.setItem(key, raw);
    render(<TestMode />);
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be restored');
    expect(localStorage.getItem(key)).toBe(raw);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('handles unavailable storage during restoration without crashing', () => {
    const storage = vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => { throw new Error('Blocked'); });
    render(<TestMode />);
    expect(screen.getByRole('alert')).toHaveTextContent('Browser storage is unavailable');
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    storage.mockRestore();
  });

  it('warns when persistence fails, keeps the in-memory result, and can still retry', async () => {
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: failure });
    const { user } = await start([word()], { save });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    await answerText('wrong');
    await screen.findByText('Failed to save result');
    const original = structuredClone(save.insert.mock.calls[0][0]);
    expect(screen.getByRole('alert')).toHaveTextContent('leaving or refreshing may lose it');
    expect(screen.getByText('0 out of 1 correct')).toBeInTheDocument();
    write.mockRestore();
    save.insert.mockResolvedValueOnce({ error: null });
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(original);
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
  });

  it('does not claim to discard a pending result when browser removal fails', async () => {
    const result = completed();
    persistPendingTest(result);
    render(<TestMode />);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    await userEvent.click(screen.getByRole('button', { name: 'Take Another Test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard result' }));
    expect(screen.getByRole('alert')).toHaveTextContent('result has been kept');
    expect(localStorage.getItem(pendingTestKey(result))).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Retry Save' })).toBeEnabled();
    remove.mockRestore();
  });

  it('retains other pending results and restores the next one after the current result is saved', async () => {
    const first = completed();
    const second = completed({ id: 'cf2c1807-58a2-43fa-952a-970da720bb9b', test_date: '2026-01-03T10:00:00Z',
      total_words: 3, correct_count: 3, mistakes: [] });
    persistPendingTest(first);
    persistPendingTest(second);
    const save = query();
    supabaseMock.from.mockReturnValue(save);
    render(<TestMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(localStorage.getItem(pendingTestKey(first))).toBeNull();
    expect(JSON.parse(localStorage.getItem(pendingTestKey(second))!).result).toEqual(second);
    await userEvent.click(screen.getByRole('button', { name: 'Take Another Test' }));
    expect(screen.getByText('3 out of 3 correct')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Recovered');
    expect(save.insert).toHaveBeenCalledOnce();
  });
});

describe('TestMode idempotent History saving', () => {
  it('recovers an interrupted response and confirms the same committed ID instead of adding another record', async () => {
    const interrupted = deferred<QueryResult>();
    let committed: CompletedTestResult | undefined;
    const save = query();
    save.insert.mockImplementation((result: CompletedTestResult) => {
      if (!committed) {
        committed = structuredClone(result); // Server commits; the browser never receives confirmation.
        return interrupted.promise;
      }
      expect(result).toEqual(committed);
      return Promise.resolve({ error: { code: '23505', message: 'Duplicate primary key' } });
    });
    const { unmount } = await start([word()], { save });
    await answerText('wrong');
    expect(screen.getByRole('status')).toHaveTextContent('Saving result');
    expect(screen.getByRole('button', { name: 'Take Another Test' })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(pendingTestKey(committed!))!).result).toEqual(committed);
    unmount();
    const existing = query({ data: [{ ...committed, test_date: committed!.test_date.replace('Z', '+00:00'),
      // PostgreSQL JSONB can return object keys in a different order.
      mistakes: committed!.mistakes.map(mistake => Object.fromEntries(Object.entries(mistake).reverse())),
    }], error: null });
    save.select.mockReturnValue(existing);
    render(<TestMode />);
    expect(save.insert).toHaveBeenCalledOnce(); // Restoration itself never retries.
    const retry = screen.getByRole('button', { name: 'Retry Save' });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledTimes(2);
    expect(save.select).toHaveBeenCalledOnce();
    expect(existing.eq.mock.calls).toEqual([['id', committed!.id], ['user_id', 'user-a']]);
    expect(save.update).not.toHaveBeenCalled();
    expect(localStorage.getItem(pendingTestKey(committed!))).toBeNull();
    await act(async () => { interrupted.resolve({ error: null }); });
  });

  it.each(['different payload', 'wrong owner', 'no row', 'lookup error'])('keeps recovery data when a conflict cannot be confirmed: %s', async (reason) => {
    const result = completed();
    persistPendingTest(result);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query();
    save.insert.mockResolvedValue({ error: { code: '23505', message: 'Conflict' } });
    const lookup = query({
      data: reason === 'no row' ? [] : [{ ...result,
        ...(reason === 'different payload' ? { total_words: 3 } : {}),
        ...(reason === 'wrong owner' ? { user_id: 'user-b' } : {}),
      }],
      error: reason === 'lookup error' ? { message: 'Select failed' } : null,
    });
    save.select.mockReturnValue(lookup);
    supabaseMock.from.mockReturnValue(save);
    render(<TestMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Failed to save result');
    expect(logged).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith('Error saving test result:', expect.anything());
    expect(JSON.parse(localStorage.getItem(pendingTestKey(result))!).result).toEqual(result);
    expect(lookup.eq.mock.calls).toEqual([['id', result.id], ['user_id', 'user-a']]);
  });

  it('warns if a confirmed save cannot clear storage, with the same ID available for safe recovery', async () => {
    const result = completed();
    persistPendingTest(result);
    supabaseMock.from.mockReturnValue(query());
    render(<TestMode />);
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    await userEvent.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(screen.getByRole('alert')).toHaveTextContent('browser copy could not be removed');
    expect(JSON.parse(localStorage.getItem(pendingTestKey(result))!).result).toEqual(result);
    expect(screen.getByRole('button', { name: 'Take Another Test' })).toBeEnabled();
    remove.mockRestore();
  });
});

describe('TestMode multiple choice', () => {
  it('uses the full frozen session vocabulary on first and later questions', async () => {
    const vocabulary = [
      word({ id: 'a', english_word: 'a', georgian_definitions: ['ა'] }),
      word({ id: 'b', english_word: 'b', georgian_definitions: ['ბ'] }),
      word({ id: 'c', english_word: 'c', georgian_definitions: ['გ'] }),
      word({ id: 'd', english_word: 'd', georgian_definitions: ['დ'] }),
    ];
    const { user, save } = await start(vocabulary, { count: 2, input: 'multiple' });
    expect(new Set(optionLabels())).toEqual(new Set(['ა', 'ბ', 'გ', 'დ']));
    vocabulary[2].georgian_definitions[0] = 'changed after start';
    await user.click(screen.getByRole('radio', { name: 'ა' }));
    await user.click(screen.getByRole('button', { name: 'Next Question' }));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    expect(new Set(optionLabels())).toEqual(new Set(['ა', 'ბ', 'გ', 'დ']));
    await user.click(screen.getByRole('radio', { name: 'ბ' }));
    await user.click(screen.getByRole('button', { name: 'Finish Test' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledWith(expect.objectContaining({ correct_count: 2, mistakes: [] }));
  });

  it('excludes accepted synonyms, overlapping labels, empty labels, and duplicate distractors', async () => {
    await start([
      word(),
      word({ id: 'synonym', english_word: 'surrender', georgian_definitions: [' დათმობა '] }),
      word({ id: 'overlap', english_word: 'produce', georgian_definitions: ['მოსავლიანობა', 'სხვა'] }),
      word({ id: 'safe', english_word: 'cat', georgian_definitions: ['კატა'] }),
      word({ id: 'duplicate', english_word: 'kitten', georgian_definitions: [' კატა '] }),
      word({ id: 'empty', english_word: 'empty', georgian_definitions: [] }),
    ], { input: 'multiple' });
    const labels = optionLabels();
    expect(new Set(labels)).toEqual(new Set(['დათმობა, მოსავლიანობა', 'კატა']));
    expect(labels).toHaveLength(2); // Fewer than four is safer than an ambiguous option.
  });

  it.each([null, '  \n ', 'Agricultural context'])('uses current description %j to disambiguate same-English senses', async (description) => {
    await start([
      word({ description }),
      word({ id: 'other', english_word: ' YIELD ', georgian_definitions: ['მოსავალი'], description: 'Other context' }),
    ], { input: 'multiple' });
    expect(optionLabels()).toContain('დათმობა, მოსავლიანობა');
    expect(optionLabels().includes('მოსავალი')).toBe(Boolean(description?.trim()));
  });

  it('deduplicates English options across senses in Georgian → English', async () => {
    await start([
      word(), word({ id: 'same', english_word: ' YIELD ', georgian_definitions: ['მოსავალი'] }),
      word({ id: 'safe', english_word: 'cat' }), word({ id: 'duplicate', english_word: ' CAT ' }),
    ], { input: 'multiple', direction: 'geo-to-en' });
    expect(new Set(optionLabels())).toEqual(new Set(['yield', 'cat']));
    expect(optionLabels()).toHaveLength(2);
  });
});

describe('TestMode save lifecycle', () => {
  it('shows a returned error and retries the exact completed payload/date only once', async () => {
    const failure = { message: 'Insert denied' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    const save = query();
    save.insert.mockReturnValueOnce(Promise.resolve({ error: failure }))
      .mockReturnValueOnce(pending.promise);
    await start([word()], { save });
    await answerText('wrong');
    await screen.findByText('Failed to save result');
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
    const captured = structuredClone(save.insert.mock.calls[0][0]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const retry = screen.getByRole('button', { name: 'Retry Save' });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    expect(save.insert).toHaveBeenCalledTimes(2);
    expect(save.insert.mock.calls[1][0]).toEqual(captured);
    expect(screen.getByRole('button', { name: 'Take Another Test' })).toBeDisabled();
    await act(async () => { pending.resolve({ error: null }); });
    expect(screen.getByText('Result saved to History')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Save' })).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledTimes(2);
  });

  it('guards rapid final submissions and prevents a new test while the insert is pending', async () => {
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    await start([word()], { save });
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'დათმობა' } });
    const finish = screen.getByRole('button', { name: 'Finish Test' });
    act(() => { fireEvent.click(finish); fireEvent.click(finish); });
    expect(save.insert).toHaveBeenCalledOnce();
    const reset = screen.getByRole('button', { name: 'Take Another Test' });
    expect(reset).toBeDisabled();
    fireEvent.click(reset);
    expect(screen.getByRole('heading', { name: 'Test Results' })).toBeInTheDocument();
    await act(async () => { pending.resolve({ error: null }); });
    await waitFor(() => expect(reset).toBeEnabled());
    await userEvent.click(reset);
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledOnce();
  });
});
