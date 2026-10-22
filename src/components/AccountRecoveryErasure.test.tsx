import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import App from '../App';
import FreeMode from './FreeMode';
import TestMode from './TestMode';
import { eraseAccountRecovery } from '../lib/eraseAccountRecovery';
import { createRecoveryStore, legacyPracticeKey, practiceSessionKey, activeTestPrefix, pendingTestPrefix,
  retirementKey, ownsRecoveryKey } from '../lib/recoveryStorage';
import { readTestRecovery } from '../lib/activeTestSessions';

vi.mock('@/components/WordManagement', () => ({ default: () => <div>Words fixture</div> }));
vi.mock('@/components/AuthPage', () => ({ default: () => <div>Sign-in fixture</div> }));
const A = { id: 'user-a', email: 'a@example.com' }; const B = { id: 'user-b', email: 'b@example.com' };
const success = { status: 204, error: null };
const practice = () => ({ userId: A.id, queueIds: ['word'], direction: 'geo-to-en', orderMode: 'db-order',
  allowReguess: false, correctCount: 0, totalAttempts: 0, mistakes: [] });
const vocabulary = [word({ id: 'word', english_word: 'cat', georgian_definitions: ['კატა'] })];
const aKeys = () => [practiceSessionKey(A.id), `${activeTestPrefix(A.id)}one`, `${activeTestPrefix(A.id)}two`,
  `${pendingTestPrefix(A.id)}one`, `${pendingTestPrefix(A.id)}two`];
function seed() {
  aKeys().forEach(key => localStorage.setItem(key, 'malformed but A-owned'));
  localStorage.setItem(legacyPracticeKey, JSON.stringify(practice()));
  const other = [practiceSessionKey(B.id), `${activeTestPrefix(B.id)}one`, `${pendingTestPrefix(B.id)}one`,
    'sb-fixture-auth-token', 'vocab-app-theme', 'unrelated'];
  other.forEach((key, index) => localStorage.setItem(key, index === 4 ? 'light' : `B/unrelated exact ${index}`));
  return other.map(key => [key, localStorage.getItem(key)]);
}
function openDeletion() {
  fireEvent.click(screen.getByRole('button', { name: A.email }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
}
function staleClick(element: HTMLElement): () => void {
  const key = Object.keys(element).find(key => key.startsWith('__reactProps$'))!;
  return (Reflect.get(element, key) as { onClick: () => void }).onClick;
}
// A separate JS realm writes the durable marker and sweeps its own account.
// The active React root learns only through the real storage-event interface.
function peerDeletion() {
  const peer = createRecoveryStore();
  expect(peer.retire(A.id)).toBe(true);
  Object.keys(localStorage).filter(key => ownsRecoveryKey(A.id, key)).forEach(key => localStorage.removeItem(key));
  window.dispatchEvent(new StorageEvent('storage', { key: retirementKey(A.id), newValue: '1', storageArea: localStorage }));
}
beforeEach(() => {
  authMock.user = A;
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: A, access_token: 'synthetic-A' } }, error: null });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  supabaseMock.from.mockImplementation(table => table === 'profiles' ? query({ data: null, error: null }) : query({ data: vocabulary, error: null }));
  supabaseMock.rpc.mockReturnValue({ ...query(success), setHeader: vi.fn().mockReturnThis() });
});

