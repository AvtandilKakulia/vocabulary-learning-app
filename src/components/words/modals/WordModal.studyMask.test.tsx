import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { word } from '@/test/fixtures';
import { deferred } from '@/test/mocks';
import { renderStudyDescription } from '@/lib/descriptionStudyMask';
import WordModal from './WordModal';

function editor(description = 'The company will postpone until Monday.') {
  const props = { word: word({ description }), onClose: vi.fn(), onSave: vi.fn(), onDuplicateDetected: vi.fn(),
    addWord: vi.fn(), updateWord: vi.fn().mockResolvedValue(undefined), checkExistingEnglishWords: vi.fn() };
  return { props, ...render(<WordModal {...props} />) };
}
function preview() { return screen.getByRole('region', { name: 'Description preview' }); }
function input() { return screen.getByPlaceholderText('Add additional context or example sentences...') as HTMLTextAreaElement; }
function selectText(text: string) {
  const root = preview();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let next: Node | null;
  while ((next = walker.nextNode())) nodes.push(next as Text);
  const start = root.textContent!.indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);
  const locate = (index: number): [Text, number] => {
    for (const node of nodes) {
      if (index <= node.length) return [node, index];
      index -= node.length;
    }
    throw new Error('Invalid test selection');
  };
  const range = document.createRange();
  range.setStart(...locate(start));
  range.setEnd(...locate(start + text.length));
  act(() => {
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('Word editor study masking', () => {
  it('marks multiple preview selections, retains visible words and saves the exact marked source/version', async () => {
    const { props } = editor();
    for (const text of ['postpone', 'Monday']) {
      selectText(text);
      await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
      expect(preview()).toHaveTextContent(text);
    }
    expect(preview().querySelectorAll('[data-study-mask="true"]')).toHaveLength(2);
    const expected = 'The company will <span data-study-mask="true">postpone</span> until <span data-study-mask="true">Monday</span>.';
    expect(input()).toHaveValue(expected);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.updateWord).toHaveBeenCalledExactlyOnceWith(props.word.id, expect.objectContaining({ description: expected }), props.word.updated_at);
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it('handles keyboard toolbar activation and a phrase spanning formatting, entities and Georgian', async () => {
    editor('Before <strong>ქართული &amp;</strong> <span style="color: #abcdef">text!</span> after');
    selectText('ქართული & text!');
    const mark = screen.getByRole('button', { name: 'Mask for Study' });
    mark.focus();
    await userEvent.keyboard('{Enter}');
    expect(preview().querySelector('[data-study-mask] strong')).toHaveTextContent('ქართული &');
    expect(preview().querySelector('[data-study-mask] [style]')).toHaveTextContent('text!');
    expect(renderStudyDescription(input().value)).toBe('Before <span data-study-mask="true">*****</span> after');
    selectText('ქართული');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Study Mask' }));
    expect(input()).toHaveValue('Before <strong>ქართული &amp;</strong> <span style="color: #abcdef">text!</span> after');
    selectText('ქართული & text!');
    await userEvent.click(mark);
    expect(preview().querySelectorAll('[data-study-mask]')).toHaveLength(1);
  });

  it('removes previously saved masks without changing unrelated formatting or original characters', async () => {
    const original = 'Before <span data-study-mask="true"><strong>next Monday</strong></span> <span style="color: #abcdef">after</span>';
    const { props } = editor(original);
    selectText('Monday');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Study Mask' }));
    const expected = 'Before <strong>next Monday</strong> <span style="color: #abcdef">after</span>';
    expect(input()).toHaveValue(expected);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.updateWord.mock.calls[0][1].description).toBe(expected);
  });

  it('rejects missing, stale and overlapping selections with feedback and preserves the draft', async () => {
    editor('A <span data-study-mask="true">secret</span> phrase');
    const original = input().value;
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(screen.getByRole('status')).toHaveTextContent('Select text in the Description preview first.');
    selectText('secret');
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(screen.getByRole('status')).toHaveTextContent('already includes a study mask');
    expect(input()).toHaveValue(original);
    selectText('phrase');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Study Mask' }));
    expect(screen.getByRole('status')).toHaveTextContent('does not include a study mask');
    selectText('secret');
    fireEvent.change(input(), { target: { value: 'Rewritten draft' } });
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(input()).toHaveValue('Rewritten draft');
    expect(screen.getByRole('status')).toHaveTextContent('Select text');
  });

  it('keeps mask actions disabled and their stale handlers inert while a save is pending', async () => {
    const { props } = editor();
    const pending = deferred<void>();
    props.updateWord.mockReturnValue(pending.promise);
    selectText('postpone');
    const original = input().value;
    const mark = screen.getByRole('button', { name: 'Mask for Study' });
    act(() => {
      fireEvent.submit(input().closest('form')!);
      fireEvent.click(mark);
    });
    expect(mark).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Study Mask' })).toBeDisabled();
    expect(input()).toHaveValue(original);
    await act(async () => pending.resolve());
    expect(props.updateWord.mock.calls[0][1].description).toBe(original);
  });
});
