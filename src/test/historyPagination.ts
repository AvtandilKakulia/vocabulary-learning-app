import { fireEvent } from '@testing-library/react';

const sizeControl = () => document.querySelector<HTMLSelectElement>('section[aria-label="History display controls"] select');
const list = () => document.querySelector<HTMLElement>('[data-history-rows]');
const rows = (container = list()) => Array.from(container?.querySelectorAll<HTMLElement>('[data-history-id]') ?? []);

function pagination() {
  const nav = document.querySelector('[aria-label="History pagination (top)"]');
  if (!nav) return undefined;
  const status = nav.querySelector('p')!;
  const buttons = Array.from(nav.querySelectorAll('button'));
  const previous = buttons.find(button => button.textContent === 'Previous')!;
  const next = buttons.find(button => button.textContent === 'Next')!;
  const position = () => {
    const match = status.textContent?.match(/^Page (\d+) of (\d+)$/);
    if (!match) throw new Error('Missing History page position');
    return { page: Number(match[1]), pages: Number(match[2]) };
  };
  return { previous, next, position };
}

interface HistoryRowSnapshot { id: string; textContent: string }

// Read scalar snapshots from each real UI page, so assertions do not retain
// detached row subtrees. Cache only the mounted list and pagination controls.
export function allHistoryRows(): HistoryRowSnapshot[] {
  const control = sizeControl();
  const originalSize = control?.value;
  if (control && pagination() && originalSize !== '100') {
    fireEvent.change(control, { target: { value: '100' } });
  }
  const container = list();
  const nav = pagination();
  const visited = new Map<number, HistoryRowSnapshot[]>();
  const ids = new Set<string>();
  const collect = () => {
    const page = nav?.position().page ?? 1;
    if (visited.has(page)) return;
    visited.set(page, rows(container).map(row => {
      const id = row.dataset.historyId;
      if (!id || ids.has(id)) throw new Error(`Missing or duplicate rendered History ID: ${id}`);
      ids.add(id);
      return { id, textContent: row.textContent ?? '' };
    }));
  };
  collect();
  if (nav) {
    const { page, pages } = nav.position();
    // Size changes retain the first visible record; traversal may start in the
    // middle. Visit the nearer end first and collect revisited pages only once.
    const directions = page - 1 <= pages - page ? [nav.previous, nav.next] : [nav.next, nav.previous];
    for (const button of directions) {
      while (visited.size < pages && !button.disabled) {
        const before = nav.position().page;
        fireEvent.click(button);
        const after = nav.position();
        if (after.pages !== pages || after.page !== before + (button === nav.next ? 1 : -1)) {
          throw new Error('History page navigation did not advance');
        }
        collect();
      }
    }
    if (visited.size !== pages) throw new Error('History traversal omitted pages');
  }
  if (control && control.value !== originalSize) fireEvent.change(control, { target: { value: originalSize } });
  return [...visited].sort(([a], [b]) => a - b).flatMap(([, entries]) => entries);
}

export function findHistoryRow(id: string) {
  const current = rows().find(row => row.dataset.historyId === id);
  if (current) return current;
  const control = sizeControl();
  const originalSize = control?.value;
  if (control && pagination() && originalSize !== '100') {
    fireEvent.change(control, { target: { value: '100' } });
  }
  const found = findOnPages(id) !== undefined;
  if (control && control.value !== originalSize) {
    fireEvent.change(control, { target: { value: originalSize } });
  }
  // Restoring the size retains the coarse page's first record, not necessarily
  // the target. Return its live node only after reaching its original-size page.
  return found ? findOnPages(id) : undefined;
}

function findOnPages(id: string) {
  const container = list();
  const find = () => rows(container).find(row => row.dataset.historyId === id);
  let row = find();
  if (row) return row;
  const nav = pagination();
  if (!nav) return undefined;
  for (const button of [nav.next, nav.previous]) {
    while (!button.disabled) {
      const before = nav.position().page;
      fireEvent.click(button);
      if (nav.position().page !== before + (button === nav.next ? 1 : -1)) {
        throw new Error('History record navigation did not advance');
      }
      row = find();
      if (row) return row;
    }
  }
  return undefined;
}
