import { Profiler, StrictMode, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '../../src/test/mocks';
import { word } from '../../src/test/fixtures';
import { practiceSessionKey, type StoredPracticeSession } from '../../src/lib/practiceSessions';
import FreeMode from '../../src/components/FreeMode';

const read = (userId: string): StoredPracticeSession | null => JSON.parse(localStorage.getItem(practiceSessionKey(userId)) ?? 'null');
const seed = (session: StoredPracticeSession) => localStorage.setItem(practiceSessionKey(session.userId), JSON.stringify(session));
const session = (userId = 'user-a'): StoredPracticeSession => ({
  userId, queueIds: ['a'], direction: 'en-to-geo', orderMode: 'db-order', allowReguess: true,
  correctCount: 2, totalAttempts: 3, attemptedWordIds: ['a', 'b', 'c'], unresolvedWordIds: ['a'],
  mistakes: [{ word_id: 'a', english_word: 'a', user_answer: 'wrong', correct_definitions: ['meaning a'] }],
  hasChecked: true, completed: false,
});

beforeEach(() => {
  // Same animation stubs as the existing Practice suites; no scheduling delays.
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

describe('R3-QA-01 observable commit versus checkpoint readiness', () => {
  it.each([false, true])('observes the old checked checkpoint at visible DOM commit, then durable restored progress (StrictMode: %s)', async strict => {
    seed(session());
    const original = localStorage.getItem(practiceSessionKey('user-a'));
    const pending = deferred<QueryResult>();
    const request = query(pending.promise);
    supabaseMock.from.mockImplementation(table => { expect(table).toBe('words'); return request; });
    const atVisibleCommit: (StoredPracticeSession | null)[] = [];
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const observe = () => {
      if (document.querySelector('input[type="text"]')) atVisibleCommit.push(read('user-a'));
    };
    const wrap = (child: ReactNode) => <Profiler id="readiness" onRender={observe}>{strict ? <StrictMode>{child}</StrictMode> : child}</Profiler>;
    const view = render(wrap(<FreeMode />));
    await waitFor(() => expect(request.range).toHaveBeenCalled());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(original);
    await act(async () => pending.resolve({ error: null, data: ['a', 'b', 'c'].map(id => word({ id, english_word: id })) }));
    // Profiler is read-only: it observes real DOM after commit, before passive
    // effects. Textbox existence alone cannot imply a completed storage effect.
    expect(atVisibleCommit.some(snapshot => snapshot?.hasChecked === true)).toBe(true);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(read('user-a')).toEqual({ ...session(), hasChecked: false });
    expect(writes.mock.calls.filter(([key]) => key === practiceSessionKey('user-a')).map(([, raw]) => JSON.parse(raw)))
      .toEqual([{ ...session(), hasChecked: false }]);
    view.unmount();
    render(wrap(<FreeMode />));
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument());
    expect(read('user-a')).toEqual({ ...session(), hasChecked: false });
    expect(supabaseMock.from.mock.calls.every(([table]) => table === 'words')).toBe(true);
  });

  it.each([
    { strict: false, outcome: 'success' }, { strict: true, outcome: 'success' },
    { strict: false, outcome: 'failure' }, { strict: true, outcome: 'failure' },
  ].flatMap(test => ['return to A', 'stay on B'].map(route => ({ ...test, route }))))(
    'separates B initialization from A save $outcome, $route (StrictMode: $strict)', async ({ strict, outcome, route }) => {
    const result = { id: crypto.randomUUID(), user_id: 'user-a', test_date: '2026-01-01T10:00:00.000Z',
      test_direction: 'en-to-geo' as const, total_words: 1, correct_count: 1, mistakes: [] };
    seed({ ...session(), queueIds: [], correctCount: 1, totalAttempts: 1, attemptedWordIds: ['a'], mistakes: [],
      unresolvedWordIds: [], hasChecked: false, completed: true, completedResult: result });
    const pendingSave = deferred<QueryResult>();
    const save = query(pendingSave.promise);
    const retry = query({ error: null });
    const pendingB = deferred<QueryResult>();
    const bRequest = query(pendingB.promise);
    let saveRequests = 0;
    supabaseMock.from.mockImplementation(table => {
      if (table === 'test_history') return ++saveRequests === 1 ? save : retry;
      expect(table).toBe('words');
      return authMock.user?.id === 'user-b' ? bRequest : query({ error: null, data: [word({ id: 'a' })] });
    });
    const bAtVisibleCommit: (StoredPracticeSession | null)[] = [];
    const observe = () => {
      if (authMock.user?.id === 'user-b' && document.querySelector('input[type="text"]')) bAtVisibleCommit.push(read('user-b'));
    };
    const ui = () => <Profiler id="account" onRender={observe}>{strict ? <StrictMode><FreeMode /></StrictMode> : <FreeMode />}</Profiler>;
    const view = render(ui());
    // A restored completed result is correctly shown as unconfirmed; explicitly
    // start its first request through the existing Retry Save action.
    await screen.findByRole('button', { name: 'Retry Save' });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry Save' })));
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(result);
    const aCopy = localStorage.getItem(practiceSessionKey('user-a'));
    authMock.user = { id: 'user-b' };
    view.rerender(ui());
    await waitFor(() => expect(bRequest.range).toHaveBeenCalled());
    expect(read('user-b')).toBeNull();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
    await act(async () => pendingB.resolve({ data: [word({ id: 'b', user_id: 'user-b', english_word: 'beta' })], error: null }));
    expect(bAtVisibleCommit).toContain(null); // The original test can capture this early value.
    const bCopy = localStorage.getItem(practiceSessionKey('user-b'));
    expect(read('user-b')).toMatchObject({ userId: 'user-b', queueIds: ['b'], totalAttempts: 0, correctCount: 0 });
    expect(bCopy).not.toBeNull(); // B created this before A's deferred save settles.
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removals = vi.spyOn(Storage.prototype, 'removeItem');
    if (route === 'stay on B') {
      // This control starts only after B's initialization effects have settled.
      // A later save must not erase an established B draft or checkpoint.
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B input' } });
      expect(screen.getByRole('textbox')).toHaveValue('B input');
      await act(async () => {
        if (outcome === 'success') pendingSave.resolve({ error: null });
        else pendingSave.reject(new Error('Controlled failure'));
      });
      expect(screen.getByRole('textbox')).toHaveValue('B input');
      expect(screen.queryByText('Result saved to History')).not.toBeInTheDocument();
      expect(screen.queryByText('Failed to save result')).not.toBeInTheDocument();
      expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(outcome === 'success' ? null : aCopy);
      expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bCopy);
      expect(writes.mock.calls.some(([key]) => key === practiceSessionKey('user-b'))).toBe(false);
      expect(removals.mock.calls.some(([key]) => key === practiceSessionKey('user-b'))).toBe(false);
      expect(saveRequests).toBe(1);
      expect(retry.insert).not.toHaveBeenCalled();
      return;
    }
    authMock.user = { id: 'user-a' };
    view.rerender(ui());
    expect(await screen.findByRole('button', { name: 'Saving result...' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Retry Save' })).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(result);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      if (outcome === 'success') pendingSave.resolve({ error: null });
      else pendingSave.reject(new Error('Controlled failure'));
    });
    if (outcome === 'failure') {
      await screen.findByRole('button', { name: 'Retry Save' });
      expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
      expect(saveRequests).toBe(1);
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry Save' })));
      expect(saveRequests).toBe(2);
      expect(retry.insert).toHaveBeenCalledExactlyOnceWith(result);
    } else expect(saveRequests).toBe(1);
    await screen.findByText('Result saved to History');
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bCopy);
    expect(writes.mock.calls.some(([key]) => key === practiceSessionKey('user-b'))).toBe(false);
    expect(removals.mock.calls.some(([key]) => key === practiceSessionKey('user-b'))).toBe(false);
  });
});
