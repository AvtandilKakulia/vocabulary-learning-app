import React from "react";

interface PaginationProps {
  page: number;
  totalPages: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
}

export default function Pagination({
  page,
  totalPages,
  setPage,
}: PaginationProps) {
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 border-t border-gray-200 dark:border-gray-700">
      <div className="text-sm text-gray-600 dark:text-gray-400">
        Page {page + 1} of {totalPages || 1}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setPage(page - 1)}
          disabled={page === 0}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 text-sm font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition"
        >
          Previous
        </button>
        <button
          onClick={() => setPage(page + 1)}
          disabled={page >= totalPages - 1}
          className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 text-sm font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}
