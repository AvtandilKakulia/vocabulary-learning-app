import { sanitizeDescription } from './sanitizeDescription';

const marker = 'span[data-study-mask="true"]';
export interface DescriptionSelection { start: number; end: number }

function parseDescription(description: string): HTMLElement {
  // A fragment wrapper keeps leading whitespace out of the HTML parser's
  // before-body insertion mode, which would otherwise discard it.
  const doc = new DOMParser().parseFromString(`<div>${sanitizeDescription(description)}</div>`, 'text/html');
  return doc.body.firstElementChild as HTMLElement;
}

/** Presentation only: never write this output back to a word or session snapshot. */
export function renderStudyDescription(description: string): string {
  // Without a DOM parser we cannot safely distinguish marked HTML from text.
  if (typeof DOMParser === 'undefined') return '';
  const root = parseDescription(description);
  root.querySelectorAll(marker).forEach(element => {
    // Only transform outermost regions; a legacy nested mask is not a second
    // question. Keep edge whitespace (including formatted BRs) in the DOM.
    if (element.parentElement?.closest(marker)) return;
    const text = descriptionText(element);
    if (!text.trim()) return;
    const leading = text.length - text.trimStart().length;
    const end = text.trimEnd().length;
    const before = slice(element, 0, leading);
    const after = slice(element, end, text.length);
    element.replaceChildren(...Array.from(before?.childNodes ?? []), root.ownerDocument.createTextNode('*****'), ...Array.from(after?.childNodes ?? []));
  });
  return root.innerHTML;
}

// Treat a visible line break as one character so selections across lines map
// identically in the source projection and detached, sanitized document.
function length(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === 'BR') return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + length(child), 0);
}

function descriptionText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return '\n';
  return Array.from(node.childNodes).map(descriptionText).join('');
}

/** Map serialized textarea offsets, not a search for the selected phrase.
 * This conservative scanner only identifies indivisible source tokens. The DOM
 * parser decodes entities and verifies the complete text projection; all edits
 * still go through editDescriptionStudyMask's sanitized DOM transformation.
 */
