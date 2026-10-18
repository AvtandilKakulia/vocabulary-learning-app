import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import { practiceSessionKey, type StoredPracticeSession } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

const vocabulary = ['a', 'b', 'c'].map(id => word({ id, english_word: id, georgian_definitions: [`meaning ${id}`] }));
const mistake = (id: string) => ({ word_id: id, english_word: id, user_answer: 'wrong', correct_definitions: [`meaning ${id}`] });
const stored = (userId = 'user-a'): StoredPracticeSession => JSON.parse(localStorage.getItem(practiceSessionKey(userId))!);
function seed(overrides: Partial<StoredPracticeSession> = {}) {
  const session: StoredPracticeSession = {
    userId: 'user-a', queueIds: ['a', 'b', 'c'], direction: 'en-to-geo', orderMode: 'db-order',
    allowReguess: false, correctCount: 0, totalAttempts: 0, mistakes: [], attemptedWordIds: [], hasChecked: false,
    ...overrides,
  };
  localStorage.setItem(practiceSessionKey(session.userId), JSON.stringify(session));
}
async function toggle() {
  await userEvent.click(screen.getByText('Allow re-guessing wrong answers').parentElement!.querySelector('button')!);
}
async function answer(value: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  await userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
}
async function next() {
  await userEvent.click(screen.getByRole('button', { name: /^(Next Word|Finish Practice)$/ }));
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  supabaseMock.from.mockImplementation(table => {
    if (table === 'words') return query({ data: vocabulary, error: null });
    throw new Error(`Unexpected table: ${table}`);
  });
});

