import { sanitizeDescription } from './sanitizeDescription';

const marker = 'span[data-study-mask="true"]';
export interface DescriptionSelection { start: number; end: number }

/** Presentation only: never write this output back to a word or session snapshot. */
export function renderStudyDescription(description: string): string {
  // Without a DOM parser we cannot safely distinguish marked HTML from text.
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(sanitizeDescription(description), 'text/html');
  doc.body.querySelectorAll(marker).forEach(element => { element.textContent = '*****'; });
  return doc.body.innerHTML;
}

// Treat a visible line break as one character so selections across lines map
// identically in the preview and the detached, sanitized document.
function length(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === 'BR') return 1;
  return Array.from(node.childNodes).reduce((total, child) => total + length(child), 0);
}

export function readDescriptionSelection(root: HTMLElement, range: Range): DescriptionSelection | null {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = length(prefix.cloneContents());
  return { start, end: start + length(range.cloneContents()) };
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
    return { error: 'Select text in the Description preview first.' };
  }
  const doc = new DOMParser().parseFromString(sanitizeDescription(description), 'text/html');
  const root = doc.body;
  const { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > length(root)) {
    return { error: 'The selection has changed. Select text in the preview again.' };
  }
  const selected = slice(root, start, end) as HTMLElement;
  if (action === 'mask' && !selected.textContent?.trim()) return { error: 'Select a word or phrase, not only whitespace.' };

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
  if (splitCharacter) return { error: 'Select complete characters in the preview.' };

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
