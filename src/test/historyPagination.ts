import { fireEvent } from '@testing-library/react';

const navigation = () => document.querySelector('[aria-label="History pagination (top)"]');
const button = (name: string) => Array.from(navigation()?.querySelectorAll('button') ?? [])
  .find(element => element.textContent === name);
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-history-id]'));

// Full-collection read/order assertions use the largest supported UI page to
// avoid redundant transitions. Inspect every rendered ID once and restore the
// original size. Dedicated UI tests exercise page position and the default 25.
export function allHistoryRows() {
  const sizeControl = document.querySelector<HTMLSelectElement>('section[aria-label="History display controls"] select');
  if (!sizeControl) return rows();
  const originalSize = sizeControl.value;
  fireEvent.change(sizeControl, { target: { value: '100' } });
  const pageNumber = () => Number(navigation()?.textContent?.match(/Page (\d+) of/)?.[1] ?? 1);
  const pages = Number(navigation()?.textContent?.match(/of (\d+)/)?.[1] ?? 1);
  const visited = new Map([[pageNumber(), rows()]]);
  while (button('Previous') && !button('Previous')!.disabled) {
    fireEvent.click(button('Previous')!);
    visited.set(pageNumber(), rows());
  }
  let steps = 0;
  while (visited.size < pages && button('Next') && !button('Next')!.disabled) {
    fireEvent.click(button('Next')!);
    visited.set(pageNumber(), rows());
    if (++steps > 1000) throw new Error('History page navigation did not terminate');
  }
  fireEvent.change(sizeControl, { target: { value: originalSize } });
  return [...visited].sort(([a], [b]) => a - b).flatMap(([, entries]) => entries);
}

export function findHistoryRow(id: string) {
  let row = rows().find(element => element.dataset.historyId === id);
  if (row) return row;
  for (const direction of ['Next', 'Previous']) {
    let steps = 0;
    while (button(direction) && !button(direction)!.disabled) {
      fireEvent.click(button(direction)!);
      row = rows().find(element => element.dataset.historyId === id);
      if (row) return row;
      if (++steps > 1000) throw new Error('History record navigation did not terminate');
    }
  }
  return undefined;
}
