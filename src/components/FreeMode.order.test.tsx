import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import { practiceSessionKey, type StoredPracticeSession } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

const vocabulary = ['a', 'b', 'c', 'd'].map((id, index) => word({
  id, english_word: id, georgian_definitions: [`meaning ${id}`],
  created_at: `2026-01-0${index + 1}T00:00:00.000Z`,
}));
const stored = (userId = 'user-a'): StoredPracticeSession => JSON.parse(localStorage.getItem(practiceSessionKey(userId))!);
function seed(overrides: Partial<StoredPracticeSession> = {}) {
  const session: StoredPracticeSession = {
    userId: 'user-a', queueIds: ['a', 'b', 'c', 'd'], direction: 'en-to-geo', orderMode: 'db-order',
    allowReguess: false, correctCount: 0, totalAttempts: 0, mistakes: [], attemptedWordIds: [],
    unresolvedWordIds: [], hasChecked: false, completed: false, ...overrides,
  };
  localStorage.setItem(practiceSessionKey(session.userId), JSON.stringify(session));
}
async function order(mode: 'Random' | 'In database order') {
  await userEvent.click(screen.getByRole('button', { name: mode }));
}
async function answer(value: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  await userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
}
async function next() {
  await userEvent.click(screen.getByRole('button', { name: /^(Next Word|Finish Practice)$/ }));
}
async function toggleReguess() {
  await userEvent.click(screen.getByText('Allow re-guessing wrong answers').parentElement!.querySelector('button')!);
}
const mistake = (id: string) => ({ word_id: id, english_word: id, user_answer: 'wrong', correct_definitions: [`meaning ${id}`] });

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  supabaseMock.from.mockImplementation(table => {
    if (table === 'words') return query({ data: vocabulary, error: null });
    throw new Error(`Unexpected table: ${table}`);
  });
});

