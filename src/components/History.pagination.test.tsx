import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, supabaseMock, type QueryResult } from '../test/mocks';
import { historyRecord } from '../test/fixtures';
import type { TestHistory } from '../lib/supabase';
import History from './History';

const id = (index: number, userId = 'user-a') => `${userId}-${String(index).padStart(4, '0')}`;
// Unique denominators make each rendered record identifiable even with tied dates.
const history = (size: number, userId = 'user-a') => Array.from({ length: size }, (_, index) => historyRecord({
  id: id(index, userId), user_id: userId, total_words: (index + 1) * 10,
  correct_count: (index + 1) * (index % 3 === 0 ? 9 : index % 3 === 1 ? 6 : 2),
  test_date: '2026-01-01T10:00:00.123456Z',
}));

interface Read {
  userId?: string;
  from: number;
  to: number;
  exactCount: boolean;
  orders: { column: keyof TestHistory; ascending: boolean }[];
}
interface Deletion { userId?: string; ids: string[] }

// Authorization and sorting happen before inclusive ranges and an independent
// server cap. Deletes only mutate this in-memory fixture after confirmation.
function server(rows: TestHistory[], maxRows = 1000) {
  const state = {
    rows, reads: [] as Read[], deletions: [] as Deletion[],
    respond: (_read: Read, response: QueryResult): QueryResult | Promise<QueryResult> => response,
    deleteError: null as QueryResult['error'],
  };
  supabaseMock.from.mockImplementation(table => {
    if (table !== 'test_history') throw new Error(`Unexpected table: ${table}`);
    const read: Read = { from: 0, to: Infinity, exactCount: false, orders: [] };
    let deleting = false;
    let ids: string[] = [];
    const builder = {
      select: (_columns: string, options?: { count?: string }) => { read.exactCount = options?.count === 'exact'; return builder; },
      eq: (column: string, value: string) => {
        if (column === 'user_id') read.userId = value;
        if (column === 'id') ids = [value];
        return builder;
      },
      order: (column: keyof TestHistory, options: { ascending: boolean }) => { read.orders.push({ column, ...options }); return builder; },
      range: (from: number, to: number) => { read.from = from; read.to = to; return builder; },
      delete: () => { deleting = true; return builder; },
      in: (column: string, values: string[]) => { if (column === 'id') ids = values; return builder; },
      then: <T, U>(resolve?: (value: QueryResult) => T, reject?: (reason: unknown) => U) => {
        if (deleting) {
          state.deletions.push({ userId: read.userId, ids });
          if (!state.deleteError) state.rows = state.rows.filter(row => row.user_id !== read.userId || !ids.includes(row.id));
          return Promise.resolve({ error: state.deleteError }).then(resolve, reject);
        }
        state.reads.push(read);
        const authorized = state.rows.filter(row => row.user_id === read.userId).sort((a, b) => {
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

const renderedRows = () => Array.from(document.querySelectorAll<HTMLElement>('.border-b'));
const renderedTotals = () => renderedRows().map(row => Number(row.textContent?.match(/\(\d+\/(\d+)\)/)?.[1]));
const finishLoading = () => waitFor(() => expect(document.body.textContent).not.toContain('Loading...'));
const control = (index: number, value: string) => fireEvent.change(document.querySelectorAll('select')[index], { target: { value } });
// Scope queries before searching thousands of row buttons; keep assertions on
// the real rendered list without spending the timeout traversing unrelated rows.
const toolbar = () => within(document.querySelector<HTMLElement>('[role="group"]')!);
const confirmation = () => within(document.querySelector<HTMLElement>('.fixed')!);
const selectAll = () => fireEvent.click(toolbar().getByRole('button', { name: 'Select All' }));
function rowAction(record: TestHistory, icon: string) {
  const row = renderedRows().find(row => row.textContent?.includes(`(${record.correct_count}/${record.total_words})`));
  const button = row?.querySelector(`.lucide-${icon}`)?.closest('button');
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button!;
}
function expectStats(records: TestHistory[]) {
  const values = Array.from(document.querySelectorAll('.text-4xl'), el => el.textContent);
  if (!records.length) { expect(values).toEqual([]); return; }
  const average = Math.round(records.reduce((sum, row) => sum + row.correct_count / row.total_words * 100, 0) / records.length);
  expect(values[0]).toBe(String(records.length));
  expect(values[1]).toMatch(new RegExp(`^${average}%`));
  expect(values[2]).toBe(String(records.reduce((sum, row) => sum + row.total_words, 0)));
}
function expectNoPartialHistory() {
  expect(renderedRows()).toHaveLength(0);
  expectStats([]);
  expect(toolbar().getByRole('button', { name: 'Delete Selected (0)' })).toBeDisabled();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('History loads the complete authorized collection', () => {
  it.each([0, 3, 499, 500, 501, 1000, 1001, 2000, 2001])('loads %i records with complete statistics, deterministic ties, and no duplicate reads', async size => {
    const rows = history(size);
    const api = server([...rows, ...history(7, 'user-b')]);
    render(<History />);
    await finishLoading();
    expect(renderedRows()).toHaveLength(size);
    expect(renderedTotals()).toEqual([...rows].reverse().map(row => row.total_words));
    expectStats(rows);
    expect(api.reads).toHaveLength(Math.max(1, Math.ceil(size / 500)));
    api.reads.forEach((read, index) => expect(read).toEqual({
      userId: 'user-a', from: index * 500, to: index * 500 + 499, exactCount: index === 0,
      orders: [{ column: 'test_date', ascending: false }, { column: 'id', ascending: false }],
    }));
    expect(api.deletions).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
    if (!size) expect(screen.getByText('No results found.')).toBeInTheDocument();
  });

  it('continues from actual row counts when the server cap is below 500', async () => {
    const rows = history(1001);
    const api = server(rows, 200);
    render(<History />);
    await finishLoading();
    expect(renderedTotals()).toEqual([...rows].reverse().map(row => row.total_words));
    expect(api.reads.map(read => read.from)).toEqual([0, 200, 400, 600, 800, 1000]);
    expectStats(rows);
  });

  it('orders by date first, then descending ID across tied batch boundaries', async () => {
    const rows = history(1001).map((row, index) => ({ ...row,
      test_date: index < 500 ? '2026-01-02T10:00:00.123456Z' : row.test_date,
    }));
    server([...rows].reverse());
    render(<History />);
    await finishLoading();
    expect(renderedTotals()).toEqual([...rows.slice(0, 500).reverse(), ...rows.slice(500).reverse()].map(row => row.total_words));
  });

  it('filters, sorts, and calculates filter-dependent statistics using records beyond the first 1,000', async () => {
    const rows = history(1003).map((row, index) => ({ ...row,
      test_direction: index < 3 ? 'geo-to-en' as const : 'en-to-geo' as const,
      test_date: index < 3 ? `2025-12-0${index + 1}T10:00:00Z` : row.test_date,
    }));
    const api = server(rows);
    render(<History />);
    await finishLoading();
    expectStats(rows);
    control(0, 'geo-to-en');
    expect(renderedTotals()).toEqual([30, 20, 10]);
    expectStats(rows.slice(0, 3));
    for (const [filter, index] of [['high', 0], ['medium', 1], ['low', 2]] as const) {
      control(1, filter);
      expect(renderedTotals()).toEqual([rows[index].total_words]);
      expectStats([rows[index]]);
    }
    expect(api.reads).toHaveLength(3); // Client filters do not fetch again.
    control(1, 'all');
    control(3, 'asc');
    await finishLoading();
    expect(renderedTotals()).toEqual([10, 20, 30]);
    control(2, 'score');
    await finishLoading();
    expect(renderedTotals()).toEqual([30, 20, 10]);
    control(3, 'desc');
    await finishLoading();
    expect(renderedTotals()).toEqual([10, 20, 30]);
    expectStats(rows.slice(0, 3));
  });

  it('preserves saved prompts, descriptions, definitions and legacy mistakes beyond the first batch', async () => {
    const rows = history(1001);
    rows[0].mistakes = [
      { english_word: 'go', question_prompt: 'წასვლა, სვლა', description: '<strong onclick="evil()">Saved context</strong><script>evil()</script>',
        user_answer: 'wrong', correct_definitions: ['go', 'went', 'gone'] },
      { english_word: 'legacy word', user_answer: '', correct_definitions: ['ძველი'] },
    ];
    server(rows);
    render(<History />);
    await finishLoading();
    const expand = rowAction(rows[0], 'chevron-down');
    fireEvent.click(expand);
    const details = within(expand.closest<HTMLElement>('.border-b')!);
    expect(details.getByText('წასვლა, სვლა')).toBeInTheDocument();
    expect(details.getByText('go, went, gone')).toBeInTheDocument();
    expect(details.getByText('wrong')).toBeInTheDocument();
    expect(details.getByText('legacy word')).toBeInTheDocument();
    expect(details.getByText('(empty)')).toBeInTheDocument();
    expect(details.getByText('ძველი')).toBeInTheDocument();
    expect(details.getByText('Saved context').tagName).toBe('STRONG');
    expect(document.querySelector('script, [onclick]')).toBeNull();
  });

  it('publishes neither rows nor statistics while a later page is pending, and honors filter changes', async () => {
    const rows = history(1001).map((row, index) => ({ ...row, test_direction: index === 0 ? 'geo-to-en' as const : 'en-to-geo' as const }));
    const api = server(rows);
    const pending = deferred<QueryResult>();
    let response!: QueryResult;
    api.respond = (read, result) => {
      if (read.from === 500) { response = result; return pending.promise; }
      return result;
    };
    render(<History />);
    await waitFor(() => expect(api.reads).toHaveLength(2));
    expectNoPartialHistory();
    control(0, 'geo-to-en');
    expectNoPartialHistory();
    expect(api.reads).toHaveLength(2);
    await act(async () => { pending.resolve(response); });
    await finishLoading();
    expect(renderedTotals()).toEqual([10]);
    expectStats([rows[0]]);
    expect(api.reads).toHaveLength(3);
  });

  it.each(['API error', 'network rejection'])('discards partial results after an intermediate %s and retries from scratch', async kind => {
    const rows = history(1001);
    const api = server(rows);
    api.respond = (read, response) => read.from !== 500 ? response : kind === 'API error'
      ? { data: null, error: { message: 'Offline' } } : Promise.reject(new Error('Offline'));
    render(<History />);
    await screen.findByRole('alert');
    expectNoPartialHistory();
    expect(document.body.textContent).not.toContain('No results found.');
    expect(api.reads.map(read => read.from)).toEqual([0, 500]);
    api.respond = (_read, response) => response;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await finishLoading();
    expect(renderedTotals()).toEqual([...rows].reverse().map(row => row.total_words));
    expectStats(rows);
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 0, 500, 1000]);
    expect(api.deletions).toEqual([]);
  });

  it.each([null, undefined, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid exact count %s without publishing rows', async count => {
    const api = server(history(501));
    api.respond = (_read, response) => ({ ...response, count });
    render(<History />);
    await screen.findByRole('alert');
    expectNoPartialHistory();
    expect(api.reads).toHaveLength(1);
  });

  it.each(['null', 'object', 'empty', 'oversized', 'overlap', 'duplicate within page', 'missing id', 'null row', 'wrong owner', 'exceeds count'])(
    'rejects a malformed intermediate page: %s', async kind => {
      const rows = history(1001);
      const api = server(rows);
      api.respond = (read, response) => {
        if (read.from === 0) return kind === 'exceeds count' ? { ...response, count: 501 } : response;
        const page = response.data as TestHistory[];
        const data: unknown = kind === 'null' ? null : kind === 'object' ? {} : kind === 'empty' ? []
          : kind === 'oversized' ? rows.slice(0, 501) : kind === 'overlap' ? [rows[1000], ...page.slice(1)]
          : kind === 'duplicate within page' ? [page[0], page[0], ...page.slice(2)]
          : kind === 'missing id' ? [{ ...page[0], id: undefined }, ...page.slice(1)]
          : kind === 'null row' ? [null, ...page.slice(1)]
          : kind === 'wrong owner' ? [{ ...page[0], user_id: 'user-b' }, ...page.slice(1)] : page;
        return { ...response, data };
      };
      render(<History />);
      await screen.findByRole('alert');
      expectNoPartialHistory();
      expect(api.reads).toHaveLength(2);
      expect(api.deletions).toEqual([]);
    });
});

describe('History pagination preserves lifecycle and selection safety', () => {
  it.each(['success', 'failure'])('ignores obsolete sort-context page %s and stops its pagination', async outcome => {
    const rows = history(1001);
    const api = server(rows);
    const pending = deferred<QueryResult>();
    let oldResponse!: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { oldResponse = response; return pending.promise; }
      return response;
    };
    render(<History />);
    await waitFor(() => expect(api.reads).toHaveLength(2));
    api.respond = (_read, response) => response;
    control(2, 'score');
    await finishLoading();
    const before = renderedTotals();
    await act(async () => {
      if (outcome === 'success') pending.resolve(oldResponse);
      else pending.reject(new Error('Obsolete page failure'));
    });
    expect(renderedTotals()).toEqual(before);
    expectStats(rows);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 0, 500, 1000]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('isolates A → B → A reads under StrictMode, including a stale successful page', async () => {
    const rows = history(1001);
    const api = server([...rows, ...history(2, 'user-b')]);
    const pending = deferred<QueryResult>();
    let oldResponse!: QueryResult;
    api.respond = (read, response) => {
      if (read.userId === 'user-a' && read.from === 500) { oldResponse = response; return pending.promise; }
      return response;
    };
    const view = render(<StrictMode><History /></StrictMode>);
    await waitFor(() => expect(api.reads.some(read => read.from === 500)).toBe(true));
    expectNoPartialHistory();
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><History /></StrictMode>);
    await finishLoading();
    expectStats(history(2, 'user-b'));
    api.rows = [historyRecord({ total_words: 777, correct_count: 700 })];
    api.respond = (_read, response) => response;
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><History /></StrictMode>);
    await finishLoading();
    const reads = api.reads.length;
    await act(async () => { pending.resolve(oldResponse); });
    expect(renderedTotals()).toEqual([777]);
    expectStats(api.rows);
    expect(api.reads).toHaveLength(reads);
    expect(api.reads.filter(read => read.from === 500)).toHaveLength(1);
    expect(api.deletions).toEqual([]);
  });

  it.each(['unmount', 'navigate back', 'sign out'])('does not commit a delayed page after %s', async transition => {
    const api = server(history(1001));
    const pending = deferred<QueryResult>();
    let oldResponse!: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { oldResponse = response; return pending.promise; }
      return response;
    };
    const view = render(<History />);
    await waitFor(() => expect(api.reads).toHaveLength(2));
    if (transition === 'sign out') { authMock.user = null; view.rerender(<History />); }
    else view.unmount();
    if (transition === 'navigate back') {
      api.rows = history(3);
      api.respond = (_read, response) => response;
      render(<History />);
      await finishLoading();
    }
    const reads = api.reads.length;
    await act(async () => { pending.resolve(oldResponse); });
    expect(renderedTotals()).toEqual(transition === 'navigate back' ? [30, 20, 10] : []);
    expect(api.reads).toHaveLength(reads);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('rechecks confirmed selection after a complete reload removes a selected record', async () => {
    const rows = history(7);
    const api = server(rows, 2);
    render(<History />);
    await finishLoading();
    fireEvent.click(rowAction(rows[0], 'square'));
    fireEvent.click(rowAction(rows[1], 'square'));
    fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (2)' }));
    api.rows = rows.slice(1);
    control(3, 'asc');
    await finishLoading();
    expect(toolbar().getByText('1 of 6 visible records selected')).toBeInTheDocument();
    fireEvent.click(confirmation().getByRole('button', { name: 'Delete 1 Record' }));
    await finishLoading();
    expect(api.deletions).toEqual([{ userId: 'user-a', ids: [rows[1].id] }]);
    expectStats(rows.slice(2));
  });

  it('clears selection and invalidates stale confirmation callbacks on filtering after full loading', async () => {
    const rows = history(1001);
    const api = server(rows);
    render(<History />);
    await finishLoading();
    selectAll();
    fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (1001)' }));
    const confirm = confirmation().getByRole('button', { name: 'Delete 1001 Records' });
    const key = Object.keys(confirm).find(key => key.startsWith('__reactProps$'))!;
    const staleConfirm = (Reflect.get(confirm, key) as { onClick: () => Promise<void> }).onClick;
    control(1, 'high');
    await act(async () => { await staleConfirm(); });
    expect(api.deletions).toEqual([]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(toolbar().getByRole('button', { name: 'Delete Selected (0)' })).toBeDisabled();
    expectStats(rows.filter(row => row.correct_count / row.total_words >= 0.8));
    expect(api.reads).toHaveLength(3);
  });

  it.each(['single', 'bulk'])('refreshes all remaining pages after a confirmed %s deletion beyond the first batch', async kind => {
    const rows = history(503);
    const other = history(3, 'user-b');
    const api = server([...rows, ...other]);
    render(<History />);
    await finishLoading();
    if (kind === 'single') {
      fireEvent.click(rowAction(rows[0], 'trash2'));
      expect(api.deletions).toEqual([]);
      fireEvent.click(confirmation().getByRole('button', { name: 'Delete' }));
    } else {
      fireEvent.click(rowAction(rows[0], 'square'));
      fireEvent.click(rowAction(rows[1], 'square'));
      fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (2)' }));
      expect(api.deletions).toEqual([]);
      fireEvent.click(confirmation().getByRole('button', { name: 'Delete 2 Records' }));
    }
    await waitFor(() => expect(api.reads).toHaveLength(4));
    await finishLoading();
    const removed = kind === 'single' ? 1 : 2;
    expect(api.deletions).toEqual([{ userId: 'user-a', ids: rows.slice(0, removed).map(row => row.id) }]);
    expect(renderedTotals()).toEqual(rows.slice(removed).reverse().map(row => row.total_words));
    expectStats(rows.slice(removed));
    expect(api.rows.filter(row => row.user_id === 'user-b')).toEqual(other);
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 0, 500]);
  });

  it('retains confirmed large selections on a simulated request-size rejection without automatic deletion retries', async () => {
    const rows = history(501);
    const api = server(rows);
    api.deleteError = { message: '414 URI Too Long' };
    render(<History />);
    await finishLoading();
    selectAll();
    fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (501)' }));
    expect(api.deletions).toEqual([]);
    fireEvent.click(confirmation().getByRole('button', { name: 'Delete 501 Records' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledExactlyOnceWith('Error deleting records: 414 URI Too Long'));
    expect(api.deletions).toEqual([{ userId: 'user-a', ids: [...rows].reverse().map(row => row.id) }]);
    expect(api.rows).toEqual(rows);
    expectStats(rows);
    expect(document.querySelector('[role="alertdialog"]')).toHaveAccessibleName('Delete 501 Records');
    expect(toolbar().getByText('501 of 501 visible records selected')).toBeInTheDocument();
    expect(api.reads).toHaveLength(2);
  });
});
