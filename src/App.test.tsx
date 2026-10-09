import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import App from './App';

vi.mock('./components/WordManagement', () => ({ default: () => <div>Words view</div> }));
vi.mock('./components/AuthPage', () => ({ default: () => <div>Signed out view</div> }));

beforeEach(() => {
  localStorage.setItem('vocab-app-theme', 'light');
  authMock.user = { id: 'user-a', email: 'a@example.com' };
});

describe('App display-name reads', () => {
  it.each(['success', 'returned error', 'rejected error'] as const)('keeps a post-save refresh when the initial read finishes with %s', async completion => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initial = deferred<QueryResult>();
    const refreshed = deferred<QueryResult>();
    const save = query();
    supabaseMock.from.mockReturnValueOnce(query(initial.promise))
      .mockReturnValueOnce(query({ data: { display_name: 'Before' }, error: null }))
      .mockReturnValueOnce(save).mockReturnValueOnce(query(refreshed.promise));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'a@example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Profile' }));
    await screen.findByDisplayValue('Before');
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Refreshed name' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); });
    expect(save.upsert).toHaveBeenCalledWith({ id: 'user-a', display_name: 'Refreshed name' });
    await act(async () => refreshed.resolve({ data: { display_name: 'Refreshed name' }, error: null }));
    await act(async () => {
      if (completion === 'success') initial.resolve({ data: { display_name: 'Stale initial name' }, error: null });
      if (completion === 'returned error') initial.resolve({ error: { message: 'Old failure' } });
      if (completion === 'rejected error') initial.reject(new Error('Old failure'));
    });
    expect(screen.getByRole('button', { name: 'Refreshed name' })).toBeInTheDocument();
    expect(screen.queryByText('Stale initial name')).not.toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
  });

  it('never applies a previous account response to the current account', async () => {
    const a = deferred<QueryResult>();
    const b = deferred<QueryResult>();
    const bQuery = query(b.promise);
    supabaseMock.from.mockReturnValueOnce(query(a.promise)).mockReturnValueOnce(bQuery);
    const { rerender } = render(<App />);
    authMock.user = { id: 'user-b', email: 'b@example.com' };
    rerender(<App />);
    expect(bQuery.eq).toHaveBeenCalledWith('id', 'user-b');
    expect(screen.getByRole('button', { name: 'b@example.com' })).toBeInTheDocument();
    await act(async () => b.resolve({ data: { display_name: 'B name' }, error: null }));
    await act(async () => a.resolve({ data: { display_name: 'A name' }, error: null }));
    expect(screen.getByRole('button', { name: 'B name' })).toBeInTheDocument();
    expect(screen.queryByText('A name')).not.toBeInTheDocument();
  });

  it('immediately stops displaying the old account name and invalidates reads on sign-out', async () => {
    supabaseMock.from.mockReturnValueOnce(query({ data: { display_name: 'A name' }, error: null }));
    const { rerender } = render(<App />);
    await screen.findByRole('button', { name: 'A name' });
    const b = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(b.promise));
    authMock.user = { id: 'user-b', email: 'b@example.com' };
    rerender(<App />);
    expect(screen.queryByText('A name')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'b@example.com' })).toBeInTheDocument();
    authMock.user = null;
    rerender(<App />);
    await act(async () => b.resolve({ data: { display_name: 'Late B name' }, error: null }));
    expect(screen.getByText('Signed out view')).toBeInTheDocument();
    const next = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(next.promise));
    authMock.user = { id: 'user-b', email: 'b@example.com' };
    rerender(<App />);
    expect(screen.getByRole('button', { name: 'b@example.com' })).toBeInTheDocument();
    expect(screen.queryByText('Late B name')).not.toBeInTheDocument();
    await act(async () => next.resolve({ data: { display_name: 'Current B name' }, error: null }));
  });

  it.each(['resolve', 'reject'] as const)('ignores a pending %s after unmount', async completion => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(pending.promise));
    const { unmount } = render(<App />);
    unmount();
    await act(async () => {
      if (completion === 'resolve') pending.resolve({ data: { display_name: 'Old' }, error: null });
      else pending.reject(new Error('Unmounted'));
    });
    expect(screen.queryByText('Words view')).not.toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
  });
});
