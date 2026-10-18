// Browser-local display settings only; no account or vocabulary data.
export const WORDS_PAGE_SIZE_KEY = 'words-page-size-v1';
export const WORDS_SORT_KEY = 'words-sort-v1';
export const pageSizeOptions = [10, 25, 50, 100];
export type SortOption = 'alpha-asc' | 'alpha-desc' | 'recent';

export function readWordsPageSize(): number {
  try {
    const stored = localStorage.getItem(WORDS_PAGE_SIZE_KEY);
    return pageSizeOptions.find(size => String(size) === stored) ?? 10;
  } catch {
    return 10;
  }
}

export function readWordsSort(): SortOption {
  try {
    const stored = localStorage.getItem(WORDS_SORT_KEY);
    return stored === 'alpha-desc' || stored === 'recent' ? stored : 'alpha-asc';
  } catch {
    return 'alpha-asc';
  }
}

export function rememberWordsPageSize(size: number): void {
  try {
    localStorage.setItem(WORDS_PAGE_SIZE_KEY, String(size));
  } catch {
    // Storage may be blocked; the current in-memory selection remains usable.
  }
}

export function rememberWordsSort(sort: SortOption): void {
  try {
    localStorage.setItem(WORDS_SORT_KEY, sort);
  } catch {
    // Storage may be blocked; the current in-memory selection remains usable.
  }
}
