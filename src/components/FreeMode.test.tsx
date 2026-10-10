import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import type { TestHistory, Word } from '@/lib/supabase';
import FreeMode from './FreeMode';
import { StrictMode } from 'react';
import { legacyPracticeKey, practiceSessionKey } from '@/lib/practiceSessions';

const storageKey = practiceSessionKey('user-a');

describe('Practice account storage isolation', () => {
  const bKey = practiceSessionKey('user-b');
  const progress = (userId = 'user-a') => ({
    userId, queueIds: ['remaining'], direction: 'geo-to-en', orderMode: 'db-order',
    allowReguess: false, totalAttempts: 3, correctCount: 2,
    mistakes: [{ word_id: 'done', english_word: 'done', user_answer: 'wrong', correct_definitions: ['done'] }],
    attemptedWordIds: ['done'], hasChecked: false,
  });

  it('keeps two accounts independent through progress, reset, ordering, sign-out and return', async () => {
    const aWords = [word({ id: 'a1', english_word: 'A first', georgian_definitions: ['A meaning'] }),
      word({ id: 'a2', english_word: 'A second', georgian_definitions: ['A next'] })];
    const bWords = [word({ id: 'b1', user_id: 'user-b', english_word: 'B first' }),
      word({ id: 'b2', user_id: 'user-b', english_word: 'B second' })];
    supabaseMock.from.mockImplementation(() => query({ data: authMock.user?.id === 'user-a' ? aWords : bWords, error: null }));
    const { rerender } = render(<FreeMode />);
    const user = userEvent.setup();
    await screen.findByRole('textbox');
    await user.click(screen.getByRole('button', { name: 'In database order' }));
    await user.click(screen.getByRole('button', { name: 'Georgian → English' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'private A wrong answer' } });
    await user.click(screen.getByRole('button', { name: 'Check Answer' }));
    await user.click(screen.getByText('Allow re-guessing wrong answers').parentElement!.querySelector('button')!);
    await user.click(screen.getByRole('button', { name: 'Next Word' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A unfinished input' } });
    const aCopy = localStorage.getItem(storageKey);
    expect(JSON.parse(aCopy!)).toMatchObject({ queueIds: ['a2', 'a1'], direction: 'geo-to-en', orderMode: 'db-order', allowReguess: true,
      totalAttempts: 1, correctCount: 0, attemptedWordIds: ['a1'], hasChecked: false,
      mistakes: [expect.objectContaining({ user_answer: 'private A wrong answer' })] });

    authMock.user = { id: 'user-b' };
    rerender(<FreeMode />);
    expect(await screen.findByRole('textbox')).toHaveValue('');
    expect(screen.queryByText('A next')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('A unfinished input')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(bKey)!)).toMatchObject({ userId: 'user-b', direction: 'en-to-geo',
      orderMode: 'random', allowReguess: false, totalAttempts: 0, correctCount: 0, mistakes: [], attemptedWordIds: [], hasChecked: false });
    await user.click(screen.getByRole('button', { name: 'In database order' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wrong B' } });
    await user.click(screen.getByRole('button', { name: 'Check Answer' }));
    await user.click(screen.getByRole('button', { name: 'Reset Progress' }));
    await user.click(screen.getAllByRole('button', { name: 'Reset Progress' }).at(-1)!);
    expect(JSON.parse(localStorage.getItem(bKey)!)).toMatchObject({ totalAttempts: 0, mistakes: [] });
    expect(localStorage.getItem(storageKey)).toBe(aCopy);
    await user.click(screen.getByRole('button', { name: 'Random' }));
    expect(localStorage.getItem(storageKey)).toBe(aCopy);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'დათმობა' } });
    await user.click(screen.getByRole('button', { name: 'Check Answer' }));
    await user.click(screen.getByRole('button', { name: 'Next Word' }));
    const bCopy = localStorage.getItem(bKey);
    expect(JSON.parse(bCopy!)).toMatchObject({ totalAttempts: 1, correctCount: 1, orderMode: 'random' });
    authMock.user = null;
    rerender(<FreeMode />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(aCopy);
    expect(localStorage.getItem(bKey)).toBe(bCopy);
    authMock.user = { id: 'user-a' };
    rerender(<FreeMode />);
    await screen.findByText('A next');
    expect(localStorage.getItem(storageKey)).toBe(aCopy);
    authMock.user = { id: 'user-b' };
    rerender(<FreeMode />);
    await screen.findByRole('textbox');
    expect(localStorage.getItem(bKey)).toBe(bCopy);
  });

  it('leaves A legacy progress intact for B, then migrates A safely across StrictMode and remounts', async () => {
    const legacy = JSON.stringify(progress());
    localStorage.setItem(legacyPracticeKey, legacy);
    authMock.user = { id: 'user-b' };
    supabaseMock.from.mockImplementation(() => query({ data: [word({ id: 'remaining', user_id: authMock.user!.id })], error: null }));
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(localStorage.getItem(legacyPracticeKey)).toBe(legacy);
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(bKey)!)).toMatchObject({ totalAttempts: 0, mistakes: [] });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(localStorage.getItem(legacyPracticeKey)).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject(progress());
    expect(writes.mock.calls.filter(([key]) => key === storageKey).every(([, raw]) => JSON.parse(raw).totalAttempts === 3)).toBe(true);
    const copy = localStorage.getItem(storageKey);
    view.unmount();
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(localStorage.getItem(storageKey)).toBe(copy);
  });

  it('preserves checked-answer restoration by advancing only the checked word', async () => {
    localStorage.setItem(storageKey, JSON.stringify({ ...progress(), queueIds: ['checked', 'remaining'], attemptedWordIds: ['done', 'checked'], hasChecked: true }));
    supabaseMock.from.mockReturnValue(query({ data: [word({ id: 'checked' }), word({ id: 'remaining' })], error: null }));
    render(<FreeMode />);
    expect(await screen.findByRole('textbox')).toHaveValue('');
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({ ...progress(), queueIds: ['remaining'], attemptedWordIds: ['done', 'checked'] });
  });

  it('does not autosave over legacy progress when migration writes fail', async () => {
    const legacy = JSON.stringify(progress());
    localStorage.setItem(legacyPracticeKey, legacy);
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    supabaseMock.from.mockReturnValue(query({ data: [word({ id: 'remaining' })], error: null }));
    render(<StrictMode><FreeMode /></StrictMode>);
    expect(await screen.findByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent('original browser copy has been kept');
    expect(localStorage.getItem(legacyPracticeKey)).toBe(legacy);
    expect(writes.mock.calls.every(([, raw]) => JSON.parse(raw).totalAttempts === 3)).toBe(true);
  });

  it('preserves incompatible scoped data instead of replacing it with initial progress', async () => {
    const raw = JSON.stringify({ ...progress('user-b'), mistakes: [] });
    localStorage.setItem(storageKey, raw);
    supabaseMock.from.mockReturnValue(query({ data: [word()], error: null }));
    render(<FreeMode />);
    await screen.findByRole('textbox');
    expect(screen.getByRole('alert')).toHaveTextContent('kept unchanged');
    expect(localStorage.getItem(storageKey)).toBe(raw);
  });

  it.each(['success', 'failure'] as const)('isolates an old account save %s after switching accounts', async outcome => {
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    const { user, rerender } = await completePractice({ save });
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    const aCopy = localStorage.getItem(storageKey);
    authMock.user = { id: 'user-b' };
    const bWord = word({ id: 'b', user_id: 'user-b', english_word: 'B private word' });
    supabaseMock.from.mockReturnValue(query({ data: [bWord], error: null }));
    rerender(<FreeMode />);
    await screen.findByText('B private word');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B input' } });
    const bCopy = localStorage.getItem(bKey);
    await act(async () => {
      if (outcome === 'success') pending.resolve({ error: null });
      else pending.reject(new Error('old save failed'));
    });
    expect(screen.getByRole('textbox')).toHaveValue('B input');
    expect(screen.queryByText('Result saved to History')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to save result')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(localStorage.getItem(bKey)).toBe(bCopy);
    expect(localStorage.getItem(storageKey)).toBe(outcome === 'success' ? null : aCopy);
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user_id: 'user-a' }));
  });
});

