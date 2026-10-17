import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, supabaseMock, type QueryResult } from '../test/mocks';
import { historyRecord } from '../test/fixtures';
import type { TestHistory } from '../lib/supabase';
import History from './History';

const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const records = (size: number, userId = accountA, start = 0) => Array.from({ length: size }, (_, index) => historyRecord({
  id: `00000000-0000-4000-8000-${String(start + index).padStart(12, '0')}`, user_id: userId,
  test_date: new Date(Date.UTC(2026, 0, 1, 0, start + index)).toISOString(),
  total_words: 10, correct_count: index % 2 ? 9 : 2,
  test_direction: index % 2 ? 'geo-to-en' : 'en-to-geo',
}));

interface Deletion { userId?: string; ids: string[]; url: string }
interface Read { userId?: string; from: number; to: number }
function server(rows: TestHistory[]) {
  const api = {
    rows, deletions: [] as Deletion[], reads: [] as Read[], active: 0, maxActive: 0,
    remove(request: Deletion) {
      const deleted = api.rows.filter(row => row.user_id === request.userId && request.ids.includes(row.id)).map(row => ({ id: row.id }));
      api.rows = api.rows.filter(row => row.user_id !== request.userId || !request.ids.includes(row.id));
      return { data: deleted, error: null };
    },
    deleteResponse: (request: Deletion): QueryResult | Promise<QueryResult> => api.remove(request),
    readResponse: (_request: Read, response: QueryResult): QueryResult | Promise<QueryResult> => response,
  };
  supabaseMock.from.mockImplementation(table => {
    if (table !== 'test_history') throw new Error(`Unexpected table: ${table}`);
    const read: Read = { from: 0, to: Infinity };
    const orders: { column: keyof TestHistory; ascending: boolean }[] = [];
    const url = new URL('https://fixture.supabase.co/rest/v1/test_history');
    let ids: string[] = [], deleting = false, exactCount = false;
    const query = {
      select: (columns: string, options?: { count?: string }) => {
        exactCount = options?.count === 'exact'; url.searchParams.set('select', columns); return query;
      },
      eq: (column: string, value: string) => {
        if (column === 'user_id') read.userId = value;
        if (column === 'id') ids = [value];
        url.searchParams.set(column, `eq.${value}`); return query;
      },
      in: (column: string, values: string[]) => {
        expect(column).toBe('id'); ids = [...values];
        url.searchParams.set(column, `in.(${ids.join(',')})`); return query;
      },
      delete: () => { deleting = true; return query; },
      order: (column: keyof TestHistory, options: { ascending: boolean }) => { orders.push({ column, ...options }); return query; },
      range: (from: number, to: number) => { read.from = from; read.to = to; return query; },
      then: <T, U>(resolve?: (value: QueryResult) => T, reject?: (reason: unknown) => U) => Promise.resolve().then(async () => {
        if (deleting) {
          const request = { userId: read.userId, ids, url: url.href };
          api.deletions.push(request);
          api.active++; api.maxActive = Math.max(api.maxActive, api.active);
          try { return await api.deleteResponse(request); }
          finally { api.active--; }
        }
        api.reads.push(read);
        const authorized = api.rows.filter(row => row.user_id === read.userId).sort((a, b) => {
          for (const { column, ascending } of orders) {
            if (a[column] !== b[column]) return (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        });
        return api.readResponse(read, { data: authorized.slice(read.from, Math.min(read.to + 1, read.from + 500)),
          count: exactCount ? authorized.length : null, error: null });
      }).then(resolve, reject),
    };
    return query;
  });
  return api;
}

const toolbar = () => within(document.querySelector<HTMLElement>('[role="group"]')!);
const dialog = () => within(document.querySelector<HTMLElement>('[role="alertdialog"]')!);
const ready = () => waitFor(() => expect(document.body.textContent).not.toContain('Loading...'));
const selectAll = () => fireEvent.click(toolbar().getByRole('button', { name: 'Select All' }));
const openConfirmation = (count: number) => fireEvent.click(toolbar().getByRole('button', { name: `Delete Selected (${count})` }));
const confirm = (count: number) => fireEvent.click(dialog().getByRole('button', { name: `Delete ${count} Record${count === 1 ? '' : 's'}` }));
const renderedDates = () => Array.from(document.querySelectorAll('.border-b .text-gray-500'), element => element.textContent);
function handler(button: HTMLElement) {
  const key = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
  return (Reflect.get(button, key) as { onClick: () => void }).onClick;
}
function expectStatistics(rows: TestHistory[]) {
  const values = Array.from(document.querySelectorAll('.text-4xl'), node => node.textContent);
  if (!rows.length) { expect(values).toEqual([]); return; }
  expect(values[0]).toBe(String(rows.length));
  expect(values[1]).toMatch(new RegExp(`^${Math.round(rows.reduce((sum, row) => sum + row.correct_count / row.total_words * 100, 0) / rows.length)}%`));
  expect(values[2]).toBe(String(rows.reduce((sum, row) => sum + row.total_words, 0)));
}
beforeEach(() => {
  authMock.user = { id: accountA };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('History sequential confirmed deletion', () => {
  it.each([1, 100, 101, 500, 501, 1000, 2001])('deletes exactly %i confirmed IDs in bounded owner-scoped requests', async size => {
    const selected = records(size), other = records(2, accountB, 5000);
    const api = server([...selected, ...other]);
    render(<History />); await ready();
    selectAll(); openConfirmation(size);
    expect(api.deletions).toEqual([]);
    // A newly appearing record must never broaden an already confirmed scope.
    const added = records(1, accountA, 9000)[0]; api.rows.push(added);
    confirm(size);
    await waitFor(() => expect(document.body.textContent).toContain(`all ${size} confirmed records are no longer`));
    expect(api.deletions.map(request => request.ids.length)).toEqual(
      Array.from({ length: Math.ceil(size / 100) }, (_, index) => Math.min(100, size - index * 100)));
    expect(api.deletions.flatMap(request => request.ids)).toEqual([...selected].reverse().map(row => row.id));
    for (const request of api.deletions) {
      expect(request.userId).toBe(accountA);
      expect(new TextEncoder().encode(request.url).length).toBeLessThan(4096);
      expect(new URL(request.url).searchParams.get('user_id')).toBe(`eq.${accountA}`);
    }
    expect(api.maxActive).toBe(1);
    expect(api.rows).toEqual([...other, added]);
    expect(renderedDates()).toEqual([new Date(added.test_date).toLocaleString()]);
    expectStatistics([added]);
    expect(toolbar().getByText('0 of 1 visible records selected')).toBeInTheDocument();
    expect(api.reads).toHaveLength(Math.ceil(size / 500) + 1);
  // This exercises full rendering, selection, confirmation and removal of up to
  // 2,001 real rows. Budget for DOM work; no sleeps or relaxed assertions.
  }, 15000);

  it.each([1, 2])('stops at failed batch %i, refreshes partial progress, and requires fresh confirmation of remaining IDs', async failedBatch => {
    const rows = records(201), other = records(2, accountB, 1000);
    const api = server([...rows, ...other]);
    api.deleteResponse = request => {
      if (api.deletions.length === failedBatch) return { error: { message: 'Network error' } };
      return api.remove(request);
    };
    render(<History />); await ready(); selectAll(); openConfirmation(201);
    const stale = handler(dialog().getByRole('button', { name: 'Delete 201 Records' }));
    confirm(201);
    await waitFor(() => expect(document.body.textContent).toContain('History refreshed:'));
    const remaining = api.rows.filter(row => row.user_id === accountA);
    expect(remaining).toHaveLength(201 - (failedBatch - 1) * 100);
    expect(api.deletions).toHaveLength(failedBatch);
    expect(document.body.textContent).toContain('The request may have reached the server.');
    expect(document.body.textContent).toContain(`${remaining.length} remain.`);
    expectStatistics(remaining);
    expect(toolbar().getByText(`${remaining.length} of ${remaining.length} visible records selected`)).toBeInTheDocument();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async () => stale());
    expect(api.deletions).toHaveLength(failedBatch);
    api.deleteResponse = request => api.remove(request);
    openConfirmation(remaining.length);
    await act(async () => stale()); // The old callback cannot consume the new confirmation.
    expect(api.deletions).toHaveLength(failedBatch);
    confirm(remaining.length);
    await waitFor(() => expect(document.body.textContent).toContain(`all ${remaining.length} confirmed records are no longer`));
    expect(api.deletions.slice(failedBatch).flatMap(request => request.ids)).toEqual([...remaining].reverse().map(row => row.id));
    expect(api.rows).toEqual(other);
  });

  it('does not overlap delayed batches or accept duplicate confirmations, filters, sorting or single-delete callbacks', async () => {
    const api = server(records(201)); const pending = deferred<QueryResult>();
    let firstResult: QueryResult;
    api.deleteResponse = request => {
      const response = api.remove(request);
      if (api.deletions.length === 1) { firstResult = response; return pending.promise; }
      return response;
    };
    render(<History />); await ready();
    const single = handler(document.querySelector('.border-b .lucide-trash2')!.closest('button')!);
    selectAll(); openConfirmation(201);
    const stale = handler(dialog().getByRole('button', { name: 'Delete 201 Records' }));
    await act(async () => { stale(); stale(); });
    expect(api.deletions).toHaveLength(1); expect(api.active).toBe(1);
    fireEvent.change(document.querySelectorAll('select')[0], { target: { value: 'geo-to-en' } });
    fireEvent.change(document.querySelectorAll('select')[3], { target: { value: 'asc' } });
    expect(document.querySelectorAll('select')[0]).toHaveValue('all');
    expect(document.querySelectorAll('select')[3]).toHaveValue('desc');
    act(() => single());
    expect(screen.queryByText('Delete Test Record')).not.toBeInTheDocument();
    expect(api.deletions).toHaveLength(1);
    await act(async () => pending.resolve(firstResult!));
    await waitFor(() => expect(document.body.textContent).toContain('all 201 confirmed records are no longer'));
    expect(api.deletions.map(request => request.ids.length)).toEqual([100, 100, 1]);
    expect(api.maxActive).toBe(1);
    await act(async () => stale()); expect(api.deletions).toHaveLength(3);
  });

  it.each([false, true])('reconciles a lost response (server committed=%s) without replaying DELETE automatically', async committed => {
    const api = server(records(201));
    api.deleteResponse = request => {
      if (committed) api.remove(request);
      return Promise.reject(new Error('Connection lost after sending'));
    };
    render(<History />); await ready(); selectAll(); openConfirmation(201); confirm(201);
    await waitFor(() => expect(document.body.textContent).toContain('History refreshed:'));
    expect(api.deletions).toHaveLength(1);
    const remaining = committed ? 101 : 201;
    expect(document.body.textContent).toContain(`${remaining} remain.`);
    expect(toolbar().getByText(`${remaining} of ${remaining} visible records selected`)).toBeInTheDocument();
    expectStatistics(api.rows);
  });

  it.each(['missing', 'zero', 'partial', 'duplicate', 'foreign'] as const)('stops and verifies an uncertain successful response: %s', async response => {
    const api = server(records(101));
    api.deleteResponse = request => ({ error: null, data: response === 'missing' ? undefined : response === 'zero' ? [] :
      response === 'partial' ? [{ id: request.ids[0] }] : response === 'duplicate' ? request.ids.map(() => ({ id: request.ids[0] })) :
        request.ids.map((id, index) => ({ id: index === 0 ? 'outside-confirmation' : id })) });
    render(<History />); await ready(); selectAll(); openConfirmation(101); confirm(101);
    await waitFor(() => expect(document.body.textContent).toContain('0 of 101 confirmed records are no longer'));
    expect(document.body.textContent).toContain('101 remain.');
    expect(document.body.textContent).toContain('Deletion stopped');
    expect(api.deletions).toHaveLength(1);
    expectStatistics(api.rows);
  });

  it.each(['error', 'invalid count', 'malformed page'])('retains an unknown outcome after refresh %s; read Retry identifies remaining IDs without deleting them', async failure => {
    const api = server(records(201));
    api.deleteResponse = request => { api.remove(request); return Promise.reject(new Error('Lost response')); };
    render(<History />); await ready(); selectAll(); openConfirmation(201);
    api.readResponse = (_request, response) => failure === 'error' ? { error: { message: 'Read unavailable' } } :
      failure === 'invalid count' ? { ...response, count: null } : { ...response, data: null };
    confirm(201);
    await waitFor(() => expect(document.body.textContent).toContain('the remaining records are unknown'));
    expect(document.body.textContent).not.toContain('History refreshed:');
    expectStatistics([]); expect(api.deletions).toHaveLength(1);
    expect(toolbar().getByRole('button', { name: 'Delete Selected (0)' })).toBeDisabled();
    api.readResponse = (_request, response) => response;
    // New records are visible after Retry but are not included in the retry selection.
    const added = records(1, accountA, 9000)[0]; api.rows.push(added);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(document.body.textContent).toContain('101 remain.'));
    expect(toolbar().getByText('101 of 102 visible records selected')).toBeInTheDocument();
    expect(api.deletions).toHaveLength(1); expectStatistics(api.rows);
    api.deleteResponse = request => api.remove(request);
    openConfirmation(101); confirm(101);
    await waitFor(() => expect(document.body.textContent).toContain('all 101 confirmed records are no longer'));
    expect(api.rows).toEqual([added]);
  });

  it('uses current authorized membership even when an old confirmation callback runs after a reload', async () => {
    const rows = records(3); const added = records(1, accountA, 9000)[0];
    const api = server(rows); render(<History />); await ready();
    selectAll(); openConfirmation(3);
    const stale = handler(dialog().getByRole('button', { name: 'Delete 3 Records' }));
    api.rows = [rows[1], added];
    fireEvent.change(document.querySelectorAll('select')[3], { target: { value: 'asc' } });
    await ready();
    expect(dialog().getByRole('button', { name: 'Delete 1 Record' })).toBeEnabled();
    await act(async () => stale());
    await waitFor(() => expect(document.body.textContent).toContain('all 1 confirmed records are no longer'));
    expect(api.deletions.map(request => request.ids)).toEqual([[rows[1].id]]);
    expect(api.rows).toEqual([added]);
  });

  it('keeps another account selection and History intact when the old account request rejects late', async () => {
    const rows = records(201), other = records(2, accountB, 9000);
    const api = server([...rows, ...other]); const pending = deferred<QueryResult>();
    api.deleteResponse = () => pending.promise;
    const view = render(<History />); await ready(); selectAll(); openConfirmation(201); confirm(201);
    await waitFor(() => expect(api.deletions).toHaveLength(1));
    authMock.user = { id: accountB }; view.rerender(<History />); await ready();
    selectAll(); openConfirmation(2);
    const reads = api.reads.length;
    await act(async () => pending.reject(new Error('Old account offline')));
    expect(api.deletions).toHaveLength(1); expect(api.reads).toHaveLength(reads);
    expect(toolbar().getByText('2 of 2 visible records selected')).toBeInTheDocument();
    expect(dialog().getByRole('button', { name: 'Delete 2 Records' })).toBeEnabled();
    expect(document.body.textContent).not.toContain('Deletion stopped');
    expect(api.rows).toEqual([...rows, ...other]);
    expectStatistics(other);
  });

  it('blocks overlapping workflows in two mounted views of the same account and refreshes both afterward', async () => {
    const api = server(records(101)); const pending = deferred<QueryResult>();
    let firstResult: QueryResult;
    api.deleteResponse = request => {
      const response = api.remove(request);
      if (api.deletions.length === 1) { firstResult = response; return pending.promise; }
      return response;
    };
    const first = render(<History />), second = render(<History />); await ready();
    const a = within(first.container), b = within(second.container);
    for (const { container } of [first, second]) {
      const controls = within(container.querySelector<HTMLElement>('[role="group"]')!);
      fireEvent.click(controls.getByRole('button', { name: 'Select All' }));
      fireEvent.click(controls.getByRole('button', { name: 'Delete Selected (101)' }));
    }
    const confirmA = within(first.container.querySelector<HTMLElement>('[role="alertdialog"]')!).getByRole('button', { name: 'Delete 101 Records' });
    const oldB = handler(within(second.container.querySelector<HTMLElement>('[role="alertdialog"]')!).getByRole('button', { name: 'Delete 101 Records' }));
    await act(async () => {
      fireEvent.click(confirmA); oldB();
    });
    expect(api.deletions).toHaveLength(1); expect(api.active).toBe(1);
    await act(async () => pending.resolve(firstResult!));
    await waitFor(() => expect(a.getByText('No results found.')).toBeInTheDocument());
    await waitFor(() => expect(b.getByText('No results found.')).toBeInTheDocument());
    await act(async () => oldB());
    expect(api.deletions).toHaveLength(2); expect(api.maxActive).toBe(1);
    expect(b.getByRole('button', { name: 'Delete Selected (0)' })).toBeDisabled();
  });

  it('keeps verification pending until every refresh page arrives and preserves filters and statistics', async () => {
    const all = records(1101); const api = server(all); const refresh = deferred<QueryResult>();
    render(<History />); await ready();
    fireEvent.change(document.querySelectorAll('select')[0], { target: { value: 'en-to-geo' } });
    selectAll(); openConfirmation(551);
    api.deleteResponse = request => {
      if (api.deletions.length === 2) return { error: { message: 'Stopped' } };
      return api.remove(request);
    };
    let lastPage: QueryResult;
    api.readResponse = (read, response) => {
      if (read.from === 500) { lastPage = response; return refresh.promise; }
      return response;
    };
    confirm(551);
    await waitFor(() => expect(api.reads).toHaveLength(5));
    expect(document.body.textContent).toContain('Refreshing History to verify');
    expect(document.body.textContent).not.toContain('History refreshed:');
    expectStatistics([]);
    await act(async () => refresh.resolve(lastPage!));
    await waitFor(() => expect(document.body.textContent).toContain('451 remain.'));
    const visible = api.rows.filter(row => row.test_direction === 'en-to-geo');
    expectStatistics(visible);
    expect(toolbar().getByText('451 of 451 visible records selected')).toBeInTheDocument();
    fireEvent.change(document.querySelectorAll('select')[1], { target: { value: 'high' } });
    expect(toolbar().getByText('0 of 0 visible records selected')).toBeInTheDocument();
    expect(api.deletions).toHaveLength(2);
  });

  it.each(['unmount', 'navigate back', 'A → B', 'A → B → A'] as const)('stops later batches and ignores stale completion after %s under StrictMode', async transition => {
    const rows = records(201), other = records(2, accountB, 9000);
    const api = server([...rows, ...other]); const pending = deferred<QueryResult>();
    api.deleteResponse = request => api.deletions.length === 1 ? (api.remove(request), pending.promise) : api.remove(request);
    const view = render(<StrictMode><History /></StrictMode>); await ready();
    selectAll(); openConfirmation(201); confirm(201);
    await waitFor(() => expect(api.deletions).toHaveLength(1));
    if (transition.startsWith('A')) {
      authMock.user = { id: accountB }; view.rerender(<StrictMode><History /></StrictMode>); await ready();
      expectStatistics(other);
      if (transition.endsWith('→ A')) { authMock.user = { id: accountA }; view.rerender(<StrictMode><History /></StrictMode>); }
    } else {
      view.unmount();
      if (transition === 'navigate back') render(<History />);
    }
    if (transition === 'navigate back' || transition.endsWith('→ A')) {
      expect(toolbar().getByRole('button', { name: 'Delete Selected (0)' })).toBeDisabled();
    }
    await act(async () => pending.resolve({ error: null }));
    expect(api.deletions).toHaveLength(1); expect(api.maxActive).toBe(1);
    expect(api.rows.filter(row => row.user_id === accountB)).toEqual(other);
    expect(document.body.textContent).not.toContain('all 201 confirmed records');
    if (transition === 'navigate back' || transition.endsWith('→ A')) {
      await ready(); expectStatistics(rows.slice(0, 101));
      selectAll(); openConfirmation(101); confirm(101);
      await waitFor(() => expect(document.body.textContent).toContain('all 101 confirmed records are no longer'));
      expect(api.deletions).toHaveLength(3);
    }
  });
});
