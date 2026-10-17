import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import type { Word } from '../lib/supabase';
import { practiceSessionKey, type StoredPracticeSession } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

const id = (index: number, userId = 'user-a') => `${userId}-${String(index).padStart(4, '0')}`;
const vocabulary = (size: number, userId = 'user-a') => Array.from({ length: size }, (_, index) => word({
  id: id(index, userId), user_id: userId, english_word: `word ${index}`, georgian_definitions: [`meaning ${index}`],
  // Equal timestamps cross page boundaries; the ID tie-breaker is essential.
  created_at: '2026-01-01T10:00:00.123456Z',
}));
const stored = (userId = 'user-a'): StoredPracticeSession => JSON.parse(localStorage.getItem(practiceSessionKey(userId))!);
function seed(overrides: Partial<StoredPracticeSession> = {}) {
  const state: StoredPracticeSession = {
    userId: 'user-a', queueIds: [], orderMode: 'db-order', direction: 'en-to-geo', allowReguess: true,
    correctCount: 0, totalAttempts: 0, mistakes: [], attemptedWordIds: [], unresolvedWordIds: [],
    hasChecked: false, completed: false, ...overrides,
  };
  localStorage.setItem(practiceSessionKey(state.userId), JSON.stringify(state));
  return localStorage.getItem(practiceSessionKey(state.userId));
}

interface Read {
  userId: string | undefined;
  from: number;
  to: number;
  exactCount: boolean;
  orders: { column: keyof Word; ascending: boolean }[];
}

