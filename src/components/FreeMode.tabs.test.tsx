import { StrictMode } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import { legacyPracticeKey, practiceSessionKey, type StoredPracticeSession } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

const words = ['a', 'b', 'c', 'd'].map(id => word({ id, english_word: id, georgian_definitions: [`meaning ${id}`] }));
const key = practiceSessionKey('user-a');
const stored = (): StoredPracticeSession => JSON.parse(localStorage.getItem(key)!);
function seed(overrides: Partial<StoredPracticeSession> = {}) {
  localStorage.setItem(key, JSON.stringify({ userId: 'user-a', queueIds: ['a', 'b', 'c', 'd'], orderMode: 'db-order',
    direction: 'en-to-geo', allowReguess: true, correctCount: 0, totalAttempts: 0, mistakes: [],
    attemptedWordIds: [], unresolvedWordIds: [], hasChecked: false, completed: false, ...overrides }));
}
function open() {
  const view = render(<StrictMode><FreeMode /></StrictMode>);
  return { ...view, ui: within(view.container) };
}
async function takeover(tab: ReturnType<typeof open>) {
  await userEvent.click(await tab.ui.findByRole('button', { name: 'Continue in this tab' }));
  expect(tab.ui.getByRole('alertdialog')).toHaveTextContent('Unchecked answer text');
  await userEvent.click(tab.ui.getByRole('button', { name: 'Continue here' }));
}
async function answer(tab: ReturnType<typeof open>, value: string) {
  fireEvent.change(await tab.ui.findByRole('textbox'), { target: { value } });
  await userEvent.click(tab.ui.getByRole('button', { name: 'Check Answer' }));
}
const next = (tab: ReturnType<typeof open>) => userEvent.click(tab.ui.getByRole('button', { name: /^(Next Word|Finish Practice)$/ }));
function capturedClick(button: HTMLElement): () => void {
  const props = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
  return (Reflect.get(button, props) as { onClick: () => void }).onClick;
}
beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  supabaseMock.from.mockImplementation(table => {
    if (table === 'words') return query({ data: words, error: null });
    throw new Error(`Unexpected table: ${table}`);
  });
});

it('does not let an independently mounted stale tab overwrite a newer correct answer', async () => {
  const words = [word({ id: 'a' }), word({ id: 'b' })];
  localStorage.setItem(practiceSessionKey('user-a'), JSON.stringify({
    userId: 'user-a', queueIds: ['a', 'b'], orderMode: 'db-order',
  }));
  supabaseMock.from.mockReturnValue(query({ data: words, error: null }));
  const a = within(render(<FreeMode />).container);
  const b = within(render(<FreeMode />).container);
  fireEvent.change(await a.findByRole('textbox'), { target: { value: 'დათმობა' } });
  await userEvent.click(a.getByRole('button', { name: 'Check Answer' }));
  const latest = localStorage.getItem(practiceSessionKey('user-a'));
  // These roots have independent React state but share the browser's storage.
  // Before ownership protection, B's stale counters overwrite A's scored answer.
  const staleInput = b.queryByRole('textbox');
  if (staleInput) {
    fireEvent.change(staleInput, { target: { value: 'wrong' } });
    await userEvent.click(b.getByRole('button', { name: 'Check Answer' }));
  }
  expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(latest);
  expect(b.getByRole('status')).toHaveTextContent('Practice is active in another tab');
});

it('keeps a draft and all mutation controls in the active tab while the passive tab performs no writes or reads', async () => {
  seed();
  const a = open();
  fireEvent.change(await a.ui.findByRole('textbox'), { target: { value: 'unfinished' } });
  const copy = localStorage.getItem(key);
  const reads = supabaseMock.from.mock.calls.length;
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const b = open();
  await b.ui.findByRole('button', { name: 'Continue in this tab' });
  expect(b.ui.queryByRole('textbox')).not.toBeInTheDocument();
  expect(b.ui.getAllByRole('button')).toHaveLength(1);
  expect(a.ui.getByRole('textbox')).toHaveValue('unfinished');
  expect(localStorage.getItem(key)).toBe(copy);
  expect(writes).not.toHaveBeenCalled();
  expect(supabaseMock.from).toHaveBeenCalledTimes(reads);
  fireEvent.focus(window);
  fireEvent.blur(window);
  expect(a.ui.getByRole('textbox')).toHaveValue('unfinished');
});