describe('Practice vocabulary read errors', () => {
  it('preserves a completed unsaved result through a vocabulary failure and read retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: { message: 'save offline' } });
    const { user, rerender, current } = await completePractice({ save });
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Failed to save result');
    const stored = localStorage.getItem(storageKey);
    const snapshot = structuredClone(save.insert.mock.calls[0][0]);
    const vocabulary = query({ error: { message: 'read offline' } });
    supabaseMock.from.mockImplementation(table => table === 'words' ? vocabulary : save);
    authMock.user = { id: 'user-b' };
    rerender(<FreeMode />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load your vocabulary');
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Save' })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
    const recovered = query({ data: [current], error: null });
    supabaseMock.from.mockImplementation(table => table === 'words' ? recovered : save);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Unable to load your vocabulary. Please try again.')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
    expect(save.insert).toHaveBeenCalledOnce();
    authMock.user = { id: 'user-a' };
    rerender(<FreeMode />);
    await waitFor(() => expect(recovered.eq).toHaveBeenCalledWith('user_id', 'user-a'));
    save.insert.mockResolvedValueOnce({ error: null });
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(snapshot);
  });

  it.each(['returned', 'rejected'] as const)('preserves restored progress through a %s read failure and retry', async kind => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const saved = {
      userId: 'user-a', queueIds: ['remaining'], orderMode: 'db-order', direction: 'en-to-geo',
      totalAttempts: 3, correctCount: 2, mistakes: [{ word_id: 'done', english_word: 'done', user_answer: 'wrong', correct_definitions: ['done'] }],
      attemptedWordIds: ['done'], hasChecked: false, allowReguess: false,
    };
    localStorage.setItem(storageKey, JSON.stringify(saved));
    const failed = deferred<QueryResult>();
    // Session restoration changes ordering, so both reads share the controlled outcome.
    const failedRead = query(failed.promise);
    supabaseMock.from.mockReturnValue(failedRead);
    render(<FreeMode />);
    const stored = localStorage.getItem(storageKey);
    await act(async () => {
      if (kind === 'returned') failed.resolve({ error: { message: 'private details' } });
      else failed.reject(new Error('private details'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your vocabulary. Please try again.');
    expect(screen.queryByText('Ready to Start Learning?')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
    const retryPending = deferred<QueryResult>();
    const retry = query(retryPending.promise);
    supabaseMock.from.mockReturnValue(retry);
    const button = screen.getByRole('button', { name: 'Retry' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    fireEvent.click(button);
    expect(screen.getByText('Loading your words...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
    await act(async () => retryPending.resolve({ data: [word({ id: 'remaining' })], error: null }));
    expect(screen.getByText('yield')).toBeInTheDocument();
    expect(retry.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(retry.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject(saved);
    expect(supabaseMock.from.mock.calls.every(([table]) => table === 'words')).toBe(true);
    expect(retry.insert).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
  });

  it('shows the empty vocabulary screen only after a successful empty read', async () => {
    supabaseMock.from.mockReturnValue(query({ data: [], error: null }));
    render(<FreeMode />);
    expect(await screen.findByText('Ready to Start Learning?')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not let an obsolete ordering success clear the current error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem(storageKey, JSON.stringify({ userId: 'user-a', orderMode: 'db-order', queueIds: ['word-1'] }));
    const old = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query({ error: { message: 'latest failed' } }));
    render(<FreeMode />);
    await screen.findByRole('alert');
    const stored = localStorage.getItem(storageKey);
    await act(async () => old.resolve({ data: [word()], error: null }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('yield')).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
  });

  it('keeps the new account successful after an old error and ignores failures after unmount', async () => {
    const old = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise));
    const { rerender, unmount } = render(<FreeMode />);
    authMock.user = { id: 'user-b' };
    const current = query({ data: [word({ user_id: 'user-b' })], error: null });
    supabaseMock.from.mockReturnValueOnce(current);
    rerender(<FreeMode />);
    await screen.findByText('yield');
    await act(async () => old.reject(new Error('old account')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(current.eq).toHaveBeenCalledWith('user_id', 'user-b');
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(pending.promise));
    authMock.user = { id: 'user-c' };
    rerender(<FreeMode />);
    unmount();
    await act(async () => pending.reject(new Error('unmounted')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('Practice vocabulary read races', () => {
  function orderingRace() {
    // Restoration changes the initial random request to database order while it is pending.
    localStorage.setItem(storageKey, JSON.stringify({
      userId: 'user-a', queueIds: ['new'], orderMode: 'db-order', direction: 'en-to-geo',
      totalAttempts: 1, correctCount: 1, mistakes: [], attemptedWordIds: ['completed'],
    }));
    const old = deferred<QueryResult>();
    const current = deferred<QueryResult>();
    const oldQuery = query(old.promise);
    const newQuery = query(current.promise);
    supabaseMock.from.mockReturnValueOnce(oldQuery).mockReturnValueOnce(newQuery);
    const view = render(<FreeMode />);
    expect(oldQuery.order).not.toHaveBeenCalled();
    expect(newQuery.order).toHaveBeenCalledWith('created_at', { ascending: true });
    return { old, current, ...view };
  }

  it('keeps the latest ordering and restored progress when the old request finishes last', async () => {
    const { old, current } = orderingRace();
    await act(async () => current.resolve({ data: [word({ id: 'new', english_word: 'current vocabulary' })], error: null }));
    expect(screen.getByText('current vocabulary')).toBeInTheDocument();
    await act(async () => old.resolve({ data: [word({ english_word: 'obsolete vocabulary' })], error: null }));
    expect(screen.getByText('current vocabulary')).toBeInTheDocument();
    expect(screen.queryByText('obsolete vocabulary')).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
      orderMode: 'db-order', queueIds: ['new'], correctCount: 1, totalAttempts: 1,
      attemptedWordIds: ['completed'],
    });
  });

  it('keeps loading while the current ordering request is pending', async () => {
    const { old, current } = orderingRace();
    await act(async () => old.resolve({ data: [word()], error: null }));
    expect(screen.getByText('Loading your words...')).toBeInTheDocument();
    await act(async () => current.resolve({ data: [word({ id: 'new' })], error: null }));
    expect(screen.queryByText('Loading your words...')).not.toBeInTheDocument();
    expect(screen.getByText('yield')).toBeInTheDocument();
  });

  it.each(['returned', 'rejected'] as const)('ignores stale %s errors without damaging progress', async kind => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { old, current } = orderingRace();
    await act(async () => current.resolve({ data: [word({ id: 'new' })], error: null }));
    const stored = localStorage.getItem(storageKey);
    await act(async () => {
      if (kind === 'returned') old.resolve({ error: { message: 'Old failure' } });
      else old.reject(new Error('Old failure'));
    });
    expect(screen.getByText('yield')).toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
    expect(logged).not.toHaveBeenCalled();
  });

  it('does not apply a previous account response after switching users', async () => {
    const a = deferred<QueryResult>();
    const b = deferred<QueryResult>();
    const bQuery = query(b.promise);
    supabaseMock.from.mockReturnValueOnce(query(a.promise)).mockReturnValueOnce(bQuery);
    const { rerender } = render(<FreeMode />);
    authMock.user = { id: 'user-b' };
    rerender(<FreeMode />);
    expect(bQuery.eq).toHaveBeenCalledWith('user_id', 'user-b');
    await act(async () => b.resolve({ data: [word({ id: 'b', user_id: 'user-b', english_word: 'B vocabulary' })], error: null }));
    await act(async () => a.resolve({ data: [word({ english_word: 'A vocabulary' })], error: null }));
    expect(screen.getByText('B vocabulary')).toBeInTheDocument();
    expect(screen.queryByText('A vocabulary')).not.toBeInTheDocument();
    authMock.user = null;
    rerender(<FreeMode />);
    expect(screen.queryByText('B vocabulary')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading your words...')).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)('ignores a pending %s after unmount', async completion => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(pending.promise));
    const { unmount } = render(<FreeMode />);
    unmount();
    const stored = localStorage.getItem(storageKey);
    await act(async () => {
      if (completion === 'resolve') pending.resolve({ data: [word()], error: null });
      else pending.reject(new Error('Unmounted'));
    });
    expect(localStorage.getItem(storageKey)).toBe(stored);
    expect(logged).not.toHaveBeenCalled();
  });
});

beforeEach(() => {
  // Progress animation/focus frames are unrelated to persistence and can otherwise
  // schedule updates outside interactions. Keep these stubs local to Practice tests.
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

async function completePractice(options: {
  current?: Word; direction?: TestHistory['test_direction']; answers?: string[];
  save?: ReturnType<typeof query>;
} = {}) {
  const current = options.current ?? word();
  localStorage.setItem(storageKey, JSON.stringify({
    userId: 'user-a', queueIds: [current.id], direction: options.direction ?? 'en-to-geo',
    orderMode: 'db-order', allowReguess: false, correctCount: 0, totalAttempts: 0,
    mistakes: [], attemptedWordIds: [], hasChecked: false,
  }));
  const load = query({ data: [current], error: null });
  const save = options.save ?? query();
  supabaseMock.from.mockImplementation((table) => {
    if (table === 'words') return load;
    if (table === 'test_history') return save;
    throw new Error(`Unexpected table: ${table}`);
  });
  const view = render(<FreeMode />);
  const user = userEvent.setup();
  const expectedInputs = options.direction === 'geo-to-en' && current.is_irregular_verb ? 3 : 1;
  await waitFor(() => expect(screen.getAllByRole('textbox')).toHaveLength(expectedInputs));
  const inputs = screen.getAllByRole('textbox');
  for (const [index, input] of inputs.entries()) {
    fireEvent.change(input, { target: { value: options.answers?.[index] ?? 'wrong' } });
  }
  await user.click(screen.getByRole('button', { name: 'Check Answer' }));
  await user.click(screen.getByRole('button', { name: 'Finish Practice' }));
  await screen.findByRole('heading', { name: 'Practice Summary' });
  return { ...view, user, current, load, save };
}

describe('FreeMode save lifecycle', () => {
  it.each(['returned', 'thrown'] as const)('preserves the result after a %s insert error and retries the exact snapshot', async (kind) => {
    const error = new Error('Save unavailable');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query();
    save.insert.mockImplementationOnce(() => kind === 'returned'
      ? Promise.resolve({ error }) : Promise.reject(error));
    const { current, user } = await completePractice({ save });
    expect(screen.queryByRole('button', { name: 'Close without saving' })).not.toBeInTheDocument();
    const stored = localStorage.getItem(storageKey);
    expect(JSON.parse(stored!).totalAttempts).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Failed to save result');
    expect(screen.getByRole('heading', { name: 'Practice Summary' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject(JSON.parse(stored!));
    expect(screen.getByRole('button', { name: 'Retry Save' })).toBeEnabled();
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving history:', error);
    const captured = structuredClone(save.insert.mock.calls[0][0]);
    expect(captured).toEqual({
      user_id: 'user-a', test_date: expect.any(String), test_direction: 'en-to-geo',
      total_words: 1, correct_count: 0, mistakes: [{
        english_word: 'yield', question_prompt: 'yield', user_answer: 'wrong',
        correct_definitions: ['დათმობა', 'მოსავლიანობა'],
      }],
    });
    current.english_word = 'edited source';
    current.georgian_definitions[0] = 'edited definition';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(captured);
    expect(save.insert).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('clears a completed result only after confirmed success and prevents overlapping inserts', async () => {
    const otherKey = practiceSessionKey('user-b');
    localStorage.setItem(otherKey, 'another account recovery copy');
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    await completePractice({ save, answers: ['დათმობა'] });
    const stored = localStorage.getItem(storageKey);
    const button = screen.getByRole('button', { name: 'Close & Save' });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(save.insert).toHaveBeenCalledOnce();
    expect(save.insert).toHaveBeenCalledWith(expect.objectContaining({ correct_count: 1, mistakes: [] }));
    expect(button).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Practice Summary' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({ ...JSON.parse(stored!), completedResult: save.insert.mock.calls[0][0] });
    await act(async () => { pending.resolve({ error: null }); });
    await screen.findByText('Result saved to History');
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(localStorage.getItem(otherKey)).toBe('another account recovery copy');
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(save.insert).toHaveBeenCalledOnce();
  });

  it('refuses to retry User A’s result as User B and retains it for the original account', async () => {
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: failure });
    const { user, rerender, load } = await completePractice({ save });
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Failed to save result');
    const stored = localStorage.getItem(storageKey);
    const captured = structuredClone(save.insert.mock.calls[0][0]);
    authMock.user = { id: 'user-b' };
    rerender(<FreeMode />);
    await waitFor(() => expect(load.eq).toHaveBeenCalledWith('user_id', 'user-b'));
    expect(screen.queryByRole('button', { name: 'Retry Save' })).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving history:', failure);
    expect(localStorage.getItem(storageKey)).toBe(stored);
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    authMock.user = { id: 'user-a' };
    save.insert.mockResolvedValueOnce({ error: null });
    rerender(<FreeMode />);
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(captured);
  });

  it('offers discard only after failure; cancel retains the result and confirmation clears it', async () => {
    const otherKey = practiceSessionKey('user-b');
    localStorage.setItem(otherKey, 'another account recovery copy');
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: failure });
    const { user } = await completePractice({ save });
    expect(screen.queryByRole('button', { name: 'Close without saving' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Failed to save result');
    const stored = localStorage.getItem(storageKey);
    await user.click(screen.getByRole('button', { name: 'Close without saving' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Practice Summary' })).toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe(stored);
    await user.click(screen.getByRole('button', { name: 'Close without saving' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard result' }));
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(localStorage.getItem(otherKey)).toBe('another account recovery copy');
    expect(save.insert).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving history:', failure);
  });
});

describe('FreeMode history snapshots', () => {
  it.each([
    { direction: 'en-to-geo', irregular: false, prompt: 'go', correct: ['წასვლა', 'სვლა'] },
    { direction: 'geo-to-en', irregular: false, prompt: 'წასვლა, სვლა', correct: ['go'] },
    { direction: 'geo-to-en', irregular: true, prompt: 'წასვლა, სვლა', correct: ['go', 'went', 'gone'] },
  ] as const)('stores $direction answers (irregular=$irregular) in order', async ({ direction, irregular, prompt, correct }) => {
    const { user, save } = await completePractice({
      direction, current: word({ english_word: 'go', georgian_definitions: ['წასვლა', 'სვლა'],
        is_irregular_verb: irregular, past_simple: 'went', past_participle: 'gone' }),
    });
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[0][0].mistakes).toEqual([{
      english_word: 'go', question_prompt: prompt,
      user_answer: irregular ? 'wrong, wrong, wrong' : 'wrong', correct_definitions: correct,
    }]);
  });

  it('accepts all three irregular English forms in their proper positions', async () => {
    const { user, save } = await completePractice({
      direction: 'geo-to-en', answers: [' GO ', 'went', 'GONE'],
      current: word({ english_word: 'go', is_irregular_verb: true, past_simple: 'went', past_participle: 'gone' }),
    });
    await user.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledWith(expect.objectContaining({ correct_count: 1, mistakes: [] }));
  });
});
