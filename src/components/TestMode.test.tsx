import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import type { TestHistory, Word } from '@/lib/supabase';
import TestMode from './TestMode';

type Direction = TestHistory['test_direction'];

beforeEach(() => {
  // Keep fixture question selection deterministic; assertions do not rely on option order.
  vi.spyOn(Math, 'random').mockReturnValue(0.999999);
});

async function start(vocabulary: Word[], options: {
  direction?: Direction; count?: number; input?: 'text' | 'multiple';
  save?: ReturnType<typeof query>;
} = {}) {
  const load = query({ data: vocabulary, error: null });
  const save = options.save ?? query();
  supabaseMock.from.mockImplementation((table) => {
    if (table === 'words') return load;
    if (table === 'test_history') return save;
    throw new Error(`Unexpected table: ${table}`);
  });
  const user = userEvent.setup();
  render(<TestMode />);
  await user.click(screen.getByRole('button', {
    name: options.direction === 'geo-to-en' ? 'Georgian → English' : 'English → Georgian',
  }));
  await user.type(screen.getByPlaceholderText('Custom'), String(options.count ?? 1));
  await user.click(screen.getByRole('button', { name: options.input === 'multiple' ? 'Multiple Choice' : 'Text Input' }));
  await user.click(screen.getByRole('button', { name: 'Start Test' }));
  await screen.findByText(`Question 1 of ${options.count ?? 1}`);
  expect(load.eq).toHaveBeenCalledWith('user_id', 'user-a');
  return { user, save };
}

async function answerText(answer: string) {
  fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: answer } });
  await userEvent.click(screen.getByRole('button', { name: /^(Next Question|Finish Test)$/ }));
}

function optionLabels() {
  return screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value);
}

describe('TestMode answer evaluation and history snapshots', () => {
  it.each([
    ['en-to-geo', 'დათმობა', 1],
    ['en-to-geo', '  მოსავლიანობა  ', 1],
    ['en-to-geo', 'unrelated', 0],
    ['en-to-geo', 'მოსავალი', 0],
    ['geo-to-en', '  YIELD  ', 1],
    ['geo-to-en', 'დათმობა', 0],
  ] as const)('%s evaluates %j against the current sense (score %i)', async (direction, answer, score) => {
    const { save } = await start([
      word(), word({ id: 'other-sense', georgian_definitions: ['მოსავალი'] }),
    ], { direction });
    await answerText(answer);
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledOnce();
    expect(save.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-a', test_direction: direction, total_words: 1, correct_count: score,
      mistakes: score ? [] : [expect.objectContaining({ user_answer: answer })],
    }));
  });

  it.each(['en-to-geo', 'geo-to-en'] as const)('captures %s prompt, description, and direction-aware answers', async (direction) => {
    const current = word({ description: '<strong>Road sense</strong>',
      is_irregular_verb: true, past_simple: 'yielded', past_participle: 'yielded' });
    const { save } = await start([current], { direction });
    // TestMode retains its single-answer behavior even for an irregular word.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await answerText('wrong');
    await screen.findByText('Result saved to History');
    expect(save.insert.mock.calls[0][0].mistakes).toEqual([{
      english_word: 'yield', user_answer: 'wrong', description: '<strong>Road sense</strong>',
      question_prompt: direction === 'en-to-geo' ? 'yield' : 'დათმობა, მოსავლიანობა',
      correct_definitions: direction === 'en-to-geo' ? ['დათმობა', 'მოსავლიანობა'] : ['yield'],
    }]);
  });
});

