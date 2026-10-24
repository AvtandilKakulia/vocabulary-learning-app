import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { query, supabaseMock } from '@/test/mocks';
import { historyRecord, word } from '@/test/fixtures';
import { readTestRecovery } from '@/lib/activeTestSessions';
import { practiceSessionKey } from '@/lib/practiceSessions';
import FreeMode from './FreeMode';
import TestMode from './TestMode';
import History from './History';
import WordTable from './words/WordTable';
import ViewWordModal from './words/modals/ViewWordModal';

const description = 'Example <span data-study-mask="true"><strong>hidden phrase</strong></span> and <span data-study-mask="true" style="color: #abcdef">საიდუმლო</span>.';
const vocabulary = [word({ id: 'cat', english_word: 'cat', georgian_definitions: ['კატა'], description }),
  word({ id: 'dog', english_word: 'dog', georgian_definitions: ['ძაღლი'], description })];
function expectMasked(container: HTMLElement) {
  expect(container.innerHTML).not.toContain('hidden phrase');
  expect(container.innerHTML).not.toContain('საიდუმლო');
  const markers = container.querySelectorAll('[data-study-mask]');
  expect(markers).toHaveLength(2);
  markers.forEach(element => expect(element.innerHTML).toBe('*****'));
}
function expectOriginal(container: HTMLElement) {
  expect(container).toHaveTextContent('hidden phrase');
  expect(container).toHaveTextContent('საიდუმლო');
  expect(container.querySelector('[data-study-mask] strong')).toHaveTextContent('hidden phrase');
  expect(container).not.toHaveTextContent('*****');
}

describe('Description presentation boundaries', () => {
  it.each(['en-to-geo', 'geo-to-en'] as const)('masks Practice %s through checking, retry and recovery without changing words or mistakes', async direction => {
    supabaseMock.from.mockReturnValue(query({ data: vocabulary, error: null }));
    localStorage.setItem(practiceSessionKey('user-a'), JSON.stringify({ userId: 'user-a', direction,
      queueIds: ['cat', 'dog'], orderMode: 'db-order', allowReguess: true }));
    const view = render(<StrictMode><FreeMode /></StrictMode>);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'wrong' } });
    expectMasked(view.container);
    await userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
    expectMasked(view.container);
    const saved = JSON.parse(localStorage.getItem(practiceSessionKey('user-a'))!);
    expect(saved).toMatchObject({ totalAttempts: 1, correctCount: 0, unresolvedWordIds: ['cat'],
      mistakes: [expect.objectContaining({ word_id: 'cat', english_word: 'cat', user_answer: 'wrong' })] });
    await userEvent.click(screen.getByRole('button', { name: 'Next Word' }));
    expectMasked(view.container);
    view.unmount();
    const restored = render(<FreeMode />);
    await screen.findByRole('textbox');
    expectMasked(restored.container);
    expect(vocabulary[0].description).toBe(description);
    expect(JSON.parse(localStorage.getItem(practiceSessionKey('user-a'))!).mistakes).toEqual(saved.mistakes);
  });

  it.each([
    ['en-to-geo', 'text'], ['geo-to-en', 'text'], ['en-to-geo', 'multiple'], ['geo-to-en', 'multiple'],
  ] as const)('masks active Test %s/%s and restored sessions, then shows full Results and saves original snapshots', async (direction, inputType) => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const save = query();
    const load = query({ data: vocabulary, error: null });
    supabaseMock.from.mockImplementation(table => table === 'words' ? load : save);
    const view = render(<StrictMode><TestMode /></StrictMode>);
    await userEvent.click(screen.getByRole('button', { name: direction === 'en-to-geo' ? 'English → Georgian' : 'Georgian → English' }));
    fireEvent.change(screen.getByPlaceholderText('Custom'), { target: { value: '1' } });
    await userEvent.click(screen.getByRole('button', { name: inputType === 'text' ? 'Text Input' : 'Multiple Choice' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start Test' }));
    await screen.findByText('Question 1 of 1');
    expectMasked(view.container);
    const original = readTestRecovery('user-a').sessions[0];
    expect(original.questions[0].description).toBe(description);
    view.unmount();
    supabaseMock.from.mockClear();
    const restored = render(<StrictMode><TestMode /></StrictMode>);
    expectMasked(restored.container);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(readTestRecovery('user-a').sessions[0]).toEqual(original);
    if (inputType === 'text') fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'wrong' } });
    else await userEvent.click(screen.getByRole('radio', { name: direction === 'en-to-geo' ? 'ძაღლი' : 'dog' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish Test' }));
    await screen.findByText('Result saved to History successfully.');
    expectOriginal(restored.container);
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: original.id, correct_count: 0,
      mistakes: [expect.objectContaining({ description })] }));
  });

  it('shows original formatted content in the Words table and details modal', () => {
    const view = render(<WordTable words={[vocabulary[0]]} loading={false} readError={null} onRetry={vi.fn()}
      allSelected={false} selectedIds={new Set()} onToggleSelectAll={vi.fn()} onToggleSelect={vi.fn()}
      onEdit={vi.fn()} onDelete={vi.fn()} onView={vi.fn()} />);
    expectOriginal(view.container);
    view.unmount();
    render(<ViewWordModal word={vocabulary[0]} onClose={vi.fn()} />);
    expectOriginal(document.body);
  });

  it('shows the original saved description in expanded History', async () => {
    supabaseMock.from.mockReturnValue(query({ data: [historyRecord({ mistakes: [{ english_word: 'cat',
      user_answer: 'wrong', correct_definitions: ['კატა'], description }] })], error: null }));
    const view = render(<History />);
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Show mistakes' }));
    expectOriginal(view.container);
  });
});
