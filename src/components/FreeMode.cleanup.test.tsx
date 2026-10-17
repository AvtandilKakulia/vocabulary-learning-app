import { Profiler, StrictMode, type ReactNode } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import { practiceSessionKey } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

const words = ['a', 'b', 'c', 'd'].map(id => word({ id, english_word: id, georgian_definitions: [`meaning ${id}`] }));
const key = practiceSessionKey('user-a');
const otherKey = practiceSessionKey('user-b');
const otherCopy = JSON.stringify({ userId: 'user-b', queueIds: ['private'], correctCount: 2, totalAttempts: 3 });

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

type Timing = 'between commit and effects' | 'immediate vocabulary' | 'save first' | 'words first' |
  'together save first' | 'together words first';

async function startPendingTakeover(strict: boolean, timing: Timing) {
  localStorage.setItem(key, JSON.stringify({ userId: 'user-a', queueIds: ['a'], orderMode: 'db-order',
    direction: 'en-to-geo', allowReguess: true, correctCount: 0, totalAttempts: 0, mistakes: [],
    attemptedWordIds: ['b', 'c', 'd'], unresolvedWordIds: [], hasChecked: false, completed: false }));
  localStorage.setItem(otherKey, otherCopy);
  const pending = deferred<QueryResult>();
  const vocabulary = deferred<QueryResult>();
  const save = query(pending.promise);
  let holdVocabulary = false;
  supabaseMock.from.mockImplementation(table => {
    if (table === 'words') return query(holdVocabulary ? vocabulary.promise : { data: words, error: null });
    if (table === 'test_history') return save;
    throw new Error(`Unexpected table: ${table}`);
  });
  const wrap = (children: ReactNode) => strict ? <StrictMode>{children}</StrictMode> : children;
  const first = render(wrap(<FreeMode />));
  const a = within(first.container);
  fireEvent.change(await a.findByRole('textbox'), { target: { value: 'meaning a' } });
  await userEvent.click(a.getByRole('button', { name: 'Check Answer' }));
  await userEvent.click(a.getByRole('button', { name: 'Finish Practice' }));
  await userEvent.click(a.getByRole('button', { name: 'Close & Save' }));
  await waitFor(() => expect(save.insert).toHaveBeenCalledOnce());
  const result = structuredClone(save.insert.mock.calls[0][0]);
  const checkpoint = localStorage.getItem(key);
  holdVocabulary = timing !== 'immediate vocabulary';
  let scheduleSave: (() => void) | undefined;
  let commits = 0;
  let clockOffset = 0;
  const now = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => now() + clockOffset);
  const second = render(wrap(<Profiler id="practice" onRender={() => {
    if (scheduleSave && second.container.textContent?.includes('Total words in dictionary: 4') && ++commits === 2) {
      // Model the browser yielding after vocabulary reconciliation commits, with
      // that render's passive effects still queued. No wall-clock sleep: advance
      // the scheduler's frame clock, then let the real deferred save settle.
      clockOffset += 100;
      scheduleSave();
    }
  }}><FreeMode /></Profiler>));
  const b = within(second.container);
  await userEvent.click(await b.findByRole('button', { name: 'Continue in this tab' }));
  await userEvent.click(b.getByRole('button', { name: 'Continue here' }));
  await b.findByRole('button', { name: 'Saving result...' });
  expect(localStorage.getItem(key)).toBe(checkpoint);
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const removals = vi.spyOn(Storage.prototype, 'removeItem');
  const finishWords = () => vocabulary.resolve({ data: words, error: null });
  async function finish(response: QueryResult = { error: null }) {
    const finishSave = () => pending.resolve(response);
    if (timing === 'between commit and effects') {
      scheduleSave = finishSave;
      // Intentionally outside act: act drains passive effects synchronously and
      // would remove the browser scheduling window under investigation.
      finishWords();
      await waitFor(() => expect(commits).toBeGreaterThanOrEqual(2));
    } else if (timing.startsWith('together')) {
      await act(async () => {
        if (timing.endsWith('save first')) { finishSave(); finishWords(); }
        else { finishWords(); finishSave(); }
      });
    } else {
      await act(async () => { if (timing === 'save first') finishSave(); else finishWords(); });
      await act(async () => { if (timing === 'save first') finishWords(); else finishSave(); });
    }
  }
  return { first, second, a, b, finish, save, result, checkpoint, writes, removals };
}

describe.each([false, true])('Practice save cleanup (StrictMode=%s)', strict => {
  it.each<Timing>(['between commit and effects', 'immediate vocabulary', 'save first', 'words first',
    'together save first', 'together words first'])('does not resurrect a saved checkpoint: %s', async timing => {
    const { b, finish, save, result, writes, removals } = await startPendingTakeover(strict, timing);
    await finish();
    await b.findByText('Result saved to History');
    const immediateCopy = localStorage.getItem(key);
    // Also flush subsequent effects: success must be stable, not an intermediate
    // null followed by a stale completed/zero-attempt replacement checkpoint.
    await act(async () => { await Promise.resolve(); });
    expect(localStorage.getItem(key)).toBeNull();
    expect(immediateCopy).toBeNull();
    expect(b.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(b.getByRole('button', { name: 'Reset Progress' })).toBeDisabled();
    expect(b.getByRole('textbox')).toBeEnabled();
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(result);
    expect(removals).toHaveBeenCalledWith(key);
    expect(writes.mock.calls.filter(([storageKey]) => storageKey === key)).toEqual([]);
    expect(localStorage.getItem(otherKey)).toBe(otherCopy);
  });

  it('retains the exact pending snapshot on failure in the same scheduling window and retries once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { b, finish, save, result, checkpoint } = await startPendingTakeover(strict, 'between commit and effects');
    await finish({ error: { message: 'Offline' } });
    await b.findByRole('button', { name: 'Retry Save' });
    expect(localStorage.getItem(key)).toBe(checkpoint);
    expect(b.queryByText('Result saved to History')).not.toBeInTheDocument();
    save.insert.mockResolvedValueOnce({ error: null });
    await userEvent.click(b.getByRole('button', { name: 'Retry Save' }));
    await b.findByText('Result saved to History');
    expect(save.insert.mock.calls.map(([payload]) => payload)).toEqual([result, result]);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(otherKey)).toBe(otherCopy);
  });
});

it('persists new scored work and gives a separate intentional session its own History identity after cleanup', async () => {
  const { b, finish, save, result } = await startPendingTakeover(true, 'between commit and effects');
  await finish();
  await b.findByText('Result saved to History');
  expect(localStorage.getItem(key)).toBeNull();
  fireEvent.change(b.getByRole('textbox'), { target: { value: 'meaning a' } });
  await userEvent.click(b.getByRole('button', { name: 'Check Answer' }));
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ correctCount: 1, totalAttempts: 1, hasChecked: true, completed: false });
  await userEvent.click(b.getByRole('button', { name: 'Finish' }));
  const confirmation = b.getByRole('heading', { name: 'Finish Practice' }).closest<HTMLElement>('.fixed')!;
  await userEvent.click(within(confirmation).getByRole('button', { name: 'Finish' }));
  save.insert.mockResolvedValueOnce({ error: null });
  await userEvent.click(b.getByRole('button', { name: 'Close & Save' }));
  await b.findByText('Result saved to History');
  expect(save.insert).toHaveBeenCalledTimes(2);
  expect(save.insert.mock.calls[1][0]).toMatchObject({ user_id: result.user_id, total_words: 1, correct_count: 1, mistakes: [] });
  expect(save.insert.mock.calls[1][0].id).not.toBe(result.id);
  expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem(otherKey)).toBe(otherCopy);
});