describe('TestMode multiple choice', () => {
  it('uses the full frozen session vocabulary on first and later questions', async () => {
    const vocabulary = [
      word({ id: 'a', english_word: 'a', georgian_definitions: ['ა'] }),
      word({ id: 'b', english_word: 'b', georgian_definitions: ['ბ'] }),
      word({ id: 'c', english_word: 'c', georgian_definitions: ['გ'] }),
      word({ id: 'd', english_word: 'd', georgian_definitions: ['დ'] }),
    ];
    const { user, save } = await start(vocabulary, { count: 2, input: 'multiple' });
    expect(new Set(optionLabels())).toEqual(new Set(['ა', 'ბ', 'გ', 'დ']));
    vocabulary[2].georgian_definitions[0] = 'changed after start';
    await user.click(screen.getByRole('radio', { name: 'ა' }));
    await user.click(screen.getByRole('button', { name: 'Next Question' }));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    expect(new Set(optionLabels())).toEqual(new Set(['ა', 'ბ', 'გ', 'დ']));
    await user.click(screen.getByRole('radio', { name: 'ბ' }));
    await user.click(screen.getByRole('button', { name: 'Finish Test' }));
    await screen.findByText('Result saved to History');
    expect(save.insert).toHaveBeenCalledWith(expect.objectContaining({ correct_count: 2, mistakes: [] }));
  });

  it('excludes accepted synonyms, overlapping labels, empty labels, and duplicate distractors', async () => {
    await start([
      word(),
      word({ id: 'synonym', english_word: 'surrender', georgian_definitions: [' დათმობა '] }),
      word({ id: 'overlap', english_word: 'produce', georgian_definitions: ['მოსავლიანობა', 'სხვა'] }),
      word({ id: 'safe', english_word: 'cat', georgian_definitions: ['კატა'] }),
      word({ id: 'duplicate', english_word: 'kitten', georgian_definitions: [' კატა '] }),
      word({ id: 'empty', english_word: 'empty', georgian_definitions: [] }),
    ], { input: 'multiple' });
    const labels = optionLabels();
    expect(new Set(labels)).toEqual(new Set(['დათმობა, მოსავლიანობა', 'კატა']));
    expect(labels).toHaveLength(2); // Fewer than four is safer than an ambiguous option.
  });

  it.each([null, '  \n ', 'Agricultural context'])('uses current description %j to disambiguate same-English senses', async (description) => {
    await start([
      word({ description }),
      word({ id: 'other', english_word: ' YIELD ', georgian_definitions: ['მოსავალი'], description: 'Other context' }),
    ], { input: 'multiple' });
    expect(optionLabels()).toContain('დათმობა, მოსავლიანობა');
    expect(optionLabels().includes('მოსავალი')).toBe(Boolean(description?.trim()));
  });

  it('deduplicates English options across senses in Georgian → English', async () => {
    await start([
      word(), word({ id: 'same', english_word: ' YIELD ', georgian_definitions: ['მოსავალი'] }),
      word({ id: 'safe', english_word: 'cat' }), word({ id: 'duplicate', english_word: ' CAT ' }),
    ], { input: 'multiple', direction: 'geo-to-en' });
    expect(new Set(optionLabels())).toEqual(new Set(['yield', 'cat']));
    expect(optionLabels()).toHaveLength(2);
  });
});

describe('TestMode save lifecycle', () => {
  it('shows a returned error and retries the exact completed payload/date only once', async () => {
    const failure = { message: 'Insert denied' };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    const save = query();
    save.insert.mockReturnValueOnce(Promise.resolve({ error: failure }))
      .mockReturnValueOnce(pending.promise);
    await start([word()], { save });
    await answerText('wrong');
    await screen.findByText('Failed to save result');
    expect(logged).toHaveBeenCalledExactlyOnceWith('Error saving test result:', failure);
    const captured = structuredClone(save.insert.mock.calls[0][0]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const retry = screen.getByRole('button', { name: 'Retry Save' });
    act(() => { fireEvent.click(retry); fireEvent.click(retry); });
    expect(save.insert).toHaveBeenCalledTimes(2);
    expect(save.insert.mock.calls[1][0]).toEqual(captured);
    expect(screen.getByRole('button', { name: 'Take Another Test' })).toBeDisabled();
    await act(async () => { pending.resolve({ error: null }); });
    expect(screen.getByText('Result saved to History')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Save' })).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledTimes(2);
  });

  it('guards rapid final submissions and prevents a new test while the insert is pending', async () => {
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    await start([word()], { save });
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), { target: { value: 'დათმობა' } });
    const finish = screen.getByRole('button', { name: 'Finish Test' });
    act(() => { fireEvent.click(finish); fireEvent.click(finish); });
    expect(save.insert).toHaveBeenCalledOnce();
    const reset = screen.getByRole('button', { name: 'Take Another Test' });
    expect(reset).toBeDisabled();
    fireEvent.click(reset);
    expect(screen.getByRole('heading', { name: 'Test Results' })).toBeInTheDocument();
    await act(async () => { pending.resolve({ error: null }); });
    await waitFor(() => expect(reset).toBeEnabled());
    await userEvent.click(reset);
    expect(screen.getByRole('button', { name: 'Start Test' })).toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledOnce();
  });
});
