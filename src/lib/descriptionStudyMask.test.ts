import { describe, expect, it, vi } from 'vitest';
import { editDescriptionStudyMask, readDescriptionSelection, renderStudyDescription } from './descriptionStudyMask';
import { sanitizeDescription } from './sanitizeDescription';

const mask = (text: string) => `<span data-study-mask="true">${text}</span>`;
function edit(html: string, start: number, end: number, action: 'mask' | 'unmask' = 'mask') {
  const result = editDescriptionStudyMask(html, { start, end }, action);
  if ('error' in result) throw new Error(result.error);
  return result.html;
}

describe('Description study masking', () => {
  it.each(['postpone', 'next Monday', 'ქართული, ტექსტი!', '🌍'])('masks %s as exactly five stars without changing its source', value => {
    const original = `Before ${value} after`;
    const marked = edit(original, 7, 7 + value.length);
    expect(marked).toBe(`Before ${mask(value)} after`);
    expect(renderStudyDescription(marked)).toBe(`Before ${mask('*****')} after`);
    expect(sanitizeDescription(marked)).toContain(value);
    expect(edit(marked, 7, 7 + value.length, 'unmask')).toBe(original);
  });

  it('keeps independent masks and permits removal and reapplication without nesting', () => {
    const first = edit('postpone until Monday', 0, 8);
    const both = edit(first, 15, 21);
    expect(both).toBe(`${mask('postpone')} until ${mask('Monday')}`);
    expect(renderStudyDescription(both)).toBe(`${mask('*****')} until ${mask('*****')}`);
    expect(editDescriptionStudyMask(both, { start: 1, end: 3 }, 'mask')).toHaveProperty('error');
    expect(editDescriptionStudyMask(both, { start: 6, end: 18 }, 'mask')).toHaveProperty('error');
    const removed = edit(both, 0, 8, 'unmask');
    expect(removed).toBe(`postpone until ${mask('Monday')}`);
    expect(edit(removed, 0, 8)).toBe(both);
    expect(edit(both, 0, 21, 'unmask')).toBe('postpone until Monday');
  });

  it('preserves bold, color, entities and line breaks through a multi-node selection', () => {
    const original = '<strong>Bold &amp; text</strong> plain <span style="color: #abcdef">ქართული</span><br>last';
    const marked = edit(original, 5, 25);
    const normal = document.createElement('div');
    normal.innerHTML = marked;
    expect(normal.textContent).toBe('Bold & text plain ქართულიlast');
    expect(normal.querySelector('[data-study-mask] strong')).toHaveTextContent('& text');
    expect(normal.querySelector('[data-study-mask] span[style]')).toHaveTextContent('ქართული');
    expect(normal.querySelector('br')).not.toBeNull();
    expect(renderStudyDescription(marked)).not.toContain('ქართული');
    const removed = edit(marked, 6, 7, 'unmask');
    normal.innerHTML = removed;
    expect(normal.querySelectorAll('[data-study-mask]')).toHaveLength(0);
    expect([...normal.querySelectorAll('strong')].map(el => el.textContent).join('')).toBe('Bold & text');
    expect(normal.querySelector('[style]')).toHaveTextContent('ქართული');
  });

  it('maps a real Range across nodes and a line break without counting markup or entity source bytes', () => {
    const root = document.createElement('div');
    root.innerHTML = 'A &amp; <strong>ქართული</strong><br><span>next</span>';
    const range = document.createRange();
    range.setStart(root.firstChild!, 2);
    range.setEnd(root.lastChild!.firstChild!, 2);
    const selection = readDescriptionSelection(root, range);
    expect(selection).toEqual({ start: 2, end: 14 });
    const result = editDescriptionStudyMask(root.innerHTML, selection, 'mask');
    expect(result).toHaveProperty('html');
    if ('html' in result) expect(renderStudyDescription(result.html)).toBe(`A ${mask('*****')}<span>xt</span>`);
    range.collapse(true);
    expect(readDescriptionSelection(root, range)).toBeNull();
    expect(readDescriptionSelection(document.createElement('div'), range)).toBeNull();
  });

  it('removes masks from colored spans without removing their color or bold descendants', () => {
    const original = '<span data-study-mask="true" style="color: #abcdef"><strong>secret</strong></span>';
    expect(edit(original, 1, 2, 'unmask')).toBe('<span style="color: #abcdef"><strong>secret</strong></span>');
  });

  it('retains only the exact span marker and safe formatting, stripping hidden payloads and unsafe metadata', () => {
    const html = '<span data-study-mask="true" title="secret" onclick="evil()" style="color: #abcdef">' +
      '<strong>secret</strong><img src="secret"><span data-study-mask="true">nested</span></span>' +
      '<span data-study-mask="false">visible</span><strong data-study-mask="true">also visible</strong><script>evil()</script>';
    const normal = sanitizeDescription(html);
    expect(normal).toContain('<strong>secret</strong>');
    expect(normal).not.toMatch(/onclick|title|src|script|false|<strong data/);
    const study = renderStudyDescription(html);
    expect(study).toBe('<span data-study-mask="true" style="color: #abcdef">*****</span><span>visible</span><strong>also visible</strong>');
    expect(study).not.toMatch(/secret|nested|evil/);
    expect(renderStudyDescription(study)).toBe(study);
  });

  it.each(['', 'Old &amp; safe', '<strong>Bold</strong> <span style="color: #AbCdEf">color</span>', 'first\nsecond', 'first<br>second'])('preserves ordinary description rendering: %s', html => {
    expect(renderStudyDescription(html)).toBe(sanitizeDescription(html));
    expect(sanitizeDescription(sanitizeDescription(html))).toBe(sanitizeDescription(html));
  });

  it('rejects missing, invalid, whitespace-only and split-character selections without altering source', () => {
    for (const selection of [null, { start: -1, end: 2 }, { start: 1, end: 99 }, { start: 1, end: 1 }, { start: 0.1, end: 2 }]) {
      expect(editDescriptionStudyMask('text', selection, 'mask')).toHaveProperty('error');
    }
    expect(editDescriptionStudyMask('a b', { start: 1, end: 2 }, 'mask')).toHaveProperty('error');
    expect(editDescriptionStudyMask('🌍', { start: 0, end: 1 }, 'mask')).toHaveProperty('error');
    expect(editDescriptionStudyMask('text', { start: 0, end: 4 }, 'unmask')).toHaveProperty('error');
  });

  it('fails closed for study rendering without a parser', () => {
    vi.stubGlobal('DOMParser', undefined);
    expect(renderStudyDescription(mask('secret'))).toBe('');
    expect(editDescriptionStudyMask('text', { start: 0, end: 4 }, 'mask')).toHaveProperty('error');
  });
});
