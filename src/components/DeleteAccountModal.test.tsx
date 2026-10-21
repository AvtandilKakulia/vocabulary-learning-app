import { StrictMode, useLayoutEffect } from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock } from '@/test/mocks';
import App from '@/App';

vi.mock('@/components/WordManagement', () => ({ default: () => <div>Words fixture</div> }));
vi.mock('@/components/AuthPage', () => ({ default: () => <div>Signed out fixture</div> }));

const A = { id: 'user-a', email: 'a@example.com' };
const B = { id: 'user-b', email: 'b@example.com' };
type Listener = (event: AuthChangeEvent, session: Session | null) => void;
let listeners: Set<Listener>;
function session(user = A, token = `synthetic-token-${user.id}`): Session {
  return { user: user as User, access_token: token, refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer' };
}
const sessionResult = (value: Session | null = session()) => ({ data: { session: value }, error: null });
const input = () => screen.getByPlaceholderText('DELETE');
const submit = () => screen.getByRole('button', { name: 'Delete Account' });
const confirm = (text = 'DELETE') => fireEvent.change(input(), { target: { value: text } });
function open(email = A.email) {
  fireEvent.click(screen.getByRole('button', { name: email }));
  fireEvent.click(submit());
}
function clickHandler(button: HTMLElement): () => Promise<void> {
  const key = Object.keys(button).find(key => key.startsWith('__reactProps$'))!;
  return (button as unknown as Record<string, { onClick: () => Promise<void> }>)[key].onClick;
}

beforeEach(() => {
  authMock.user = A;
  localStorage.setItem('vocab-app-theme', 'light');
  supabaseMock.from.mockImplementation(() => query({ data: null, error: null }));
  supabaseMock.auth.getSession.mockResolvedValue(sessionResult());
  listeners = new Set();
  supabaseMock.auth.onAuthStateChange.mockImplementation((listener: Listener) => {
    listeners.add(listener);
    return { data: { subscription: { unsubscribe: vi.fn(() => listeners.delete(listener)) } } };
  });
  const request = { ...query(), setHeader: vi.fn().mockReturnThis() };
  supabaseMock.rpc.mockReturnValue(request);
});

describe('account-bound deletion intent in the actual App', () => {
  it('accepts only exact DELETE and identifies the intended account', async () => {
    render(<App />); open();
    expect(screen.getByText('a@example.com', { selector: 'strong' })).toBeInTheDocument();
    for (const text of ['', 'delete', 'Delete', ' DELETE', 'DELETE ']) {
      confirm(text);
      expect(submit()).toBeDisabled();
      await act(async () => clickHandler(submit())());
    }
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    confirm();
    const stale = clickHandler(submit());
    confirm('delete');
    await act(async () => stale());
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    confirm();
    expect(submit()).toBeEnabled();
    await act(async () => fireEvent.click(submit()));
    expect(supabaseMock.auth.getSession).toHaveBeenCalledExactlyOnceWith();
    expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
    expect(supabaseMock.rpc.mock.results[0].value.setHeader).toHaveBeenCalledExactlyOnceWith('Authorization', 'Bearer synthetic-token-user-a');
    expect(authMock.signOut).toHaveBeenCalledOnce();
  });

  it('shows the immutable account ID when there is no email', () => {
    authMock.user = { id: A.id };
    render(<App />);
    const menu = screen.getByRole('button', { name: '' });
    fireEvent.click(menu); fireEvent.click(submit());
    expect(screen.getByText(A.id, { selector: 'strong' })).toBeInTheDocument();
  });

  it.each([
    ['A to B', [B]], ['A to signed out', [null]], ['A to signed out to B', [null, B]],
    ['A to B to A', [B, A]], ['A to signed out to A', [null, A]],
  ] as const)('never reuses confirmation across %s', async (_name, users) => {
    const view = render(<App />); open(); confirm();
    const stale = clickHandler(submit());
    for (const user of users) {
      authMock.user = user;
      view.rerender(<App />);
      expect(screen.queryByPlaceholderText('DELETE')).not.toBeInTheDocument();
    }
    await act(async () => stale());
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    if (authMock.user) {
      open(authMock.user.email!);
      expect(input()).toHaveValue('');
      expect(submit()).toBeDisabled();
    } else expect(screen.getByText('Signed out fixture')).toBeInTheDocument();
  });

  it('blocks an old handler during the new account commit before passive effects', async () => {
    function WithCommitAttempt({ attempt }: { attempt?: () => Promise<void> }) {
      useLayoutEffect(() => { void attempt?.(); }, [attempt]);
      return <App />;
    }
    const view = render(<WithCommitAttempt />); open(); confirm();
    const stale = clickHandler(submit());
    authMock.user = B;
    await act(async () => view.rerender(<WithCommitAttempt attempt={stale} />));
    expect(screen.queryByPlaceholderText('DELETE')).not.toBeInTheDocument();
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it.each(['different account', 'missing session', 'missing token', 'returned error', 'rejected error'] as const)(
    'fails closed with safe feedback for %s', async kind => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      if (kind === 'different account') supabaseMock.auth.getSession.mockResolvedValue(sessionResult(session(B)));
      if (kind === 'missing session') supabaseMock.auth.getSession.mockResolvedValue(sessionResult(null));
      if (kind === 'missing token') supabaseMock.auth.getSession.mockResolvedValue(sessionResult(session(A, '')));
      if (kind === 'returned error') supabaseMock.auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('private-token-detail') });
      if (kind === 'rejected error') supabaseMock.auth.getSession.mockRejectedValue(new Error('private-token-detail'));
      render(<App />); open(); confirm();
      const stale = clickHandler(submit());
      await act(async () => fireEvent.click(submit()));
      expect(screen.getByText(/Unable to verify the session for this account/)).toBeInTheDocument();
      expect(input()).toHaveValue('');
      expect(submit()).toBeDisabled();
      await act(async () => stale());
      expect(supabaseMock.auth.getSession).toHaveBeenCalledOnce();
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expect(screen.queryByText(/private-token-detail/)).not.toBeInTheDocument();
      expect(logged).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['A to B', [B]], ['A to signed out', [null]], ['A to signed out to B', [null, B]], ['A to B to A', [B, A]],
  ] as const)('revalidates after a delayed session check across %s', async (_name, users) => {
    const pending = deferred<ReturnType<typeof sessionResult>>();
    supabaseMock.auth.getSession.mockReturnValue(pending.promise);
    const view = render(<App />); open(); confirm(); fireEvent.click(submit());
    expect(supabaseMock.auth.getSession).toHaveBeenCalledOnce();
    for (const user of users) { authMock.user = user; view.rerender(<App />); }
    if (authMock.user) { open(authMock.user.email!); confirm(); }
    await act(async () => pending.resolve(sessionResult()));
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(authMock.signOut).not.toHaveBeenCalled();
    if (authMock.user) expect(input()).toHaveValue('DELETE');
  });

  it.each(['cancel', 'unmount'] as const)('invalidates a delayed session check on %s', async action => {
    const pending = deferred<ReturnType<typeof sessionResult>>();
    supabaseMock.auth.getSession.mockReturnValue(pending.promise);
    const view = render(<App />); open(); confirm(); fireEvent.click(submit());
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    else view.unmount();
    await act(async () => pending.resolve(sessionResult()));
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(authMock.signOut).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('requires a fresh intent after batched SDK A to B to A events before React updates', async () => {
    render(<App />); open(); confirm();
    const stale = clickHandler(submit());
    expect(listeners.size).toBe(1);
    await act(async () => {
      for (const listener of [...listeners]) { listener('SIGNED_IN', session(B)); listener('SIGNED_IN', session(A)); }
      await stale();
    });
    expect(screen.queryByPlaceholderText('DELETE')).not.toBeInTheDocument();
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    open(); expect(input()).toHaveValue(''); expect(submit()).toBeDisabled();
  });

  it('reopening clears confirmation and session errors without replaying an old handler', async () => {
    supabaseMock.auth.getSession.mockResolvedValueOnce(sessionResult(null));
    render(<App />); open(); confirm();
    const stale = clickHandler(submit());
    await act(async () => fireEvent.click(submit()));
    expect(screen.getByText(/Unable to verify/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); open();
    expect(input()).toHaveValue('');
    expect(screen.queryByText(/Unable to verify/)).not.toBeInTheDocument();
    await act(async () => stale());
    expect(supabaseMock.auth.getSession).toHaveBeenCalledOnce();
    confirm(); await act(async () => fireEvent.click(submit()));
    expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
  });

  it('keeps a same-account token refresh valid under StrictMode and deduplicates pending submissions', async () => {
    const pending = deferred<ReturnType<typeof sessionResult>>();
    supabaseMock.auth.getSession.mockReturnValue(pending.promise);
    const view = render(<StrictMode><App /></StrictMode>); open(); confirm();
    expect(listeners.size).toBe(1);
    act(() => { for (const listener of listeners) listener('TOKEN_REFRESHED', session(A, 'refreshed-a')); });
    const stale = clickHandler(submit());
    let first: Promise<void>;
    act(() => { first = stale(); void stale(); });
    expect(supabaseMock.auth.getSession).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    await act(async () => { pending.resolve(sessionResult(session(A, 'refreshed-a'))); await first!; });
    expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
    expect(supabaseMock.rpc.mock.results[0].value.setHeader).toHaveBeenCalledWith('Authorization', 'Bearer refreshed-a');
    view.unmount(); expect(listeners.size).toBe(0);
  });

  it('pins the checked A token even if the installed SDK reads B before transport, without changing other requests', async () => {
    const { createClient } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createClient('https://account-deletion.invalid', 'synthetic-public-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'r4-sec-07-sdk-contract' },
      global: { fetch: transport },
    });
    const sdkSession = vi.spyOn(client.auth, 'getSession').mockResolvedValue(sessionResult(session(B)));
    supabaseMock.rpc.mockImplementation(name => client.rpc(name));
    render(<App />); open(); confirm();
    await act(async () => fireEvent.click(submit()));
    expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
    expect(sdkSession).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledOnce();
    const [url, options] = transport.mock.calls[0];
    expect(String(url)).toBe('https://account-deletion.invalid/rest/v1/rpc/delete_user_account');
    expect(options?.method).toBe('POST'); expect(options?.body).toBe('{}');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer synthetic-token-user-a');
    await client.from('words').select('id');
    expect(new Headers(transport.mock.calls[1][1]?.headers).get('Authorization')).toBe('Bearer synthetic-token-user-b');
  });
});
