import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, query, supabaseMock } from '../test/mocks';
import { word } from '../test/fixtures';
import type { Word } from '../lib/supabase';
import { practiceSessionKey, type StoredPracticeSession } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

const vocabulary = [
  word({ id: 'a', english_word: 'apple', georgian_definitions: ['ვაშლი', 'ვაშლის ნაყოფი'] }),
  word({ id: 'b', english_word: 'pear', georgian_definitions: ['მსხალი'] }),
];
const stored = (userId = 'user-a'): StoredPracticeSession => JSON.parse(localStorage.getItem(practiceSessionKey(userId))!);
function seed(words = vocabulary, overrides: Partial<StoredPracticeSession> = {}) {
  const session: StoredPracticeSession = {
    userId: 'user-a', queueIds: words.map(item => item.id), direction: 'en-to-geo', orderMode: 'db-order',
    allowReguess: false, correctCount: 0, totalAttempts: 0, mistakes: [], attemptedWordIds: [],
    unresolvedWordIds: [], hasChecked: false, ...overrides,
  };
  localStorage.setItem(practiceSessionKey(session.userId), JSON.stringify(session));
}
async function start(options: { words?: Word[]; session?: Partial<StoredPracticeSession> } = {}) {
  const words = options.words ?? vocabulary;
  seed(words, options.session);
  const save = query();
  supabaseMock.from.mockImplementation(table => {
    if (table === 'words') return query({ data: words, error: null });
    if (table === 'test_history') return save;
    throw new Error(`Unexpected table: ${table}`);
  });
  const view = render(<StrictMode><FreeMode /></StrictMode>);
  await screen.findAllByRole('textbox');
  return { ...view, save };
}
function fill(...values: string[]) {
  const inputs = screen.getAllByRole('textbox');
  values.forEach((value, index) => fireEvent.change(inputs[index], { target: { value } }));
}
const check = () => userEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
const next = () => userEvent.click(screen.getByRole('button', { name: /^(Next Word|Finish Practice)$/ }));

function expectProgress(correct: number, attempts: number) {
  const counter = screen.getByText('/').parentElement!;
  expect(Array.from(counter.children, item => item.textContent).join(' ')).toBe(`${correct} / ${attempts}`);
}

// Test-only React 18 adapter: exercise the actual captured callback, bypassing
// disabled DOM controls and rerenders, without adding an application test API.
function clickHandler(element: HTMLElement): () => void {
  const key = Object.keys(element).find(name => name.startsWith('__reactProps$'));
  if (!key) throw new Error('Expected a React-managed button');
  return (Reflect.get(element, key) as { onClick: () => void }).onClick;
}

