import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import { activeTestKey, persistActiveTest, readTestRecovery, type ActiveTestSession } from '@/lib/activeTestSessions';
import { pendingTestKey, type CompletedTestResult } from '@/lib/pendingTestResults';
import TestMode from './TestMode';

const vocabulary = [
  word({ id: 'cat', english_word: 'cat', georgian_definitions: ['კატა'] }),
  word({ id: 'dog', english_word: 'dog', georgian_definitions: ['ძაღლი'] }),
  word({ id: 'bird', english_word: 'bird', georgian_definitions: ['ჩიტი'] }),
  word({ id: 'extra', english_word: 'fish', georgian_definitions: ['თევზი'] }),
];

beforeEach(() => { vi.spyOn(Math, 'random').mockReturnValue(0.999999); });

async function start(options: { input?: 'text' | 'multiple'; count?: number; direction?: 'en-to-geo' | 'geo-to-en'; save?: ReturnType<typeof query> } = {}) {
  const save = options.save ?? query();
  const load = query({ data: vocabulary, error: null });
  supabaseMock.from.mockImplementation(table => {
    if (table === 'words') return load;
    if (table === 'test_history') return save;
    throw new Error(`Unexpected table ${table}`);
  });
  const view = render(<React.StrictMode><TestMode /></React.StrictMode>);
  await userEvent.click(screen.getByRole('button', { name: options.direction === 'en-to-geo' ? 'English → Georgian' : 'Georgian → English' }));
  await userEvent.type(screen.getByPlaceholderText('Custom'), String(options.count ?? 3));
  await userEvent.click(screen.getByRole('button', { name: options.input === 'multiple' ? 'Multiple Choice' : 'Text Input' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Test' }));
  await screen.findByText(`Question 1 of ${options.count ?? 3}`);
  return { ...view, save, load };
}

function active() { return readTestRecovery('user-a').sessions[0]; }
function options() { return screen.getAllByRole('radio').map(radio => (radio as HTMLInputElement).value); }
async function answer(value: string) {
  fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value } });
  await userEvent.click(screen.getByRole('button', { name: /^(Next Question|Finish Test)$/ }));
}
async function restart() {
  await userEvent.click(screen.getByRole('button', { name: 'Restart Test' }));
  await userEvent.click(screen.getByRole('button', { name: 'Discard progress' }));
}