export function readDescriptionSourceSelection(source: string, selection: DescriptionSelection):
  { selection: DescriptionSelection; error?: never } | { error: string; selection?: never } {
  const invalid = { error: 'Select complete text without cutting HTML tags, entities or characters. Select only text between complete formatting tags; ambiguous HTML must be corrected before masking.' };
  if (typeof DOMParser === 'undefined') return invalid;
  const { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) return invalid;
  const parser = new DOMParser();
  const boundaries = new Map<number, number>([[0, 0]]);
  const stack: string[] = [];
  let text = '';
  let index = 0;
  while (index < source.length) {
    let next = index + 1;
    let value = source[index];
    if (value === '<') {
      // Unsupported/ambiguous HTML cannot be mapped safely.
      const name = source.slice(index).match(/^<(\/?)(strong|span|br)(?=[\s/>])/i);
      if (!name) return invalid;
      let quote = '';
      while (next < source.length) {
        const char = source[next];
        if (quote) { if (char === quote) quote = ''; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === '>') break;
        next++;
      }
      if (next === source.length) return invalid;
      next++;
      const tag = name[2].toLowerCase();
      const token = source.slice(index, next);
      if (name[1]) {
        if (!/^<\/(strong|span)\s*>$/i.test(token) || stack.pop() !== tag) return invalid;
      } else if (tag !== 'br') {
        if (/\/\s*>$/.test(token)) return invalid;
        stack.push(tag);
      }
      value = tag === 'br' ? '\n' : '';
    } else if (value === '&') {
      const entity = source.slice(index).match(/^&(?:#[xX][0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/i)?.[0];
      if (entity) {
        next = index + entity.length;
        value = parser.parseFromString(`<div>${entity}</div>`, 'text/html').body.textContent ?? '';
      }
    } else if (value === '\r') {
      next += source[next] === '\n' ? 1 : 0;
      value = '\n';
    } else {
      value = String.fromCodePoint(source.codePointAt(index)!);
      next = index + value.length;
    }
    text += value;
    boundaries.set(next, text.length);
    index = next;
  }
  if (stack.length) return invalid;
  if (descriptionText(parseDescription(source)) !== text) return invalid;
  const from = boundaries.get(start), to = boundaries.get(end);
  if (from === undefined || to === undefined || from === to) return invalid;
  return { selection: { start: from, end: to } };
}

/** Clone a text interval with its formatting ancestors; never splice HTML strings. */
function slice(node: Node, start: number, end: number): Node | null {
  const size = length(node);
  if (end <= 0 || start >= size) return null;
  if (node.nodeType === Node.TEXT_NODE) {
    return node.ownerDocument!.createTextNode((node.textContent ?? '').slice(Math.max(0, start), end));
  }
  const copy = node.cloneNode(false);
  let offset = 0;
  for (const child of Array.from(node.childNodes)) {
    const part = slice(child, start - offset, end - offset);
    if (part) copy.appendChild(part);
    offset += length(child);
  }
  return copy;
}

type MaskEdit = { html: string; message: string } | { error: string };

export function editDescriptionStudyMask(
  description: string, selection: DescriptionSelection | null, action: 'mask' | 'unmask',
): MaskEdit {
  if (!selection || typeof DOMParser === 'undefined') {
    return { error: 'Select text in Description first.' };
  }
  const root = parseDescription(description);
  const doc = root.ownerDocument;
  let { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > length(root)) {
    return { error: 'The selection has changed. Select text in Description again.' };
  }
  let selected = slice(root, start, end) as HTMLElement;
  if (action === 'mask') {
    const text = descriptionText(selected);
    if (!text.trim()) return { error: 'Select a word or phrase, not only whitespace.' };
    // Accidental selection of adjacent spaces must not join surrounding words.
    start += text.length - text.trimStart().length;
    end -= text.length - text.trimEnd().length;
    selected = slice(root, start, end) as HTMLElement;
  }

  // Reject boundaries inside surrogate pairs, even for programmatic selections.
  let offset = 0;
  let splitCharacter = false;
  const overlapping: HTMLElement[] = [];
  const inspect = (node: Node) => {
    const size = length(node);
    if (node instanceof HTMLElement && node.matches(marker) && start < offset + size && end > offset) {
      overlapping.push(node);
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      for (const boundary of [start - offset, end - offset]) {
        if (boundary > 0 && boundary < text.length && /[\uD800-\uDBFF]/.test(text[boundary - 1]) && /[\uDC00-\uDFFF]/.test(text[boundary])) splitCharacter = true;
      }
      offset += size;
    } else if (node.nodeName === 'BR') offset += 1;
    else Array.from(node.childNodes).forEach(inspect);
  };
  inspect(root);
  if (splitCharacter) return { error: 'Select complete characters in Description.' };

  if (action === 'unmask') {
    if (!overlapping.length) return { error: 'The selection does not include a study mask.' };
    for (const element of overlapping) {
      element.removeAttribute('data-study-mask');
      // Keep color and any nested formatting when removing the marker.
      if (!element.attributes.length) element.replaceWith(...Array.from(element.childNodes));
    }
    return { html: root.innerHTML, message: 'Study mask removed from the selected region(s). Original text retained.' };
  }
  if (overlapping.length) return { error: 'This selection already includes a study mask. Remove it before masking again.' };

  const before = slice(root, 0, start);
  const after = slice(root, end, length(root));
  const masked = doc.createElement('span');
  masked.setAttribute('data-study-mask', 'true');
  masked.append(...Array.from(selected.childNodes));
  root.replaceChildren(...Array.from(before?.childNodes ?? []), masked, ...Array.from(after?.childNodes ?? []));
  return { html: root.innerHTML, message: 'Selected text will appear as ***** in active Practice and Test questions.' };
}
