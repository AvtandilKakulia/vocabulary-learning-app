import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deferred } from '@/test/mocks';
import { word } from '@/test/fixtures';
import WordModal from './WordModal';

function setup(updateWord = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const props = {
    word: word(), onClose, onSave,
    onDuplicateDetected: vi.fn(),
    addWord: vi.fn().mockResolvedValue(undefined),
    updateWord,
    checkExistingEnglishWords: vi.fn().mockResolvedValue([]),
  };
  render(<WordModal {...props} />);
  return { ...props };
}

describe('WordModal in-flight saving safeguards (R3-A18)', () => {
  it('blocks close, discard and duplicate submissions until the update finishes', async () => {
    const pending = deferred<void>();
    const updateWord = vi.fn().mockReturnValue(pending.promise);
    const { onClose, onSave } = setup(updateWord);
    fireEvent.change(screen.getByPlaceholderText('Enter the English word'), { target: { value: 'yield edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(updateWord).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('form', { hidden: true })).toHaveAttribute('aria-busy', 'true');
    const close = screen.getByRole('button', { name: 'Close word editor' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(close).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.click(close);
    fireEvent.click(cancel);
    fireEvent.submit(screen.getByRole('button', { name: 'Saving...' }).closest('form')!);
    expect(updateWord).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(updateWord).toHaveBeenCalledTimes(1);
  });

  it('re-enables close and preserves editable form after failed save', async () => {
    const pending = deferred<void>();
    const updateWord = vi.fn().mockReturnValue(pending.promise);
    const { onClose, onSave } = setup(updateWord);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    fireEvent.change(screen.getByPlaceholderText('Enter the English word'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await act(async () => pending.reject(new Error('write failed')));
    expect(alert).toHaveBeenCalledWith('Error saving word: write failed');
    expect(onSave).not.toHaveBeenCalled();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).not.toBeDisabled();
    fireEvent.click(cancel);
    expect(screen.getByText('Close without saving?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
