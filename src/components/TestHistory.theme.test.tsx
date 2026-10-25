import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { query, supabaseMock } from '@/test/mocks';
import { historyRecord } from '@/test/fixtures';
import { persistActiveTest } from '@/lib/activeTestSessions';
import { persistPendingTest } from '@/lib/pendingTestResults';
import TestMode from './TestMode';
import History from './History';

const id = '10000000-0000-4000-8000-000000000001';
function restore(inputType: 'text' | 'multiple' = 'text') {
  expect(persistActiveTest({ id, userId: 'user-a', startedAt: '2026-01-01T00:00:00Z',
    direction: 'geo-to-en', inputType, wordCount: 0, customCount: '1', currentQuestion: 0, draftAnswer: '',
    questions: [{ id: 'cat', english_word: 'cat', georgian_definitions: ['კატა'], description: '<strong>Context</strong>',
      userAnswer: '', isCorrect: false, options: inputType === 'multiple' ? ['cat', 'dog'] : [] }] })).toBe(true);
  return render(<TestMode />);
}
function panel(element: HTMLElement) {
  const surface = element.closest('.bg-white');
  expect(surface).toHaveClass('dark:bg-gray-800');
  return surface!;
}

describe('Test and History theme presentation', () => {
  it('increments/decrements Custom without nonpositive counts or a new maximum', async () => {
    render(<TestMode />);
    const user = userEvent.setup();
    const input = screen.getByRole('spinbutton', { name: 'Custom word count' });
    const up = screen.getByRole('button', { name: 'Increase custom word count' });
    const down = screen.getByRole('button', { name: 'Decrease custom word count' });
    expect(up).toHaveAttribute('type', 'button');
    expect(down).toHaveAttribute('type', 'button');
    await user.click(up);
    expect(input).toHaveValue(1);
    expect(screen.getByRole('button', { name: /^10$/ })).not.toHaveClass('bg-blue-600');
    await user.click(down);
    expect(input).toHaveValue(1);
    await user.clear(input);
    await user.type(input, '12');
    expect(fireEvent.keyDown(input, { key: 'ArrowUp' })).toBe(true);
    await user.click(up);
    expect(input).toHaveValue(13);
    await user.click(down);
    expect(input).toHaveValue(12);
    await user.click(screen.getByRole('button', { name: '20' }));
    await user.click(down);
    expect(input).toHaveValue(1);
    fireEvent.change(input, { target: { value: '1001' } });
    up.focus();
    await user.keyboard('{Enter}');
    expect(input).toHaveValue(1002);
    expect(input).not.toHaveAttribute('max');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('styles setup headings, inactive choices and custom input for both themes', () => {
    render(<TestMode />);
    expect(screen.getByRole('heading', { name: 'Test Mode' })).toHaveClass('text-gray-900', 'dark:text-gray-100');
    const choice = screen.getByRole('button', { name: 'English → Georgian' });
    panel(choice);
    expect(choice).toHaveClass('text-gray-700', 'dark:text-gray-200', 'dark:border-gray-500', 'dark:hover:bg-gray-700', 'focus-visible:ring-2');
    expect(screen.getByPlaceholderText('Custom')).toHaveClass('bg-white', 'dark:bg-gray-900', 'dark:text-gray-100', 'dark:placeholder:text-gray-400');
    const count = screen.getByRole('spinbutton');
    expect(count).toHaveAttribute('type', 'number');
    expect(count).toHaveClass('[appearance:textfield]', '[&::-webkit-inner-spin-button]:appearance-none', '[&::-webkit-outer-spin-button]:appearance-none', 'focus-visible:ring-2');
    fireEvent.change(count, { target: { value: '12' } });
    expect(count).toHaveValue(12);
  });

  it('styles active question, unchanged rich description, text input and restart confirmation', () => {
    restore();
    expect(screen.getByText('კატა')).toHaveClass('text-gray-900', 'dark:text-gray-100');
    expect(screen.getByText('Context').tagName).toBe('STRONG');
    expect(screen.getByText('Context').parentElement?.parentElement).toHaveClass('dark:text-gray-300');
    const input = screen.getByPlaceholderText('Type your answer...');
    panel(input.parentElement!);
    expect(input).toHaveClass('dark:bg-gray-900', 'dark:text-gray-100');
    fireEvent.click(screen.getByRole('button', { name: 'Restart Test' }));
    const dialog = screen.getByRole('alertdialog');
    panel(within(dialog).getByText('Abandon this unfinished test?'));
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveClass('dark:border-gray-500', 'dark:hover:bg-gray-700', 'focus-visible:ring-2');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel.parentElement).toHaveClass('flex', 'flex-col', 'gap-3', 'sm:flex-row');
    expect(within(dialog).getByRole('button', { name: 'Discard progress' }).parentElement).toBe(cancel.parentElement);
    expect(input).toBeDisabled();
  });

  it('keeps multiple-choice option hover, borders and keyboard focus visible', () => {
    restore('multiple');
    const radio = screen.getByRole('radio', { name: 'cat' });
    expect(radio).toHaveClass('focus-visible:ring-2');
    expect(radio.closest('label')).toHaveClass('dark:border-gray-600', 'dark:hover:bg-gray-700');
  });

  it('styles recovered results, retry status, mistakes and discard confirmation', () => {
    expect(persistPendingTest(historyRecord({ id, mistakes: [{ english_word: 'cat', user_answer: 'dog', correct_definitions: ['კატა'] }] }))).toBe(true);
    render(<TestMode />);
    expect(screen.getByRole('heading', { name: 'Test Results' })).toHaveClass('dark:text-gray-100');
    panel(screen.getByText('50%'));
    expect(screen.getByRole('status')).toHaveClass('dark:bg-amber-950', 'dark:text-amber-100');
    expect(screen.getByRole('button', { name: 'Retry Save' })).toHaveClass('dark:bg-blue-300', 'dark:text-blue-950');
    expect(screen.getByText('cat').closest('.border')).toHaveClass('bg-red-50', 'dark:bg-red-950');
    fireEvent.click(screen.getByRole('button', { name: 'Take Another Test' }));
    panel(within(screen.getByRole('alertdialog')).getByText('Discard this completed test?'));
  });

  it('styles History filters, statistics, records, expanded details and deletion dialogs', async () => {
    supabaseMock.from.mockReturnValue(query({ data: [historyRecord({ mistakes: [
      { english_word: 'cat', description: '<strong>Saved context</strong>', user_answer: 'dog', correct_definitions: ['კატა'] },
    ] })], error: null }));
    const { container } = render(<History />);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    expect(container.querySelectorAll('select.history-filter-select')).toHaveLength(4);
    for (const field of screen.getAllByRole('combobox').slice(0, 4)) {
      expect(field).toHaveClass('bg-white', 'text-gray-900', 'dark:bg-gray-900', 'dark:text-gray-100', 'dark:[color-scheme:dark]', 'focus-visible:ring-2');
      expect(field).toHaveClass('appearance-none', 'pr-12');
      expect(field).toHaveClass('history-filter-select');
      expect(field.parentElement).toHaveClass('relative');
      const indicator = field.parentElement!.querySelector('svg');
      expect(indicator).toHaveAttribute('aria-hidden', 'true');
      expect(indicator).toHaveAttribute('focusable', 'false');
      expect(indicator).toHaveClass('pointer-events-none', 'right-4', 'dark:text-gray-300');
    }
    expect(screen.getByText('Total Tests')).toHaveClass('dark:text-blue-400');
    const row = container.querySelector('[data-history-id]')!;
    expect(row).toHaveClass('dark:text-gray-100', 'dark:border-gray-700', 'dark:hover:bg-gray-700');
    fireEvent.click(screen.getByRole('button', { name: 'Show mistakes' }));
    const mistake = screen.getByText('cat').closest('.border');
    expect(mistake).toHaveClass('bg-slate-100', 'border-slate-300', 'break-words', 'dark:bg-gray-900', 'dark:border-red-900/60');
    expect(mistake).not.toHaveClass('dark:bg-red-950');
    expect(screen.getByText('Saved context').tagName).toBe('STRONG');
    expect(screen.getByText('Your answer:')).toHaveClass('font-bold', 'text-red-700', 'dark:text-red-300');
    expect(screen.getByText('Correct:')).toHaveClass('font-bold', 'text-green-700', 'dark:text-green-300');
    for (const value of [screen.getByText('dog'), screen.getByText('კატა')]) {
      expect(value).toHaveClass('font-semibold', 'text-gray-900', 'dark:text-gray-100');
      expect(value).not.toHaveClass('font-bold');
      for (const color of ['text-red-700', 'dark:text-red-300', 'text-green-700', 'dark:text-green-300']) {
        expect(value).not.toHaveClass(color);
        expect(value.parentElement).not.toHaveClass(color);
      }
    }
    fireEvent.click(screen.getByRole('button', { name: /^Delete record from/ }));
    panel(screen.getByRole('heading', { name: 'Delete Test Record' }));
    expect(screen.getByRole('button', { name: /^Delete$/ })).toHaveClass('bg-red-700', 'text-white');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: /^Select All/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected (1)' }));
    panel(within(screen.getByRole('alertdialog')).getByRole('heading'));
    expect(screen.getByText(/You are about to delete/).parentElement).toHaveClass('dark:bg-red-950');
  });
});
