import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
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

const variedRecords = [
  historyRecord({ id: 'en-high', test_direction: 'en-to-geo', total_words: 10, correct_count: 9, test_date: '2026-02-01T10:00:00Z' }),
  historyRecord({ id: 'geo-low', test_direction: 'geo-to-en', total_words: 10, correct_count: 2, test_date: '2026-02-02T10:00:00Z' }),
  historyRecord({ id: 'en-medium', test_direction: 'en-to-geo', total_words: 10, correct_count: 6, test_date: '2026-02-03T10:00:00Z' }),
  historyRecord({ id: 'geo-high', test_direction: 'geo-to-en', total_words: 10, correct_count: 8, test_date: '2026-02-04T10:00:00Z' }),
];

// The existing History controls are ordered Direction, Score Range, Sort By, Order.
const control = (index: number) => screen.getAllByRole('combobox')[index];
async function finishReload() {
  await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
}

describe('History bulk selection safety', () => {
  it('shows only the appropriate selection actions as selection changes, including keyboard activation', async () => {
    const { user, load } = await loadHistory(variedRecords);
    expect(screen.queryByRole('button', { name: /^(Select All|Deselect All|Clear Selection)$/ })).not.toBeInTheDocument();
    await user.click(rowAction(variedRecords[0], 'square'));
    const selectAll = screen.getByRole('button', { name: 'Select All' });
    expect(screen.getByRole('button', { name: 'Clear Selection' })).toBeEnabled();
    selectAll.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('4 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Clear Selection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select All' })).not.toBeInTheDocument();
    // Deselect one row to return directly from full to partial selection.
    const selectedRow = screen.getByText(new Date(variedRecords[0].test_date).toLocaleString()).closest('.border-b')!;
    await user.click(selectedRow.querySelector('button')!);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select All' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear Selection' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Select All' }));
    screen.getByRole('button', { name: 'Deselect All' }).focus();
    await user.keyboard(' ');
    expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Select All|Deselect All|Clear Selection)$/ })).not.toBeInTheDocument();
    await user.click(rowAction(variedRecords[0], 'square'));
    expect(screen.getByRole('button', { name: 'Select All' })).toBeEnabled();
    screen.getByRole('button', { name: 'Clear Selection' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
    expect(load.delete).not.toHaveBeenCalled();
  });

  it('shows only Deselect All when filters leave one visible record selected', async () => {
    const { user, load } = await loadHistory(variedRecords);
    await user.selectOptions(control(0), 'en-to-geo');
    await user.selectOptions(control(1), 'high');
    await user.click(rowAction(variedRecords[0], 'square'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Clear Selection' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select All' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deselect All' }));
    expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Select All|Deselect All|Clear Selection)$/ })).not.toBeInTheDocument();
    expect(load.delete).not.toHaveBeenCalled();
  });

  it.each([[0, 'geo-to-en'], [1, 'high']] as const)(
    'clears selection and invalidates a queued confirmation when filter %i changes', async (index, value) => {
      const { user, load } = await loadHistory(variedRecords);
      await user.click(rowAction(variedRecords[0], 'square'));
      await user.click(rowAction(variedRecords[1], 'square'));
      await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
      const confirm = screen.getByRole('button', { name: 'Delete 2 Records' });
      act(() => {
        fireEvent.change(control(index), { target: { value } });
        fireEvent.click(confirm); // The old DOM handler can still run before the next render.
      });
      expect(load.delete).not.toHaveBeenCalled();
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
      expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
      const deletion = query();
      supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValue(query({ data: [], error: null }));
      await user.click(rowAction(variedRecords[3], 'square'));
      await user.click(screen.getByRole('button', { name: 'Delete Selected (1)' }));
      await user.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
      expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['geo-high']);
      expect(deletion.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'user-a');
    },
  );

  it('Select All selects exactly the filtered records and Deselect All clears them after sorting', async () => {
    const { user, load } = await loadHistory(variedRecords);
    await user.selectOptions(control(0), 'en-to-geo');
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(screen.getByRole('button', { name: 'Select All' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.selectOptions(control(3), 'asc');
    await finishReload();
    await user.click(screen.getByRole('button', { name: 'Deselect All' }));
    expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
    expect(load.delete).not.toHaveBeenCalled();
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(screen.getByRole('button', { name: 'Select All' }));
    const deletion = query();
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValue(query({ data: [variedRecords[1], variedRecords[3]], error: null }));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Delete 2 Records');
    expect(dialog).toHaveTextContent('You are about to delete 2 test records.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete 2 Records' }));
    expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['en-high', 'en-medium']);
    expect(deletion.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'user-a');
  });

  it.each([[2, 'score'], [3, 'asc']] as const)('preserves valid selection and confirmation when sorting control %i changes', async (index, value) => {
    const { user } = await loadHistory(variedRecords);
    await user.selectOptions(control(0), 'en-to-geo');
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(rowAction(variedRecords[2], 'square'));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
    await user.selectOptions(control(index), value);
    await finishReload();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deselect All' })).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete 2 Records');
    const deletion = query();
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValue(query({ data: [], error: null }));
    await user.click(screen.getByRole('button', { name: 'Delete 2 Records' }));
    expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['en-high', 'en-medium']);
  });

  it('checks visible membership rather than equal Set sizes after records change', async () => {
    const { user } = await loadHistory(variedRecords);
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(rowAction(variedRecords[1], 'square'));
    // Two selected IDs, two visible records, but only one ID is shared.
    supabaseMock.from.mockReturnValue(query({ data: [variedRecords[0], variedRecords[2]], error: null }));
    await user.selectOptions(control(2), 'score');
    await finishReload();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deselect All' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Select All' }));
    const deletion = query();
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValue(query({ data: [], error: null }));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2 Records' }));
    expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['en-high', 'en-medium']);
  });

  it.each(['hidden', 'missing', 'empty'] as const)('rechecks an open confirmation after a reload makes selected records %s', async change => {
    const { user } = await loadHistory(variedRecords);
    await user.selectOptions(control(0), 'en-to-geo');
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(rowAction(variedRecords[2], 'square'));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
    const refreshed = change === 'empty' ? [] : [variedRecords[2],
      ...(change === 'hidden' ? [{ ...variedRecords[0], test_direction: 'geo-to-en' as const }] : []), variedRecords[3]];
    supabaseMock.from.mockReturnValue(query({ data: refreshed, error: null }));
    await user.selectOptions(control(2), 'score');
    await finishReload();
    const deletion = query();
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValue(query({ data: [], error: null }));
    if (change === 'empty') {
      expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
      const empty = screen.getByRole('button', { name: 'Delete 0 Records' });
      expect(empty).toBeDisabled();
      fireEvent.click(empty);
      expect(deletion.delete).not.toHaveBeenCalled();
      expect(deletion.in).not.toHaveBeenCalled();
    } else {
      expect(screen.getByText('1 selected')).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete 1 Record');
      await user.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
      expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['en-medium']);
      expect(deletion.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'user-a');
    }
  });

  it.each(['add', 'remove', 'clear'] as const)('invalidates confirmation immediately when selection changes: %s', async change => {
    const { user, load } = await loadHistory(variedRecords);
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (1)' }));
    const confirm = screen.getByRole('button', { name: 'Delete 1 Record' });
    const selection = change === 'add' ? rowAction(variedRecords[2], 'square')
      : change === 'clear' ? screen.getByRole('button', { name: 'Clear Selection' })
        : screen.getByText(new Date(variedRecords[0].test_date).toLocaleString()).closest('.border-b')!.querySelector('button')!;
    act(() => { fireEvent.click(selection); fireEvent.click(confirm); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(load.delete).not.toHaveBeenCalled();
    if (change === 'add') {
      expect(screen.getByText('2 selected')).toBeInTheDocument();
      const deletion = query();
      supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValue(query({ data: [], error: null }));
      await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
      await user.click(screen.getByRole('button', { name: 'Delete 2 Records' }));
      expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['en-high', 'en-medium']);
    } else {
      expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
    }
  });

  it.each(['returned', 'thrown'] as const)('preserves safe selection on a %s error, guards rapid retry, and clears only selected records on success', async failureKind => {
    const { user } = await loadHistory(variedRecords);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await user.click(rowAction(variedRecords[0], 'square'));
    await user.click(rowAction(variedRecords[2], 'square'));
    const failed = query({ error: { message: 'Offline' } });
    if (failureKind === 'thrown') failed.eq.mockRejectedValueOnce(new Error('Offline'));
    const pending = deferred<QueryResult>();
    const retry = query(pending.promise);
    const remaining = [variedRecords[1], variedRecords[3]];
    supabaseMock.from.mockReturnValueOnce(failed).mockReturnValueOnce(retry)
      .mockReturnValue(query({ data: remaining, error: null }));
    await user.click(screen.getByRole('button', { name: 'Delete Selected (2)' }));
    await user.click(screen.getByRole('button', { name: 'Delete 2 Records' }));
    expect(alert).toHaveBeenCalledExactlyOnceWith('Error deleting records: Offline');
    expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete 2 Records');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Delete 2 Records' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(retry.delete).toHaveBeenCalledOnce();
    expect(retry.in).toHaveBeenCalledExactlyOnceWith('id', ['en-high', 'en-medium']);
    expect(retry.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'user-a');
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    expect(control(0)).toBeDisabled();
    fireEvent.change(control(0), { target: { value: 'geo-to-en' } });
    expect(control(0)).toHaveValue('all');
    await act(async () => { pending.resolve({ error: null }); });
    await finishReload();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Selected/ })).not.toBeInTheDocument();
    expect(screen.queryByText(new Date(variedRecords[0].test_date).toLocaleString())).not.toBeInTheDocument();
    for (const record of remaining) expect(screen.getByText(new Date(record.test_date).toLocaleString())).toBeInTheDocument();
  });
});
