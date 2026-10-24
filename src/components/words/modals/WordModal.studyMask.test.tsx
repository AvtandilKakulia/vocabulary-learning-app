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
function selectSource(text: string, last = false) {
  const field = input();
  const start = last ? field.value.lastIndexOf(text) : field.value.indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);
  field.focus();
  field.setSelectionRange(start, start + text.length);
  fireEvent.select(field);
}
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
    (document.activeElement as HTMLElement)?.blur();
    fireEvent.pointerDown(root);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

describe('Word editor study masking', () => {
  it('masks a word selected directly inside the textarea', async () => {
    editor();
    input().focus();
    input().setSelectionRange(17, 25);
    fireEvent.select(input());
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(input()).toHaveValue('The company will <span data-study-mask="true">postpone</span> until Monday.');
  });

  it('masks formatted textarea text including entities, excluding incidental edge whitespace', async () => {
    const { props } = editor('Before <strong> ქართული &amp;</strong> <span style="color: #abcdef">text! </span>after');
    selectSource(' ქართული &amp;</strong> <span style="color: #abcdef">text! ');
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(preview()).toHaveTextContent('Before ქართული & text! after');
    const marked = preview().querySelector('[data-study-mask]')!;
    expect(marked.textContent).toBe('ქართული & text!');
    expect(marked.querySelector('strong')).toHaveTextContent('ქართული &');
    expect(marked.querySelector('[style]')).toHaveTextContent('text!');
    const expected = input().value;
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.updateWord).toHaveBeenCalledExactlyOnceWith(props.word.id, expect.objectContaining({ description: expected }), props.word.updated_at);
  });

  it('unmasks saved source text via keyboard and retains an unsaved draft through Cancel/Keep editing', async () => {
    const original = 'Before <span data-study-mask="true"><strong>ქართული &amp; text</strong></span> after';
    const { props } = editor(original);
    selectSource('ქართული');
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('button', { name: 'Remove Study Mask' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    const expected = 'Before <strong>ქართული &amp; text</strong> after';
    expect(input()).toHaveValue(expected);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Close without saving?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(input()).toHaveValue(expected);
    expect(props.updateWord).not.toHaveBeenCalled();
    selectSource('ქართული');
    await userEvent.keyboard('{Shift>}{Tab}{Tab}{/Shift}{Enter}');
    expect(preview().querySelector('[data-study-mask]')).toHaveTextContent('ქართული');
  });

  it.each([
    ['Mask for Study', false], ['Mask for Study', true],
    ['Remove Study Mask', false], ['Remove Study Mask', true],
  ] as const)('ignores Preview selection and invalidates a previous textarea range for %s (toolbar focused: %s)', async (action, toolbarFocused) => {
    const original = 'same <span data-study-mask="true">same</span>';
    editor(original);
    selectText('same');
    await userEvent.click(screen.getByRole('button', { name: action }));
    expect(input()).toHaveValue(original);
    selectSource('same', true);
    if (toolbarFocused) await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    selectText('same');
    await userEvent.click(screen.getByRole('button', { name: action }));
    expect(input()).toHaveValue(original);
    expect(screen.getByRole('status')).toHaveTextContent('Select text in Description first.');
    expect(preview()).toHaveTextContent('same same');
    expect(preview().querySelector('[data-study-mask]')).toHaveTextContent('same');
  });

  it.each(['strong', 'amp', '\udf0d'])('rejects selection inside a tag/entity/surrogate (%s) without changing the draft', async selected => {
    editor('<strong>word &amp; 🌍</strong> other');
    selectText('other');
    const original = input().value;
    selectSource(selected);
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(input()).toHaveValue(original);
    expect(screen.getByRole('status')).toHaveTextContent('without cutting HTML tags, entities or characters');
    expect(screen.getByRole('status')).toHaveTextContent('complete formatting tags');
    selectSource('word');
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(preview().querySelector('[data-study-mask]')).toHaveTextContent('word');
  });

  it('invalidates source selections after typing or Bold without losing the latest edit', async () => {
    editor();
    selectSource('postpone');
    act(() => {
      fireEvent.change(input(), { target: { value: 'new draft' } });
      fireEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    });
    expect(input()).toHaveValue('new draft');
    selectSource('draft');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
      fireEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    });
    expect(input()).toHaveValue('new <strong>draft</strong>');
  });

  it('marks multiple textarea selections, retains visible words and saves the exact marked source/version', async () => {
    const { props } = editor();
    for (const text of ['postpone', 'Monday']) {
      selectSource(text);
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
    selectSource('ქართული &amp;</strong> <span style="color: #abcdef">text!');
    const mark = screen.getByRole('button', { name: 'Mask for Study' });
    mark.focus();
    await userEvent.keyboard('{Enter}');
    expect(preview().querySelector('[data-study-mask] strong')).toHaveTextContent('ქართული &');
    expect(preview().querySelector('[data-study-mask] [style]')).toHaveTextContent('text!');
    expect(renderStudyDescription(input().value)).toBe('Before <span data-study-mask="true">*****</span> after');
    selectSource('ქართული');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Study Mask' }));
    expect(input()).toHaveValue('Before <strong>ქართული &amp;</strong> <span style="color: #abcdef">text!</span> after');
    selectSource('ქართული &amp;</strong> <span style="color: #abcdef">text!');
    await userEvent.click(mark);
    expect(preview().querySelectorAll('[data-study-mask]')).toHaveLength(1);
  });

  it('removes previously saved masks without changing unrelated formatting or original characters', async () => {
    const original = 'Before <span data-study-mask="true"><strong>next Monday</strong></span> <span style="color: #abcdef">after</span>';
    const { props } = editor(original);
    selectSource('Monday');
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
    expect(screen.getByRole('status')).toHaveTextContent('Select text in Description first.');
    selectSource('secret');
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(screen.getByRole('status')).toHaveTextContent('already includes a study mask');
    expect(input()).toHaveValue(original);
    selectSource('phrase');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Study Mask' }));
    expect(screen.getByRole('status')).toHaveTextContent('does not include a study mask');
    selectSource('secret');
    fireEvent.change(input(), { target: { value: 'Rewritten draft' } });
    await userEvent.click(screen.getByRole('button', { name: 'Mask for Study' }));
    expect(input()).toHaveValue('Rewritten draft');
    expect(screen.getByRole('status')).toHaveTextContent('Select text');
  });

  it('keeps mask actions disabled and their stale handlers inert while a save is pending', async () => {
    const { props } = editor();
    const pending = deferred<void>();
    props.updateWord.mockReturnValue(pending.promise);
    selectSource('postpone');
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