it('checkpoints the latest order/scores before takeover and rejects stale Check, Next, toggles and Reset callbacks', async () => {
  seed();
  const a = open();
  await a.ui.findByRole('textbox');
  const check = capturedClick(a.ui.getByRole('button', { name: 'Check Answer' }));
  await answer(a, 'wrong');
  const advance = capturedClick(a.ui.getByRole('button', { name: 'Next Word' }));
  await userEvent.click(a.ui.getByRole('button', { name: 'Random' }));
  const order = capturedClick(a.ui.getByRole('button', { name: 'In database order' }));
  const direction = capturedClick(a.ui.getByRole('button', { name: 'Georgian → English' }));
  const reguess = capturedClick(a.ui.getByText('Allow re-guessing wrong answers').parentElement!.querySelector('button')!);
  await userEvent.click(a.ui.getByRole('button', { name: 'Reset Progress' }));
  const reset = capturedClick(a.ui.getAllByRole('button', { name: 'Reset Progress' }).at(-1)!);
  const before = stored();
  const b = open();
  await takeover(b);
  await b.ui.findByRole('textbox');
  expect(a.ui.queryByRole('textbox')).not.toBeInTheDocument();
  await waitFor(() => expect(stored()).toEqual({ ...before, hasChecked: false, queueIds: [...before.queueIds.slice(1), 'a'] }));
  const latest = localStorage.getItem(key);
  act(() => { check(); advance(); order(); direction(); reguess(); reset(); });
  expect(localStorage.getItem(key)).toBe(latest);
  expect(b.ui.getByRole('textbox')).toHaveValue('');
});

it('restores unresolved/resolved eligibility without resurrecting corrected historical mistakes', async () => {
  seed({ queueIds: ['c', 'd', 'b'], attemptedWordIds: ['a', 'b'], unresolvedWordIds: ['b'], totalAttempts: 3, correctCount: 1,
    mistakes: ['a', 'b'].map(id => ({ word_id: id, english_word: id, user_answer: 'wrong', correct_definitions: [`meaning ${id}`] })) });
  const a = open();
  await a.ui.findByRole('textbox');
  await userEvent.click(a.ui.getByRole('button', { name: 'Random' }));
  const before = stored();
  const b = open();
  await takeover(b);
  await b.ui.findByRole('textbox');
  expect(stored()).toEqual(before);
  await userEvent.click(b.ui.getByRole('button', { name: 'In database order' }));
  expect(stored().queueIds).toEqual(['c', 'd', 'b']);
  expect(stored().queueIds).not.toContain('a');
});

it('continues from the latest checkpoint after the owner closes', async () => {
  seed();
  const a = open();
  await answer(a, 'meaning a');
  await next(a);
  const latest = stored();
  const b = open();
  await b.ui.findByRole('button', { name: 'Continue in this tab' });
  a.unmount();
  await takeover(b);
  await b.ui.findByRole('textbox');
  expect(stored()).toEqual(latest);
});

it('keeps the editor usable after stale Cancel clicks and lets a third tab continue without reloading', async () => {
  vi.stubGlobal('BroadcastChannel', undefined); // Deliberately hold the request in the queue.
  seed();
  const a = open();
  await answer(a, 'meaning a');
  await next(a);
  const checkpoint = stored();
  const b = open();
  await takeover(b);
  const oldCancel = capturedClick(b.ui.getByRole('button', { name: 'Cancel request' }));
  act(() => oldCancel());
  await takeover(b);
  const grantedCancel = capturedClick(b.ui.getByRole('button', { name: 'Cancel request' }));
  act(() => oldCancel());
  expect(b.ui.getByRole('button', { name: 'Cancel request' })).toBeInTheDocument();
  a.unmount();
  await b.ui.findByRole('textbox');
  act(() => { oldCancel(); grantedCancel(); });
  expect(b.ui.getByRole('textbox')).toBeInTheDocument();
  expect(stored()).toEqual(checkpoint);
  await answer(b, 'meaning b');
  await next(b);
  const latest = stored();
  const c = open();
  await c.ui.findByRole('button', { name: 'Continue in this tab' });
  b.unmount();
  await takeover(c);
  await c.ui.findByRole('textbox');
  expect(stored()).toEqual(latest);
});

