import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import WordManagement from './WordManagement';

describe('Words read-error UI', () => {
  it('waits for the latest typed search before offering Retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabaseMock.from.mockReturnValueOnce(query({ error: { message: 'failed' } }));
    render(<WordManagement />);
    const oldRetry = await screen.findByRole('button', { name: 'Retry' });
    vi.useFakeTimers();
    supabaseMock.rpc.mockImplementation(name => Promise.resolve({ data: name === 'search_words' ? [word()] : 1, error: null }));
    fireEvent.change(screen.getByPlaceholderText('Search English or Georgian words...'), { target: { value: 'yield' } });
    expect(screen.getByText('Loading words...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(oldRetry);
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words', expect.objectContaining({ p_term: 'yield' }));
    expect(screen.getByText('Yield')).toBeInTheDocument();
  });

  it.each(['returned', 'rejected'] as const)('shows an accessible error for a %s failure and retries using the keyboard', async kind => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(pending.promise));
    render(<WordManagement />);
    expect(screen.getByText('Loading words...')).toBeInTheDocument();
    await act(async () => {
      if (kind === 'returned') pending.resolve({ error: { message: 'sensitive internal details' } });
      else pending.reject(new Error('sensitive internal details'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your words. Please try again.');
    expect(screen.queryByText('No words yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive internal/)).not.toBeInTheDocument();
    expect(screen.queryByText('Loading words...')).not.toBeInTheDocument();
    const recovery = deferred<QueryResult>();
    const retry = query(recovery.promise);
    supabaseMock.from.mockReturnValue(retry);
    screen.getByRole('button', { name: 'Retry' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Loading words...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await act(async () => recovery.resolve({ data: [word()], count: 1, error: null }));
    expect(screen.getByText('Yield')).toBeInTheDocument();
    expect(retry.eq).toHaveBeenCalledWith('user_id', 'user-a');
  });

  it('shows the empty state only after a successful empty read', async () => {
    supabaseMock.from.mockReturnValue(query({ data: [], count: 0, error: null }));
    render(<WordManagement />);
    expect(await screen.findByText('No words yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides stale rows/totals, cancels deletion confirmation, and retains a valid selection through retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const current = word();
    supabaseMock.from.mockReturnValue(query({ data: [current], count: 80, error: null }));
    render(<WordManagement />);
    await screen.findByText('Yield');
    const row = screen.getByText('Yield').closest('tr')!;
    fireEvent.click(within(row).getAllByRole('button')[0]);
    // The toolbar and the row each offer Delete. The toolbar is first in document order.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    const confirmation = screen.getByRole('button', { name: 'Delete 1 Word' });
    supabaseMock.from.mockReturnValueOnce(query({ error: { message: 'read failed' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Alphabetical (A → Z)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recently added' }));
    await screen.findByRole('alert');
    expect(screen.queryByText('Yield')).not.toBeInTheDocument();
    expect(screen.queryByText('80', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delete 1 Word' })).not.toBeInTheDocument();
    fireEvent.click(confirmation);
    const retry = query({ data: [current], count: 1, error: null });
    supabaseMock.from.mockReturnValue(retry);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Yield');
    expect(screen.getByText('1 selected (this page)')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Delete 1 Word' })).not.toBeInTheDocument();
    expect(retry.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(retry.delete).not.toHaveBeenCalled();
  });

  it('does not show an old account error after the new account recovers', async () => {
    const old = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise));
    const { rerender, unmount } = render(<WordManagement />);
    const current = query({ data: [word({ user_id: 'user-b' })], count: 1, error: null });
    supabaseMock.from.mockReturnValue(current);
    authMock.user = { id: 'user-b' };
    rerender(<WordManagement />);
    await screen.findByText('Yield');
    await act(async () => old.reject(new Error('old account')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(current.eq).toHaveBeenCalledWith('user_id', 'user-b');
    unmount();
  });
});
