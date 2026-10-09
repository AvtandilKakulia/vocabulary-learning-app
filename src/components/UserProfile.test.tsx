import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import UserProfile from './UserProfile';

const props = { onClose: vi.fn(), onProfileUpdated: vi.fn() };

describe('UserProfile reads', () => {
  it.each(['old first', 'new first', 'returned error', 'rejected error'] as const)('protects the current account form when completion is %s', async completion => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.user = { id: 'user-a', email: 'a@example.com' };
    const a = deferred<QueryResult>();
    const b = deferred<QueryResult>();
    const bQuery = query(b.promise);
    supabaseMock.from.mockReturnValueOnce(query(a.promise)).mockReturnValueOnce(bQuery);
    const { rerender } = render(<UserProfile {...props} />);
    authMock.user = { id: 'user-b', email: 'b@example.com' };
    rerender(<UserProfile {...props} />);
    expect(bQuery.eq).toHaveBeenCalledWith('id', 'user-b');
    if (completion === 'old first') {
      await act(async () => a.resolve({ data: { display_name: 'Old name' }, error: null }));
      expect(screen.getByText('Loading profile...')).toBeInTheDocument();
    }
    await act(async () => b.resolve({ data: { display_name: 'Current name' }, error: null }));
    // A delayed read must not overwrite even an unsaved edit in the current form.
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Edited current name' } });
    await act(async () => {
      if (completion === 'new first') a.resolve({ data: { display_name: 'Old name' }, error: null });
      if (completion === 'returned error') a.resolve({ error: { message: 'Old failure' } });
      if (completion === 'rejected error') a.reject(new Error('Old failure'));
    });
    expect(screen.getByPlaceholderText('Your name')).toHaveValue('Edited current name');
    expect(screen.getByDisplayValue('b@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load profile')).not.toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
  });

  it('clears old form errors and values when switching accounts or signing out', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.user = { id: 'user-a', email: 'a@example.com' };
    supabaseMock.from.mockReturnValueOnce(query({ error: { message: 'Read failed' } }));
    const { rerender } = render(<UserProfile {...props} />);
    await screen.findByText('Failed to load profile');
    const b = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(b.promise));
    authMock.user = { id: 'user-b', email: 'b@example.com' };
    rerender(<UserProfile {...props} />);
    expect(screen.queryByText('Failed to load profile')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('a@example.com')).not.toBeInTheDocument();
    authMock.user = null;
    rerender(<UserProfile {...props} />);
    await act(async () => b.resolve({ data: { display_name: 'Obsolete B' }, error: null }));
    expect(screen.getByPlaceholderText('Your name')).toHaveValue('');
    expect(screen.getAllByRole('textbox')[1]).toHaveValue('');
    expect(screen.queryByText('Loading profile...')).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)('ignores a pending %s after unmount', async completion => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(pending.promise));
    const { unmount } = render(<UserProfile {...props} />);
    unmount();
    await act(async () => {
      if (completion === 'resolve') pending.resolve({ data: { display_name: 'Old' }, error: null });
      else pending.reject(new Error('Unmounted'));
    });
    expect(screen.queryByPlaceholderText('Your name')).not.toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
  });

  it('preserves profile save and email-update contracts after loading', async () => {
    authMock.user = { id: 'user-a', email: 'a@example.com' };
    const save = query();
    supabaseMock.from.mockReturnValueOnce(query({ data: { display_name: 'Before' }, error: null }))
      .mockReturnValueOnce(save);
    supabaseMock.auth.updateUser.mockResolvedValueOnce({ error: null });
    const updated = vi.fn();
    render(<UserProfile onClose={vi.fn()} onProfileUpdated={updated} />);
    await screen.findByDisplayValue('Before');
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: ' After ' } });
    fireEvent.change(screen.getByDisplayValue('a@example.com'), { target: { value: 'new@example.com' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); });
    expect(save.upsert).toHaveBeenCalledExactlyOnceWith({ id: 'user-a', display_name: 'After' });
    expect(supabaseMock.auth.updateUser).toHaveBeenCalledExactlyOnceWith({ email: 'new@example.com' });
    expect(updated).toHaveBeenCalledOnce();
    expect(screen.getByText('Profile updated! Please check your email to confirm the new email address.')).toBeInTheDocument();
  });
});