// Model server filtering, ordering, inclusive ranges and its independent row cap.
// An unpaginated implementation really truncates at 1,000 in these React tests.
function server(rows: Word[], maxRows = 1000) {
  const reads: Read[] = [];
  const state = {
    reads,
    respond: (_read: Read, response: QueryResult): QueryResult | Promise<QueryResult> => response,
  };
  supabaseMock.from.mockImplementation(table => {
    if (table !== 'words') throw new Error(`Unexpected table: ${table}`);
    const read: Read = { userId: undefined, from: 0, to: Infinity, exactCount: false, orders: [] };
    const builder = {
      select: (_columns: string, options?: { count?: string }) => { read.exactCount = options?.count === 'exact'; return builder; },
      eq: (column: string, value: string) => { if (column === 'user_id') read.userId = value; return builder; },
      order: (column: keyof Word, options: { ascending: boolean }) => { read.orders.push({ column, ...options }); return builder; },
      range: (from: number, to: number) => { read.from = from; read.to = to; return builder; },
      then: <T, U>(resolve?: (value: QueryResult) => T, reject?: (reason: unknown) => U) => {
        reads.push(read);
        const authorized = rows.filter(row => row.user_id === read.userId).sort((a, b) => {
          for (const { column, ascending } of read.orders) {
            const left = String(a[column]), right = String(b[column]);
            if (left !== right) return (left < right ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
        return Promise.resolve(state.respond(read, {
          data: authorized.slice(read.from, Math.min(read.to + 1, read.from + maxRows)),
          count: read.exactCount ? authorized.length : null, error: null,
        })).then(resolve, reject);
      },
    };
    return builder;
  });
  return state;
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

describe('Practice loads the full vocabulary before reconciling progress', () => {
  it.each([0, 3, 499, 500, 501, 1000, 1001, 2000, 2001])('loads %i words without gaps or duplicates', async size => {
    const rows = vocabulary(size);
    const api = server([...rows].reverse().concat(vocabulary(5, 'user-b')));
    seed();
    render(<FreeMode />);
    if (size) await screen.findByRole('textbox');
    else await screen.findByText(/No words available yet/);
    await waitFor(() => expect(stored().queueIds).toEqual(rows.map(row => row.id)));
    expect(new Set(stored().queueIds).size).toBe(size);
    expect(api.reads).toHaveLength(Math.max(1, Math.ceil(size / 500)));
    api.reads.forEach((read, index) => expect(read).toEqual({
      userId: 'user-a', from: index * 500, to: index * 500 + 499, exactCount: index === 0,
      orders: [{ column: 'created_at', ascending: true }, { column: 'id', ascending: true }],
    }));
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBeNull();
  });

  it('continues after short pages when the configured server cap is below the requested batch size', async () => {
    const rows = vocabulary(1001);
    const api = server(rows, 250);
    seed();
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored().queueIds).toEqual(rows.map(row => row.id)));
    expect(api.reads.map(read => read.from)).toEqual([0, 250, 500, 750, 1000]);
  });

  it('uses created_at before the ID tie-breaker across page boundaries', async () => {
    const rows = vocabulary(1001).map((row, index) => ({ ...row,
      created_at: index < 500 ? '2026-01-02T10:00:00.123456Z' : row.created_at,
    }));
    server([...rows].reverse());
    seed();
    render(<FreeMode />);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored().queueIds).toEqual([...rows.slice(500), ...rows.slice(0, 500)].map(row => row.id)));
  });

  it.each(['response error', 'network rejection'])('keeps the checkpoint untouched on an intermediate %s and retries the entire read', async failure => {
    const rows = vocabulary(1001);
    const api = server(rows);
    const pending = deferred<QueryResult>();
    api.respond = (read, response) => read.from === 500 ? pending.promise : response;
    const checkpoint = seed({ queueIds: [id(2), id(1000), id(1)], attemptedWordIds: [id(0), id(1)],
      unresolvedWordIds: [id(1)], totalAttempts: 2, correctCount: 1,
      mistakes: [{ word_id: id(1), english_word: 'word 1', user_answer: 'wrong', correct_definitions: ['meaning 1'] }],
    });
    const original = stored();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FreeMode />);
    await waitFor(() => expect(api.reads).toHaveLength(2));
    expect(screen.getByText('Loading your words...')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
    await act(async () => {
      if (failure === 'network rejection') pending.reject(new Error('Network unavailable'));
      else pending.resolve({ data: null, error: { message: 'Intermediate request failed' } });
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your vocabulary');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
    expect(errors).toHaveBeenCalledTimes(1);
    api.respond = (_read, response) => response;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored()).toEqual({ ...original, queueIds: [...rows.slice(2).map(row => row.id), id(1)] }));
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 0, 500, 1000]);
    expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeEnabled();
  });

  it.each(['missing count', 'invalid count', 'early empty page', 'overlapping page', 'more rows than count'])('fails closed on %s instead of persisting a partial queue or looping', async kind => {
    const rows = vocabulary(1001);
    const api = server(rows);
    api.respond = (read, response) => {
      if (kind === 'missing count' && read.from === 0) return { ...response, count: null };
      if (kind === 'invalid count' && read.from === 0) return { ...response, count: Infinity };
      if (kind === 'more rows than count' && read.from === 0) return { ...response, count: 1 };
      if (read.from === 500) return { ...response, data: kind === 'early empty page' ? [] : rows.slice(0, 500) };
      return response;
    };
    const checkpoint = seed({ queueIds: [id(1000)] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<FreeMode />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
    expect(api.reads.length).toBeLessThanOrEqual(2);
  });

  it('restores checked progress and unresolved retries after the final batch and changes order locally', async () => {
    const rows = vocabulary(1001);
    const api = server([...rows].reverse());
    const pending = deferred<QueryResult>();
    let finalPage: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 1000) { finalPage = response; return pending.promise; }
      return response;
    };
    const checkpoint = seed({ queueIds: [id(1), ...rows.slice(2).map(row => row.id)],
      attemptedWordIds: [id(0), id(1)], unresolvedWordIds: [id(1)], hasChecked: true,
      totalAttempts: 3, correctCount: 1, mistakes: [0, 1].map(index => ({
        word_id: id(index), english_word: `word ${index}`, user_answer: 'wrong', correct_definitions: [`meaning ${index}`],
      })),
    });
    render(<StrictMode><FreeMode /></StrictMode>);
    await waitFor(() => expect(finalPage).toBeDefined());
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
    await act(async () => pending.resolve(finalPage));
    await screen.findByRole('textbox');
    const expectedQueue = [...rows.slice(2).map(row => row.id), id(1)];
    await waitFor(() => expect(stored().queueIds).toEqual(expectedQueue));
    const progress = stored();
    expect(progress).toMatchObject({ totalAttempts: 3, correctCount: 1, unresolvedWordIds: [id(1)], hasChecked: false });
    expect(progress.mistakes).toHaveLength(2);
    expect(progress.queueIds).not.toContain(id(0));
    // StrictMode may start an abandoned first page; only the live read continues.
    expect(api.reads.filter(read => read.from === 500)).toHaveLength(1);
    expect(api.reads.filter(read => read.from === 1000)).toHaveLength(1);
    const requests = api.reads.length;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unchecked draft' } });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await userEvent.click(screen.getByRole('button', { name: 'Random' }));
    expect(stored().queueIds[0]).toBe(id(2));
    expect(stored().queueIds.at(-1)).toBe(id(1));
    expect(new Set(stored().queueIds)).toEqual(new Set(expectedQueue));
    expect(stored().queueIds).not.toEqual(expectedQueue);
    await userEvent.click(screen.getByRole('button', { name: 'In database order' }));
    expect(stored()).toEqual(progress);
    expect(screen.getByRole('textbox')).toHaveValue('unchecked draft');
    expect(api.reads).toHaveLength(requests);
  });

  it.each(['success', 'failure'])('ignores an old intermediate %s after navigating away and back', async outcome => {
    const rows = vocabulary(1001);
    const api = server(rows);
    const pending = deferred<QueryResult>();
    let stalePage: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { stalePage = response; return pending.promise; }
      return response;
    };
    const checkpoint = seed({ queueIds: [id(1000)] });
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await waitFor(() => expect(stalePage).toBeDefined());
    view.rerender(<div>Words</div>);
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
    api.respond = (_read, response) => response;
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'new draft' } });
    await waitFor(() => expect(stored().queueIds).toHaveLength(1001));
    const current = localStorage.getItem(practiceSessionKey('user-a'));
    const requests = api.reads.length;
    await act(async () => pending.resolve(outcome === 'success' ? stalePage : { error: { message: 'Stale error' } }));
    expect(api.reads).toHaveLength(requests);
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(current);
    expect(screen.getByRole('textbox')).toHaveValue('new draft');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not write or request another page after unmount', async () => {
    const api = server(vocabulary(2001));
    const pending = deferred<QueryResult>();
    let page: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { page = response; return pending.promise; }
      return response;
    };
    const checkpoint = seed();
    const view = render(<FreeMode />);
    await waitFor(() => expect(page).toBeDefined());
    view.unmount();
    await act(async () => pending.resolve(page));
    expect(api.reads.map(read => read.from)).toEqual([0, 500]);
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
  });

  it('isolates A → B → A while the first A page sequence is still pending', async () => {
    const rows = vocabulary(1001), bRows = vocabulary(501, 'user-b');
    const api = server([...rows, ...bRows]);
    const pending = deferred<QueryResult>();
    let stalePage: QueryResult;
    api.respond = (read, response) => {
      if (read.userId === 'user-a' && read.from === 500) { stalePage = response; return pending.promise; }
      return response;
    };
    const aCopy = seed({ queueIds: [id(1000)], totalAttempts: 1, correctCount: 1, attemptedWordIds: [id(0)] });
    seed({ userId: 'user-b' });
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    await waitFor(() => expect(stalePage).toBeDefined());
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored('user-b').queueIds).toEqual(bRows.map(row => row.id)));
    const bCopy = localStorage.getItem(practiceSessionKey('user-b'));
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
    api.respond = (_read, response) => response;
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored().queueIds).toHaveLength(1000));
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 1 });
    expect(stored().queueIds).toEqual([id(1000), ...rows.slice(1, 1000).map(row => row.id)]);
    const current = localStorage.getItem(practiceSessionKey('user-a'));
    const requests = api.reads.length;
    await act(async () => pending.resolve(stalePage));
    expect(api.reads).toHaveLength(requests);
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(current);
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bCopy);
  });

  it('hands off during batch loading without persisting partial progress or accepting the old owner response', async () => {
    const rows = vocabulary(1001);
    const api = server(rows);
    const pending = deferred<QueryResult>();
    let stalePage: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { stalePage = response; return pending.promise; }
      return response;
    };
    const checkpoint = seed({ queueIds: [id(1000), id(1)], attemptedWordIds: [id(0), id(1)],
      unresolvedWordIds: [id(1)], totalAttempts: 2, correctCount: 1,
      mistakes: [{ word_id: id(1), english_word: 'word 1', user_answer: 'wrong', correct_definitions: ['meaning 1'] }],
    });
    const first = within(render(<StrictMode><FreeMode /></StrictMode>).container);
    await waitFor(() => expect(stalePage).toBeDefined());
    const reads = api.reads.length;
    const second = within(render(<StrictMode><FreeMode /></StrictMode>).container);
    await second.findByRole('button', { name: 'Continue in this tab' });
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
    expect(second.queryByRole('textbox')).not.toBeInTheDocument();
    expect(api.reads).toHaveLength(reads);
    api.respond = (_read, response) => response;
    await userEvent.click(second.getByRole('button', { name: 'Continue in this tab' }));
    await userEvent.click(second.getByRole('button', { name: 'Continue here' }));
    await second.findByRole('textbox');
    await waitFor(() => expect(stored().queueIds).toHaveLength(1000));
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1, unresolvedWordIds: [id(1)] });
    expect(stored().queueIds[0]).toBe(id(1000));
    expect(stored().queueIds.at(-1)).toBe(id(1));
    const latest = localStorage.getItem(practiceSessionKey('user-a'));
    const requests = api.reads.length;
    await act(async () => pending.resolve(stalePage));
    expect(first.queryByRole('textbox')).not.toBeInTheDocument();
    expect(first.getByRole('status')).toHaveTextContent('Practice is active in another tab');
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(latest);
    expect(api.reads).toHaveLength(requests);
  });
});
