import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import type { Word } from '../lib/supabase';
import { activeTestKey, readTestRecovery } from '../lib/activeTestSessions';
import TestMode from './TestMode';

const id = (index: number, userId = 'user-a') => `${userId}-${String(index).padStart(4, '0')}`;
const vocabulary = (size: number, userId = 'user-a') => Array.from({ length: size }, (_, index) => word({
  id: id(index, userId), user_id: userId, english_word: `word ${index}`,
  georgian_definitions: [`meaning ${index}`], created_at: '2026-01-01T10:00:00.123456Z',
}));
const active = (userId = 'user-a') => readTestRecovery(userId).sessions[0];

interface Read {
  userId: string | undefined;
  from: number;
  to: number;
  exactCount: boolean;
  orders: { column: keyof Word; ascending: boolean }[];
}

// Like the Practice regression server, this applies authorization and DB order
// before inclusive ranges and a separate server cap. Unranged reads truncate.
function server(rows: Word[], maxRows = 1000) {
  const reads: Read[] = [];
  const state = { reads,
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

function configure(count = 1, input = 'Text Input') {
  fireEvent.change(screen.getByPlaceholderText('Custom'), { target: { value: String(count) } });
  fireEvent.click(screen.getByRole('button', { name: input }));
}
const start = () => userEvent.click(screen.getByRole('button', { name: 'Start Test' }));
function expectNoSession() {
  expect(readTestRecovery('user-a').sessions).toEqual([]);
  expect(readTestRecovery('user-a').results).toEqual([]);
  expect(localStorage.length).toBe(0);
  expect(supabaseMock.from.mock.calls.every(([table]) => table === 'words')).toBe(true);
}
function captureStart(button: HTMLElement): () => Promise<void> {
  const props = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
  return (Reflect.get(button, props) as { onClick: () => Promise<void> }).onClick;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Test Mode reads the complete vocabulary before selecting questions', () => {
  it.each([0, 3, 499, 500, 501, 1000, 1001, 2000, 2001])('loads %i authorized words with no missing or duplicate questions', async size => {
    const rows = vocabulary(size);
    const api = server([...rows].reverse().concat(vocabulary(7, 'user-b')));
    render(<StrictMode><TestMode /></StrictMode>);
    configure(size || 1);
    await start();
    if (size) {
      await screen.findByText(`Question 1 of ${size}`);
      expect(active().questions.map(question => question.id)).toEqual(rows.map(row => row.id));
      expect(new Set(active().questions.map(question => question.id)).size).toBe(size);
      expect(active()).toMatchObject({ userId: 'user-a', currentQuestion: 0, draftAnswer: '', customCount: String(size) });
      expect(active().questions.every(question => question.userAnswer === '' && !question.isCorrect)).toBe(true);
      expect(window.alert).not.toHaveBeenCalled();
    } else {
      expect(window.alert).toHaveBeenCalledExactlyOnceWith('No words available. Add some words first!');
      expectNoSession();
      expect(screen.getByRole('button', { name: 'Start Test' })).toBeEnabled();
    }
    expect(api.reads).toHaveLength(Math.max(1, Math.ceil(size / 500)));
    api.reads.forEach((read, index) => expect(read).toEqual({
      userId: 'user-a', from: index * 500, to: index * 500 + 499, exactCount: index === 0,
      orders: [{ column: 'created_at', ascending: true }, { column: 'id', ascending: true }],
    }));
    expect(readTestRecovery('user-b').sessions).toEqual([]);
    expect(supabaseMock.from.mock.calls.every(([table]) => table === 'words')).toBe(true);
  });

  it('advances by the received row count when the server cap is only 250', async () => {
    const rows = vocabulary(1001);
    const api = server(rows, 250);
    render(<TestMode />);
    configure(1001);
    await start();
    await screen.findByText('Question 1 of 1001');
    expect(active().questions.map(question => question.id)).toEqual(rows.map(row => row.id));
    expect(api.reads.map(read => read.from)).toEqual([0, 250, 500, 750, 1000]);
  });

  it('orders by created_at first and id second across page boundaries', async () => {
    const rows = vocabulary(1001).map((row, index) => ({ ...row,
      created_at: index < 500 ? '2026-01-02T10:00:00.123456Z' : row.created_at,
    }));
    server([...rows].reverse());
    render(<TestMode />);
    configure(1001);
    await start();
    await screen.findByText('Question 1 of 1001');
    expect(active().questions.map(question => question.id)).toEqual([...rows.slice(500), ...rows.slice(0, 500)].map(row => row.id));
  });

  it('can randomly select a word beyond the original server limit for a preset-length test', async () => {
    server(vocabulary(1001));
    // Fisher-Yates moves the last vocabulary row into the first question slot.
    vi.mocked(Math.random).mockReturnValueOnce(0);
    render(<TestMode />);
    fireEvent.click(screen.getByRole('button', { name: 'Text Input' }));
    await start();
    await screen.findByText('Question 1 of 10');
    expect(active().questions[0].id).toBe(id(1000));
    expect(active().questions).toHaveLength(10);
    expect(Math.random).toHaveBeenCalledTimes(1000);
  });

  it('retains separate meanings with the same English spelling across pages', async () => {
    const rows = vocabulary(1001).map(row => ({ ...row, english_word: 'yield' }));
    server(rows);
    render(<TestMode />);
    configure(1001);
    await start();
    await screen.findByText('Question 1 of 1001');
    expect(active().questions.map(question => [question.id, question.georgian_definitions]))
      .toEqual(rows.map(row => [row.id, row.georgian_definitions]));
  });

  it.each(['English → Georgian', 'Georgian → English'])('uses distractors beyond row 1,000 for %s and freezes them on recovery', async direction => {
    const rows = vocabulary(1003).map((row, index) => index < 1000
      ? { ...row, english_word: 'shared word', georgian_definitions: ['shared meaning'] } : row);
    const api = server(rows);
    const view = render(<StrictMode><TestMode /></StrictMode>);
    configure(1, 'Multiple Choice');
    fireEvent.click(screen.getByRole('button', { name: direction }));
    await start();
    await screen.findByText('Question 1 of 1');
    const expected = direction === 'English → Georgian'
      ? ['shared meaning', 'meaning 1000', 'meaning 1001', 'meaning 1002']
      : ['shared word', 'word 1000', 'word 1001', 'word 1002'];
    expect(active().questions[0].options).toEqual(expected);
    await userEvent.click(screen.getByRole('radio', { name: expected[1] }));
    const snapshot = active();
    const reads = api.reads.length;
    view.unmount();
    vi.mocked(Math.random).mockReturnValue(0);
    render(<StrictMode><TestMode /></StrictMode>);
    expect(screen.getByRole('radio', { name: expected[1] })).toBeChecked();
    expect(active()).toEqual(snapshot);
    expect(api.reads).toHaveLength(reads);
    expect(supabaseMock.from.mock.calls.every(([table]) => table === 'words')).toBe(true);
  });

  it('validates an excessive custom count against the complete dictionary and allows a corrected start', async () => {
    const api = server(vocabulary(2001));
    render(<TestMode />);
    configure(2002);
    await start();
    expect(window.alert).toHaveBeenCalledExactlyOnceWith('Please select between 1 and 2001 words');
    expect(api.reads).toHaveLength(5);
    expectNoSession();
    configure(2001);
    await start();
    await screen.findByText('Question 1 of 2001');
    expect(active().questions).toHaveLength(2001);
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 1000, 1500, 2000, 0, 500, 1000, 1500, 2000]);
  });

  it.each(['API error', 'network rejection'])('does not create a partial session on an intermediate %s and supports a clean retry', async kind => {
    const api = server(vocabulary(1001));
    const pending = deferred<QueryResult>();
    api.respond = (read, response) => read.from === 500 ? pending.promise : response;
    render(<TestMode />);
    configure(1001);
    await start();
    await waitFor(() => expect(api.reads).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
    expectNoSession();
    await act(async () => {
      if (kind === 'API error') pending.resolve({ data: null, error: { message: 'Intermediate failure' } });
      else pending.reject(new Error('Intermediate failure'));
    });
    expect(window.alert).toHaveBeenCalledExactlyOnceWith('Error starting test: Intermediate failure');
    expectNoSession();
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeEnabled();
    api.respond = (_read, response) => response;
    await start();
    await screen.findByText('Question 1 of 1001');
    expect(active().questions).toHaveLength(1001);
    expect(localStorage.length).toBe(1);
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 0, 500, 1000]);
  });

  it.each([undefined, null, -1, 0.5, NaN, Infinity])('fails safely with invalid exact count %s', async count => {
    const api = server(vocabulary(1001));
    api.respond = (_read, response) => ({ ...response, count });
    render(<TestMode />);
    configure();
    await start();
    expect(window.alert).toHaveBeenCalledOnce();
    expect(api.reads).toHaveLength(1);
    expectNoSession();
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeEnabled();
  });

  it.each(['null', 'missing', 'non-array', 'empty', 'overlap', 'oversized', 'count overrun'])('rejects an intermediate %s response instead of starting or looping', async kind => {
    const rows = vocabulary(1001);
    const api = server(rows);
    api.respond = (read, response) => {
      if (kind === 'count overrun') return read.from === 1000 ? { ...response, data: rows.slice(998, 1000) } : response;
      if (read.from !== 500) return response;
      const data = kind === 'null' ? null : kind === 'missing' ? undefined : kind === 'non-array' ? { length: 500 }
        : kind === 'empty' ? [] : kind === 'overlap' ? rows.slice(0, 500) : rows.slice(500);
      return { ...response, data };
    };
    render(<TestMode />);
    configure();
    await start();
    expect(window.alert).toHaveBeenCalledOnce();
    expectNoSession();
    expect(api.reads.length).toBeLessThanOrEqual(3);
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeEnabled();
    api.respond = (_read, response) => response;
    await start();
    await screen.findByText('Question 1 of 1');
    expect(localStorage.length).toBe(1);
  });

  it('blocks rapid and captured Start callbacks throughout loading and creates exactly one zero-answer session', async () => {
    const api = server(vocabulary(1001));
    const pending = deferred<QueryResult>();
    let finalPage: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 1000) { finalPage = response; return pending.promise; }
      return response;
    };
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    render(<StrictMode><TestMode /></StrictMode>);
    configure(1001);
    const button = screen.getByRole('button', { name: 'Start Test' });
    const captured = captureStart(button);
    act(() => { void captured(); void captured(); fireEvent.click(button); });
    await waitFor(() => expect(finalPage).toBeDefined());
    expectNoSession();
    expect(writes).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Loading...' })).toBeDisabled();
    act(() => { void captured(); });
    // Preserve existing semantics: the settings captured by Start define the test.
    configure(1, 'Multiple Choice');
    fireEvent.click(screen.getByRole('button', { name: 'English → Georgian' }));
    await act(async () => pending.resolve(finalPage));
    await screen.findByText('Question 1 of 1001');
    expect(active()).toMatchObject({ customCount: '1001', inputType: 'text', direction: 'geo-to-en', currentQuestion: 0 });
    expect(writes).toHaveBeenCalledOnce();
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 1000]);
    const original = active();
    await act(async () => captured());
    expect(active()).toEqual(original);
    expect(writes).toHaveBeenCalledOnce();
    expect(api.reads).toHaveLength(3);
  });

  it.each(['success', 'API error', 'rejection'])('ignores stale intermediate %s after navigation and a new test', async outcome => {
    const api = server(vocabulary(2001));
    const pending = deferred<QueryResult>();
    let stalePage: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { stalePage = response; return pending.promise; }
      return response;
    };
    const view = render(<StrictMode><TestMode /></StrictMode>);
    configure(2001);
    await start();
    await waitFor(() => expect(stalePage).toBeDefined());
    view.rerender(<div>Words tab</div>);
    expectNoSession();
    api.respond = (_read, response) => response;
    view.rerender(<StrictMode><TestMode /></StrictMode>);
    configure(1);
    await start();
    await screen.findByText('Question 1 of 1');
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'new draft' } });
    const snapshot = active();
    const reads = api.reads.length;
    await act(async () => {
      if (outcome === 'rejection') pending.reject(new Error('Stale request'));
      else pending.resolve(outcome === 'success' ? stalePage : { error: { message: 'Stale request' } });
    });
    expect(active()).toEqual(snapshot);
    expect(localStorage.length).toBe(1);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('new draft');
    expect(api.reads).toHaveLength(reads);
    expect(window.alert).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('stops reading after unmount and ignores a captured Start callback', async () => {
    const api = server(vocabulary(2001));
    const pending = deferred<QueryResult>();
    let page: QueryResult;
    api.respond = (read, response) => {
      if (read.from === 500) { page = response; return pending.promise; }
      return response;
    };
    const view = render(<TestMode />);
    configure();
    const captured = captureStart(screen.getByRole('button', { name: 'Start Test' }));
    await start();
    await waitFor(() => expect(page).toBeDefined());
    view.unmount();
    await act(async () => { pending.resolve(page); await captured(); });
    expectNoSession();
    expect(api.reads.map(read => read.from)).toEqual([0, 500]);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('isolates A → B → A while the first account read is pending', async () => {
    const api = server([...vocabulary(1001), ...vocabulary(501, 'user-b')]);
    const pending = deferred<QueryResult>();
    let stalePage: QueryResult;
    api.respond = (read, response) => {
      if (read.userId === 'user-a' && read.from === 500) { stalePage = response; return pending.promise; }
      return response;
    };
    const view = render(<StrictMode><TestMode /></StrictMode>);
    configure(1001);
    await start();
    await waitFor(() => expect(stalePage).toBeDefined());
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><TestMode /></StrictMode>);
    configure(501);
    await start();
    await screen.findByText('Question 1 of 501');
    expect(active('user-b').questions.map(question => question.id)).toEqual(vocabulary(501, 'user-b').map(row => row.id));
    const b = active('user-b');
    const bCopy = localStorage.getItem(activeTestKey('user-b', b.id));
    expect(active()).toBeUndefined();
    api.respond = (_read, response) => response;
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><TestMode /></StrictMode>);
    configure(1001);
    await start();
    await screen.findByText('Question 1 of 1001');
    const a = active();
    const reads = api.reads.length;
    await act(async () => pending.resolve(stalePage));
    expect(active()).toEqual(a);
    expect(localStorage.getItem(activeTestKey('user-b', b.id))).toBe(bCopy);
    expect(localStorage.length).toBe(2);
    expect(api.reads).toHaveLength(reads);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('restores a large zero-answer session and draft without refetching, then permits an intentional new session', async () => {
    const api = server(vocabulary(1001));
    const view = render(<StrictMode><TestMode /></StrictMode>);
    configure(1001);
    await start();
    await screen.findByText('Question 1 of 1001');
    const original = active();
    view.rerender(<div>Words tab</div>);
    view.rerender(<StrictMode><TestMode /></StrictMode>);
    expect(active()).toEqual(original);
    expect(api.reads).toHaveLength(3);
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'unfinished draft' } });
    const draft = active();
    view.unmount();
    render(<StrictMode><TestMode /></StrictMode>);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('unfinished draft');
    expect(active()).toEqual(draft);
    expect(api.reads).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Restart Test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard progress' }));
    expectNoSession();
    configure(1);
    await start();
    await screen.findByText('Question 1 of 1');
    expect(active().id).not.toBe(original.id);
    expect(api.reads.map(read => read.from)).toEqual([0, 500, 1000, 0, 500, 1000]);
  });
});
