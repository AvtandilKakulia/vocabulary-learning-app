import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import WordManagement from './WordManagement';

const first = word({ is_irregular_verb: true, past_simple: 'yielded', past_participle: 'yielded' });
const second = word({ id: 'word-2', english_word: 'go' });

async function mountWords() {
  supabaseMock.from.mockReturnValueOnce(query({ data: [first, second], count: 2, error: null }));
  render(<WordManagement />);
  await screen.findByText('Yield');
}

function row(name: string) {
  return within(screen.getByText(name).closest('tr')!);
}

function selectBoth() {
  fireEvent.click(row('Yield').getAllByRole('button')[0]);
  fireEvent.click(row('Go').getAllByRole('button')[0]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
}

describe('Word mutation result UI', () => {
  it('preserves every draft field and the editor after a zero-row update, then allows a verified retry', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await mountWords();
    fireEvent.click(row('Yield').getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByPlaceholderText('Add additional context or example sentences...'), { target: { value: 'Keep this draft' } });
    const pending = deferred<QueryResult>();
    const update = query(pending.promise);
    supabaseMock.from.mockReturnValueOnce(update);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => pending.resolve({ error: null, count: 0 }));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('This word could not be saved'));
    expect(screen.getByRole('heading', { name: 'Refine your entry' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter the English word')).toHaveValue(first.english_word);
    expect(screen.getByPlaceholderText('Enter past simple form')).toHaveValue(first.past_simple);
    expect(screen.getByPlaceholderText('Enter past participle form')).toHaveValue(first.past_participle);
    expect(screen.getByPlaceholderText('Definition 1')).toHaveValue(first.georgian_definitions[0]);
    expect(screen.getByPlaceholderText('Definition 2')).toHaveValue(first.georgian_definitions[1]);
    expect(screen.getByPlaceholderText('Add additional context or example sentences...')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(2); // No successful-save refresh.
    const retry = query({ error: null, count: 1 });
    supabaseMock.from.mockReturnValueOnce(retry).mockReturnValueOnce(query({ data: [first, second], error: null, count: 2 }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' })));
    expect(retry.update.mock.calls).toEqual(update.update.mock.calls);
    expect(retry.update).toHaveBeenCalledWith(expect.objectContaining({ is_irregular_verb: true, part_of_speech: 'verb', description: 'Keep this draft' }), { count: 'exact' });
    expect(screen.queryByRole('heading', { name: 'Refine your entry' })).not.toBeInTheDocument();
    expect(supabaseMock.from).toHaveBeenCalledTimes(4);
  });

  it.each([0, 1])('reconciles a single delete with count %s and reports zero as unsuccessful', async count => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await mountWords();
    fireEvent.click(row('Yield').getByRole('button', { name: 'Delete' }));
    const deletion = query({ error: null, count });
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValueOnce(query({ data: [second], count: 1, error: null }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete "yield"' })));
    if (count === 0) expect(alert).toHaveBeenCalledWith(expect.stringContaining('No words were deleted'));
    else expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Delete Word' })).not.toBeInTheDocument();
    expect(screen.queryByText('Yield')).not.toBeInTheDocument();
    expect(screen.getByText('Go')).toBeInTheDocument();
    expect(deletion.delete).toHaveBeenCalledOnce();
    expect(supabaseMock.from).toHaveBeenCalledTimes(3);
  });

  it.each([0, 1, 2])('reconciles bulk count %s without retrying, and requires fresh selection and confirmation', async count => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await mountWords();
    selectBoth();
    const pending = deferred<QueryResult>();
    const deletion = query(pending.promise);
    const remaining = word({ id: 'remaining', english_word: 'remain' });
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValueOnce(query({ data: [remaining], count: 1, error: null }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 Words' }));
    expect(screen.getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    await act(async () => pending.resolve({ error: null, count }));
    if (count === 0) expect(alert).toHaveBeenCalledWith(expect.stringContaining('No words were deleted'));
    if (count === 1) expect(alert).toHaveBeenCalledWith(expect.stringContaining('Only 1 of 2 selected words were deleted'));
    if (count === 2) expect(alert).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Delete 2 Words' })).not.toBeInTheDocument();
    expect(screen.queryByText('Yield')).not.toBeInTheDocument();
    expect(screen.queryByText('2 selected (this page)')).not.toBeInTheDocument();
    expect(screen.getByText('Remain')).toBeInTheDocument();
    expect(supabaseMock.from).toHaveBeenCalledTimes(3);
    expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', ['word-1', 'word-2']);
    // No automatic destructive retry; a new selection opens a new confirmation.
    fireEvent.click(row('Remain').getAllByRole('button')[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(supabaseMock.from).toHaveBeenCalledTimes(3);
    const freshDelete = query({ error: null, count: 1 });
    supabaseMock.from.mockReturnValueOnce(freshDelete).mockReturnValueOnce(query({ data: [], count: 0, error: null }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Word' })));
    expect(freshDelete.in).toHaveBeenCalledExactlyOnceWith('id', ['remaining']);
    expect(screen.getByText('No words yet')).toBeInTheDocument();
  });

  it('blocks stale deletion controls if the refresh after a partial delete fails and offers a read-only retry', async () => {
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mountWords();
    selectBoth();
    const refresh = deferred<QueryResult>();
    const deletion = query({ error: null, count: 1 });
    supabaseMock.from.mockReturnValueOnce(deletion).mockReturnValueOnce(query(refresh.promise));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete 2 Words' })));
    expect(screen.getByText('Loading words...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete 2 Words' })).not.toBeInTheDocument();
    await act(async () => refresh.resolve({ error: { message: 'private failure' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your words');
    expect(screen.queryByText('Yield')).not.toBeInTheDocument();
    const readRetry = query({ data: [second], count: 1, error: null });
    supabaseMock.from.mockReturnValueOnce(readRetry);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
    expect(screen.getByText('Go')).toBeInTheDocument();
    expect(screen.queryByText('2 selected (this page)')).not.toBeInTheDocument();
    expect(readRetry.delete).not.toHaveBeenCalled();
    expect(deletion.delete).toHaveBeenCalledOnce();
  });
});
