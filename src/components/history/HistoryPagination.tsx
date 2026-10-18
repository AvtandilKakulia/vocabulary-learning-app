interface Props {
  position: 'top' | 'bottom';
  page: number;
  totalPages: number;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

export default function HistoryPagination({ position, page, totalPages, disabled, onPageChange }: Props) {
  return (
    <nav aria-label={`History pagination (${position})`}
      className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      <p aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">Page {page + 1} of {totalPages}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={disabled || page === 0}
          className="px-4 py-2 rounded-xl border bg-white dark:bg-gray-800 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-blue-500">
          Previous
        </button>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= totalPages - 1}
          className="px-4 py-2 rounded-xl border bg-white dark:bg-gray-800 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-blue-500">
          Next
        </button>
      </div>
    </nav>
  );
}
