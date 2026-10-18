// This browser preference contains no account, History, or selection data.
export const HISTORY_PAGE_SIZE_KEY = 'history-page-size-v1';
export const HISTORY_PAGE_SIZES = [10, 25, 50, 100] as const;
export type HistoryPageSize = typeof HISTORY_PAGE_SIZES[number];

export function readHistoryPageSize(): HistoryPageSize {
  try {
    const stored = localStorage.getItem(HISTORY_PAGE_SIZE_KEY);
    return HISTORY_PAGE_SIZES.find(size => String(size) === stored) ?? 25;
  } catch {
    return 25;
  }
}

export function rememberHistoryPageSize(size: HistoryPageSize) {
  try { localStorage.setItem(HISTORY_PAGE_SIZE_KEY, String(size)); }
  catch { /* Pagination remains usable for this mount when storage is blocked. */ }
}