describe('Practice unresolved wrong-answer retries', () => {
  it('keeps corrected words resolved across toggles and saves the original mistakes and scores', async () => {
    seed();
    const save = query();
    supabaseMock.from.mockImplementation(table => table === 'words' ? query({ data: vocabulary, error: null }) : save);
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await toggle();
    await answer('wrong'); // A retries after B and C.
    await next();
    await answer('wrong'); // B also needs a retry.
    await next();
    await answer('meaning c');
    await next();
    await answer('meaning a'); // A is now resolved, but its historical mistake remains.
    await next();
    expect(stored().queueIds).toEqual(['b']);
    for (let i = 0; i < 3; i += 1) {
      await toggle();
      await toggle();
      expect(stored().queueIds).toEqual(['b']);
    }
    expect(stored()).toMatchObject({ totalAttempts: 4, correctCount: 2, mistakes: [mistake('a'), mistake('b')] });
    await answer('meaning b');
    await next();
    await screen.findByRole('heading', { name: 'Practice Summary' });
    await userEvent.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      user_id: 'user-a', total_words: 5, correct_count: 3,
      mistakes: [
        { english_word: 'a', question_prompt: 'a', user_answer: 'wrong', correct_definitions: ['meaning a'] },
        { english_word: 'b', question_prompt: 'b', user_answer: 'wrong', correct_definitions: ['meaning b'] },
      ],
    }));
    expect(save.insert.mock.calls[0][0]).not.toHaveProperty('unresolvedWordIds');
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
  });

  it.each([true, false])('does not resurrect ambiguous legacy mistakes on restore (attempted IDs present: %s)', async hasAttemptedIds => {
    seed({ queueIds: ['b', 'c'], allowReguess: true, totalAttempts: 2, correctCount: 1,
      mistakes: [mistake('a')], attemptedWordIds: hasAttemptedIds ? ['a'] : undefined });
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValue(query(pending.promise));
    render(<StrictMode><FreeMode /></StrictMode>);
    await act(async () => pending.resolve({ data: vocabulary, error: null }));
    await screen.findByRole('textbox');
    expect(stored().queueIds).toEqual(['b', 'c']);
    await toggle();
    await toggle();
    expect(stored().queueIds).toEqual(['b', 'c']);
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1, mistakes: [mistake('a')] });
  });

  it('appends an unresolved skipped answer only once when the user enables retries', async () => {
    seed();
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    expect(stored().queueIds).toEqual(['b', 'c']);
    for (let i = 0; i < 3; i += 1) {
      await toggle();
      expect(stored().queueIds).toEqual(['b', 'c', 'a']);
      await toggle();
    }
  });

  it.each(['reload', 'navigation'] as const)('preserves corrected progress and pending order after %s with retries enabled', async restore => {
    seed();
    let view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await toggle();
    await answer('wrong');
    await next();
    await answer('wrong');
    await next();
    await answer('meaning c');
    await next();
    await answer('meaning a');
    await next();
    const before = stored();
    expect(before).toMatchObject({ queueIds: ['b'], unresolvedWordIds: ['b'], allowReguess: true });
    if (restore === 'reload') {
      view.unmount();
      view = render(<StrictMode><FreeMode /></StrictMode>);
    } else {
      view.rerender(<div>Words</div>);
      view.rerender(<StrictMode><FreeMode /></StrictMode>);
    }
    await screen.findByRole('textbox');
    expect(stored()).toEqual(before);
    await toggle();
    await toggle();
    expect(stored()).toEqual(before);
  });

  it.each([
    { label: 'unresolved', unresolvedWordIds: ['a'], allowReguess: true, expected: ['b', 'a'] },
    { label: 'resolved', unresolvedWordIds: [], allowReguess: true, expected: ['b'] },
    { label: 'retry disabled', unresolvedWordIds: ['a'], allowReguess: false, expected: ['b'] },
    { label: 'legacy unknown', unresolvedWordIds: undefined, allowReguess: true, expected: ['b'] },
  ])('restores a checked $label answer exactly once under StrictMode', async ({ unresolvedWordIds, allowReguess, expected }) => {
    seed({ queueIds: ['a', 'b'], hasChecked: true, allowReguess, unresolvedWordIds,
      totalAttempts: 3, correctCount: 1, attemptedWordIds: ['a', 'c'], mistakes: [mistake('a'), mistake('c')] });
    render(<StrictMode><FreeMode /></StrictMode>);
    expect(await screen.findByRole('textbox')).toHaveValue('');
    await waitFor(() => expect(stored()).toMatchObject({ queueIds: expected, totalAttempts: 3, correctCount: 1, hasChecked: false }));
    await toggle();
    if (allowReguess) await toggle();
    expect(stored().queueIds).toEqual(unresolvedWordIds?.includes('a') ? ['b', 'a'] : ['b']);
  });

  it('does not treat restoration as a toggle even when a known unresolved ID is outside the saved queue', async () => {
    seed({ queueIds: ['b', 'c'], allowReguess: true, unresolvedWordIds: ['a'],
      attemptedWordIds: ['a'], totalAttempts: 1, mistakes: [mistake('a')] });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(stored().queueIds).toEqual(['b', 'c']);
    await toggle();
    await toggle();
    expect(stored().queueIds).toEqual(['b', 'c', 'a']);
  });

  it('keeps retry eligibility separate for identical spellings with different IDs', async () => {
    seed();
    const meanings = [word({ id: 'a', english_word: 'yield', georgian_definitions: ['დათმობა'] }),
      word({ id: 'b', english_word: 'yield', georgian_definitions: ['მოსავლიანობა'] }), vocabulary[2]];
    supabaseMock.from.mockReturnValue(query({ data: meanings, error: null }));
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await answer('მოსავლიანობა');
    await next();
    await toggle();
    expect(stored()).toMatchObject({ queueIds: ['c', 'a'], unresolvedWordIds: ['a'], correctCount: 1,
      mistakes: [expect.objectContaining({ word_id: 'a', english_word: 'yield' })] });
    await answer('meaning c');
    await next();
    await answer('დათმობა');
    await next();
    await screen.findByRole('heading', { name: 'Practice Summary' });
    expect(stored()).toMatchObject({ queueIds: [], unresolvedWordIds: [], totalAttempts: 4, correctCount: 3 });
  });

  it('retains account-specific unresolved state across A → B → A without changing the other copy', async () => {
    seed();
    const bWord = word({ id: 'b-private', user_id: 'user-b' });
    seed({ userId: 'user-b', queueIds: [bWord.id], unresolvedWordIds: [] });
    const bCopy = localStorage.getItem(practiceSessionKey('user-b'));
    supabaseMock.from.mockImplementation(() => query({ data: authMock.user?.id === 'user-a' ? vocabulary : [bWord], error: null }));
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    const aCopy = localStorage.getItem(practiceSessionKey('user-a'));
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bCopy);
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await toggle();
    expect(stored('user-b')).toMatchObject({ queueIds: [bWord.id], unresolvedWordIds: [], mistakes: [] });
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
    const bAfter = localStorage.getItem(practiceSessionKey('user-b'));
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(stored()).toMatchObject({ queueIds: ['b', 'c'], unresolvedWordIds: ['a'] });
    await toggle();
    expect(stored().queueIds).toEqual(['b', 'c', 'a']);
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bAfter);
  });

  it('keeps completed progress complete on reload, including its historical mistakes', async () => {
    seed({ queueIds: [], allowReguess: true, unresolvedWordIds: [], completed: true,
      totalAttempts: 4, correctCount: 3, attemptedWordIds: ['a', 'b', 'c'], mistakes: [mistake('a')] });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('heading', { name: 'Practice Summary' });
    expect(stored()).toMatchObject({ queueIds: [], unresolvedWordIds: [], completed: true,
      totalAttempts: 4, correctCount: 3, mistakes: [mistake('a')] });
    expect(screen.queryByRole('button', { name: 'Check Answer' })).not.toBeInTheDocument();
  });

  it('deduplicates a restored pending queue without changing its order', async () => {
    seed({ queueIds: ['b', 'a', 'b', 'a', 'c'], unresolvedWordIds: ['a'],
      attemptedWordIds: ['a'], totalAttempts: 1, mistakes: [mistake('a')] });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored().queueIds).toEqual(['b', 'a', 'c']));
    await toggle();
    expect(stored().queueIds).toEqual(['b', 'a', 'c']);
    await answer('meaning b');
    await next();
    await answer('wrong');
    await next();
    expect(stored().queueIds).toEqual(['c', 'a']);
  });

  it('clears retry metadata on an intentional progress reset', async () => {
    seed();
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Reset Progress' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Progress' }).at(-1)!);
    await waitFor(() => expect(stored()).toMatchObject({ unresolvedWordIds: [], mistakes: [], totalAttempts: 0 }));
    await answer('meaning a');
    await next();
    await toggle();
    expect(stored().queueIds).toEqual(['b', 'c']);
  });

  it('preserves unknown legacy progress through a read failure and another reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed({ queueIds: ['b', 'c'], allowReguess: true, totalAttempts: 2, correctCount: 1,
      mistakes: [{ english_word: 'a', user_answer: 'wrong', correct_definitions: ['meaning a'] }],
      attemptedWordIds: undefined });
    supabaseMock.from.mockReturnValue(query({ error: { message: 'offline' } }));
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('alert');
    expect(stored().attemptedWordIds).toBeUndefined();
    view.unmount();
    supabaseMock.from.mockReturnValue(query({ data: vocabulary, error: null }));
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await toggle();
    await toggle();
    expect(stored()).toMatchObject({ queueIds: ['b', 'c'], totalAttempts: 2, correctCount: 1, unresolvedWordIds: [] });
  });

  it('uses complete irregular-verb correctness and preserves retries when direction advances a checked word', async () => {
    seed();
    const irregular = word({ id: 'a', english_word: 'go', georgian_definitions: ['წასვლა'],
      is_irregular_verb: true, past_simple: 'went', past_participle: 'gone' });
    supabaseMock.from.mockReturnValue(query({ data: [irregular, ...vocabulary.slice(1)], error: null }));
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await toggle();
    await answer('wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Georgian → English' }));
    expect(stored().queueIds).toEqual(['b', 'c', 'a']);
    await answer('wrong');
    await next();
    await answer('c');
    await next();
    const inputs = screen.getAllByRole('textbox');
    ['go', 'went', 'wrong'].forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
    await userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
    expect(stored().unresolvedWordIds).toEqual(['a', 'b']);
    await next();
    await answer('wrong');
    await next();
    ['go', 'went', 'gone'].forEach((value, index) => fireEvent.change(screen.getAllByRole('textbox')[index], { target: { value } }));
    await userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
    await next();
    await toggle();
    await toggle();
    expect(stored()).toMatchObject({ queueIds: ['b'], unresolvedWordIds: ['b'], totalAttempts: 6, correctCount: 2 });
  });

  it('preserves a single checked wrong answer as one pending retry on reload', async () => {
    seed({ queueIds: ['a'], hasChecked: true, allowReguess: true, unresolvedWordIds: ['a'],
      totalAttempts: 3, correctCount: 2, attemptedWordIds: ['a', 'b', 'c'], mistakes: [mistake('a')] });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    // The textbox can commit before the restored checkpoint's persistence effect.
    await waitFor(() => expect(stored()).toEqual({
      userId: 'user-a', queueIds: ['a'], direction: 'en-to-geo', orderMode: 'db-order',
      allowReguess: true, correctCount: 2, totalAttempts: 3, mistakes: [mistake('a')],
      attemptedWordIds: ['a', 'b', 'c'], unresolvedWordIds: ['a'], hasChecked: false, completed: false,
    }));
    await answer('meaning a');
    await next();
    await screen.findByRole('heading', { name: 'Practice Summary' });
    expect(stored()).toMatchObject({ queueIds: [], unresolvedWordIds: [], totalAttempts: 4, correctCount: 3 });
  });
});
