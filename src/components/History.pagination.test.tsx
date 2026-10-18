import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { HISTORY_PAGE_SIZE_KEY } from '../lib/historyPreferences';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, supabaseMock, type QueryResult } from '../test/mocks';
import { historyRecord } from '../test/fixtures';
import type { TestHistory } from '../lib/supabase';
import { beginHistoryDeletion } from '../lib/historyDeletion';
import History from './History';
import { allHistoryRows, findHistoryRow } from '../test/historyPagination';

function refreshAfterDeletion() {
  act(() => { const release = beginHistoryDeletion('user-a'); expect(release).not.toBeNull(); release!(); });
}

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
          const deleted = state.rows.filter(row => row.user_id === read.userId && ids.includes(row.id)).map(row => ({ id: row.id }));
          if (!state.deleteError) state.rows = state.rows.filter(row => row.user_id !== read.userId || !ids.includes(row.id));
          return Promise.resolve({ data: state.deleteError ? null : deleted, error: state.deleteError }).then(resolve, reject);
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
const renderedTotals = () => allHistoryRows().map(row => Number(row.textContent?.match(/\(\d+\/(\d+)\)/)?.[1]));
const finishLoading = () => waitFor(() => expect(document.body.textContent).not.toContain('Loading...'));
const control = (index: number, value: string) => fireEvent.change(document.querySelectorAll('select')[index], { target: { value } });
// Scope queries before searching thousands of row buttons; keep assertions on
// the real rendered list without spending the timeout traversing unrelated rows.
const toolbar = () => within(document.querySelector<HTMLElement>('[role="group"]')!);
const confirmation = () => within(document.querySelector<HTMLElement>('.fixed')!);
const selectAll = () => fireEvent.click(toolbar().getByRole('button', { name: /^Select All \d+ Filtered Records$/ }));
function rowAction(record: TestHistory, icon: string) {
  const row = findHistoryRow(record.id);
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
    const allRows = allHistoryRows();
    expect(allRows).toHaveLength(size);
    expect(renderedRows().length).toBeLessThanOrEqual(25);
    expect(allRows.map(row => Number(row.textContent?.match(/\(\d+\/(\d+)\)/)?.[1])))
      .toEqual([...rows].reverse().map(row => row.total_words));
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
    expect(api.reads).toHaveLength(3);
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
    control(2, 'score');
    control(3, 'asc');
    expect(api.reads.map(read => read.from)).toEqual([0, 500]);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    api.respond = (_read, response) => response;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await finishLoading();
    expect(renderedTotals()).toEqual([...rows].reverse().sort((a, b) =>
      a.correct_count / a.total_words - b.correct_count / b.total_words).map(row => row.total_words));
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

describe('History sorting is presentation only', () => {
  const sortCases = [100, 1001, 2001].flatMap(size =>
    ['date', 'score'].flatMap(by => ['asc', 'desc'].map(order => ({ size, by, order }))));
  const withDates = (size: number) => history(size).map((row, index) => ({ ...row,
    test_date: new Date(Date.UTC(2026, 0, 1) + Math.floor(index / 7) * 1000).toISOString(),
  }));
  const expectedOrder = (rows: TestHistory[], by: string, order: string) => [...rows].reverse().sort((a, b) => {
    const delta = by === 'date' ? Date.parse(a.test_date) - Date.parse(b.test_date)
      : a.correct_count / a.total_words - b.correct_count / b.total_words;
    return order === 'asc' ? delta : -delta;
  }).map(row => row.total_words);

  it.each(sortCases)('sorts $size records $by $order with stable ties and zero additional reads', async ({ size, by, order }) => {
    const rows = withDates(size);
    const api = server([...rows, ...history(3, 'user-b')]);
    render(<History />);
    await finishLoading();
    const reads = api.reads.length;
    // Also exercise a transition back to the default date/desc ordering.
    if (by === 'date' && order === 'desc') control(3, 'asc');
    act(() => { control(2, by); control(3, order); });
    expect(document.body.textContent).not.toContain('Loading...');
    expect(renderedTotals()).toEqual(expectedOrder(rows, by, order));
    expectStats(rows);
    await act(async () => {}); // Settle queued mock requests before asserting zero new reads.
    expect(api.reads).toHaveLength(reads);
    expect(reads).toBe(Math.ceil(size / 500));
    expect(api.deletions).toEqual([]);
  });

  it('keeps expanded details, filtered statistics and selected IDs through rapid sort changes', async () => {
    const rows = withDates(100);
    rows[3].mistakes = [{ english_word: 'saved prompt', correct_definitions: ['განმარტება'], user_answer: 'attempt' }];
    const api = server(rows);
    render(<History />); await finishLoading();
    control(1, 'high');
    fireEvent.click(rowAction(rows[3], 'chevron-down'));
    fireEvent.click(rowAction(rows[3], 'square'));
    fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (1)' }));
    const dialog = document.querySelector('[role="alertdialog"]');
    act(() => {
      for (let i = 0; i < 5; i++) {
        control(2, 'score'); control(3, 'asc'); control(2, 'date'); control(3, 'desc');
      }
      control(2, 'score'); control(3, 'asc');
    });
    const visible = rows.filter(row => row.correct_count / row.total_words >= .8);
    expect(renderedTotals()).toEqual(expectedOrder(visible, 'score', 'asc'));
    expectStats(visible);
    findHistoryRow(rows[3].id);
    expect(screen.getByText('saved prompt')).toBeInTheDocument();
    expect(document.querySelector('[role="alertdialog"]')).toBe(dialog);
    expect(toolbar().getByText(`1 of ${visible.length} matching records selected across all pages`)).toBeInTheDocument();
    expect(api.reads).toHaveLength(1);
    fireEvent.click(confirmation().getByRole('button', { name: 'Delete 1 Record' }));
    await finishLoading();
    expect(api.deletions).toEqual([{ userId: 'user-a', ids: [rows[3].id] }]);
  });

  it.each([500, 1000])('keeps the same paginated read alive when sorting during the page at offset %i', async offset => {
    const rows = withDates(1001), api = server(rows);
    const pending = deferred<QueryResult>();
    let page!: QueryResult;
    api.respond = (read, response) => {
      if (read.from === offset) { page = response; return pending.promise; }
      return response;
    };
    render(<History />);
    await waitFor(() => expect(api.reads).toHaveLength(offset / 500 + 1));
    control(3, 'asc'); control(2, 'score'); control(3, 'desc');
    expectNoPartialHistory();
    expect(api.reads.map(read => read.from)).toEqual(offset === 500 ? [0, 500] : [0, 500, 1000]);
    await act(async () => pending.resolve(page));
    await finishLoading();
    expect(renderedTotals()).toEqual(expectedOrder(rows, 'score', 'desc'));
    expectStats(rows);
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 1000]);
  });
});