describe('confirmed deletion and recovery erasure in App', () => {
  it.each(['A', 'B', 'B then A'] as const)('erases only A after delayed success with %s active', async transition => {
    const unchanged = seed(); const pending = deferred<QueryResult>();
    const request = { ...query(pending.promise), setHeader: vi.fn().mockReturnThis() };
    supabaseMock.rpc.mockReturnValue(request);
    const view = render(<StrictMode><App /></StrictMode>); openDeletion();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete Account' })));
    if (transition !== 'A') { authMock.user = B; view.rerender(<StrictMode><App /></StrictMode>); }
    if (transition === 'B then A') { authMock.user = A; view.rerender(<StrictMode><App /></StrictMode>); }
    aKeys().forEach(key => expect(localStorage.getItem(key)).not.toBeNull());
    const before = view.container.innerHTML;
    await act(async () => pending.resolve(success));
    aKeys().forEach(key => expect(localStorage.getItem(key)).toBeNull());
    expect(localStorage.getItem(legacyPracticeKey)).toBeNull();
    unchanged.forEach(([key, value]) => expect(localStorage.getItem(key!)).toBe(value));
    expect(request.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer synthetic-A');
    expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
    expect(authMock.signOut).not.toHaveBeenCalled();
    if (transition === 'B') {
      expect(view.container.innerHTML).toBe(before);
      authMock.user = A; view.rerender(<StrictMode><App /></StrictMode>);
    }
    expect(screen.queryByText('Words fixture')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('absence checked');
    view.unmount(); render(<App />);
    expect(screen.queryByText('Words fixture')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('has not been verified');
  });

  it.each(['failure', 'lost response', 'gateway', 'malformed'] as const)('preserves all recovery bytes after %s', async kind => {
    seed(); const before = { ...localStorage }; const pending = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValue({ ...query(pending.promise), setHeader: vi.fn().mockReturnThis() });
    render(<App />); openDeletion();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete Account' })));
    await act(async () => {
      if (kind === 'lost response') pending.reject(new Error('response lost'));
      else pending.resolve(kind === 'failure' ? { status: 403, error: { code: '42501', message: 'rejected' } }
        : kind === 'gateway' ? { status: 504, error: { message: 'timeout' } } : { error: null });
    });
    expect({ ...localStorage }).toEqual(before);
    expect(screen.getByRole('status')).toHaveTextContent(kind === 'failure' ? 'database rejected' : 'outcome is unknown');
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
    expect(authMock.signOut).not.toHaveBeenCalled();
  });

  it.each(['partial removal', 'blocked marker'] as const)('keeps A retired and reports residual data after %s without another RPC', async kind => {
    seed(); const view = render(<App />); openDeletion();
    const stale = staleClick(screen.getByRole('button', { name: 'Delete Account' }));
    const remove = Storage.prototype.removeItem; const set = Storage.prototype.setItem;
    if (kind === 'partial removal') vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (key === practiceSessionKey(A.id)) throw new Error('blocked');
      remove.call(this, key);
    });
    else vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === retirementKey(A.id)) throw new Error('quota');
      set.call(this, key, value);
    });
    await act(async () => stale());
    expect(screen.getByRole('status')).toHaveTextContent('Account deletion confirmed');
    expect(screen.getByRole('alert')).toHaveTextContent('Residual recovery data may remain');
    expect(screen.queryByText('Words fixture')).not.toBeInTheDocument();
    await act(async () => stale());
    authMock.user = B; view.rerender(<App />);
    expect(screen.getByText('Words fixture')).toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey(B.id))).toBe('B/unrelated exact 0');
    authMock.user = A; view.rerender(<App />);
    expect(screen.queryByText('Words fixture')).not.toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
  });
});

