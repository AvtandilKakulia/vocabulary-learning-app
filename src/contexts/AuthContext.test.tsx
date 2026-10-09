import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from './AuthContext';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));

function Consumer() {
  const { user, loading } = useAuth();
  return <div>{loading ? 'Loading session' : user?.id ?? 'Signed out'}</div>;
}

describe('Auth initial session read', () => {
  let resolve: (result: { data: { session: Session | null }; error: null }) => void;
  let reject: (error: Error) => void;
  let event: (event: AuthChangeEvent, session: Session | null) => void;
  const unsubscribe = vi.fn();

  beforeEach(() => {
    auth.getSession.mockReturnValue(new Promise((res, rej) => { resolve = res; reject = rej; }));
    auth.onAuthStateChange.mockImplementation(callback => {
      event = callback;
      return { data: { subscription: { unsubscribe } } };
    });
    unsubscribe.mockClear();
  });

  it.each(['SIGNED_IN', 'SIGNED_OUT'] as const)('does not overwrite a newer %s event with an initial session', async kind => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    const newer = kind === 'SIGNED_IN' ? { user: { id: 'user-b' } } as Session : null;
    act(() => event(kind, newer));
    await act(async () => resolve({ data: { session: { user: { id: 'user-a' } } as Session }, error: null }));
    expect(screen.getByText(kind === 'SIGNED_IN' ? 'user-b' : 'Signed out')).toBeInTheDocument();
  });

  it('ignores an initial-session failure after a newer authentication event', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AuthProvider><Consumer /></AuthProvider>);
    act(() => event('SIGNED_IN', { user: { id: 'user-b' } } as Session));
    await act(async () => reject(new Error('Old failure')));
    expect(screen.getByText('user-b')).toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
  });

  it('loads the initial session when there is no newer event', async () => {
    render(<AuthProvider><Consumer /></AuthProvider>);
    expect(screen.getByText('Loading session')).toBeInTheDocument();
    await act(async () => resolve({ data: { session: { user: { id: 'user-a' } } as Session }, error: null }));
    expect(screen.getByText('user-a')).toBeInTheDocument();
  });

  it('ignores a pending rejection after unmount and unsubscribes', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<AuthProvider><Consumer /></AuthProvider>);
    unmount();
    await act(async () => reject(new Error('Unmounted')));
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(logged).not.toHaveBeenCalled();
  });
});
