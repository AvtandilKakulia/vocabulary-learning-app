import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { persistActiveTest, readTestRecovery, type ActiveTestSession } from '@/lib/activeTestSessions';
import TestMode from './TestMode';

function mountTest(direction: ActiveTestSession['direction'] = 'geo-to-en', inputType: ActiveTestSession['inputType'] = 'multiple') {
  const saveResponse = deferred<QueryResult>();
  const save = query(saveResponse.promise);
  supabaseMock.from.mockImplementation(table => {
    if (table === 'test_history') return save;
    throw new Error(`Unexpected vocabulary refetch: ${table}`);
  });
  const labels = direction === 'geo-to-en' ? ['cat', 'dog', 'bird'] : ['კატა', 'ძაღლი', 'ჩიტი'];
  const snapshot: ActiveTestSession = {
    id: crypto.randomUUID(), userId: 'user-a', startedAt: new Date().toISOString(),
    direction, inputType, wordCount: 0, customCount: '3', currentQuestion: 0, draftAnswer: '',
    questions: ['cat', 'dog', 'bird'].map((english_word, i) => ({
      id: english_word, english_word, georgian_definitions: ['კატა', 'ძაღლი', 'ჩიტი'].slice(i, i + 1),
      description: null, userAnswer: '', isCorrect: false, options: inputType === 'multiple' ? [...labels] : [],
    })),
  };
  expect(persistActiveTest(snapshot)).toBe(true);
  return { ...render(<React.StrictMode><TestMode /></React.StrictMode>), snapshot, labels, save, saveResponse };
}

function active() { return readTestRecovery('user-a').sessions[0]; }
function next() { return screen.getByRole('button', { name: /^(Next Question|Finish Test)$/ }); }
function enterDown(element: HTMLElement, repeat = false) { return fireEvent.keyDown(element, { key: 'Enter', code: 'Enter', repeat }); }
function releaseEnter(element: HTMLElement | Window = window) { fireEvent.keyUp(element, { key: 'Enter', code: 'Enter' }); }
function select(label: string) {
  const radio = screen.getByRole('radio', { name: label });
  fireEvent.click(radio);
  return radio;
}

