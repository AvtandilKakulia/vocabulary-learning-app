import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { query, supabaseMock } from '@/test/mocks';
import { word } from '@/test/fixtures';
import WordManagement from '../WordManagement';
import WordTable from './WordTable';

const words = [
  word({ id: 'sense-a', english_word: 'yield', georgian_definitions: ['დათმობა'] }),
  word({ id: 'sense-b', english_word: 'yield', georgian_definitions: ['მოსავლიანობა'], part_of_speech: 'noun' }),
  word({ id: 'go', english_word: 'go', is_irregular_verb: true, past_simple: 'went', past_participle: 'gone' }),
];

function props(overrides: Partial<React.ComponentProps<typeof WordTable>> = {}) {
  return {
    words, loading: false, readError: null, onRetry: vi.fn(), allSelected: false, selectedIds: new Set<string>(),
    onToggleSelectAll: vi.fn(), onToggleSelect: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onView: vi.fn(),
    ...overrides,
  };
}
function rows() { return Array.from(screen.getByRole('table').querySelectorAll<HTMLTableRowElement>('tbody tr')); }

describe('Words table visual hierarchy', () => {
  it('defines distinct ordinary, alternating, hover and header surfaces with dark overrides', () => {
    render(<WordTable {...props()} />);
    expect(screen.getByRole('table').parentElement!.parentElement).toHaveClass('bg-white', 'shadow-sm', 'dark:shadow-2xl');
    expect(screen.getByRole('table').querySelector('thead')).toHaveClass('bg-slate-100', 'dark:bg-gradient-to-r');
    for (const row of rows()) {
      expect(row).toHaveClass('odd:bg-white', 'even:bg-slate-50', 'hover:bg-blue-50', 'border-slate-200', 'dark:bg-transparent', 'dark:hover:bg-gray-800/60');
      expect(row).toHaveAttribute('aria-selected', 'false');
      expect(row).not.toHaveClass('bg-blue-100');
    }
    expect(screen.getByText('went')).toBeInTheDocument();
    expect(screen.getByText('gone')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('მოსავლიანობა')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('Verb')).toHaveClass('!text-gray-950', 'dark:text-gray-950');
    expect(rows()[0].querySelector('.text-xs')).toHaveClass('text-slate-600', 'dark:text-gray-400');
  });

  it('highlights the entire selected row by record ID through reordering and replacement', () => {
    const selectedIds = new Set(['sense-b']);
    const view = render(<WordTable {...props({ selectedIds })} />);
    function assertSelection(index: number) {
      rows().forEach((row, i) => {
        expect(row).toHaveAttribute('aria-selected', String(i === index));
        if (i === index) {
          expect(row).toHaveClass('bg-blue-100', 'hover:bg-blue-200');
          expect(row).not.toHaveClass('even:bg-slate-50', 'odd:bg-white');
          expect(within(row).getByRole('button', { name: 'Deselect yield' })).toHaveAttribute('aria-pressed', 'true');
        } else expect(row).not.toHaveClass('bg-blue-100');
      });
    }
    assertSelection(1);
    view.rerender(<WordTable {...props({ words: [words[1], words[2], words[0]], selectedIds })} />);
    assertSelection(0);
    view.rerender(<WordTable {...props({ words: [words[2]], selectedIds })} />);
    assertSelection(-1); // Selection does not move to an unrelated replacement row.
    view.rerender(<WordTable {...props({ words: [words[1]], selectedIds })} />);
    assertSelection(0);
  });

  it('supports keyboard selection, full-page selection and deselection without opening details', async () => {
    const onView = vi.fn();
    function SelectionTable() {
      const [selectedIds, setSelectedIds] = useState(new Set<string>());
      const allSelected = selectedIds.size === words.length;
      return <WordTable {...props({ selectedIds, allSelected, onView,
        onToggleSelect: id => setSelectedIds(previous => {
          const next = new Set(previous);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        }),
        onToggleSelectAll: () => setSelectedIds(allSelected ? new Set() : new Set(words.map(item => item.id))),
      })} />;
    }
    render(<SelectionTable />);
    const user = userEvent.setup();
    const select = within(rows()[0]).getByRole('button', { name: 'Select yield' });
    expect(select).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-blue-600');
    select.focus();
    await user.keyboard('{Enter}');
    expect(rows()[0]).toHaveAttribute('aria-selected', 'true');
    expect(rows()[1]).toHaveAttribute('aria-selected', 'false');
    await user.click(screen.getByRole('button', { name: 'Select all words on this page' }));
    expect(rows().every(row => row.getAttribute('aria-selected') === 'true')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Deselect all words on this page' }));
    expect(rows().every(row => row.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(onView).not.toHaveBeenCalled();
  });

  it('keeps row details and Select/Edit/Delete actions independent, with exact record identity', async () => {
    const callbacks = props();
    render(<WordTable {...callbacks} />);
    const row = rows()[1];
    fireEvent.click(row);
    expect(callbacks.onView).toHaveBeenCalledExactlyOnceWith(words[1]);
    for (const name of ['Select yield', 'Edit', 'Delete']) {
      const button = within(row).getByRole('button', { name });
      expect(button).toHaveClass('focus-visible:ring-2');
      await userEvent.click(button);
    }
    expect(callbacks.onToggleSelect).toHaveBeenCalledExactlyOnceWith('sense-b');
    expect(callbacks.onEdit).toHaveBeenCalledExactlyOnceWith(words[1]);
    expect(callbacks.onDelete).toHaveBeenCalledExactlyOnceWith(words[1]);
    expect(callbacks.onView).toHaveBeenCalledOnce();
  });

  it.each(['loading', 'empty', 'error'] as const)('preserves the %s state without stale selectable rows', state => {
    const callbacks = props({ loading: state === 'loading', words: state === 'empty' ? [] : words,
      readError: state === 'error' ? 'Unable to load your words. Please try again.' : null,
      selectedIds: new Set(['sense-b']),
    });
    render(<WordTable {...callbacks} />);
    expect(screen.getByRole('button', { name: 'Select all words on this page' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Deselect yield' })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).not.toHaveClass('bg-blue-100');
    if (state === 'loading') expect(screen.getByText('Loading words...')).toBeInTheDocument();
    if (state === 'empty') expect(screen.getByText('No words yet')).toBeInTheDocument();
    if (state === 'error') {
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your words.');
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(callbacks.onRetry).toHaveBeenCalledOnce();
    }
  });

  it('preserves highlighting and toolbar actions through real sorting, searching and pagination', async () => {
    const vocabulary = Array.from({ length: 12 }, (_, i) => word({
      id: `entry-${i}`, english_word: `entry ${String(i).padStart(2, '0')}`,
    }));
    function ordered(desc = false, term = '') {
      return vocabulary.filter(item => item.user_id === 'user-a' && item.english_word.includes(term))
        .sort((a, b) => (desc ? -1 : 1) * a.english_word.localeCompare(b.english_word));
    }
    supabaseMock.from.mockImplementation(table => {
      expect(table).toBe('words');
      let desc = false;
      const chain = query();
      chain.eq.mockImplementation((key, id) => { expect([key, id]).toEqual(['user_id', 'user-a']); return chain; });
      chain.order.mockImplementation((_key, options) => { desc = !options.ascending; return chain; });
      chain.range.mockImplementation((start, end) => query({ data: ordered(desc).slice(start, end + 1), count: 12, error: null }));
      return chain;
    });
    supabaseMock.rpc.mockImplementation((name, args) => {
      expect(args.p_user_id).toBe('user-a');
      const matches = ordered(args.p_sort === 'alpha-desc', args.p_term);
      return Promise.resolve({ data: name === 'search_words_count' ? matches.length : matches.slice(args.p_offset, args.p_offset + args.p_limit), error: null });
    });
    render(<WordManagement />);
    await screen.findByText('Entry 02');
    const search = screen.getByPlaceholderText('Search English or Georgian words...');
    expect(search).toHaveClass('bg-white', 'dark:bg-gray-800/70', 'focus:ring-2');
    expect(search).not.toHaveClass('backdrop-blur-sm', 'dark:backdrop-blur-sm');
    expect(screen.getByRole('button', { name: '10 per page' })).toHaveClass('min-w-0', 'sm:min-w-[11rem]');
    fireEvent.click(screen.getByRole('button', { name: 'Select entry 02' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alphabetical (A → Z)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alphabetical (Z → A)' }));
    await screen.findByText('Entry 11');
    expect(screen.getByText('Entry 02').closest('tr')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Entry 11').closest('tr')).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 of 2');
    expect(rows().every(row => row.getAttribute('aria-selected') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select all words on this page' }));
    expect(rows().every(row => row.getAttribute('aria-selected') === 'true')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(rows().every(row => row.getAttribute('aria-selected') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select entry 00' }));
    vi.useFakeTimers();
    fireEvent.change(search, { target: { value: 'entry 02' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Entry 02').closest('tr')).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Select entry 02' }));
    expect(rows()[0]).toHaveClass('bg-blue-100');
    expect(screen.getByText('1 selected (this page)')).toBeInTheDocument();
    expect(screen.getByText('1 selected (this page)').parentElement).toHaveClass('min-h-12');
    expect(screen.getByText('1 selected (this page)').parentElement).not.toHaveClass('h-12');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await screen.findByText('Entry 11');
    expect(rows().every(row => row.getAttribute('aria-selected') === 'false')).toBe(true);
  });
});