// jsdom does not perform native button activation for fireEvent.keyDown. Model
// that default explicitly: only an uncancelled Enter keydown may dispatch click.
// A real-browser check is still required for platform-specific event ordering.
function enterWithButtonDefault(button: HTMLElement, repeat = false) {
  const allowed = fireEvent.keyDown(button, { key: 'Enter', repeat, cancelable: true });
  if (allowed) fireEvent.click(button, { detail: 0 });
  return allowed;
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

describe('Practice progress counter presentation', () => {
  it('initially displays 0 / 0', async () => {
    await start();
    expectProgress(0, 0);
  });

  it.each([
    { answer: 'wrong', correct: 0 },
    { answer: 'ვაშლი', correct: 1 },
  ])('displays $correct / 1 consistently after one attempt', async ({ answer, correct }) => {
    await start();
    fill(answer);
    await check();
    expectProgress(correct, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(screen.getByRole('heading', { name: 'Finish Practice' })).toBeInTheDocument();
    expect(screen.getByText(`${correct}/1 correct (${correct * 100}%)`)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Finish' }).at(-1)!);
    await screen.findByRole('heading', { name: 'Practice Summary' });
    expect(screen.getByText(`${correct}/1 correct (${correct * 100}%)`)).toBeInTheDocument();
    expectProgress(correct, 1);
  });
});

describe('Practice manual Reset availability', () => {
  it('keeps an untouched session disabled for mouse, keyboard and captured callbacks', async () => {
    await start();
    const reset = screen.getByRole('button', { name: 'Reset Progress' });
    expectProgress(0, 0);
    expect(reset).toBeDisabled();
    const user = userEvent.setup();
    await user.click(reset);
    screen.getByText('Allow re-guessing wrong answers').parentElement!.querySelector('button')!.focus();
    await user.tab();
    expect(screen.getByRole('textbox')).toHaveFocus();
    reset.focus();
    expect(reset).not.toHaveFocus();
    fireEvent.keyDown(reset, { key: 'Enter' });
    fireEvent.keyDown(reset, { key: ' ' });
    act(() => clickHandler(reset)());
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    expectProgress(0, 0);
  });

  it('does not enable Reset or erase an unchecked draft', async () => {
    await start();
    fill('unfinished answer');
    const reset = screen.getByRole('button', { name: 'Reset Progress' });
    const before = stored();
    expect(reset).toBeDisabled();
    await userEvent.click(reset);
    act(() => clickHandler(reset)());
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('unfinished answer');
    expect(stored()).toEqual(before);
  });

  it('stays disabled after order, direction and retry preference changes without scoring', async () => {
    await start();
    for (const name of ['Random', 'In database order', 'Georgian → English', 'English → Georgian']) {
      await userEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeDisabled();
      expectProgress(0, 0);
    }
    for (let i = 0; i < 2; i++) {
      await userEvent.click(screen.getByText('Allow re-guessing wrong answers').parentElement!.querySelector('button')!);
      expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeDisabled();
      expectProgress(0, 0);
    }
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    expect(stored()).toMatchObject({ totalAttempts: 0, correctCount: 0, mistakes: [] });
  });

  it.each([
    { answer: 'wrong', correct: 0 }, { answer: 'ვაშლი', correct: 1 },
  ])('enables Reset after a checked answer ($correct / 1)', async ({ answer, correct }) => {
    await start();
    fill(answer);
    await check();
    expectProgress(correct, 1);
    const reset = screen.getByRole('button', { name: 'Reset Progress' });
    expect(reset).toBeEnabled();
    await userEvent.click(reset);
    expect(screen.getByRole('heading', { name: 'Reset Progress' })).toBeInTheDocument();
  });

  it.each(['wrong', 'ვაშლი'])('enables Reset after restoring scored progress (%s)', async answer => {
    const view = await start();
    fill(answer);
    await check();
    const before = stored();
    view.unmount();
    render(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored()).toEqual({ ...before, hasChecked: false, queueIds: ['b'] }));
    expectProgress(before.correctCount, 1);
    expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeEnabled();
  });

  it('disables Reset after confirmation and rejects stale open/confirm callbacks before and after commit', async () => {
    await start();
    fill('wrong');
    await check();
    const reset = screen.getByRole('button', { name: 'Reset Progress' });
    const openReset = clickHandler(reset);
    await userEvent.click(reset);
    const confirmReset = clickHandler(screen.getAllByRole('button', { name: 'Reset Progress' }).at(-1)!);
    act(() => { confirmReset(); openReset(); confirmReset(); });
    expectProgress(0, 0);
    expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    expect(stored()).toMatchObject({ totalAttempts: 0, correctCount: 0, mistakes: [], queueIds: ['a', 'b'] });
    fill('new unchecked draft');
    const before = stored();
    act(() => { openReset(); confirmReset(); });
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('new unchecked draft');
    expect(stored()).toEqual(before);
  });

  it('still cleans up after History saving and leaves another account untouched', async () => {
    seed(vocabulary, { userId: 'user-b' });
    const bCopy = localStorage.getItem(practiceSessionKey('user-b'));
    const { save } = await start();
    fill('ვაშლი');
    await check();
    const openReset = clickHandler(screen.getByRole('button', { name: 'Reset Progress' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Finish' }).at(-1)!);
    await userEvent.click(await screen.findByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ user_id: 'user-a', total_words: 1, correct_count: 1 }));
    expectProgress(0, 0);
    expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
    act(() => openReset());
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bCopy);
  });
});

describe('Practice scores each question presentation once', () => {
  it.each([false, true])('cannot reopen a wrong answer by editing it (re-guessing: %s)', async allowReguess => {
    await start({ session: { allowReguess } });
    fill('wrong');
    await check();
    const submitted = stored();
    fill('ვაშლი');
    const reopened = screen.queryByRole('button', { name: 'Check Answer' });
    if (reopened) await userEvent.click(reopened);
    expect(stored()).toEqual(submitted);
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 0, unresolvedWordIds: ['a'],
      mistakes: [expect.objectContaining({ word_id: 'a', user_answer: 'wrong' })] });
    expect(screen.getByRole('textbox')).toHaveValue('wrong');
    expect(screen.getByRole('textbox')).toHaveClass('border-red-500');
    expect(screen.getByRole('button', { name: 'Next Word' })).toBeEnabled();
  });

  it('scores rapid duplicate Check events only once before React commits', async () => {
    await start();
    fill('ვაშლი');
    const button = screen.getByRole('button', { name: 'Check Answer' });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 1, mistakes: [], hasChecked: true });
    expect(screen.getByRole('textbox')).toHaveValue('ვაშლი');
  });

  it('allows two rapid mouse clicks to check then advance without scoring the next question', async () => {
    await start();
    fill('wrong');
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole('button', { name: 'Check Answer' }));
    // Retarget the current button like browser hit-testing; do not click a stale
    // detached Check node after React has rendered Next.
    await user.click(screen.getByRole('button', { name: 'Next Word' }));
    expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, correctCount: 0, hasChecked: false });
    expect(stored().mistakes).toHaveLength(1);
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Check Answer' })).toBeDisabled();
  });

  it.each([
    { direction: 'en-to-geo', irregular: false, correct: false },
    { direction: 'en-to-geo', irregular: false, correct: true },
    { direction: 'geo-to-en', irregular: false, correct: false },
    { direction: 'geo-to-en', irregular: false, correct: true },
    { direction: 'geo-to-en', irregular: true, correct: false },
    { direction: 'geo-to-en', irregular: true, correct: true },
  ] as const)('cancels held Enter after focus transfer ($direction, irregular: $irregular, correct: $correct)', async ({ direction, irregular, correct }) => {
    const current = irregular ? word({ id: 'a', english_word: 'go', is_irregular_verb: true,
      past_simple: 'went', past_participle: 'gone' }) : vocabulary[0];
    await start({ words: [current, vocabulary[1]], session: { direction } });
    const values = irregular ? ['go', 'went', correct ? 'gone' : 'wrong']
      : [correct ? direction === 'en-to-geo' ? 'ვაშლი' : 'apple' : 'wrong'];
    fill(...values);
    screen.getAllByRole('textbox').at(-1)!.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter>}');
    const nextButton = screen.getByRole('button', { name: 'Next Word' });
    await waitFor(() => expect(nextButton).toHaveFocus());
    const submitted = stored();
    expect(submitted).toMatchObject({ totalAttempts: 1, correctCount: Number(correct), hasChecked: true });
    for (let i = 0; i < 3; i++) expect(enterWithButtonDefault(nextButton, true)).toBe(false);
    // The physical-press latch also protects a duplicate event without repeat set.
    expect(enterWithButtonDefault(nextButton)).toBe(false);
    expect(stored()).toEqual(submitted);
    expect(screen.getAllByRole('textbox').map(input => (input as HTMLInputElement).value)).toEqual(values);
    expect(screen.getAllByRole('textbox').at(-1)).toHaveClass(correct ? 'border-green-500' : 'border-red-500');
    await user.keyboard('{/Enter}');
    await user.keyboard('{Enter>}');
    expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, correctCount: Number(correct), hasChecked: false });
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', repeat: true })).toBe(false);
    expect(stored().totalAttempts).toBe(1);
    await user.keyboard('{/Enter}');
  });

  it('protects focus transfer when the original Enter activates Check as a native button', async () => {
    await start();
    fill('wrong');
    screen.getByRole('button', { name: 'Check Answer' }).focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter>}');
    const nextButton = screen.getByRole('button', { name: 'Next Word' });
    await waitFor(() => expect(nextButton).toHaveFocus());
    const submitted = stored();
    expect(enterWithButtonDefault(nextButton, true)).toBe(false);
    expect(stored()).toEqual(submitted);
    // Keyup outside Practice must still release the latch.
    fireEvent.keyUp(document.body, { key: 'Enter' });
    expect(enterWithButtonDefault(nextButton)).toBe(true);
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, hasChecked: false });
  });

  it('keeps explicit mouse Next working while Enter is held', async () => {
    await start();
    fill('wrong');
    screen.getByRole('textbox').focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter>}');
    await user.click(screen.getByRole('button', { name: 'Next Word' }));
    expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, hasChecked: false });
    fill('მსხალი');
    expect(fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', repeat: true })).toBe(false);
    expect(stored().totalAttempts).toBe(1);
    await user.keyboard('{/Enter}');
    screen.getByRole('textbox').focus();
    await user.keyboard('{Enter}');
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1 });
  });

  it('clears the held-key latch on window blur without accepting auto-repeat on return', async () => {
    await start();
    fill('wrong');
    screen.getByRole('textbox').focus();
    await userEvent.keyboard('{Enter>}');
    const nextButton = screen.getByRole('button', { name: 'Next Word' });
    await waitFor(() => expect(nextButton).toHaveFocus());
    fireEvent.blur(window);
    expect(enterWithButtonDefault(nextButton, true)).toBe(false);
    // Simulate release while away (no keyup delivered), then a fresh press.
    expect(enterWithButtonDefault(nextButton)).toBe(true);
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, hasChecked: false });
  });

  it('handles fast release/fresh press without a stale focus timer blurring the next answer', async () => {
    await start();
    fill('wrong');
    vi.useFakeTimers();
    try {
      const input = screen.getByRole('textbox');
      input.focus();
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyUp(input, { key: 'Enter' });
      // Advance before the 0ms focus transfer from Check has executed.
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyUp(input, { key: 'Enter' });
      expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, hasChecked: false });
      const nextInput = screen.getByRole('textbox');
      nextInput.focus();
      fireEvent.change(nextInput, { target: { value: 'მსხალი' } });
      act(() => vi.runOnlyPendingTimers());
      expect(nextInput).toHaveFocus();
      fireEvent.keyDown(nextInput, { key: 'Enter' });
      fireEvent.keyUp(nextInput, { key: 'Enter' });
      expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1 });
      act(() => vi.runOnlyPendingTimers());
    } finally { vi.useRealTimers(); }
  });

  it.each(['navigation', 'reload', 'account'] as const)('ignores a still-held Enter after %s, then accepts a fresh press', async restore => {
    const view = await start({ session: { allowReguess: true } });
    fill('wrong');
    screen.getByRole('textbox').focus();
    await userEvent.keyboard('{Enter>}');
    const aCopy = localStorage.getItem(practiceSessionKey('user-a'));
    if (restore === 'account') {
      const bWord = word({ id: 'b-private', user_id: 'user-b', georgian_definitions: ['B meaning'] });
      seed([bWord], { userId: 'user-b' });
      supabaseMock.from.mockReturnValue(query({ data: [bWord], error: null }));
      authMock.user = { id: 'user-b' };
      view.rerender(<StrictMode><FreeMode /></StrictMode>);
    } else if (restore === 'navigation') {
      view.rerender(<div>Words</div>);
      view.rerender(<StrictMode><FreeMode /></StrictMode>);
    } else {
      view.unmount();
      render(<StrictMode><FreeMode /></StrictMode>);
    }
    const input = await screen.findByRole('textbox');
    const userId = restore === 'account' ? 'user-b' : 'user-a';
    // Capture the restored checkpoint after persistence, so its asynchronous
    // Next transition cannot be mistaken for a response to the held Enter.
    await waitFor(() => expect(stored(userId)).toMatchObject(restore === 'account'
      ? { userId, queueIds: ['b-private'], hasChecked: false, totalAttempts: 0, correctCount: 0, mistakes: [] }
      : { ...JSON.parse(aCopy!), queueIds: ['b', 'a'], hasChecked: false }));
    const before = stored(userId);
    fill(restore === 'account' ? 'B meaning' : 'მსხალი');
    input.focus();
    expect(fireEvent.keyDown(input, { key: 'Enter', repeat: true })).toBe(false);
    expect(stored(userId)).toEqual(before);
    fireEvent.keyUp(window, { key: 'Enter' });
    await userEvent.keyboard('{Enter}');
    expect(stored(userId)).toMatchObject({ totalAttempts: restore === 'account' ? 1 : 2, correctCount: 1 });
    if (restore === 'account') expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
    else expect(stored().unresolvedWordIds).toEqual(['a']);
  });

  it('does not let a held Finish press activate Close & Save after focus moves to the summary', async () => {
    const { save } = await start({ words: [vocabulary[0]] });
    fill('ვაშლი');
    await check();
    const finish = screen.getByRole('button', { name: 'Finish Practice' });
    finish.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter>}');
    await screen.findByRole('heading', { name: 'Practice Summary' });
    const close = screen.getByRole('button', { name: 'Close & Save' });
    // The animation frame is stubbed in these tests; focus its target explicitly.
    close.focus();
    expect(enterWithButtonDefault(close, true)).toBe(false);
    expect(save.insert).not.toHaveBeenCalled();
    await user.keyboard('{/Enter}');
    await user.keyboard('{Enter}');
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ total_words: 1, correct_count: 1, mistakes: [] }));
  });

  it('preserves five attempts/four correct when a wrong word returns after three other records', async () => {
    const words = [...vocabulary,
      word({ id: 'c', english_word: 'third', georgian_definitions: ['third meaning'] }),
      word({ id: 'd', english_word: 'fourth', georgian_definitions: ['fourth meaning'] })];
    const { save } = await start({ words, session: { allowReguess: true } });
    for (const [index, answer] of ['wrong', 'მსხალი', 'third meaning', 'fourth meaning', 'ვაშლი'].entries()) {
      fill(answer);
      await check();
      expectProgress(index, index + 1);
      expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeEnabled();
      await next();
    }
    await screen.findByRole('heading', { name: 'Practice Summary' });
    expectProgress(4, 5);
    expect(screen.getByText('4/5 correct (80%)')).toBeInTheDocument();
    expect(stored()).toMatchObject({ totalAttempts: 5, correctCount: 4, unresolvedWordIds: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ total_words: 5, correct_count: 4,
      mistakes: [expect.objectContaining({ english_word: 'apple', user_answer: 'wrong' })] }));
  });

  it.each(['en-to-geo', 'geo-to-en'] as const)('locks a correct answer in %s and independently scores another meaning', async direction => {
    const meanings = vocabulary.map(item => ({ ...item, english_word: 'yield' }));
    await start({ words: meanings, session: { direction } });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'unfinished');
    await user.clear(screen.getByRole('textbox'));
    const correct = direction === 'en-to-geo' ? 'ვაშლი' : 'yield';
    await user.type(screen.getByRole('textbox'), correct);
    const submit = clickHandler(screen.getByRole('button', { name: 'Check Answer' }));
    await check();
    const submitted = stored();
    await user.type(screen.getByRole('textbox'), 'changed');
    fill('wrong'); // A programmatic change must be guarded too.
    act(() => { submit(); submit(); });
    expect(stored()).toEqual(submitted);
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 1, mistakes: [], unresolvedWordIds: [] });
    expect(screen.getByRole('textbox')).toHaveValue(correct);
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true);
    expect(screen.getByRole('textbox')).toHaveClass('border-green-500');
    await next();
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', false);
    fill(direction === 'en-to-geo' ? 'მსხალი' : 'yield');
    await check();
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 2, attemptedWordIds: ['a', 'b'] });
  });

  it('rejects duplicate and stale callbacks but scores a legitimate same-ID retry and saves exact History counts', async () => {
    const { save } = await start({ words: [vocabulary[0]], session: { allowReguess: true } });
    fill('wrong');
    const firstSubmit = clickHandler(screen.getByRole('button', { name: 'Check Answer' }));
    act(() => { firstSubmit(); firstSubmit(); firstSubmit(); });
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 0, unresolvedWordIds: ['a'] });
    expect(stored().mistakes).toHaveLength(1);
    const advance = clickHandler(screen.getByRole('button', { name: 'Finish Practice' }));
    act(() => { advance(); advance(); firstSubmit(); });
    expect(stored()).toMatchObject({ queueIds: ['a'], totalAttempts: 1, hasChecked: false });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', false);
    fill('ვაშლი');
    const retrySubmit = clickHandler(screen.getByRole('button', { name: 'Check Answer' }));
    act(() => { firstSubmit(); retrySubmit(); firstSubmit(); retrySubmit(); });
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1, unresolvedWordIds: [],
      mistakes: [expect.objectContaining({ user_answer: 'wrong' })] });
    await next();
    await screen.findByRole('heading', { name: 'Practice Summary' });
    await userEvent.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      user_id: 'user-a', total_words: 2, correct_count: 1, test_direction: 'en-to-geo',
      mistakes: [{ english_word: 'apple', question_prompt: 'apple', user_answer: 'wrong',
        correct_definitions: ['ვაშლი', 'ვაშლის ნაყოფი'] }],
    }));
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
    // Save completion starts another presentation/session, even for the same ID.
    fill('ვაშლი');
    await check();
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Close & Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledTimes(2);
    expect(save.insert.mock.calls[1][0]).toMatchObject({ total_words: 1, correct_count: 1, mistakes: [] });
    expect(save.insert.mock.calls[1][0].id).not.toBe(save.insert.mock.calls[0][0].id);
  });

  it.each(['click', 'Enter'] as const)('scores Enter followed immediately by %s once and keeps keyboard Next available', async duplicate => {
    await start();
    fill('wrong');
    const input = screen.getByRole('textbox');
    const button = screen.getByRole('button', { name: 'Check Answer' });
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      if (duplicate === 'click') fireEvent.click(button);
      else fireEvent.keyDown(input, { key: 'Enter' });
    });
    const submitted = stored();
    expect(submitted).toMatchObject({ queueIds: ['a', 'b'], totalAttempts: 1, correctCount: 0, hasChecked: true });
    expect(submitted.mistakes).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter', repeat: true });
    expect(stored()).toEqual(submitted);
    fireEvent.keyUp(input, { key: 'Enter' });
    input.focus();
    await userEvent.keyboard('{Enter}');
    expect(stored()).toMatchObject({ queueIds: ['b'], totalAttempts: 1, hasChecked: false });
    fill('მსხალი');
    screen.getByRole('textbox').focus();
    await userEvent.keyboard('{Enter}');
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1, hasChecked: true });
  });

  it('allows editing/adding/removing before Check and guards every input mutation after it', async () => {
    await start();
    fill('unfinished');
    fill('ვაშლი');
    await userEvent.click(screen.getByRole('button', { name: 'Add another answer' }));
    fill('ვაშლი', 'ვაშლის ნაყოფი');
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer' }));
    expect(screen.getByRole('textbox')).toHaveValue('ვაშლის ნაყოფი');
    await userEvent.click(screen.getByRole('button', { name: 'Add another answer' }));
    fill('ვაშლის ნაყოფი', 'ვაშლი');
    expect(stored()).toMatchObject({ totalAttempts: 0, mistakes: [], hasChecked: false });
    const add = clickHandler(screen.getByRole('button', { name: 'Add another answer' }));
    const remove = clickHandler(screen.getByRole('button', { name: 'Remove answer' }));
    const submit = clickHandler(screen.getByRole('button', { name: 'Check Answer' }));
    act(() => { submit(); add(); remove(); submit(); });
    const submitted = stored();
    expect(screen.getByRole('button', { name: 'Add another answer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove answer' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Add another answer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove answer' }));
    act(() => { add(); remove(); submit(); });
    fill('changed', 'changed');
    expect(screen.getAllByRole('textbox').map(input => (input as HTMLInputElement).value)).toEqual(['ვაშლის ნაყოფი', 'ვაშლი']);
    screen.getAllByRole('textbox').forEach(input => {
      expect(input).toHaveProperty('readOnly', true);
      expect(input).toHaveClass('border-green-500');
    });
    expect(stored()).toEqual(submitted);
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 1, mistakes: [] });
    await next();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add another answer' })).toBeEnabled();
  });

  it('locks all three irregular forms, then permits a new three-input attempt for the same word', async () => {
    const irregular = word({ id: 'go', english_word: 'go', georgian_definitions: ['წასვლა'],
      is_irregular_verb: true, past_simple: 'went', past_participle: 'gone' });
    await start({ words: [irregular], session: { direction: 'geo-to-en', allowReguess: true } });
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    fill('unfinished', 'unfinished', 'unfinished');
    fill('go', 'went', 'wrong');
    await check();
    const submitted = stored();
    fill('go', 'went', 'gone');
    expect(screen.getAllByRole('textbox').map(input => (input as HTMLInputElement).value)).toEqual(['go', 'went', 'wrong']);
    screen.getAllByRole('textbox').forEach(input => expect(input).toHaveProperty('readOnly', true));
    expect(screen.getAllByRole('textbox')[2]).toHaveClass('border-red-500');
    expect(stored()).toEqual(submitted);
    await next();
    expect(screen.getAllByRole('textbox')).toHaveLength(3);
    screen.getAllByRole('textbox').forEach(input => {
      expect(input).toHaveValue('');
      expect(input).toHaveProperty('readOnly', false);
    });
    fill('go', 'went', 'gone');
    await check();
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1, unresolvedWordIds: [],
      mistakes: [expect.objectContaining({ user_answer: 'go, went, wrong', correct_definitions: ['go', 'went', 'gone'] })] });
  });

  it('advances a checked question exactly once on a direction change without rescoring', async () => {
    await start({ session: { allowReguess: true } });
    fill('wrong');
    await check();
    const changeDirection = clickHandler(screen.getByRole('button', { name: 'Georgian → English' }));
    act(() => { changeDirection(); changeDirection(); });
    expect(stored()).toMatchObject({ queueIds: ['b', 'a'], totalAttempts: 1, correctCount: 0, hasChecked: false,
      direction: 'geo-to-en', unresolvedWordIds: ['a'] });
    expect(screen.getByRole('textbox')).toHaveValue('');
    fill('pear');
    await check();
    const submitted = stored();
    await userEvent.click(screen.getByRole('button', { name: 'Georgian → English' }));
    expect(stored()).toEqual(submitted);
    expect(screen.getByRole('textbox')).toHaveValue('pear');
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', true);
  });

  it.each([
    { restore: 'reload', allowReguess: false }, { restore: 'reload', allowReguess: true },
    { restore: 'navigation', allowReguess: false }, { restore: 'navigation', allowReguess: true },
  ])('restores a checked question after $restore (re-guessing: $allowReguess) without recounting it', async ({ restore, allowReguess }) => {
    let view = await start({ session: { allowReguess } });
    fill('wrong');
    await check();
    const submitted = stored();
    if (restore === 'reload') {
      view.unmount();
      view = { ...view, ...render(<StrictMode><FreeMode /></StrictMode>) };
    } else {
      view.rerender(<div>Words</div>);
      view.rerender(<StrictMode><FreeMode /></StrictMode>);
    }
    await screen.findByRole('textbox');
    await waitFor(() => expect(stored()).toEqual({ ...submitted, hasChecked: false, queueIds: allowReguess ? ['b', 'a'] : ['b'] }));
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', false);
    fill('მსხალი');
    await check();
    await next();
    if (allowReguess) {
      fill('ვაშლი');
      await check();
      await next();
    }
    await screen.findByRole('heading', { name: 'Practice Summary' });
    expect(stored()).toMatchObject({ totalAttempts: allowReguess ? 3 : 2, correctCount: allowReguess ? 2 : 1 });
    expect(stored().mistakes).toEqual(submitted.mistakes);
  });

  it('isolates the synchronous guard and checked progress across accounts under StrictMode', async () => {
    const view = await start({ session: { allowReguess: true } });
    fill('wrong');
    const aSubmit = clickHandler(screen.getByRole('button', { name: 'Check Answer' }));
    await check();
    const aCopy = localStorage.getItem(practiceSessionKey('user-a'));
    const aReset = clickHandler(screen.getByRole('button', { name: 'Reset Progress' }));
    const bWord = word({ id: 'b-private', user_id: 'user-b', english_word: 'B word', georgian_definitions: ['B meaning'] });
    seed([bWord], { userId: 'user-b' });
    supabaseMock.from.mockImplementation(() => query({ data: authMock.user?.id === 'user-a' ? vocabulary : [bWord], error: null }));
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(stored('user-b')).toMatchObject({ totalAttempts: 0, hasChecked: false });
    expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeDisabled();
    act(() => aReset());
    expect(screen.queryByRole('heading', { name: 'Reset Progress' })).not.toBeInTheDocument();
    fill('B meaning');
    await check();
    act(() => aSubmit());
    expect(stored('user-b')).toMatchObject({ totalAttempts: 1, correctCount: 1, mistakes: [] });
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
    const bCopy = localStorage.getItem(practiceSessionKey('user-b'));
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(screen.getByText('pear')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', false);
    // The restored UI can commit before vocabulary reconciliation allows the
    // persistence effect to write its checkpoint. Wait for that observable write.
    await waitFor(() => expect(stored()).toEqual({ ...JSON.parse(aCopy!), queueIds: ['b', 'a'], hasChecked: false }));
    expect(screen.getByRole('button', { name: 'Reset Progress' })).toBeEnabled();
    fill('მსხალი');
    await check();
    expect(stored()).toMatchObject({ totalAttempts: 2, correctCount: 1 });
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe(bCopy);
  });

  it('starts a fresh presentation on an intentional reset', async () => {
    await start();
    fill('wrong');
    await check();
    await userEvent.click(screen.getByRole('button', { name: 'Reset Progress' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Reset Progress' }).at(-1)!);
    expect(stored()).toMatchObject({ queueIds: ['a', 'b'], totalAttempts: 0, hasChecked: false });
    expect(screen.getByRole('textbox')).toHaveProperty('readOnly', false);
    fill('ვაშლი');
    await check();
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 1, mistakes: [] });
  });

  it('does not consume a presentation when an empty submission is rejected', async () => {
    await start();
    const emptySubmit = clickHandler(screen.getByRole('button', { name: 'Check Answer' }));
    act(() => { emptySubmit(); emptySubmit(); });
    expect(stored()).toMatchObject({ totalAttempts: 0, hasChecked: false });
    fill('ვაშლი');
    await check();
    expect(stored()).toMatchObject({ totalAttempts: 1, correctCount: 1 });
  });
});