it('ignores pending vocabulary responses after a handoff', async () => {
  seed();
  const old = deferred<QueryResult>();
  supabaseMock.from.mockReturnValue(query(old.promise));
  const a = open();
  await waitFor(() => expect(supabaseMock.from).toHaveBeenCalled());
  const b = open();
  await b.ui.findByRole('button', { name: 'Continue in this tab' });
  supabaseMock.from.mockReturnValue(query({ data: words, error: null }));
  await takeover(b);
  await answer(b, 'meaning a');
  const latest = localStorage.getItem(key);
  await act(async () => old.resolve({ data: [word({ id: 'stale' })], error: null }));
  expect(localStorage.getItem(key)).toBe(latest);
  expect(a.ui.queryByRole('textbox')).not.toBeInTheDocument();
});

it('does not release ownership when a handoff checkpoint cannot be saved', async () => {
  seed();
  const a = open();
  await answer(a, 'meaning a');
  const b = open();
  await b.ui.findByRole('button', { name: 'Continue in this tab' });
  // Force verification to fail even when the latest JSON is already present.
  const get = Storage.prototype.getItem;
  let reads = 0;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (storageKey) {
    if (storageKey === key && ++reads % 2 === 0) throw new Error('blocked');
    return get.call(this, storageKey);
  });
  await takeover(b);
  await waitFor(() => expect(a.ui.getByRole('alert')).toHaveTextContent('Could not save progress for the other tab'));
  expect(a.ui.getByRole('textbox')).toBeInTheDocument();
  expect(b.ui.queryByRole('textbox')).not.toBeInTheDocument();
});

it('fails closed without Web Locks and retains malformed/legacy data without a passive migration', async () => {
  const raw = JSON.stringify({ userId: 'user-a', queueIds: ['a'], correctCount: 2, totalAttempts: 3 });
  localStorage.setItem(legacyPracticeKey, raw);
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const a = open();
  expect(a.ui.getByRole('status')).toHaveTextContent('Web Locks');
  expect(a.ui.queryByRole('button')).not.toBeInTheDocument();
  expect(localStorage.getItem(legacyPracticeKey)).toBe(raw);
  expect(localStorage.getItem(key)).toBeNull();
});

it('keeps malformed scoped data unchanged through initialization and an attempted handoff', async () => {
  localStorage.setItem(key, '{broken');
  const a = open();
  await a.ui.findByRole('textbox');
  const b = open();
  await takeover(b);
  await waitFor(() => expect(a.ui.getByRole('alert')).toHaveTextContent('Could not save progress'));
  expect(localStorage.getItem(key)).toBe('{broken');
  expect(b.ui.queryByRole('textbox')).not.toBeInTheDocument();
});

it('updates the passive progress preview on an other-context storage event without writing', async () => {
  seed();
  const a = open();
  await a.ui.findByRole('textbox');
  const b = open();
  await b.ui.findByRole('button', { name: 'Continue in this tab' });
  await answer(a, 'wrong');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  // jsdom has one window: explicitly model notification to the passive reader.
  // Production never synthesizes a storage event in the writing context.
  fireEvent(window, new StorageEvent('storage', { key, newValue: localStorage.getItem(key) }));
  expect(b.ui.getByText('Last saved progress: 0 / 1 correct.')).toBeInTheDocument();
  expect(writes).not.toHaveBeenCalled();
});

