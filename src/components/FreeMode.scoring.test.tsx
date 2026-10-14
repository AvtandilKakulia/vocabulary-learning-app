import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

// Test-only React 18 adapter: exercise the actual captured callback, bypassing
// disabled DOM controls and rerenders, without adding an application test API.
function clickHandler(element: HTMLElement): () => void {
  const key = Object.keys(element).find(name => name.startsWith('__reactProps$'));
  if (!key) throw new Error('Expected a React-managed button');
  return (Reflect.get(element, key) as { onClick: () => void }).onClick;
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
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

  it('keeps feedback visible after a real double-click on Check Answer', async () => {
    await start();
    fill('wrong');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Check Answer' }));
    expect(stored()).toMatchObject({ queueIds: ['a', 'b'], totalAttempts: 1, correctCount: 0, hasChecked: true });
    expect(screen.getByRole('textbox')).toHaveValue('wrong');
    expect(screen.getByRole('textbox')).toHaveClass('border-red-500');
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
    expect(stored()).toEqual({ ...submitted, hasChecked: false, queueIds: allowReguess ? ['b', 'a'] : ['b'] });
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
    const bWord = word({ id: 'b-private', user_id: 'user-b', english_word: 'B word', georgian_definitions: ['B meaning'] });
    seed([bWord], { userId: 'user-b' });
    supabaseMock.from.mockImplementation(() => query({ data: authMock.user?.id === 'user-a' ? vocabulary : [bWord], error: null }));
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(stored('user-b')).toMatchObject({ totalAttempts: 0, hasChecked: false });
    fill('B meaning');
    await check();
    act(() => aSubmit());
    expect(stored('user-b')).toMatchObject({ totalAttempts: 1, correctCount: 1, mistakes: [] });
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(aCopy);
    const bCopy = localStorage.getItem(practiceSessionKey('user-b'));
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><FreeMode /></StrictMode>);
    await screen.findByRole('textbox');
    expect(stored()).toMatchObject({ queueIds: ['b', 'a'], totalAttempts: 1, correctCount: 0, unresolvedWordIds: ['a'] });
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