describe('Practice ordering preserves the session', () => {
  it('defaults a fresh session to Georgian → English and reorders the untouched first question without refetching', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored()).toMatchObject({ direction: 'geo-to-en', queueIds: ['b', 'c', 'd', 'a'] }));
    expect(screen.getByRole('button', { name: 'Georgian → English' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('meaning b')).toBeInTheDocument();
    const reads = supabaseMock.from.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      await order('In database order');
      expect(stored().queueIds).toEqual(['a', 'b', 'c', 'd']);
      expect(screen.getByText('meaning a')).toBeInTheDocument();
      expect(screen.queryByText('meaning b')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'In database order' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Random' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('status')).toHaveTextContent('The question order is updated.');
      await order('Random');
      expect(stored().queueIds).toEqual(['b', 'c', 'd', 'a']);
      expect(screen.getByText('meaning b')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(stored()).toMatchObject({ totalAttempts: 0, correctCount: 0, mistakes: [], unresolvedWordIds: [], hasChecked: false });
    }
    expect(supabaseMock.from).toHaveBeenCalledTimes(reads);
  });

  it.each(['en-to-geo', 'geo-to-en'] as const)('restores the saved %s direction and progress after navigation', async direction => {
    seed({ direction, queueIds: ['c', 'd'], attemptedWordIds: ['a', 'b'], totalAttempts: 2, correctCount: 2 });
    const before = stored();
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    const name = direction === 'en-to-geo' ? 'English → Georgian' : 'Georgian → English';
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<div>Words</div>);
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
    expect(stored()).toEqual(before);
  });

  it.each([{ queueIds: ['a'] }, { queueIds: ['a', 'b', 'c', 'd'] }])('reports an unchanged sequence honestly for %j', async ({ queueIds }) => {
    // Switching modes need not change the actual sequence, including one-word sessions.
    supabaseMock.from.mockReturnValue(query({ data: vocabulary.filter(item => queueIds.includes(item.id)), error: null }));
    seed({ queueIds, orderMode: 'random' });
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await order('In database order');
    expect(stored().queueIds).toEqual(queueIds);
    expect(screen.getByRole('status')).toHaveTextContent('Database order selected. The question sequence is unchanged.');
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    await order('Random');
    expect(stored().queueIds).toEqual(queueIds);
    expect(screen.getByRole('status')).toHaveTextContent('Random order selected. The question sequence is unchanged.');
  });

  it('treats whitespace as a draft and keeps the active word when switching to database order', async () => {
    seed({ orderMode: 'random', queueIds: ['d', 'c', 'b', 'a'] });
    render(<FreeMode />);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: '  ' } });
    await order('In database order');
    expect(stored().queueIds).toEqual(['d', 'a', 'b', 'c']);
    expect(screen.getByRole('textbox')).toHaveValue('  ');
    expect(screen.getByRole('status')).toHaveTextContent('The new order takes effect from the next word. Your current answer is kept.');
  });

  it('retains two scored answers, mistakes, the active draft and storage when changing order', async () => {
    seed();
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await answer('meaning b');
    await next();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unfinished c' } });
    const before = stored();
    const reads = supabaseMock.from.mock.calls.length;
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    await order('Random');
    expect(stored()).toEqual({ ...before, orderMode: 'random' });
    expect(screen.getByRole('textbox')).toHaveValue('unfinished c');
    expect(remove).not.toHaveBeenCalled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(reads);
  });

  it('sorts only the remaining records by canonical database order, including timestamp ties', async () => {
    // The server orders by created_at then id; do not round PostgreSQL timestamps
    // through JS Date or sort the English spelling to reconstruct this order.
    const read = query({ data: [vocabulary[0], vocabulary[1], { ...vocabulary[2], created_at: vocabulary[1].created_at }, vocabulary[3]], error: null });
    supabaseMock.from.mockReturnValue(read);
    seed({ orderMode: 'random', queueIds: ['d', 'c', 'a', 'b'] });
    render(<FreeMode />);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'draft d' } });
    await order('In database order');
    expect(stored().queueIds).toEqual(['d', 'a', 'b', 'c']);
    expect(screen.getByRole('textbox')).toHaveValue('draft d');
    expect(screen.getByRole('status')).toHaveTextContent('The new order takes effect from the next word.');
    expect(read.select).toHaveBeenCalledWith('*', { count: 'exact' });
    expect(read.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(read.order.mock.calls).toEqual([['created_at', { ascending: true }], ['id', { ascending: true }]]);
  });

  it('shuffles only pending questions and makes selecting the active mode a no-op', async () => {
    seed();
    render(<FreeMode />);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'active draft' } });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    await order('Random');
    expect(stored().queueIds).toEqual(['a', 'c', 'd', 'b']);
    const before = stored();
    const calls = random.mock.calls.length;
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await order('Random');
    expect(stored()).toEqual(before);
    expect(writes).not.toHaveBeenCalled();
    expect(random).toHaveBeenCalledTimes(calls);
    await order('In database order');
    expect(stored().queueIds).toEqual(['a', 'b', 'c', 'd']);
    expect(screen.getByRole('textbox')).toHaveValue('active draft');
  });

  it.each([true, false])('keeps checked feedback and the scoring guard when correct=%s', async correct => {
    seed();
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    const input = screen.getByRole('textbox');
    await answer(correct ? 'meaning a' : 'wrong');
    const before = stored();
    for (let i = 0; i < 3; i++) {
      await order('Random');
      await order('In database order');
    }
    expect(stored()).toEqual(before);
    expect(screen.getByRole('textbox')).toBe(input);
    expect(input).toHaveValue(correct ? 'meaning a' : 'wrong');
    expect(input).toHaveProperty('readOnly', true);
    expect(input).toHaveClass(correct ? 'border-green-500' : 'border-red-500');
    expect(screen.queryByRole('button', { name: 'Check Answer' })).not.toBeInTheDocument();
    await next();
    expect(stored()).toMatchObject({ queueIds: ['b', 'c', 'd'], totalAttempts: 1, correctCount: correct ? 1 : 0 });
    expect(screen.getByRole('textbox')).toHaveValue('');
    await answer('meaning b');
    expect(stored().totalAttempts).toBe(2);
  });

  it('preserves multiple unfinished answer fields while reordering', async () => {
    seed();
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await userEvent.click(screen.getByRole('button', { name: /Add.*answer/i }));
    const inputs = screen.getAllByRole('textbox');
    ['first draft', 'second draft'].forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
    await order('Random');
    expect(screen.getAllByRole('textbox')).toEqual(inputs);
    expect(inputs.map(input => (input as HTMLInputElement).value)).toEqual(['first draft', 'second draft']);
    expect(stored()).toMatchObject({ hasChecked: false, totalAttempts: 0 });
    expect(stored().queueIds[0]).toBe('a');
  });

  it.each(['single', 'multiple', 'irregular'] as const)('preserves blurred %s inputs, caret and element identity without focusing or rescoring on order changes', async kind => {
    const direction = kind === 'multiple' ? 'en-to-geo' : 'geo-to-en';
    seed({ direction, orderMode: 'random', queueIds: ['a', 'd', 'c', 'b'] });
    if (kind === 'irregular') {
      supabaseMock.from.mockReturnValue(query({ data: [word({ id: 'a', english_word: 'go',
        georgian_definitions: ['წასვლა'], is_irregular_verb: true, past_simple: 'went', past_participle: 'gone' }),
      ...vocabulary.slice(1)], error: null }));
    }
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findAllByRole('textbox');
    if (kind === 'multiple') await userEvent.click(screen.getByRole('button', { name: 'Add another answer' }));
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs).toHaveLength(kind === 'irregular' ? 3 : kind === 'multiple' ? 2 : 1);
    const drafts = inputs.map((_, index) => `unfinished answer ${index}`);
    inputs.forEach((input, index) => {
      fireEvent.change(input, { target: { value: drafts[index] } });
      input.setSelectionRange(2, 7);
    });
    inputs[0].focus();
    const before = stored();
    const reads = supabaseMock.from.mock.calls.length;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    for (const mode of ['In database order', 'Random', 'In database order'] as const) {
      const control = screen.getByRole('button', { name: mode });
      await userEvent.click(control); // Real blur; the order control keeps focus.
      view.rerender(<StrictMode><FreeMode /></StrictMode>);
      expect(control).toHaveFocus();
      const currentInputs = screen.getAllByRole('textbox');
      expect(currentInputs).toHaveLength(inputs.length);
      inputs.forEach((input, index) => {
        expect(currentInputs[index]).toBe(input);
        // Structural mitigation guard; jsdom cannot verify Chromium's painted pixels.
        expect(input.className).not.toMatch(/\bbackdrop-/);
        expect(input).toHaveClass('bg-white/50', 'dark:bg-gray-700/50',
          'text-gray-900', 'dark:text-gray-100', 'focus:ring-4');
        expect(input).toHaveValue(drafts[index]);
        expect(input).not.toHaveFocus();
        expect(input.selectionStart).toBe(2);
        expect(input.selectionEnd).toBe(7);
        expect(input.readOnly).toBe(false);
      });
      expect(stored()).toEqual({ ...before, orderMode: mode === 'Random' ? 'random' : 'db-order',
        queueIds: mode === 'Random' ? ['a', 'c', 'd', 'b'] : ['a', 'b', 'c', 'd'] });
      expect(screen.getByRole('status')).toHaveTextContent('The new order takes effect from the next word.');
    }
    expect(supabaseMock.from).toHaveBeenCalledTimes(reads);
  });

  it.each([true, false])('keeps irregular-verb inputs and feedback (correct=%s)', async correct => {
    const irregular = word({ id: 'a', english_word: 'go', georgian_definitions: ['წასვლა'],
      is_irregular_verb: true, past_simple: 'went', past_participle: 'gone' });
    seed({ direction: 'geo-to-en' });
    supabaseMock.from.mockReturnValue(query({ data: [irregular, ...vocabulary.slice(1)], error: null }));
    render(<FreeMode />);
    await screen.findAllByRole('textbox');
    const values = ['go', 'went', correct ? 'gone' : 'wrong'];
    values.forEach((value, index) => fireEvent.change(screen.getAllByRole('textbox')[index], { target: { value } }));
    await order('Random');
    expect(screen.getAllByRole('textbox').map(input => (input as HTMLInputElement).value)).toEqual(values);
    await userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
    await order('In database order');
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    expect(screen.getAllByRole('textbox').map(input => (input as HTMLInputElement).value)).toEqual(values);
    expect(screen.getAllByRole('textbox')[2]).toHaveClass(correct ? 'border-green-500' : 'border-red-500');
    expect(stored()).toMatchObject({ direction: 'geo-to-en', totalAttempts: 1, correctCount: correct ? 1 : 0, hasChecked: true });
  });

  it('defers a genuine retry behind unattempted words, then records 5 attempts / 4 correct in History', async () => {
    const save = query();
    supabaseMock.from.mockImplementation(table => table === 'words' ? query({ data: vocabulary, error: null }) : save);
    seed({ allowReguess: true });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await order('Random');
    await order('In database order');
    expect(stored()).toMatchObject({ queueIds: ['b', 'c', 'd', 'a'], unresolvedWordIds: ['a'], allowReguess: true });
    for (const id of ['b', 'c', 'd', 'a']) {
      expect(stored().queueIds[0]).toBe(id);
      await answer(`meaning ${id}`);
      if (id === 'a') {
        // Even when it is the checked final question, order changes must not
        // reopen its presentation or replace Finish Practice with Check Answer.
        await order('Random');
        await order('In database order');
        expect(stored()).toMatchObject({ totalAttempts: 5, correctCount: 4, unresolvedWordIds: [] });
      }
      await next();
    }
    await screen.findByRole('heading', { name: 'Practice Summary' });
    await userEvent.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledTimes(1);
    expect(save.insert.mock.calls[0][0]).toMatchObject({ total_words: 5, correct_count: 4,
      mistakes: [{ english_word: 'a', question_prompt: 'a', user_answer: 'wrong', correct_definitions: ['meaning a'] }] });
  });

  it('never resurrects a resolved mistake or duplicates pending IDs through repeated order and retry toggles', async () => {
    seed({ queueIds: ['c', 'd', 'b'], allowReguess: true, attemptedWordIds: ['a', 'b'], unresolvedWordIds: ['b'],
      totalAttempts: 3, correctCount: 1, mistakes: [mistake('a'), mistake('b')] });
    render(<FreeMode />);
    await screen.findByRole('textbox');
    const before = stored();
    for (let i = 0; i < 4; i++) {
      await order('Random');
      await toggleReguess();
      await order('In database order');
      await toggleReguess();
      expect(stored()).toEqual(before);
    }
  });

  it('does not schedule an unresolved retry when re-guessing is disabled', async () => {
    seed();
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await order('Random');
    await order('In database order');
    expect(stored()).toMatchObject({ queueIds: ['b', 'c', 'd'], allowReguess: false, unresolvedWordIds: ['a'], totalAttempts: 1 });
    await toggleReguess();
    expect(stored().queueIds).toEqual(['b', 'c', 'd', 'a']);
  });

  it.each(['resolve', 'reject'] as const)('ignores an obsolete pending read that later %ss after rapid order changes', async outcome => {
    seed();
    const old = deferred<QueryResult>();
    const current = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query(current.promise));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<StrictMode><FreeMode /></StrictMode>);
    const original = localStorage.getItem(practiceSessionKey('user-a'));
    expect(screen.getByText('Loading your words...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'In database order' })).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(original);
    await act(async () => current.resolve({ data: vocabulary, error: null }));
    await answer('meaning a');
    await next();
    await order('Random');
    await order('In database order');
    await order('Random');
    const before = stored();
    await act(async () => {
      if (outcome === 'resolve') old.resolve({ data: [word({ id: 'obsolete' })], error: null });
      else old.reject(new Error('obsolete read'));
    });
    expect(stored()).toEqual(before);
    expect(stored()).toMatchObject({ orderMode: 'random', totalAttempts: 1, correctCount: 1 });
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(supabaseMock.from).toHaveBeenCalledTimes(2); // StrictMode only; no ordering refetch.
    expect(errors).not.toHaveBeenCalled();
  });

  it('preserves the exact saved progress through read failure and Retry before reordering', async () => {
    seed({ queueIds: ['c', 'd'], attemptedWordIds: ['a', 'b'], unresolvedWordIds: ['a'], totalAttempts: 2, correctCount: 1, mistakes: [mistake('a')] });
    const raw = localStorage.getItem(practiceSessionKey('user-a'));
    const failed = deferred<QueryResult>();
    const retry = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(failed.promise)).mockReturnValueOnce(query(retry.promise));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FreeMode />);
    await act(async () => failed.resolve({ error: { message: 'offline' } }));
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(raw);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(raw);
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    await act(async () => retry.resolve({ data: vocabulary, error: null }));
    await order('Random');
    expect(stored()).toEqual({ ...JSON.parse(raw!), orderMode: 'random' });
  });

  it.each(['reload', 'navigation'] as const)('restores the exact reordered queue and progress after %s', async restore => {
    seed({ allowReguess: true });
    let view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await order('Random');
    const before = stored();
    if (restore === 'reload') {
      view.unmount();
      view = render(<StrictMode><FreeMode /></StrictMode>);
    } else {
      view.rerender(<div>Words</div>);
      view.rerender(<StrictMode><FreeMode /></StrictMode>);
    }
    await screen.findByRole('textbox');
    expect(stored()).toEqual(before);
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
  });

  it('keeps independent reordered queues and scores across A → B → A', async () => {
    seed();
    seed({ userId: 'user-b', queueIds: ['d', 'b', 'c'], orderMode: 'random', attemptedWordIds: ['a'], totalAttempts: 1, correctCount: 1 });
    const bBefore = localStorage.getItem(practiceSessionKey('user-b'));
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await order('Random');
    const aBefore = localStorage.getItem(practiceSessionKey('user-a'));
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bBefore);
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await order('In database order');
    expect(stored('user-b')).toMatchObject({ queueIds: ['d', 'b', 'c'], totalAttempts: 1, correctCount: 1 });
    const bAfter = localStorage.getItem(practiceSessionKey('user-b'));
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aBefore);
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aBefore);
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bAfter);
  });

  it('keeps meanings with identical spelling independent by record ID', async () => {
    seed();
    supabaseMock.from.mockReturnValue(query({ data: vocabulary.map(item => ({ ...item, english_word: 'yield' })), error: null }));
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await answer('meaning a');
    await next();
    await order('Random');
    await order('In database order');
    expect(stored()).toMatchObject({ queueIds: ['b', 'c', 'd'], attemptedWordIds: ['a'], totalAttempts: 1 });
    await answer('meaning b');
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 2, attemptedWordIds: ['a', 'b'] });
  });

  it('keeps held-Enter protection across an order change, and advances on a fresh press', async () => {
    seed();
    render(<FreeMode />);
    const input = await screen.findByRole('textbox');
    fireEvent.change(input, { target: { value: 'meaning a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next Word' })).toHaveFocus());
    await order('Random');
    const submitted = stored();
    // jsdom doesn't perform native keyboard activation. Model the button default
    // only when keydown was not cancelled, as in the R3-A21 regression tests.
    const nextButton = screen.getByRole('button', { name: 'Next Word' });
    const allowed = fireEvent.keyDown(nextButton, { key: 'Enter', repeat: true, cancelable: true });
    if (allowed) fireEvent.click(nextButton, { detail: 0 });
    expect(allowed).toBe(false);
    expect(stored()).toEqual(submitted);
    fireEvent.keyUp(nextButton, { key: 'Enter' });
    nextButton.focus();
    await userEvent.keyboard('{Enter}');
    expect(stored()).toMatchObject({ queueIds: submitted.queueIds.slice(1), totalAttempts: 1, hasChecked: false });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `meaning ${stored().queueIds[0]}` } });
    await userEvent.keyboard('{Enter}');
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 2 });
  });

  it('still resets all progress intentionally after an ordering change', async () => {
    seed({ allowReguess: true });
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await answer('wrong');
    await next();
    await order('Random');
    await order('In database order');
    await userEvent.click(screen.getByRole('button', { name: 'Reset Progress' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Progress' }).at(-1)!);
    expect(stored()).toMatchObject({ queueIds: ['a', 'b', 'c', 'd'], totalAttempts: 0, correctCount: 0,
      mistakes: [], attemptedWordIds: [], unresolvedWordIds: [], hasChecked: false, orderMode: 'db-order' });
    expect(screen.getByRole('textbox')).toHaveValue('');
    await answer('meaning a');
    expect(stored().totalAttempts).toBe(1);
  });

  it('does not change a completed session or its pending History snapshot through ordering controls', async () => {
    seed({ queueIds: ['a'], attemptedWordIds: ['b', 'c', 'd'], totalAttempts: 3, correctCount: 3 });
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    supabaseMock.from.mockImplementation(table => table === 'words' ? query({ data: vocabulary, error: null }) : save);
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await answer('meaning a');
    await next();
    await screen.findByRole('heading', { name: 'Practice Summary' });
    const complete = stored();
    expect(screen.getByRole('button', { name: 'Random' })).toBeDisabled();
    await order('Random');
    expect(stored()).toEqual(complete);
    await userEvent.click(screen.getByRole('button', { name: 'Close & Save' }));
    const checkpoint = stored();
    await order('In database order');
    await order('Random');
    expect(stored()).toEqual(checkpoint);
    expect(save.insert).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ error: null }));
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[0][0]).toEqual(checkpoint.completedResult);
  });

  it('reconciles new words on remount before deferred retries without replaying completed records', async () => {
    seed({ queueIds: ['c', 'a'], allowReguess: true, attemptedWordIds: ['a', 'b'], unresolvedWordIds: ['a'],
      totalAttempts: 2, correctCount: 1, mistakes: [mistake('a')] });
    supabaseMock.from.mockReturnValue(query({ data: vocabulary.slice(0, 3), error: null }));
    const view = render(<FreeMode />);
    await screen.findByRole('textbox');
    await order('Random');
    await order('In database order');
    const before = stored();
    view.unmount();
    const refresh = deferred<QueryResult>();
    supabaseMock.from.mockReturnValue(query(refresh.promise));
    render(<FreeMode />);
    expect(stored()).toEqual(before);
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    await act(async () => refresh.resolve({ data: vocabulary, error: null }));
    expect(stored()).toEqual({ ...before, queueIds: ['c', 'd', 'a'] });
    await order('Random');
    await order('In database order');
    expect(stored()).toEqual({ ...before, queueIds: ['c', 'd', 'a'] });
  });

  it('does not persist an empty transient queue or show Summary before new work is reconciled', async () => {
    seed({ queueIds: [], attemptedWordIds: ['a'], totalAttempts: 1, correctCount: 1 });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValue(query(pending.promise));
    render(<StrictMode><FreeMode /></StrictMode>);
    expect(writes).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ data: vocabulary, error: null }));
    expect(stored()).toMatchObject({ queueIds: ['b', 'c', 'd'], totalAttempts: 1, correctCount: 1, completed: false });
    expect(writes.mock.calls.every(([, raw]) => JSON.parse(raw).queueIds.length > 0 && !JSON.parse(raw).completed)).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
  });

  it('does not reopen completed progress when the refreshed vocabulary contains new words', async () => {
    seed({ queueIds: [], attemptedWordIds: ['a'], totalAttempts: 1, correctCount: 1, completed: true });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('heading', { name: 'Practice Summary' });
    await waitFor(() => expect(stored().completed).toBe(true));
    expect(stored().queueIds).toEqual([]);
    expect(screen.getByRole('button', { name: 'Random' })).toBeDisabled();
  });

  it('preserves conservative legacy eligibility when optional retry metadata is absent', async () => {
    seed({ queueIds: ['c', 'b'], attemptedWordIds: undefined, unresolvedWordIds: undefined,
      totalAttempts: 2, correctCount: 1, mistakes: [mistake('a')], allowReguess: true });
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await order('Random');
    await order('In database order');
    expect(stored()).toMatchObject({ queueIds: ['c', 'b'], unresolvedWordIds: [], totalAttempts: 2, correctCount: 1, mistakes: [mistake('a')] });
  });

  it('keeps incompatible saved data unchanged even after ordering changes', async () => {
    const raw = '{malformed';
    localStorage.setItem(practiceSessionKey('user-a'), raw);
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await order('In database order');
    await order('Random');
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(raw);
    expect(screen.getByRole('alert')).toHaveTextContent('kept unchanged');
  });
});