describe('History pagination preserves lifecycle and selection safety', () => {
  it.each(['success', 'failure'])('ignores obsolete deletion-version page %s and stops its pagination', async outcome => {
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
    refreshAfterDeletion();
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
    control(2, 'score');
    control(3, 'asc');
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
    refreshAfterDeletion();
    await finishLoading();
    expect(toolbar().getByText('1 of 6 matching records selected across all pages')).toBeInTheDocument();
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
    control(2, 'score');
    control(3, 'asc');
    expect(renderedTotals()).toEqual(rows.slice(removed).reverse().sort((a, b) =>
      a.correct_count / a.total_words - b.correct_count / b.total_words).map(row => row.total_words));
    expectStats(rows.slice(removed));
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
    await waitFor(() => expect(document.body.textContent).toContain('501 remain.'));
    expect(document.body.textContent).toContain('Deletion stopped');
    expect(document.body.textContent).toContain('The request may have reached the server.');
    expect(api.deletions).toEqual([{ userId: 'user-a', ids: [...rows].reverse().slice(0, 100).map(row => row.id) }]);
    expect(api.rows).toEqual(rows);
    expectStats(rows);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(toolbar().getByText('501 of 501 matching records selected across all pages')).toBeInTheDocument();
    expect(api.reads).toHaveLength(4);
  });
});


