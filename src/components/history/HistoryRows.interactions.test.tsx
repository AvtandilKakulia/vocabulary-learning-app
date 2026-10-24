import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { historyRecord } from '@/test/fixtures';
import HistoryRows from './HistoryRows';
import { readFileSync } from 'node:fs';

const pickerStyles = readFileSync('src/components/history/historyFilters.css', 'utf8');

const mistake = { english_word: 'cat', user_answer: 'dog', correct_definitions: ['კატა'] };
function setup() {
  const onSelect = vi.fn(), onDelete = vi.fn();
  const records = [historyRecord({ mistakes: [mistake] }),
    historyRecord({ id: 'second', test_date: '2026-02-01T00:00:00Z', mistakes: [mistake] }),
    historyRecord({ id: 'perfect', correct_count: 2 })];
  const view = render(<HistoryRows records={records} selectedIds={new Set()} disabled={false}
    onSelect={onSelect} onDelete={onDelete} scoreEmoji={() => '🙂'} />);
  const rows = view.container.querySelectorAll<HTMLElement>('[data-history-id]');
  return { ...view, rows, onSelect, onDelete, user: userEvent.setup() };
}

describe('History summary interaction', () => {
  it('toggles by score and date and leaves expanded details independently clickable', async () => {
    const { rows, user } = setup();
    const row = within(rows[0]);
    await user.click(row.getByText('50%'));
    expect(row.getByRole('button', { name: /^Collapse record/ })).toHaveAttribute('aria-expanded', 'true');
    await user.click(row.getByText('dog'));
    expect(row.getByText('Mistakes (1):')).toBeInTheDocument();
    await user.click(row.getByText(new Date('2026-01-01T10:00:00Z').toLocaleString()));
    expect(row.queryByText('Mistakes (1):')).not.toBeInTheDocument();
    expect(row.getByRole('button', { name: /^Expand record/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports Enter/Space and retains one expanded record across summary and chevron actions', async () => {
    const { rows, user } = setup();
    const first = within(rows[0]), second = within(rows[1]);
    first.getByRole('button', { name: /^Expand record/ }).focus();
    await user.keyboard('{Enter}');
    expect(first.getByText('Mistakes (1):')).toBeInTheDocument();
    await user.keyboard(' ');
    expect(first.queryByText('Mistakes (1):')).not.toBeInTheDocument();
    await user.click(first.getByRole('button', { name: 'Show mistakes' }));
    await user.click(second.getByRole('button', { name: /^Expand record/ }));
    expect(first.queryByText('Mistakes (1):')).not.toBeInTheDocument();
    expect(second.getByRole('button', { name: 'Hide mistakes' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps selection/deletion outside the summary button without toggling expansion', async () => {
    const { rows, user, onSelect, onDelete, container } = setup();
    const row = within(rows[0]);
    await user.click(row.getByRole('button', { name: /^Select record/ }));
    await user.click(row.getByRole('button', { name: /^Delete record/ }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('history-1');
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('history-1');
    expect(row.getByRole('button', { name: /^Expand record/ })).toHaveAttribute('aria-expanded', 'false');
    await user.click(row.getByRole('button', { name: /^Expand record/ }));
    await user.click(row.getByRole('button', { name: /^Select record/ }));
    await user.click(row.getByRole('button', { name: /^Delete record/ }));
    expect(row.getByText('Mistakes (1):')).toBeInTheDocument();
    expect(container.querySelector('button button')).toBeNull();
  });

  it('does not expose expandable controls for records without mistakes', () => {
    const { rows } = setup();
    const perfect = within(rows[2]);
    expect(perfect.queryByRole('button', { name: /^(Expand|Collapse) record from/ })).not.toBeInTheDocument();
    expect(perfect.queryByRole('button', { name: 'Show mistakes' })).not.toBeInTheDocument();
    fireEvent.click(perfect.getByText('100%'));
    expect(perfect.queryByText(/Mistakes/)).not.toBeInTheDocument();
  });

  it('uses a transparent trash control with bulk-delete red accents on hover and native disabled behavior', () => {
    const { rows, rerender, onSelect, onDelete } = setup();
    const deletion = within(rows[0]).getByRole('button', { name: /^Delete record/ });
    expect(deletion).toHaveClass('bg-transparent', 'border-transparent', 'hover:bg-red-100', 'dark:hover:bg-red-900', 'focus-visible:ring-2', 'disabled:opacity-50');
    for (const persistentRed of ['bg-red-50', 'dark:bg-red-950', 'border-red-300', 'dark:border-red-800']) {
      expect(deletion).not.toHaveClass(persistentRed);
    }
    expect(deletion.querySelector('svg')).toHaveAttribute('width', '18');
    expect(deletion.querySelector('svg')).toHaveClass('text-red-600', 'dark:text-red-400');
    expect(deletion.querySelector('svg')).not.toHaveClass('dark:text-red-200');
    rerender(<HistoryRows records={[historyRecord()]} selectedIds={new Set()} disabled onSelect={onSelect} onDelete={onDelete} scoreEmoji={() => ''} />);
    expect(screen.getByRole('button', { name: /^Delete record/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /^Delete record/ }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('scopes enhanced picker rules behind support detection, leaving four native fallback selects', () => {
    expect(pickerStyles).toContain('@supports (appearance: base-select)');
    expect(pickerStyles).toContain('select.history-filter-select,');
    expect(pickerStyles).toContain('.history-filter-select::picker(select)');
    expect(pickerStyles).toContain('.history-filter-select::picker-icon');
    expect(pickerStyles).toContain('border-radius: 0.75rem');
    expect(pickerStyles).toContain('position-area: block-end span-inline-end');
    expect(pickerStyles).toContain('position-try-order: normal');
    expect(pickerStyles).toContain('position-try-fallbacks: flip-block');
    expect(pickerStyles).toContain('max-block-size: min(20rem, 60vh, calc(100% - 0.75rem))');
    expect(pickerStyles).toContain('overflow-y: auto');
    expect(pickerStyles).toContain('.dark select.history-filter-select::picker(select)');
  });
});
