import { describe, expect, it, vi } from 'vitest';
import { editDescriptionStudyMask, readDescriptionSelection, readDescriptionSourceSelection, renderStudyDescription } from './descriptionStudyMask';
import { sanitizeDescription } from './sanitizeDescription';

const mask = (text: string) => `<span data-study-mask="true">${text}</span>`;
function edit(html: string, start: number, end: number, action: 'mask' | 'unmask' = 'mask') {
  const result = editDescriptionStudyMask(html, { start, end }, action);
  if ('error' in result) throw new Error(result.error);
  return result.html;
}

describe('Description study masking', () => {
  it('keeps incidental edge spaces outside a newly applied mask', () => {
    expect(edit('The company will postpone the meeting.', 16, 26))
      .toBe(`The company will ${mask('postpone')} the meeting.`);
  });

  it('preserves edge whitespace in previously saved masks without modifying their source', () => {
    const original = `The company will${mask(' postpone ')}the meeting.`;
    expect(renderStudyDescription(original)).toBe(`The company will${mask(' ***** ')}the meeting.`);
    expect(original).toContain(' postpone ');
  });

  it.each([
    ['postpone the meeting', 0, 9, '***** the meeting'],
    ['Please postpone, if needed.', 7, 15, 'Please *****, if needed.'],
    ['next Monday', 0, 11, '*****'],
    ['reconsideration', 2, 10, 're*****ation'],
    [' \t\u00a0ქართული\t \u00a0', 0, 13, ' \t\u00a0*****\t \u00a0'],
  ] as const)('preserves surrounding characters when masking %s', (source, start, end, expected) => {
    const marked = edit(source, start, end);
    const dom = document.createElement('div');
    dom.innerHTML = renderStudyDescription(marked);
    expect(dom.textContent).toBe(expected);
    expect(dom.querySelector('[data-study-mask]')!.textContent).toBe('*****');
    dom.innerHTML = marked;
    expect(dom.textContent).toBe(source);
    expect(dom.querySelector('[data-study-mask]')!.textContent).toBe(source.slice(start, end).trim());
  });

  it('keeps formatted legacy edge whitespace and BRs, hides internal spaces and preserves punctuation', () => {
    const source = `Before${mask('<strong> \t<br>next Monday&nbsp;</strong><span style="color: #abcdef"><br>\t</span>')},${mask('ქართული ')}after`;
    const expected = `Before${mask('<strong> \t<br></strong>*****<strong>&nbsp;</strong><span style="color: #abcdef"><br>\t</span>')},${mask('***** ')}after`;
    expect(renderStudyDescription(source)).toBe(expected);
    expect(renderStudyDescription(expected)).toBe(expected);
    expect(renderStudyDescription(source)).not.toMatch(/next|Monday|ქართული/);
    expect(sanitizeDescription(source)).toContain('next Monday');
  });

  it('leaves selected edge line breaks outside new masks, and keeps whitespace-only legacy regions as whitespace', () => {
    expect(edit('A<br>next Monday\nB', 1, 14)).toBe(`A<br>${mask('next Monday')}<br>B`);
    expect(renderStudyDescription(mask(' \t&nbsp;<br>'))).toBe(mask(' \t&nbsp;<br>'));
  });

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

describe('Description textarea source selection mapping', () => {
  const mappedEdit = (source: string, selected: string, occurrence: 'first' | 'last' = 'first', action: 'mask' | 'unmask' = 'mask') => {
    const start = occurrence === 'last' ? source.lastIndexOf(selected) : source.indexOf(selected);
    const mapped = readDescriptionSourceSelection(source, { start, end: start + selected.length });
    expect(mapped.error).toBeUndefined();
    const result = editDescriptionStudyMask(source, mapped.selection!, action);
    if ('error' in result) throw new Error(result.error);
    return result.html;
  };

  it('uses exact offsets for repeated phrases, including formatted duplicates and attribute text', () => {
    const source = 'same <strong>same</strong> <span title="same > same" style="color: #abcdef">same</span>';
    const marked = mappedEdit(source, 'same', 'last');
    expect(marked).toBe('same <strong>same</strong> ' + mask('<span style="color: #abcdef">same</span>'));
  });

  it.each(['ქართული', '🌍', '&amp;', '&#x1F30D;', '&NotEqualTilde;'])('maps complete Unicode/entity tokens: %s', selected => {
    const source = `Before <strong>${selected}</strong> after`;
    expect(renderStudyDescription(mappedEdit(source, selected))).toBe(`Before ${mask('*****')} after`);
  });

  it('maps selections across balanced formatting, newlines and entities using the DOM text projection', () => {
    const selected = 'one</strong> &amp; <span style="color: #abcdef">ქართული<br>two';
    const source = `<strong>${selected}</span> after`;
    expect(renderStudyDescription(mappedEdit(source, selected))).toBe(`${mask('*****')} after`);
    expect(mappedEdit('A\r\nB', 'B')).toBe(`A<br>${mask('B')}`);
  });

  it('removes a saved mask from its source text, preserving color and bold markup', () => {
    const source = `before ${mask('<strong>ქართული &amp; text</strong>')} <span style="color: #abcdef">after</span>`;
    expect(mappedEdit(source, 'ქართული', 'first', 'unmask'))
      .toBe('before <strong>ქართული &amp; text</strong> <span style="color: #abcdef">after</span>');
  });

  it.each([
    ['<strong>text</strong>', 2, 10],
    ['<span style="color: #abcdef">text</span>', 14, 20],
    ['A &amp; B', 3, 7],
    ['A &#x1F30D; B', 2, 6],
    ['A 🌍 B', 3, 4],
    ['<strong>text</strong>', 0, 8],
    ['<strong><span>text</strong></span>', 14, 18],
    ['<strong>text', 8, 12],
    ['<script>text</script>safe', 8, 12],
    ['<b>text</b>', 3, 7],
    ['A &amp B', 0, 1],
    ['<!-- comment -->text', 16, 20],
    ['2 < 3 text', 6, 10],
  ] as const)('rejects ambiguous source or an indivisible boundary: %s [%i,%i]', (source, start, end) => {
    expect(readDescriptionSourceSelection(source, { start, end }).error).toContain('Preview');
  });

  it('never keeps unsafe attributes when a safe text interval is transformed', () => {
    const source = '<span onclick="evil()" style="color: red">safe</span> &amp; sound';
    const output = mappedEdit(source, 'safe');
    expect(output).toBe(`${mask('<span>safe</span>')} &amp; sound`);
    expect(renderStudyDescription(output)).not.toMatch(/evil|onclick|safe/);
  });
});
