import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import WordManagement from './WordManagement';

const expectedDraft = {
  user_id: 'user-a', english_word: 'Yield', part_of_speech: 'verb',
  is_irregular_verb: true, past_simple: 'yielded', past_participle: 'yielded',
  georgian_definitions: ['მოსავალი', 'დათმობა'], description: '<b>Original draft</b>',
};

async function openDraft() {
  supabaseMock.from.mockReturnValueOnce(query({ data: [word()], count: 1, error: null }));
  render(<WordManagement />);
  await screen.findByText('Yield');
  fireEvent.click(screen.getByRole('button', { name: 'Add word' }));
  fireEvent.change(screen.getByPlaceholderText('Enter the English word'), { target: { value: '  Yield  ' } });
  fireEvent.change(screen.getByPlaceholderText('Definition 1'), { target: { value: ' მოსავალი ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add definition' }));
  fireEvent.change(screen.getByPlaceholderText('Definition 2'), { target: { value: 'დათმობა' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verb' }));
  fireEvent.click(screen.getByRole('button', { name: 'Irregular' }));
  fireEvent.change(screen.getByPlaceholderText('Enter past simple form'), { target: { value: 'yielded' } });
  fireEvent.change(screen.getByPlaceholderText('Enter past participle form'), { target: { value: 'yielded' } });
  fireEvent.change(screen.getByPlaceholderText('Add additional context or example sentences...'), { target: { value: expectedDraft.description } });
  return screen.getByPlaceholderText('Enter the English word').closest('form')!;
}

async function detectDuplicate(form: HTMLFormElement, existing = word()) {
  const lookup = query({ data: [existing], error: null });
  supabaseMock.from.mockReturnValueOnce(lookup);
  await act(async () => fireEvent.submit(form));
  expect(lookup.eq).toHaveBeenCalledWith('user_id', 'user-a');
  expect(lookup.eq).toHaveBeenCalledWith('english_word_norm', 'yield');
  return screen.getByRole('dialog', { name: 'Word Already Exists' });
}

describe('Word editor save workflow', () => {
  it('waits for an insert to succeed before closing and refreshing, and cannot switch entries mid-save', async () => {
    const form = await openDraft();
    const pending = deferred<QueryResult>();
    const insert = query(pending.promise);
    supabaseMock.from
      .mockReturnValueOnce(query({ data: [], error: null }))
      .mockReturnValueOnce(insert);
    await act(async () => fireEvent.submit(form));
    expect(insert.insert).toHaveBeenCalledExactlyOnceWith(expectedDraft);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(3);
    // A background row action must not replace the draft/lock while it saves.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Add a new word' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter the English word')).toHaveValue('  Yield  ');
    fireEvent.submit(form);
    const refresh = query({ data: [word({ id: 'new-word', english_word: 'new entry' })], count: 1, error: null });
    supabaseMock.from.mockReturnValueOnce(refresh);
    await act(async () => pending.resolve({ error: null }));
    expect(screen.queryByRole('heading', { name: 'Add a new word' })).not.toBeInTheDocument();
    expect(screen.getByText('New entry')).toBeInTheDocument();
    expect(refresh.select).toHaveBeenCalledOnce();
    expect(insert.insert).toHaveBeenCalledOnce();
    expect(supabaseMock.from).toHaveBeenCalledTimes(4);
  });

  it('retains the full draft through duplicate Back, then blocks repeated adds and every warning close path while inserting', async () => {
    let form = await openDraft();
    await detectDuplicate(form);
    expect(screen.queryByPlaceholderText('Enter the English word')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByPlaceholderText('Enter the English word')).toHaveValue('  Yield  ');
    expect(screen.getByPlaceholderText('Definition 1')).toHaveValue(' მოსავალი ');
    expect(screen.getByPlaceholderText('Definition 2')).toHaveValue('დათმობა');
    expect(screen.getByPlaceholderText('Enter past simple form')).toHaveValue('yielded');
    expect(screen.getByPlaceholderText('Enter past participle form')).toHaveValue('yielded');
    expect(screen.getByPlaceholderText('Add additional context or example sentences...')).toHaveValue(expectedDraft.description);
    form = screen.getByPlaceholderText('Enter the English word').closest('form')!;
    const dialog = await detectDuplicate(form);
    const pending = deferred<QueryResult>();
    const insert = query(pending.promise);
    supabaseMock.from.mockReturnValueOnce(insert);
    const add = within(dialog).getByRole('button', { name: 'Add as another meaning' });
    act(() => {
      fireEvent.click(add);
      fireEvent.click(add);
      fireEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Back to draft' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Edit existing entry' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.mouseDown(dialog.parentElement!);
    });
    expect(insert.insert).toHaveBeenCalledExactlyOnceWith(expectedDraft);
    expect(dialog).toBeInTheDocument();
    for (const button of within(dialog).getAllByRole('button')) expect(button).toBeDisabled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(4);
    supabaseMock.from.mockReturnValueOnce(query({ data: [word(), word({ id: 'another-meaning' })], count: 2, error: null }));
    await act(async () => pending.resolve({ error: null }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter the English word')).not.toBeInTheDocument();
    expect(screen.getAllByText('Yield')).toHaveLength(2);
    expect(supabaseMock.from).toHaveBeenCalledTimes(5);
  });

  it('keeps a failed additional meaning retryable without losing the submitted snapshot', async () => {
    const form = await openDraft();
    const dialog = await detectDuplicate(form);
    const pending = deferred<QueryResult>();
    const failedInsert = query(pending.promise);
    supabaseMock.from.mockReturnValueOnce(failedInsert);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add as another meaning' }));
    await act(async () => pending.resolve({ error: { message: 'Please try again' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Error adding word: Please try again');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(3);
    const retry = query({ error: null });
    supabaseMock.from.mockReturnValueOnce(retry).mockReturnValueOnce(query({ data: [word()], count: 1, error: null }));
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Add as another meaning' })));
    expect(failedInsert.insert).toHaveBeenCalledExactlyOnceWith(expectedDraft);
    expect(retry.insert).toHaveBeenCalledExactlyOnceWith(expectedDraft);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(supabaseMock.from).toHaveBeenCalledTimes(5);
  });

  it('edits an existing meaning from the warning and refreshes once after the update succeeds', async () => {
    const form = await openDraft();
    const existing = word({ is_irregular_verb: true, past_simple: 'yielded', past_participle: 'yielded' });
    await detectDuplicate(form, existing);
    fireEvent.click(screen.getByRole('button', { name: 'Edit existing entry' }));
    expect(screen.getByPlaceholderText('Enter the English word')).toHaveValue('yield');
    expect(screen.getByPlaceholderText('Enter past simple form')).toHaveValue('yielded');
    expect(screen.getByPlaceholderText('Enter past participle form')).toHaveValue('yielded');
    fireEvent.change(screen.getByPlaceholderText('Add additional context or example sentences...'), { target: { value: 'Edited context' } });
    const pending = deferred<QueryResult>();
    const update = query(pending.promise);
    supabaseMock.from.mockReturnValueOnce(update);
    const editForm = screen.getByPlaceholderText('Enter the English word').closest('form')!;
    act(() => { fireEvent.submit(editForm); fireEvent.submit(editForm); });
    expect(update.update).toHaveBeenCalledExactlyOnceWith({
      english_word: 'yield', part_of_speech: 'verb', is_irregular_verb: true,
      past_simple: 'yielded', past_participle: 'yielded',
      georgian_definitions: existing.georgian_definitions, description: 'Edited context',
    }, { count: 'exact' });
    expect(update.eq).toHaveBeenCalledWith('id', existing.id);
    expect(update.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(update.eq).toHaveBeenCalledWith('updated_at', existing.updated_at);
    expect(update.insert).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Refine your entry' })).toBeInTheDocument();
    supabaseMock.from.mockReturnValueOnce(query({ data: [existing], count: 1, error: null }));
    await act(async () => pending.resolve({ error: null, count: 1 }));
    expect(screen.queryByRole('heading', { name: 'Refine your entry' })).not.toBeInTheDocument();
    expect(screen.getByText('Yield')).toBeInTheDocument();
    expect(supabaseMock.from).toHaveBeenCalledTimes(4);
  });
});