describe('History display pagination', () => {
  const mountedIds = () => Array.from(document.querySelectorAll<HTMLElement>('[data-history-id]'), row => row.dataset.historyId);
  const nav = (position = 'top') => within(screen.getByRole('navigation', { name: `History pagination (${position})` }));
  const pageSize = () => screen.getByRole('combobox', { name: 'Records per page' });
  const sizeTo = (size: number) => fireEvent.change(pageSize(), { target: { value: String(size) } });
  const next = () => fireEvent.click(nav().getByRole('button', { name: 'Next' }));
  const previous = () => fireEvent.click(nav().getByRole('button', { name: 'Previous' }));
  const expectRange = (from: number, to: number, count: number) =>
    expect(screen.getByText(`Showing ${from}–${to} of ${count} records`)).toBeInTheDocument();

  it.each([0, 1, 10, 25, 26, 49, 50, 51, 100, 101, 1001, 2001, 5000])('renders bounded pages and exact ranges for %i authorized records', async count => {
    const rows = history(count), api = server([...rows, ...history(2, 'user-b')]);
    render(<History />); await finishLoading();
    expect(pageSize()).toHaveValue('25');
    expect(within(pageSize()).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['10', '25', '50', '100']);
    expect(mountedIds()).toEqual([...rows].reverse().slice(0, 25).map(row => row.id));
    expectRange(count ? 1 : 0, Math.min(25, count), count);
    expectStats(rows);
    const pages = Math.max(1, Math.ceil(count / 25));
    if (pages === 1) {
      expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    } else {
      expect(screen.getAllByText(`Page 1 of ${pages}`)).toHaveLength(2);
      for (const position of ['top', 'bottom']) expect(nav(position).getByRole('button', { name: 'Previous' })).toBeDisabled();
      next();
      expect(mountedIds()).toEqual([...rows].reverse().slice(25, 50).map(row => row.id));
      expectRange(26, Math.min(50, count), count);
      previous(); expectRange(1, 25, count);
    }
    expect(api.reads).toHaveLength(Math.max(1, Math.ceil(count / 500)));
    expect(api.deletions).toEqual([]);
  });

  // Native Chrome also walks every page of all benchmark sizes, including
  // 5,000 records. Keep jsdom's final-page cases below its unchanged 5s budget.
  it.each([26, 49, 50, 51, 100, 101, 1001, 2001])('shows the exact short/full final page for %i records', async count => {
    const rows = history(count), api = server(rows);
    render(<History />); await finishLoading();
    const pages = Math.ceil(count / 25);
    // Reach the tail through the supported 100-row UI, then verify the exact
    // default-size final page. Avoid 200 redundant jsdom toolbar rerenders.
    sizeTo(100); findHistoryRow(rows[0].id); sizeTo(25);
    const last = findHistoryRow(rows[0].id);
    expect(last).toBeInTheDocument();
    expect(mountedIds()).toEqual([...rows].reverse().slice((pages - 1) * 25).map(row => row.id));
    expectRange((pages - 1) * 25 + 1, count, count);
    for (const position of ['top', 'bottom']) expect(nav(position).getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getAllByText(`Page ${pages} of ${pages}`)).toHaveLength(2);
    expect(api.reads).toHaveLength(Math.ceil(count / 500));
    expectStats(rows);
  });

  it.each([10, 25, 50, 100])('remembers only page size %i across navigation and a fresh browser-state read', async size => {
    const api = server(history(101));
    const view = render(<History />); await finishLoading();
    sizeTo(size);
    expect(pageSize()).toHaveValue(String(size));
    expect(mountedIds()).toHaveLength(size);
    expect(api.reads).toHaveLength(1);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(HISTORY_PAGE_SIZE_KEY)).toBe(String(size));
    view.unmount();
    // A new component reads storage, just as after navigating back or a reload.
    const returned = render(<History />); await finishLoading();
    expect(pageSize()).toHaveValue(String(size));
    returned.unmount();
    localStorage.clear(); localStorage.setItem(HISTORY_PAGE_SIZE_KEY, String(size));
    render(<StrictMode><History /></StrictMode>); await finishLoading();
    expect(pageSize()).toHaveValue(String(size));
    expect(mountedIds()).toHaveLength(size);
  });

  it.each(['', '0', '26', '-1', '1000', 'NaN', '5e1', ' 50 ', '{"size":50}'])('defaults to 25 for invalid stored preference %s', async invalid => {
    localStorage.setItem(HISTORY_PAGE_SIZE_KEY, invalid);
    server(history(101)); render(<History />); await finishLoading();
    expect(pageSize()).toHaveValue('25'); expect(mountedIds()).toHaveLength(25);
  });

  it('uses 25 when reading storage fails and keeps pagination usable when writing fails', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const api = server(history(101)); render(<History />); await finishLoading();
    expect(pageSize()).toHaveValue('25');
    sizeTo(50); next();
    expectRange(51, 100, 101);
    expect(api.reads).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('retains the old first visible record when changing sizes, including a short last page', async () => {
    const rows = history(101), api = server(rows);
    render(<History />); await finishLoading();
    next(); next(); expectRange(51, 75, 101);
    const first = mountedIds()[0];
    sizeTo(50); expectRange(51, 100, 101); expect(mountedIds()).toContain(first);
    sizeTo(10); expectRange(51, 60, 101); expect(mountedIds()[0]).toBe(first);
    sizeTo(100); expectRange(1, 100, 101); expect(mountedIds()).toContain(first);
    next(); expectRange(101, 101, 101);
    for (const size of [25, 50, 10, 100]) {
      sizeTo(size); expectRange(101, 101, 101); expect(mountedIds()).toEqual([rows[0].id]);
    }
    expect(api.reads).toHaveLength(1); expectStats(rows);
  });

  it('supports keyboard navigation, scrolls only on page navigation, and ignores disabled callbacks', async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    const rows = history(51), api = server(rows);
    render(<History />); await finishLoading();
    expect(scroll).not.toHaveBeenCalled();
    const user = userEvent.setup();
    nav('bottom').getByRole('button', { name: 'Next' }).focus();
    await user.keyboard('{Enter}');
    expectRange(26, 50, 51);
    expect(screen.getByRole('heading', { name: 'History records' })).toHaveFocus();
    expect(scroll).toHaveBeenCalledOnce();
    next(); expectRange(51, 51, 51);
    const finalNext = nav().getByRole('button', { name: 'Next' });
    fireEvent.click(finalNext); expectRange(51, 51, 51);
    previous(); expectRange(26, 50, 51);
    const calls = scroll.mock.calls.length;
    sizeTo(50); control(2, 'score'); control(1, 'high');
    expect(scroll).toHaveBeenCalledTimes(calls);
    expect(api.reads).toHaveLength(1);
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it.each([[0, 'geo-to-en'], [1, 'high'], [2, 'score'], [3, 'asc']] as const)('resets to page 1 for control %i and keeps full filtered statistics', async (index, value) => {
    const rows = history(101).map((row, i) => ({ ...row, test_direction: i % 2 ? 'en-to-geo' as const : 'geo-to-en' as const }));
    const api = server(rows); render(<History />); await finishLoading();
    next(); next();
    control(index, value);
    const matching = rows.filter(row => index === 0 ? row.test_direction === value : index === 1 ? row.correct_count / row.total_words >= .8 : true);
    expectRange(1, Math.min(25, matching.length), matching.length);
    expectStats(matching); expect(api.reads).toHaveLength(1);
  });

  it('keeps per-ID selections across pages, size and sort changes and deletes only the confirmed scope', async () => {
    const rows = history(101), api = server(rows);
    render(<History />); await finishLoading();
    fireEvent.click(rowAction(rows[100], 'square'));
    next(); fireEvent.click(rowAction(rows[75], 'square'));
    next(); fireEvent.click(rowAction(rows[50], 'square'));
    sizeTo(50); control(2, 'score');
    expect(toolbar().getByText('3 of 101 matching records selected across all pages')).toBeInTheDocument();
    fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (3)' }));
    fireEvent.click(confirmation().getByRole('button', { name: 'Cancel' }));
    expect(api.deletions).toEqual([]);
    fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (3)' }));
    // A new server row is outside the snapshot confirmed by the user.
    const added = historyRecord({ id: 'new-row', total_words: 888 }); api.rows.push(added);
    fireEvent.click(confirmation().getByRole('button', { name: 'Delete 3 Records' }));
    await waitFor(() => expect(document.body.textContent).toContain('all 3 confirmed records are no longer'));
    expect(api.deletions).toEqual([{ userId: 'user-a', ids: [rows[100].id, rows[75].id, rows[50].id] }]);
    expect(api.rows).toContain(added); expectStats(api.rows);
    expect(toolbar().getByText('0 of 99 matching records selected across all pages')).toBeInTheDocument();
  });

  it('Select All covers every filtered page; page changes preserve confirmation and filter changes clear it', async () => {
    const rows = history(101), api = server(rows);
    render(<History />); await finishLoading(); control(1, 'high');
    const matching = rows.filter(row => row.correct_count / row.total_words >= .8);
    selectAll(); next(); sizeTo(10);
    expect(toolbar().getByRole('button', { name: 'Deselect All' })).toBeEnabled();
    fireEvent.click(toolbar().getByRole('button', { name: `Delete Selected (${matching.length})` }));
    previous(); sizeTo(100);
    expect(confirmation().getByRole('button', { name: `Delete ${matching.length} Records` })).toBeEnabled();
    control(1, 'low');
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(toolbar().getByRole('button', { name: 'Delete Selected (0)' })).toBeDisabled();
    expect(api.deletions).toEqual([]); expect(api.reads).toHaveLength(1);
  });

  it.each(['single', 'bulk'])('clamps the final page after a confirmed %s deletion and retains a still-valid page on refresh', async kind => {
    const rows = history(51), api = server(rows);
    render(<History />); await finishLoading(); next(); next();
    expectRange(51, 51, 51);
    if (kind === 'single') {
      fireEvent.click(rowAction(rows[0], 'trash2'));
      fireEvent.click(confirmation().getByRole('button', { name: 'Delete' }));
    } else {
      fireEvent.click(rowAction(rows[0], 'square'));
      fireEvent.click(toolbar().getByRole('button', { name: 'Delete Selected (1)' }));
      fireEvent.click(confirmation().getByRole('button', { name: 'Delete 1 Record' }));
    }
    await waitFor(() => expect(api.reads).toHaveLength(2)); await finishLoading();
    expectRange(26, 50, 50); expectStats(rows.slice(1));
    refreshAfterDeletion(); await finishLoading(); expectRange(26, 50, 50);
    api.rows = []; refreshAfterDeletion(); await finishLoading();
    expectRange(0, 0, 0); expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('keeps size changes local during delayed reads and errors, and applies them after explicit Retry', async () => {
    const api = server(history(1001)), pending = deferred<QueryResult>();
    api.respond = (read, response) => read.from === 500 ? pending.promise : response;
    render(<History />); await waitFor(() => expect(api.reads).toHaveLength(2));
    sizeTo(100); control(3, 'asc'); expectNoPartialHistory();
    expect(api.reads).toHaveLength(2);
    await act(async () => pending.resolve({ error: { message: 'offline' } }));
    sizeTo(10); control(2, 'score');
    expect(api.reads).toHaveLength(2); expectNoPartialHistory();
    api.respond = (_read, response) => response;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await finishLoading();
    expectRange(1, 10, 1001); expectStats(history(1001));
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 0, 500, 1000]);
  });

  it('resets pagination across accounts under StrictMode and ignores stale page callbacks after sign-out', async () => {
    const rows = history(51), other = history(26, 'user-b'), api = server([...rows, ...other]);
    const view = render(<StrictMode><History /></StrictMode>); await finishLoading(); next();
    const button = nav().getByRole('button', { name: 'Next' });
    const key = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
    const stale = (Reflect.get(button, key) as { onClick: () => void }).onClick;
    authMock.user = { id: 'user-b' }; view.rerender(<StrictMode><History /></StrictMode>); await finishLoading();
    act(() => stale()); expectRange(1, 25, 26);
    expect(mountedIds()).toEqual([...other].reverse().slice(0, 25).map(row => row.id));
    next(); authMock.user = { id: 'user-a' }; view.rerender(<StrictMode><History /></StrictMode>); await finishLoading();
    expectRange(1, 25, 51);
    authMock.user = null; view.rerender(<StrictMode><History /></StrictMode>); act(() => stale());
    expectRange(0, 0, 0); expect(mountedIds()).toEqual([]);
    expect(api.deletions).toEqual([]);
  });

  it('keeps saved mistake details associated with their ID when paging and sorting', async () => {
    const rows = history(51);
    rows[50].mistakes = [{ english_word: 'first', question_prompt: 'First saved prompt', user_answer: 'wrong', correct_definitions: ['პირველი'], description: '<strong>First description</strong>' }];
    rows[0].mistakes = [{ english_word: 'last', question_prompt: 'Last saved prompt', user_answer: 'wrong', correct_definitions: ['ბოლო'] }];
    server(rows); render(<History />); await finishLoading();
    const dateFormatting = vi.spyOn(Date.prototype, 'toLocaleString');
    fireEvent.click(rowAction(rows[50], 'chevron-down'));
    // Only the expanded row rerenders, not the other 24 mounted records.
    expect(dateFormatting).toHaveBeenCalledOnce();
    expect(screen.getByText('First description')).toBeInTheDocument();
    next(); next();
    expect(screen.queryByText('First saved prompt')).not.toBeInTheDocument();
    fireEvent.click(rowAction(rows[0], 'chevron-down'));
    expect(screen.getByText('Last saved prompt')).toBeInTheDocument();
    previous(); previous();
    expect(screen.queryByText('Last saved prompt')).not.toBeInTheDocument();
    expect(screen.queryByText('First saved prompt')).not.toBeInTheDocument();
    fireEvent.click(rowAction(rows[50], 'chevron-down')); control(2, 'score');
    findHistoryRow(rows[50].id);
    expect(screen.getByText('First saved prompt')).toBeInTheDocument();
    expect(screen.queryByText('Last saved prompt')).not.toBeInTheDocument();
  });
});
