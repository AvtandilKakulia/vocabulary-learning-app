import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import type { TestHistory, Word } from '@/lib/supabase';
import FreeMode from './FreeMode';

const storageKey = 'vocab_practice_session_state_v2';

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
    expect(localStorage.getItem(storageKey)).toBe(stored);
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
    expect(localStorage.getItem(storageKey)).toBe(stored);
    await act(async () => { pending.resolve({ error: null }); });
    await screen.findByText('Result saved to History');
    expect(localStorage.getItem(storageKey)).toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    expect(save.insert).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenLastCalledWith('Error saving history:',
      expect.objectContaining({ message: expect.stringContaining('account that completed') }));
    expect(localStorage.getItem(storageKey)).toBe(stored);
    expect(screen.getByRole('heading', { name: 'Practice Summary' })).toBeInTheDocument();
    authMock.user = { id: 'user-a' };
    save.insert.mockResolvedValueOnce({ error: null });
    rerender(<FreeMode />);
    await user.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(captured);
  });

  it('offers discard only after failure; cancel retains the result and confirmation clears it', async () => {
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
