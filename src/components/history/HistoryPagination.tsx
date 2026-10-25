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
      className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-slate-50 dark:bg-gray-800 border border-slate-300 dark:border-gray-700 rounded-2xl">
      <p aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">Page {page + 1} of {totalPages}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={disabled || page === 0}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 px-4 py-2 rounded-xl border bg-white dark:bg-gray-800 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-blue-500 border-slate-300 dark:border-gray-500 hover:bg-slate-50 dark:hover:bg-gray-700">
          Previous
        </button>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={disabled || page >= totalPages - 1}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 px-4 py-2 rounded-xl border bg-white dark:bg-gray-800 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-blue-500 border-slate-300 dark:border-gray-500 hover:bg-slate-50 dark:hover:bg-gray-700">
          Next
        </button>
      </div>
    </nav>
  );
}
