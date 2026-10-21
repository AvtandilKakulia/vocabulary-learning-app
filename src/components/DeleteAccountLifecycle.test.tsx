import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import App from '@/App';
import { DeleteAccountModal } from './UserProfile';
import type { AccountDeletionOperations, CompleteAccountDeletion } from '@/lib/accountDeletion';

vi.mock('@/components/WordManagement', () => ({ default: () => <div>Words fixture</div> }));
vi.mock('@/components/AuthPage', () => ({ default: () => <div>Sign-in fixture</div> }));

const A = { id: 'user-a', email: 'a@example.com' };
const B = { id: 'user-b', email: 'b@example.com' };
const success = { error: null, status: 204 };
const failure = { error: { message: 'private server detail', code: '42501' }, status: 403 };
const session = (user = A) => ({ user, access_token: `synthetic-${user.id}`, refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer' });
const input = () => screen.getByPlaceholderText('DELETE');
const submit = () => screen.getByRole('button', { name: 'Delete Account' });
const confirm = () => fireEvent.change(input(), { target: { value: 'DELETE' } });
function open(user = A) {
  fireEvent.click(screen.getByRole('button', { name: user.email }));
  fireEvent.click(submit());
}
function handler(button: HTMLElement): () => Promise<void> {
  const key = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
  return (button as unknown as Record<string, { onClick: () => Promise<void> }>)[key].onClick;
}
function request(result: QueryResult | Promise<QueryResult> = success) {
  return { ...query(result), setHeader: vi.fn().mockReturnThis() };
}

beforeEach(() => {
  authMock.user = A;
  localStorage.setItem('vocab-app-theme', 'light');
  supabaseMock.from.mockImplementation(() => query({ data: null, error: null }));
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  supabaseMock.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  supabaseMock.rpc.mockReturnValue(request());
});

describe('account deletion completion in App', () => {
  it('retires only deleted A UI without invoking shared sign-out or erasing stored sessions/recovery data', async () => {
    localStorage.setItem('synthetic-session', JSON.stringify(session()));
    localStorage.setItem('synthetic-recovery', 'untouched F4 data');
    const before = { ...localStorage };
    const view = render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    expect(screen.getByRole('status')).toHaveTextContent('Account deletion confirmed');
    expect(screen.getByRole('status')).toHaveTextContent('saved sign-in was not removed automatically');
    expect(screen.getByText('Sign-in fixture')).toBeInTheDocument();
    expect(screen.queryByText('Words fixture')).not.toBeInTheDocument();
    expect(authMock.signOut).not.toHaveBeenCalled();
    expect(supabaseMock.auth.getSession).toHaveBeenCalledOnce();
    expect({ ...localStorage }).toEqual(before);
    authMock.user = B; view.rerender(<App />);
    expect(screen.getByText('Words fixture')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    authMock.user = A; view.rerender(<App />);
    expect(screen.getByText('Sign-in fixture')).toBeInTheDocument();
    expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
  });

  it.each([
    ['A to B', [B]], ['A to signed out', [null]], ['A to B to A', [B, A]], ['A to signed out to B', [null, B]],
  ] as const)('isolates both delayed RPC outcomes after %s', async (_name, users) => {
    // Each outcome has its own actual App instance and operation registry.
    for (const outcome of [success, failure]) {
      authMock.user = A;
      const pending = deferred<QueryResult>();
      supabaseMock.rpc.mockClear().mockReturnValue(request(pending.promise));
      const view = render(<StrictMode><App /></StrictMode>); open(); confirm();
      const stale = handler(submit());
      await act(async () => fireEvent.click(submit()));
      for (const user of users) { authMock.user = user; view.rerender(<StrictMode><App /></StrictMode>); }
      if (authMock.user) open(authMock.user as typeof A);
      const before = view.container.innerHTML;
      await act(async () => pending.resolve(outcome));
      await act(async () => stale());
      expect(view.container.innerHTML).toBe(before);
      expect(authMock.signOut).not.toHaveBeenCalled();
      expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
      expect(screen.queryByText(/private server detail/)).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('blocks native and stale Cancel once dispatched, and blocks duplicate submissions', async () => {
    const pending = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValue(request(pending.promise));
    render(<App />); open(); confirm();
    const cancel = handler(screen.getByRole('button', { name: 'Cancel' }));
    const stale = handler(submit());
    await act(async () => { void stale(); void stale(); });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('cannot be cancelled once sent');
    await act(async () => cancel());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(input()).toBeInTheDocument();
    await act(async () => pending.resolve(success));
    await act(async () => stale());
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
    expect(screen.getByText('Sign-in fixture')).toBeInTheDocument();
  });

  it.each([success, failure])('does not run completion after unmount: %j', async outcome => {
    const pending = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValue(request(pending.promise));
    const view = render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    view.unmount();
    await act(async () => pending.resolve(outcome));
    expect(authMock.signOut).not.toHaveBeenCalled();
    expect(view.container).toBeEmptyDOMElement();
  });

  it('permits only a fresh confirmation after an explicit database rejection', async () => {
    supabaseMock.rpc.mockReturnValueOnce(request(failure)).mockReturnValueOnce(request());
    render(<App />); open(); confirm();
    const stale = handler(submit());
    await act(async () => fireEvent.click(submit()));
    expect(screen.getByRole('status')).toHaveTextContent('database rejected');
    expect(submit()).toBeDisabled();
    await act(async () => stale());
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); open();
    expect(input()).toHaveValue(''); expect(submit()).toBeDisabled();
    confirm(); await act(async () => fireEvent.click(submit()));
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
    expect(authMock.signOut).not.toHaveBeenCalled();
  });

  it.each(['rejection', 'status zero', 'gateway', 'malformed'] as const)('keeps %s outcome unknown without replay on reopen', async kind => {
    const pending = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValue(request(pending.promise));
    render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    await act(async () => {
      if (kind === 'rejection') pending.reject(new TypeError('lost response with private detail'));
      else if (kind === 'status zero') pending.resolve({ status: 0, error: { message: 'fetch failed', code: '' } });
      else if (kind === 'gateway') pending.resolve({ status: 504, error: { message: 'gateway timeout' } });
      else pending.resolve({ error: null });
    });
    expect(screen.getByRole('status')).toHaveTextContent('server outcome is unknown');
    expect(submit()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); open(); confirm();
    expect(screen.getByRole('status')).toHaveTextContent('server outcome is unknown');
    await act(async () => handler(submit())());
    expect(supabaseMock.rpc).toHaveBeenCalledOnce();
    expect(authMock.signOut).not.toHaveBeenCalled();
  });

  it('allows B a separate operation while obsolete A is pending, with independent pinned tokens', async () => {
    const a = deferred<QueryResult>(); const b = deferred<QueryResult>();
    const aRequest = request(a.promise); const bRequest = request(b.promise);
    supabaseMock.rpc.mockReturnValueOnce(aRequest).mockReturnValueOnce(bRequest);
    const view = render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    authMock.user = B; view.rerender(<App />);
    supabaseMock.auth.getSession.mockResolvedValue({ data: { session: session(B) }, error: null });
    open(B); confirm(); await act(async () => fireEvent.click(submit()));
    await act(async () => a.resolve(success));
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    expect(screen.getByText(B.email, { selector: 'strong' })).toBeInTheDocument();
    expect(aRequest.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer synthetic-user-a');
    expect(bRequest.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer synthetic-user-b');
    await act(async () => b.resolve(failure));
    expect(screen.getByRole('status')).toHaveTextContent('database rejected');
    expect(authMock.signOut).not.toHaveBeenCalled();
  });
});

describe('awaited completion contract', () => {
  it.each(['success', 'returned Auth error', 'rejection'] as const)('awaits %s, keeps busy, and never repeats confirmed deletion', async outcome => {
    const pending = deferred<{ error: unknown | null }>();
    const complete = vi.fn<CompleteAccountDeletion>().mockReturnValue(pending.promise);
    const operations: AccountDeletionOperations = new Map();
    const close = vi.fn();
    const view = render(<DeleteAccountModal account={A} operations={operations} onClose={close} onDeleted={complete} />);
    confirm(); const stale = handler(submit()); let work: Promise<void>;
    await act(async () => { work = stale(); });
    expect(complete).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    expect(complete.mock.calls[0][0].operation.accountId).toBe(A.id);
    expect(complete.mock.calls[0][0].isCurrent()).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Finishing local cleanup');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => stale());
    await act(async () => {
      if (outcome === 'rejection') pending.reject(new Error('private cleanup detail'));
      else pending.resolve({ error: outcome === 'success' ? null : new Error('returned Auth error') });
      await work!;
    });
    expect(screen.getByRole('status')).toHaveTextContent(outcome === 'success' ? 'Account deletion confirmed' : 'Account deletion confirmed, but local cleanup could not finish');
    expect(screen.queryByText(/private cleanup detail|returned Auth error/)).not.toBeInTheDocument();
    expect(submit()).toBeDisabled(); expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    await act(async () => stale());
    view.unmount();
    render(<DeleteAccountModal account={A} operations={operations} onClose={close} onDeleted={complete} />);
    confirm(); await act(async () => handler(submit())());
    expect(submit()).toBeDisabled(); expect(supabaseMock.rpc).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledOnce();
  });

  it.each(['account switch', 'unmount'] as const)('ignores a delayed cleanup rejection after %s', async transition => {
    const pending = deferred<{ error: unknown | null }>();
    const complete = vi.fn<CompleteAccountDeletion>().mockReturnValue(pending.promise);
    const operations: AccountDeletionOperations = new Map();
    const close = vi.fn();
    const element = <DeleteAccountModal account={A} operations={operations} onClose={close} onDeleted={complete} />;
    const view = render(element); confirm();
    await act(async () => fireEvent.click(submit()));
    if (transition === 'account switch') {
      authMock.user = B;
      view.rerender(<DeleteAccountModal account={A} operations={operations} onClose={close} onDeleted={complete} />);
    }
    else view.unmount();
    expect(complete.mock.calls[0][0].isCurrent()).toBe(false);
    await act(async () => pending.reject(new Error('old failure')));
    expect(view.container).toBeEmptyDOMElement(); expect(authMock.signOut).not.toHaveBeenCalled();
  });
});

// Public SDK APIs, configured in-memory storage and injected transport only.
// These probes demonstrate why a checked local signOut is NOT the fallback.
async function sdkFixture() {
  // One isolated client per probe; no peer channels. The Practice channel mock
  // intentionally implements a different API from the SDK's EventTarget API.
  vi.stubGlobal('BroadcastChannel', class extends EventTarget { postMessage() {} close() {} });
  const { createClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const stored = new Map<string, string>();
  const logout = deferred<Response>(); const reachedLogout = deferred<void>();
  const reachedLock = deferred<void>(); const releaseLock = deferred<void>();
  let queueSignOut = false;
  const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).includes('/token?grant_type=password')) {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(session(body.email === A.email ? A : B)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).includes('/logout')) { reachedLogout.resolve(); return logout.promise; }
    throw new Error('Unexpected synthetic endpoint');
  });
  const client = createClient('https://deletion-lifecycle.invalid', 'synthetic-key', {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: `r4-sec-08-${crypto.randomUUID()}`,
      storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
      lock: async (_name, _timeout, fn) => { if (queueSignOut) { queueSignOut = false; reachedLock.resolve(); await releaseLock.promise; } return fn(); },
    }, global: { fetch: transport },
  });
  await client.auth.initialize();
  const signIn = async (user = A) => { const result = await client.auth.signInWithPassword({ email: user.email, password: 'synthetic' }); expect(result.error).toBeNull(); };
  await signIn();
  return { client, stored, transport, logout, reachedLogout, reachedLock, releaseLock, queue: () => { queueSignOut = true; }, signIn };
}

describe('installed SDK session replacement boundary', () => {
  it.each(['queued', 'processing'] as const)('demonstrates unsafe checked local signOut when B replaces A while %s', async timing => {
    const fixture = await sdkFixture();
    const { client, stored, transport, logout, reachedLogout, reachedLock, releaseLock, signIn } = fixture;
    expect((await client.auth.getSession()).data.session?.user.id).toBe(A.id);
    if (timing === 'queued') fixture.queue();
    const pending = client.auth.signOut({ scope: 'local' });
    if (timing === 'queued') await reachedLock.promise;
    else await reachedLogout.promise;
    await signIn(B); expect([...stored.values()].join('')).toContain(B.id);
    if (timing === 'queued') { releaseLock.resolve(); await reachedLogout.promise; }
    logout.resolve(new Response(null, { status: 204 }));
    expect((await pending).error).toBeNull();
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect([...stored.values()].join('')).not.toContain(B.id);
    const call = transport.mock.calls.find(([url]) => String(url).includes('/logout'))!;
    expect(String(call[0])).toContain('scope=local');
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe(`Bearer synthetic-${timing === 'queued' ? B.id : A.id}`);
  });

  it.each(['success', 'failure'] as const)('fallback leaves actual SDK B session intact on late A %s', async outcome => {
    const { client, stored, transport, signIn } = await sdkFixture();
    const pending = deferred<QueryResult>();
    supabaseMock.auth.getSession.mockImplementation(() => client.auth.getSession());
    authMock.signOut.mockImplementation(() => client.auth.signOut({ scope: 'local' }));
    supabaseMock.rpc.mockReturnValue(request(pending.promise));
    const view = render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    await act(async () => signIn(B));
    const before = [...stored.entries()];
    authMock.user = B; view.rerender(<App />);
    await act(async () => pending.resolve(outcome === 'failure' ? failure : success));
    expect([...stored.entries()]).toEqual(before);
    expect((await client.auth.getSession()).data.session?.user.id).toBe(B.id);
    expect(transport.mock.calls.filter(([url]) => String(url).includes('/logout'))).toHaveLength(0);
    expect(authMock.signOut).not.toHaveBeenCalled();
    expect(supabaseMock.auth.getSession).toHaveBeenCalledOnce();
  });

  it('handles an actually missing SDK session at completion without another logout or session replacement', async () => {
    const { client, stored, transport, logout, reachedLogout } = await sdkFixture();
    const pending = deferred<QueryResult>();
    supabaseMock.auth.getSession.mockImplementation(() => client.auth.getSession());
    authMock.signOut.mockImplementation(() => client.auth.signOut({ scope: 'local' }));
    supabaseMock.rpc.mockReturnValue(request(pending.promise));
    render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    // A separately initiated sign-out completes first; React is still stale A.
    const separateSignOut = client.auth.signOut({ scope: 'local' });
    await reachedLogout.promise;
    logout.resolve(new Response(null, { status: 204 }));
    expect((await separateSignOut).error).toBeNull();
    expect((await client.auth.getSession()).data.session).toBeNull();
    const before = [...stored.entries()];
    await act(async () => pending.resolve(success));
    expect([...stored.entries()]).toEqual(before);
    expect((await client.auth.getSession()).data.session).toBeNull();
    expect(transport.mock.calls.filter(([url]) => String(url).includes('/logout'))).toHaveLength(1);
    expect(authMock.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Account deletion confirmed');
  });
});