describe('stale Practice/Test work after peer retirement', () => {
  it('releases an editor and cancels a waiting takeover when retirement interrupts a failed checkpoint', async () => {
    localStorage.setItem(practiceSessionKey(A.id), JSON.stringify(practice()));
    const first = within(render(<StrictMode><FreeMode /></StrictMode>).container);
    await first.findByRole('textbox');
    const second = within(render(<StrictMode><FreeMode /></StrictMode>).container);
    const continueHere = await second.findByRole('button', { name: 'Continue in this tab' });
    // A malformed replacement makes the existing safe handoff refuse to overwrite it.
    localStorage.setItem(practiceSessionKey(A.id), '{unreadable');
    fireEvent.click(continueHere);
    fireEvent.click(second.getByRole('button', { name: 'Continue here' }));
    const cancel = staleClick(await second.findByRole('button', { name: 'Cancel request' }));
    await first.findByText(/Could not save progress for the other tab/);
    await act(async () => peerDeletion());
    await act(async () => cancel());
    expect(first.getByRole('status')).toHaveTextContent('Practice recovery is disabled');
    expect(second.getByRole('status')).toHaveTextContent('Practice recovery is disabled');
    expect(localStorage.getItem(practiceSessionKey(A.id))).toBeNull();
    await waitFor(async () => expect((await navigator.locks.query()).held).toEqual([]));
  });

  it('revokes a live Practice owner, rejects stale controls, releases its Web Lock and prevents recovery', async () => {
    localStorage.setItem(practiceSessionKey(A.id), JSON.stringify(practice()));
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'draft' } });
    const check = staleClick(screen.getByRole('button', { name: 'Check Answer' }));
    const order = staleClick(screen.getByRole('button', { name: 'Random' }));
    await act(async () => peerDeletion());
    await act(async () => { check(); order(); });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Practice recovery is disabled');
    expect(localStorage.getItem(practiceSessionKey(A.id))).toBeNull();
    await waitFor(async () => expect((await navigator.locks.query()).held).toEqual([]));
    view.unmount(); render(<FreeMode />);
    expect(screen.getByRole('status')).toHaveTextContent('Practice recovery is disabled');
  });

  it('stops an in-flight Practice load after peer retirement without persisting or trapping an editor lock', async () => {
    const pending = deferred<QueryResult>(); supabaseMock.from.mockReturnValue(query(pending.promise));
    render(<StrictMode><FreeMode /></StrictMode>);
    // StrictMode replays the mounted editor's read effect; both responses are pending.
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalledTimes(2));
    await act(async () => peerDeletion());
    await act(async () => pending.resolve({ data: vocabulary, error: null }));
    expect(screen.getByRole('status')).toHaveTextContent('Practice recovery is disabled');
    expect(localStorage.getItem(practiceSessionKey(A.id))).toBeNull();
    await waitFor(async () => expect((await navigator.locks.query()).held).toEqual([]));
  });

  async function startTest() {
    render(<StrictMode><TestMode /></StrictMode>);
    fireEvent.change(screen.getByPlaceholderText('Custom'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Text Input' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start Test' })));
    fireEvent.change(await screen.findByPlaceholderText('Type your answer...'), { target: { value: 'cat' } });
  }

  it('stops an active Test draft and stale Finish handler after peer retirement', async () => {
    await startTest();
    expect(readTestRecovery(A.id).sessions[0].draftAnswer).toBe('cat');
    const finish = staleClick(screen.getByRole('button', { name: 'Finish Test' }));
    supabaseMock.from.mockClear();
    await act(async () => peerDeletion());
    await act(async () => finish());
    expect(screen.getByRole('status')).toHaveTextContent('Test recovery is disabled');
    expect(Object.keys(localStorage).filter(key => ownsRecoveryKey(A.id, key))).toEqual([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure', 'duplicate'] as const)('ignores delayed Test History %s after retirement, without writes or follow-up requests', async outcome => {
    const pending = deferred<QueryResult>(); const save = query(pending.promise);
    supabaseMock.from.mockImplementation(table => table === 'test_history' ? save : query({ data: vocabulary, error: null }));
    await startTest();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Finish Test' })));
    expect(save.insert).toHaveBeenCalledOnce();
    const payload = save.insert.mock.calls[0][0];
    expect(readTestRecovery(A.id).results[0]).toEqual(payload);
    await act(async () => peerDeletion());
    supabaseMock.from.mockClear();
    await act(async () => pending.resolve({ error: outcome === 'success' ? null : { message: 'late', code: outcome === 'duplicate' ? '23505' : '42501' } }));
    expect(Object.keys(localStorage).filter(key => ownsRecoveryKey(A.id, key))).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('Test recovery is disabled');
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(payload);
  });

  it('ignores delayed Test vocabulary after retirement', async () => {
    const pending = deferred<QueryResult>(); supabaseMock.from.mockReturnValue(query(pending.promise));
    render(<TestMode />);
    fireEvent.change(screen.getByPlaceholderText('Custom'), { target: { value: '1' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start Test' })));
    await act(async () => peerDeletion());
    await act(async () => pending.resolve({ data: vocabulary, error: null }));
    expect(screen.getByRole('status')).toHaveTextContent('Test recovery is disabled');
    expect(Object.keys(localStorage).filter(key => ownsRecoveryKey(A.id, key))).toEqual([]);
  });

  it('keeps B Test usable and its exact persisted draft unchanged when A is retired', async () => {
    authMock.user = B; await startTest();
    const b = readTestRecovery(B.id).sessions[0];
    const before = Object.fromEntries(Object.entries(localStorage).filter(([key]) => ownsRecoveryKey(B.id, key)));
    await act(async () => eraseAccountRecovery(A.id));
    expect(Object.fromEntries(Object.entries(localStorage).filter(([key]) => ownsRecoveryKey(B.id, key)))).toEqual(before);
    expect(readTestRecovery(B.id).sessions[0]).toEqual(b);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('cat');
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'B continues' } });
    expect(readTestRecovery(B.id).sessions[0].draftAnswer).toBe('B continues');
  });
});