describe('TestMode active recovery', () => {
  it.each(['navigation', 'remount'] as const)('persists zero answers immediately and restores exact settings/questions after %s', async method => {
    const view = await start({ input: 'multiple', direction: 'en-to-geo' });
    const original = active();
    const originalOptions = options();
    expect(original.currentQuestion).toBe(0);
    expect(original.questions.map(question => question.id)).toEqual(['cat', 'dog', 'bird']);
    expect(original.questions.every(question => question.userAnswer === '' && !question.isCorrect)).toBe(true);
    expect(original).toMatchObject({ userId: 'user-a', direction: 'en-to-geo', inputType: 'multiple', wordCount: 0, customCount: '3' });
    expect(Object.keys(original.questions[0]).sort()).toEqual(['description', 'english_word', 'georgian_definitions', 'id', 'isCorrect', 'options', 'userAnswer']);
    expect(JSON.stringify(original)).not.toContain('past_participle');
    supabaseMock.from.mockClear();
    vi.mocked(Math.random).mockReturnValue(0);
    if (method === 'navigation') {
      view.rerender(<div>Words tab</div>);
      view.rerender(<React.StrictMode><TestMode /></React.StrictMode>);
    } else {
      view.unmount();
      render(<React.StrictMode><TestMode /></React.StrictMode>);
    }
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
    expect(screen.getByText('cat')).toBeInTheDocument();
    expect(options()).toEqual(originalOptions);
    expect(active()).toEqual(original);
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(view.save.insert).not.toHaveBeenCalled();
  });

  it.each([['cat', true], ['wrong', false]] as const)('restores a submitted answer %s and finishes with unchanged scoring', async (first, correct) => {
    const view = await start();
    const id = active().id;
    await answer(first);
    expect(active().questions[0]).toMatchObject({ userAnswer: first, isCorrect: correct });
    view.rerender(<div>History tab</div>);
    view.rerender(<TestMode />);
    expect(screen.getByText('Question 2 of 3')).toBeInTheDocument();
    await answer('dog');
    view.unmount();
    render(<TestMode />);
    expect(screen.getByText('Question 3 of 3')).toBeInTheDocument();
    expect(screen.getByText('ჩიტი')).toBeInTheDocument();
    await answer('bird');
    await screen.findByText('Result saved to History');
    expect(view.save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id, total_words: 3, correct_count: correct ? 3 : 2 }));
    expect(localStorage.getItem(activeTestKey('user-a', id))).toBeNull();
    expect(localStorage.getItem(pendingTestKey({ user_id: 'user-a', id }))).toBeNull();
  });

  it('restores an unsubmitted text draft synchronously without submitting it', async () => {
    const view = await start();
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: '  ca' } });
    const snapshot = active();
    view.unmount();
    render(<TestMode />);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('  ca');
    expect(active()).toEqual(snapshot);
    expect(active().questions[0].userAnswer).toBe('');
    expect(view.save.insert).not.toHaveBeenCalled();
  });

  it('restores selected Multiple Choice answers and all future option ordering without regenerating', async () => {
    const view = await start({ input: 'multiple' });
    const original = active();
    await userEvent.click(screen.getByRole('radio', { name: 'cat' }));
    view.unmount();
    vi.mocked(Math.random).mockReturnValue(0);
    render(<TestMode />);
    expect(screen.getByRole('radio', { name: 'cat' })).toBeChecked();
    expect(options()).toEqual(original.questions[0].options);
    expect(active().currentQuestion).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: 'Next Question' }));
    expect(options()).toEqual(original.questions[1].options);
    expect(active().questions[0].isCorrect).toBe(true);
    expect(view.load.select).toHaveBeenCalledOnce();
    expect(view.save.insert).not.toHaveBeenCalled();
  });

  it('isolates account sessions, preserves Cancel, and discards only the current session', async () => {
    const view = await start();
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'draft A' } });
    const a = active();
    const b: ActiveTestSession = { ...a, userId: 'user-b', draftAnswer: 'draft B' };
    persistActiveTest(b);
    authMock.user = { id: 'user-b' };
    view.rerender(<TestMode />);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('draft B');
    await userEvent.click(screen.getByRole('button', { name: 'Restart Test' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('progress will be lost');
    expect(screen.getByRole('button', { name: 'Next Question' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(readTestRecovery('user-b').sessions[0]).toEqual(b);
    await restart();
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(readTestRecovery('user-b').sessions).toEqual([]);
    expect(active()).toEqual(a);
    authMock.user = null;
    view.rerender(<TestMode />);
    expect(screen.queryByText('Test in Progress')).not.toBeInTheDocument();
    authMock.user = { id: 'user-a' };
    view.rerender(<TestMode />);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('draft A');
  });

  it('can intentionally restart a never-persisted session while storage remains blocked', async () => {
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Blocked'); });
    try {
      const view = await start();
      expect(screen.getByRole('alert')).toHaveTextContent('Navigation or refresh may lose');
      await restart();
      expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
      expect(view.save.insert).not.toHaveBeenCalled();
    } finally { blocked.mockRestore(); }
  });

  it('retains a known active copy when later writes and intentional removal are blocked', async () => {
    await start();
    const original = active();
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('Blocked'); });
    try {
      fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'latest' } });
      await restart();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('Progress has been kept');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('latest');
    } finally { blocked.mockRestore(); }
    expect(active()).toEqual(original);
    await restart();
    expect(readTestRecovery('user-a').sessions).toEqual([]);
  });

  it.each(['invalid JSON', 'version', 'wrong account', 'index', 'question', 'options', 'direction'])('ignores %s active data without deleting or replaying it', async corruption => {
    const view = await start({ input: 'multiple' });
    const session = active();
    const key = activeTestKey(session.userId, session.id);
    view.unmount();
    const bad = { version: 1, phase: 'active', session: structuredClone(session) };
    if (corruption === 'version') bad.version = 20;
    if (corruption === 'wrong account') bad.session.userId = 'user-b';
    if (corruption === 'index') bad.session.currentQuestion = 99;
    if (corruption === 'question') (bad.session.questions as unknown[]) = [null];
    if (corruption === 'options') bad.session.questions[0].options = [];
    if (corruption === 'direction') (bad.session as unknown as { direction: unknown }).direction = ['geo-to-en'];
    const raw = corruption === 'invalid JSON' ? '{broken' : JSON.stringify(bad);
    localStorage.setItem(key, raw);
    supabaseMock.from.mockClear();
    render(<TestMode />);
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('could not be restored');
    expect(localStorage.getItem(key)).toBe(raw);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('does not write on unchanged renders or duplicate input events', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const view = await start();
    expect(write).toHaveBeenCalledOnce();
    view.rerender(<React.StrictMode><TestMode /></React.StrictMode>);
    expect(write).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'ca' } });
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'ca' } });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('ignores a late vocabulary response after navigation instead of creating a hidden session', async () => {
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValue(query(pending.promise));
    const view = render(<TestMode />);
    await userEvent.click(screen.getByRole('button', { name: 'Start Test' }));
    view.unmount();
    await act(async () => { pending.resolve({ data: vocabulary, error: null }); });
    expect(readTestRecovery('user-a').sessions).toEqual([]);
  });

  it('keeps configuration and scoring consistent if settings change during the initial request', async () => {
    const pending = deferred<QueryResult>();
    const load = query(pending.promise);
    const save = query();
    supabaseMock.from.mockImplementation(table => table === 'words' ? load : save);
    render(<TestMode />);
    await userEvent.type(screen.getByPlaceholderText('Custom'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Text Input' }));
    const startButton = screen.getByRole('button', { name: 'Start Test' });
    act(() => { fireEvent.click(startButton); fireEvent.click(startButton); });
    await userEvent.click(screen.getByRole('button', { name: 'English → Georgian' }));
    await userEvent.click(screen.getByRole('button', { name: 'Multiple Choice' }));
    await act(async () => { pending.resolve({ data: vocabulary, error: null }); });
    expect(active()).toMatchObject({ direction: 'geo-to-en', inputType: 'text', customCount: '1' });
    expect(load.select).toHaveBeenCalledOnce();
    await answer('cat');
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ test_direction: 'geo-to-en', correct_count: 1 }));
  });

  it('resumes another active session after saving the current test without overwriting it', async () => {
    await start({ count: 1 });
    const first = active();
    const second: ActiveTestSession = { ...first, id: '523502e1-45e0-4b10-9237-252e9a08a017', draftAnswer: 'unfinished second' };
    persistActiveTest(second);
    await answer('cat');
    await screen.findByText('Result saved to History');
    await userEvent.click(screen.getByRole('button', { name: 'Take Another Test' }));
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('unfinished second');
    expect(active()).toEqual(second);
    expect(localStorage.getItem(activeTestKey(first.userId, first.id))).toBeNull();
  });
});