it.each(['success', 'failure'] as const)('preserves a pending result identity and follows its %s after takeover', async outcome => {
  seed({ queueIds: ['a'], attemptedWordIds: ['b', 'c', 'd'] });
  const pending = deferred<QueryResult>();
  const save = query(pending.promise);
  supabaseMock.from.mockImplementation(table => table === 'words' ? query({ data: words, error: null }) : save);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const a = open();
  await answer(a, 'meaning a');
  await next(a);
  await a.ui.findByRole('heading', { name: 'Practice Summary' });
  const staleSave = capturedClick(a.ui.getByRole('button', { name: 'Close & Save' }));
  await userEvent.click(a.ui.getByRole('button', { name: 'Close & Save' }));
  await waitFor(() => expect(save.insert).toHaveBeenCalledTimes(1));
  const checkpoint = stored();
  const b = open();
  await takeover(b);
  await b.ui.findByRole('button', { name: 'Saving result...' });
  expect(stored()).toEqual(checkpoint);
  act(() => staleSave());
  expect(save.insert).toHaveBeenCalledTimes(1);
  expect(b.ui.queryByText('Failed to save result')).not.toBeInTheDocument();
  await act(async () => pending.resolve({ error: outcome === 'failure' ? { message: 'offline' } : null }));
  if (outcome === 'success') {
    await b.ui.findByText('Result saved to History');
    expect(localStorage.getItem(key)).toBeNull();
  } else {
    await b.ui.findByRole('button', { name: 'Retry Save' });
    expect(stored()).toEqual(checkpoint);
    save.insert.mockResolvedValueOnce({ error: null });
    await userEvent.click(b.ui.getByRole('button', { name: 'Retry Save' }));
    await b.ui.findByText('Result saved to History');
    expect(save.insert.mock.calls[1][0]).toEqual(checkpoint.completedResult);
  }
});

it('preserves the pending History snapshot through Cancel, another request and a stale post-grant Cancel', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  seed({ queueIds: ['a'], attemptedWordIds: ['b', 'c', 'd'] });
  const pending = deferred<QueryResult>();
  const save = query(pending.promise);
  supabaseMock.from.mockImplementation(table => table === 'words' ? query({ data: words, error: null }) : save);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const a = open();
  await answer(a, 'meaning a');
  await next(a);
  await userEvent.click(await a.ui.findByRole('button', { name: 'Close & Save' }));
  await waitFor(() => expect(save.insert).toHaveBeenCalledOnce());
  const checkpoint = stored();
  const b = open();
  await takeover(b);
  await userEvent.click(b.ui.getByRole('button', { name: 'Cancel request' }));
  expect(a.ui.getByRole('button', { name: 'Saving result...' })).toBeDisabled();
  expect(stored()).toEqual(checkpoint);
  await takeover(b);
  const staleCancel = capturedClick(b.ui.getByRole('button', { name: 'Cancel request' }));
  a.unmount();
  await b.ui.findByRole('button', { name: 'Saving result...' });
  act(() => staleCancel());
  expect(b.ui.getByRole('button', { name: 'Saving result...' })).toBeDisabled();
  expect(stored()).toEqual(checkpoint);
  expect(save.insert).toHaveBeenCalledOnce();
  await act(async () => pending.resolve({ error: { message: 'offline' } }));
  await b.ui.findByRole('button', { name: 'Retry Save' });
  expect(stored()).toEqual(checkpoint);
  save.insert.mockResolvedValueOnce({ error: null });
  await userEvent.click(b.ui.getByRole('button', { name: 'Retry Save' }));
  await b.ui.findByText('Result saved to History');
  expect(save.insert.mock.calls[1][0]).toEqual(checkpoint.completedResult);
});

it('retains 5 attempts / 4 correct, 4/5 (80%) and the exact History result across a mid-session takeover', async () => {
  seed();
  const save = query();
  supabaseMock.from.mockImplementation(table => table === 'words' ? query({ data: words, error: null }) : save);
  const a = open();
  await answer(a, 'wrong');
  await next(a);
  const b = open();
  await takeover(b);
  for (const id of ['b', 'c', 'd', 'a']) {
    await answer(b, `meaning ${id}`);
    await next(b);
  }
  await b.ui.findByRole('heading', { name: 'Practice Summary' });
  expect(b.ui.getByText('4/5 correct (80%)')).toBeInTheDocument();
  expect(Array.from(b.ui.getByText('/').parentElement!.children, item => item.textContent).join(' ')).toBe('4 / 5');
  expect(stored()).toMatchObject({ totalAttempts: 5, correctCount: 4, unresolvedWordIds: [] });
  await userEvent.click(b.ui.getByRole('button', { name: 'Close & Save' }));
  await b.ui.findByText('Result saved to History');
  expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ total_words: 5, correct_count: 4,
    mistakes: [{ english_word: 'a', user_answer: 'wrong', question_prompt: 'a', correct_definitions: ['meaning a'] }] }));
});
