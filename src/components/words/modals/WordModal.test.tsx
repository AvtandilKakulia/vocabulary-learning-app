import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@/test/mocks';
import { word } from '@/test/fixtures';
import type { WordFormData } from '../useWords';
import WordModal from './WordModal';

function editor(editing = false) {
  const props = {
    word: editing ? word({ part_of_speech: 'verb', is_irregular_verb: true, past_simple: 'yielded', past_participle: 'yielded' }) : null,
    onClose: vi.fn(), onSave: vi.fn(), onDuplicateDetected: vi.fn(),
    addWord: vi.fn<(data: WordFormData) => Promise<void>>().mockResolvedValue(undefined),
    updateWord: vi.fn<(id: string, data: WordFormData, expectedUpdatedAt: string) => Promise<void>>().mockResolvedValue(undefined),
    checkExistingEnglishWords: vi.fn().mockResolvedValue([]),
  };
  const view = render(<WordModal {...props} />);
  fireEvent.change(screen.getByPlaceholderText('Enter the English word'), { target: { value: 'yield' } });
  fireEvent.change(screen.getByPlaceholderText('Definition 1'), { target: { value: 'მოსავალი' } });
  fireEvent.change(screen.getByPlaceholderText('Add additional context or example sentences...'), { target: { value: 'Original draft' } });
  const form = screen.getByPlaceholderText('Enter the English word').closest('form')!;
  return { ...view, props, form };
}

describe('Word Modal pending saves', () => {
  it('blocks Cancel and editing until an update succeeds, then calls onSave exactly once', async () => {
    const { props, form } = editor(true);
    const pending = deferred<void>();
    props.updateWord.mockReturnValue(pending.promise);
    fireEvent.submit(form);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByPlaceholderText('Enter the English word')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    for (const control of form.querySelectorAll('input, textarea, button')) {
      expect(control).toBeDisabled();
    }
    await userEvent.type(screen.getByPlaceholderText('Enter past simple form'), 'changed');
    expect(screen.getByPlaceholderText('Enter past simple form')).toHaveValue('yielded');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Close without saving?')).not.toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.updateWord).toHaveBeenCalledWith('word-1', {
      englishWord: 'yield', partOfSpeech: 'verb', isIrregularVerb: true,
      pastSimple: 'yielded', pastParticiple: 'yielded',
      georgianDefs: ['მოსავალი', 'მოსავლიანობა'], description: 'Original draft',
    }, props.word!.updated_at);
    fireEvent.submit(form);
    expect(props.updateWord).toHaveBeenCalledOnce();
  });

  it('blocks duplicate lookup overlap and cannot cancel the editor before the lookup settles', async () => {
    const { props, form } = editor();
    const pending = deferred<ReturnType<typeof word>[]>();
    props.checkExistingEnglishWords.mockReturnValue(pending.promise);
    act(() => { fireEvent.submit(form); fireEvent.submit(form); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(props.checkExistingEnglishWords).toHaveBeenCalledOnce();
    expect(screen.queryByText('Close without saving?')).not.toBeInTheDocument();
    await act(async () => pending.resolve([word()]));
    expect(props.onDuplicateDetected).toHaveBeenCalledOnce();
    expect(props.addWord).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('blocks X, Cancel, Escape and backdrop clicks throughout lookup and insertion', async () => {
    const { props, form } = editor();
    const lookup = deferred<ReturnType<typeof word>[]>();
    const insert = deferred<void>();
    props.checkExistingEnglishWords.mockReturnValue(lookup.promise);
    props.addWord.mockReturnValue(insert.promise);
    const close = screen.getByRole('button', { name: 'Close word editor' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // Fire events in one batch to exercise handlers before disabled is rendered.
    act(() => { fireEvent.submit(form); fireEvent.click(close); fireEvent.click(cancel); });
    expect(close).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(props.addWord).not.toHaveBeenCalled();
    await act(async () => lookup.resolve([]));
    act(() => {
      fireEvent.submit(form);
      fireEvent.click(close);
      fireEvent.click(cancel);
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.mouseDown(close.closest('.fixed')!);
    });
    expect(screen.queryByText('Close without saving?')).not.toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.addWord).toHaveBeenCalledOnce();
    await act(async () => insert.resolve());
    expect(props.onSave).toHaveBeenCalledOnce();
    expect(props.onDuplicateDetected).not.toHaveBeenCalled();
  });

  it('does not start a save behind Discard confirmation, and guards a stale Discard after saving starts', async () => {
    const { props, form } = editor(true);
    const pending = deferred<void>();
    props.updateWord.mockReturnValue(pending.promise);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.submit(form);
    });
    expect(props.updateWord).not.toHaveBeenCalled();
    const discard = screen.getByRole('button', { name: 'Discard' });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
      fireEvent.submit(form);
      fireEvent.click(discard);
    });
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.queryByText('Close without saving?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await act(async () => pending.resolve());
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it('preserves intentional idle discard and blocks a submission after discard', () => {
    const { props, form } = editor();
    fireEvent.click(screen.getByRole('button', { name: 'Close word editor' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      fireEvent.submit(form);
    });
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.checkExistingEnglishWords).not.toHaveBeenCalled();
    expect(props.addWord).not.toHaveBeenCalled();
  });

  it.each(['lookup', 'insert', 'update'] as const)('preserves the draft after a failed %s and permits a successful retry', async failure => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const { props, form } = editor(failure === 'update');
    const pending = deferred<never>();
    if (failure === 'lookup') props.checkExistingEnglishWords.mockReturnValueOnce(pending.promise);
    if (failure === 'insert') props.addWord.mockReturnValueOnce(pending.promise);
    if (failure === 'update') props.updateWord.mockReturnValueOnce(pending.promise);
    const before = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'), input => input.value);
    await act(async () => fireEvent.submit(form));
    expect(props.onSave).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error('Please try again')));
    expect(alert).toHaveBeenCalledWith('Error saving word: Please try again');
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'), input => input.value)).toEqual(before);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close word editor' })).toBeEnabled();
    expect(screen.getByPlaceholderText('Enter the English word')).toBeEnabled();
    if (failure === 'update') {
      expect(screen.getByRole('button', { name: 'Irregular' })).toBeEnabled();
      expect(screen.getByPlaceholderText('Enter past participle form')).toBeEnabled();
    }
    fireEvent.change(screen.getByPlaceholderText('Add additional context or example sentences...'), { target: { value: 'Retry draft' } });
    await act(async () => fireEvent.submit(form));
    expect(props.onSave).toHaveBeenCalledOnce();
    const saved = failure === 'update' ? props.updateWord.mock.lastCall![1] : props.addWord.mock.lastCall![0];
    expect(saved.description).toBe('Retry draft');
    expect(saved.englishWord).toBe('yield');
    expect(saved.georgianDefs[0]).toBe('მოსავალი');
    if (failure === 'update') {
      expect(saved).toMatchObject({ partOfSpeech: 'verb', isIrregularVerb: true, pastSimple: 'yielded', pastParticiple: 'yielded' });
    }
  });

  it('closes an untouched editor without asking to discard', () => {
    const { props, rerender } = editor();
    // Switching to an existing entry initializes a clean editor.
    rerender(<WordModal {...props} word={word()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText('Close without saving?')).not.toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