describe('TestMode answer keyboard navigation', () => {
  it('does not submit an unselected choice, including stale clicks on the disabled action', () => {
    const { snapshot, save } = mountTest();
    enterDown(screen.getAllByRole('radio')[0]);
    fireEvent.click(next());
    expect(active()).toEqual(snapshot);
    expect(next()).toBeDisabled();
    expect(save.insert).not.toHaveBeenCalled();
  });

  it.each(['geo-to-en', 'en-to-geo'] as const)('scores each selected answer exactly once in %s and saves the original result ID', async direction => {
    const { labels, snapshot, save, saveResponse } = mountTest(direction);
    enterDown(select(labels[0]));
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(active()).toMatchObject({ currentQuestion: 1, draftAnswer: '' });
    expect(active().questions[0]).toMatchObject({ userAnswer: labels[0], isCorrect: true });
    releaseEnter();
    enterDown(select(labels[0])); // Deliberately wrong for question 2.
    expect(active().questions[1]).toMatchObject({ userAnswer: labels[0], isCorrect: false });
    releaseEnter();
    const finalRadio = select(labels[2]);
    act(() => { enterDown(finalRadio); enterDown(finalRadio, true); fireEvent.click(finalRadio); });
    expect(screen.getByText('Test Results')).toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: snapshot.id, user_id: 'user-a', test_direction: direction, total_words: 3, correct_count: 2,
      mistakes: [expect.objectContaining({ english_word: 'dog', user_answer: labels[0], correct_definitions: [labels[1]] })],
    }));
    await act(async () => saveResponse.resolve({ error: null }));
    expect(screen.getByText('Result saved to History successfully.')).toBeInTheDocument();
    expect(readTestRecovery('user-a').sessions).toEqual([]);
    expect(readTestRecovery('user-a').results).toEqual([]);
    expect(save.insert).toHaveBeenCalledOnce();
  });

  it.each(['multiple', 'text'] as const)('blocks repeated/duplicate keydowns across commits for %s until key release', inputType => {
    mountTest('geo-to-en', inputType);
    function answer(value: string) {
      if (inputType === 'multiple') return select(value);
      const input = screen.getByPlaceholderText('Type your answer...');
      fireEvent.change(input, { target: { value } });
      return input;
    }
    const first = answer('cat');
    const button = next();
    act(() => { enterDown(first); enterDown(first); fireEvent.click(button); });
    expect(active().currentQuestion).toBe(1);
    const second = answer('dog');
    expect(enterDown(second, true)).toBe(false);
    expect(enterDown(second)).toBe(false); // Even a duplicate with repeat=false.
    expect(active()).toMatchObject({ currentQuestion: 1, draftAnswer: 'dog' });
    expect(active().questions[1].userAnswer).toBe('');
    releaseEnter(window); // Release can target somewhere other than the original input.
    enterDown(second);
    expect(active().currentQuestion).toBe(2);
    expect(active().questions.slice(0, 2).map(question => question.isCorrect)).toEqual([true, true]);
  });

  it('does not consume composition confirmation as a typed answer submission', () => {
    mountTest('geo-to-en', 'text');
    const input = screen.getByPlaceholderText('Type your answer...');
    fireEvent.change(input, { target: { value: 'cat' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(active()).toMatchObject({ currentQuestion: 0, draftAnswer: 'cat' });
    releaseEnter();
    enterDown(input);
    expect(active().currentQuestion).toBe(1);
  });

  it('retains native Space, arrow and Tab navigation without automatically submitting', async () => {
    mountTest();
    const keyboard = userEvent.setup();
    screen.getByRole('radio', { name: 'cat' }).focus();
    await keyboard.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'cat' })).toBeChecked();
    await keyboard.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'dog' })).toBeChecked();
    expect(active()).toMatchObject({ currentQuestion: 0, draftAnswer: 'dog' });
    await keyboard.tab();
    expect(next()).toHaveFocus();
    await keyboard.tab({ shift: true });
    expect(screen.getByRole('radio', { name: 'dog' })).toHaveFocus();
    await keyboard.keyboard('{Enter}');
    expect(active().currentQuestion).toBe(1);
    expect(screen.getByRole('radio', { name: 'dog' })).toHaveFocus();
    expect(screen.getAllByRole('radio').every(radio => !(radio as HTMLInputElement).checked)).toBe(true);
  });

  it.each(['mouse', 'Enter', 'Space'] as const)('keeps native %s submit-button activation, including Finish Test', async method => {
    const { save } = mountTest();
    const user = userEvent.setup();
    for (const label of ['cat', 'dog', 'bird']) {
      select(label);
      if (method === 'mouse') await user.click(next());
      else {
        next().focus();
        await user.keyboard(method === 'Enter' ? '{Enter}' : ' ');
      }
    }
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ correct_count: 3 }));
  });

  it('blocks held Enter native button activation even after a new answer is selected', async () => {
    mountTest();
    const user = userEvent.setup();
    select('cat');
    next().focus();
    await user.keyboard('{Enter>}');
    expect(active().currentQuestion).toBe(1);
    select('dog');
    next().focus();
    // A second user.keyboard descriptor releases an already-held key first.
    // Dispatch actual repeats instead and verify native activation is cancelled.
    expect(enterDown(next(), true)).toBe(false);
    expect(enterDown(next())).toBe(false);
    expect(active()).toMatchObject({ currentQuestion: 1, draftAnswer: 'dog' });
    await user.keyboard('{/Enter}{Enter}');
    expect(active().currentQuestion).toBe(2);
  });

  it('keeps restart dialog Enter scoped to its actions and retains the answer on Cancel', async () => {
    const { save } = mountTest();
    const user = userEvent.setup();
    select('cat');
    screen.getByRole('button', { name: 'Restart Test' }).focus();
    await user.keyboard('{Enter}');
    const snapshot = active();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    enterDown(screen.getByRole('radio', { name: 'cat' }));
    expect(active()).toEqual(snapshot);
    expect(next()).toBeDisabled();
    await user.keyboard('{Enter}'); // The dialog's auto-focused Cancel button.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(active()).toEqual(snapshot);
    await user.click(screen.getByRole('button', { name: 'Restart Test' }));
    screen.getByRole('button', { name: 'Discard progress' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(save.insert).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'reload'] as const)('restores the exact question/options and selected draft after %s, without refetching', method => {
    const view = mountTest();
    enterDown(select('cat'));
    releaseEnter();
    select('dog');
    const snapshot = active();
    if (method === 'navigation') {
      view.rerender(<p>Words</p>);
      view.rerender(<React.StrictMode><TestMode /></React.StrictMode>);
    } else {
      view.unmount();
      render(<React.StrictMode><TestMode /></React.StrictMode>);
    }
    expect(active()).toEqual(snapshot);
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'dog' })).toBeChecked();
    expect(screen.getAllByRole('radio').map(radio => (radio as HTMLInputElement).value)).toEqual(snapshot.questions[1].options);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    enterDown(screen.getByRole('radio', { name: 'dog' }));
    expect(active().currentQuestion).toBe(2);
  });

  it('does not transfer a held key or answer into a different account under StrictMode', () => {
    const view = mountTest();
    const b = { ...view.snapshot, id: crypto.randomUUID(), userId: 'user-b', draftAnswer: 'dog' };
    persistActiveTest(b);
    enterDown(select('cat'));
    const a = active();
    authMock.user = { id: 'user-b' };
    view.rerender(<React.StrictMode><TestMode /></React.StrictMode>);
    enterDown(screen.getByRole('radio', { name: 'dog' }), true);
    expect(readTestRecovery('user-b').sessions[0]).toEqual(b);
    releaseEnter();
    enterDown(screen.getByRole('radio', { name: 'dog' }));
    expect(readTestRecovery('user-b').sessions[0].currentQuestion).toBe(1);
    expect(active()).toEqual(a);
    expect(view.save.insert).not.toHaveBeenCalled();
  });
});
