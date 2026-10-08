import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { query, supabaseMock } from '@/test/mocks';
import { historyRecord } from '@/test/fixtures';
import type { TestHistory } from '@/lib/supabase';
import History from './History';

async function loadHistory(records: TestHistory[]) {
  const load = query({ data: records, error: null });
  supabaseMock.from.mockReturnValue(load);
  const view = render(<History />);
  await screen.findByRole('button', { name: 'Clear All' });
  await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
  expect(supabaseMock.from).toHaveBeenCalledWith('test_history');
  expect(load.select).toHaveBeenCalledWith('*');
  expect(load.eq).toHaveBeenCalledWith('user_id', 'user-a');
  return { ...view, load, user: userEvent.setup() };
}

// Current row actions are icon-only without accessible names. Scope to the
// record's displayed date and icon rather than adding product markup for tests.
function rowAction(record: TestHistory, icon: 'trash-2' | 'square' | 'chevron-down') {
  const row = screen.getByText(new Date(record.test_date).toLocaleString()).closest('.border-b')!;
  const button = row.querySelector(`.lucide-${icon === 'trash-2' ? 'trash2' : icon}`)?.closest('button');
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button!;
}

describe('History', () => {
  it('loads only the current user and renders saved prompts, legacy fallback, sanitized context, and answers', async () => {
    const record = historyRecord({ mistakes: [
      { english_word: 'go', question_prompt: 'წასვლა, სვლა', description:
        '<strong onclick="evil()">Saved context</strong><script>evil()</script><img src="x" onerror="evil()">',
        user_answer: 'wrong', correct_definitions: ['go', 'went', 'gone'] },
      { english_word: 'legacy word', user_answer: '', correct_definitions: ['ძველი'] },
    ] });
    const { user, container } = await loadHistory([record]);
    await user.click(rowAction(record, 'chevron-down'));
    expect(screen.getByText('წასვლა, სვლა')).toBeInTheDocument();
    expect(screen.queryByText('go', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('legacy word')).toBeInTheDocument();
    expect(screen.getByText('go, went, gone')).toBeInTheDocument();
    expect(screen.getByText('ძველი')).toBeInTheDocument();
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('Saved context').tagName).toBe('STRONG');
    expect(container.querySelector('script, img, [onclick], [onerror]')).toBeNull();
  });

  it('deletes a single record by ID and owner and reloads after success', async () => {
    const record = historyRecord();
    const { user } = await loadHistory([record]);
    const deletion = query();
    supabaseMock.from.mockReturnValueOnce(deletion)
      .mockReturnValue(query({ data: [], error: null }));
    await user.click(rowAction(record, 'trash-2'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('No results found.');
    expect(deletion.delete).toHaveBeenCalledOnce();
    expect(deletion.eq.mock.calls).toEqual([['id', record.id], ['user_id', 'user-a']]);
    expect(screen.queryByRole('heading', { name: 'Delete Test Record' })).not.toBeInTheDocument();
  });

  it('retains the single-delete confirmation and record when Supabase returns an error', async () => {
    const record = historyRecord();
    const { user, load } = await loadHistory([record]);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const deletion = query({ error: { message: 'Permission denied' } });
    supabaseMock.from.mockReturnValue(deletion);
    await user.click(rowAction(record, 'trash-2'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(alert).toHaveBeenCalledExactlyOnceWith('Error deleting record: Permission denied');
    expect(screen.getByRole('heading', { name: 'Delete Test Record' })).toBeInTheDocument();
    expect(screen.getByText(new Date(record.test_date).toLocaleString())).toBeInTheDocument();
    expect(load.select).toHaveBeenCalledOnce();
    expect(deletion.select).not.toHaveBeenCalled();
  });

  it.each([false, true])('bulk-deletes only selected IDs and owner (returned error=%s)', async (fails) => {
    const records = [historyRecord(), historyRecord({ id: 'history-2', test_date: '2026-01-02T10:00:00Z' }),
      historyRecord({ id: 'unselected', test_date: '2026-01-03T10:00:00Z' })];
    const { user } = await loadHistory(records);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await user.click(rowAction(records[0], 'square'));
    await user.click(rowAction(records[1], 'square'));
    const deletion = query({ error: fails ? { message: 'Offline' } : null });
    supabaseMock.from.mockReturnValueOnce(deletion)
      .mockReturnValue(query({ data: [records[2]], error: null }));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2 Records' }));
    expect(deletion.delete).toHaveBeenCalledOnce();
    expect(deletion.in).toHaveBeenCalledWith('id', ['history-1', 'history-2']);
    expect(deletion.eq.mock.calls).toEqual([['user_id', 'user-a']]);
    if (fails) {
      expect(alert).toHaveBeenCalledExactlyOnceWith('Error deleting records: Offline');
      expect(screen.getByRole('heading', { name: 'Delete 2 Records' })).toBeInTheDocument();
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      expect(screen.getByText(new Date(records[0].test_date).toLocaleString())).toBeInTheDocument();
    } else {
      await waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete 2 Records' })).not.toBeInTheDocument());
      expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
      expect(screen.queryByText(new Date(records[0].test_date).toLocaleString())).not.toBeInTheDocument();
      expect(screen.getByText(new Date(records[2].test_date).toLocaleString())).toBeInTheDocument();
    }
  });

  it('requires confirmation and scopes Clear All to the current user', async () => {
    const { user } = await loadHistory([historyRecord()]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const deletion = query();
    supabaseMock.from.mockReturnValueOnce(deletion)
      .mockReturnValue(query({ data: [], error: null }));
    await user.click(screen.getByRole('button', { name: 'Clear All' }));
    expect(deletion.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Clear All' }));
    await screen.findByText('No results found.');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(deletion.delete).toHaveBeenCalledOnce();
    expect(deletion.eq.mock.calls).toEqual([['user_id', 'user-a']]);
    expect(deletion.in).not.toHaveBeenCalled();
    // Known limitation: Clear All ignores returned { error } (unlike single/bulk).
    // Issue 8 intentionally covers its ownership contract without changing that behavior.
  });
});