describe('active-to-completed TestMode handoff', () => {
  it.each(['pending', 'checkpoint'])('only confirms completed-result discard after both copies can be removed (%s)', async phase => {
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await start({ count: 1, save: query({ error: failure }) });
    const id = active().id;
    const setItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (phase === 'checkpoint' && key.startsWith('vocab_pending_test:')) throw new Error('Quota');
      setItem.call(this, key, value);
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    await answer('cat');
    await screen.findByText('Failed to save result');
    await userEvent.click(screen.getByRole('button', { name: 'Take Another Test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard result' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('result has been kept');
    expect(readTestRecovery('user-a').results).toHaveLength(1);
    expect(localStorage.getItem(activeTestKey('user-a', id))).not.toBeNull();
    remove.mockRestore();
    write.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Discard result' }));
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(localStorage.getItem(activeTestKey('user-a', id))).toBeNull();
    expect(readTestRecovery('user-a').results).toEqual([]);
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
  });

  it('persists the original completed payload before sending History and suppresses a stale active copy', async () => {
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    const view = await start({ count: 1, save });
    const original = active();
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Blocked'); });
    save.insert.mockImplementation((result: CompletedTestResult) => {
      expect(JSON.parse(localStorage.getItem(pendingTestKey(result))!).result).toEqual(result);
      expect(result.id).toBe(original.id);
      return pending.promise;
    });
    await answer('cat');
    expect(readTestRecovery('user-a').sessions).toEqual([]);
    expect(readTestRecovery('user-a').results).toHaveLength(1);
    view.unmount();
    const remount = render(<TestMode />);
    expect(screen.getByText('1 out of 1 correct')).toBeInTheDocument();
    expect(screen.queryByText('Test in Progress')).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ error: null }); });
    // Late success cannot remove the guard while stale active cleanup still fails.
    expect(readTestRecovery('user-a').results).toHaveLength(1);
    remove.mockRestore();
    const result = save.insert.mock.calls[0][0];
    save.insert.mockResolvedValueOnce({ error: { code: '23505', message: 'Already committed' } });
    save.select.mockReturnValue(query({ data: [result], error: null }));
    const retry = screen.getByRole('button', { name: 'Retry Save' });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledTimes(2);
    expect(save.insert).toHaveBeenLastCalledWith(result);
    remount.unmount();
    render(<TestMode />);
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
  });

  it('uses a compact completed checkpoint if allocating the pending key fails, and restores only the result', async () => {
    const failure = { message: 'Offline' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const save = query({ error: failure });
    const view = await start({ count: 1, save });
    const original = active();
    const setItem = Storage.prototype.setItem;
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key.startsWith('vocab_pending_test:')) throw new Error('Quota');
      setItem.call(this, key, value);
    });
    await answer('cat');
    await screen.findByText('Failed to save result');
    const result = save.insert.mock.calls[0][0];
    expect(JSON.parse(localStorage.getItem(activeTestKey('user-a', original.id))!)).toEqual({ version: 1, phase: 'completed', result });
    view.unmount();
    render(<TestMode />);
    expect(screen.getByText('1 out of 1 correct')).toBeInTheDocument();
    expect(screen.queryByText('Test in Progress')).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledOnce();
    write.mockRestore();
    save.insert.mockResolvedValueOnce({ error: null });
    await userEvent.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenLastCalledWith(result);
    expect(localStorage.getItem(activeTestKey('user-a', original.id))).toBeNull();
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
  });

  it('keeps the last active snapshot and delays History when every completion write fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await start({ count: 1 });
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'cat' } });
    const original = active();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    await userEvent.click(screen.getByRole('button', { name: 'Finish Test' }));
    await screen.findByText('Failed to save result');
    expect(screen.getByRole('alert')).toHaveTextContent('leaving or refreshing may lose it');
    expect(view.save.insert).not.toHaveBeenCalled();
    expect(active()).toEqual(original);
    expect(logged).toHaveBeenCalledWith('Error saving test result:', expect.objectContaining({ message: expect.stringContaining('Could not preserve') }));
    write.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Save' }));
    await screen.findByText('Result saved to History');
    expect(view.save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: original.id, correct_count: 1 }));
    expect(readTestRecovery('user-a').sessions).toEqual([]);
  });

  it('recovers the previous active draft after a refresh when completion writes failed, with no History commit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await start({ count: 1 });
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'cat' } });
    const original = active();
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    await userEvent.click(screen.getByRole('button', { name: 'Finish Test' }));
    await screen.findByText('Failed to save result');
    view.unmount();
    write.mockRestore();
    render(<TestMode />);
    expect(screen.getByPlaceholderText('Type your answer...')).toHaveValue('cat');
    expect(view.save.insert).not.toHaveBeenCalled();
    expect(active()).toEqual(original);
    await userEvent.click(screen.getByRole('button', { name: 'Finish Test' }));
    await screen.findByText('Result saved to History');
    expect(view.save.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: original.id }));
  });
});
