import React, { useEffect, useRef } from "react";
import {
  Search,
  Plus,
  X,
  Sparkles,
  Trash2,
  CheckSquare,
  ChevronDown,
} from "lucide-react";
import { pageSizeOptions } from "./useWords";

interface WordToolbarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onClearSearch: () => void;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  pageSizeMenuOpen: boolean;
  setPageSizeMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  sortOption: string;
  onSortChange: (value: string) => void;
  someSelected: boolean;
  selectedCount: number;
  onClearSelection: () => void;
  onBulkDelete: () => void;
  onAddWord: () => void;
}

export default function WordToolbar({
  searchTerm,
  onSearchChange,
  onClearSearch,
  pageSize,
  onPageSizeChange,
  pageSizeMenuOpen,
  setPageSizeMenuOpen,
  setPage,
  sortOption,
  onSortChange,
  someSelected,
  selectedCount,
  onClearSelection,
  onBulkDelete,
  onAddWord,
}: WordToolbarProps) {
  const pageSizeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pageSizeMenuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        pageSizeMenuRef.current &&
        !pageSizeMenuRef.current.contains(event.target as Node)
      ) {
        setPageSizeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPageSizeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [pageSizeMenuOpen, setPageSizeMenuOpen]);

  return (
    <div className="relative bg-white/90 dark:bg-gray-900/70 rounded-3xl shadow-2xl border border-slate-100/60 dark:border-gray-800/80 p-6 transition-all duration-300 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-white shadow-lg">
            <Sparkles size={16} />
            <span className="text-sm font-semibold">Manage words</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Smoother tooling for creating, editing, and reviewing entries.
          </p>
        </div>

        <div className="relative z-30 flex flex-wrap gap-3 justify-end items-center">
          {someSelected && (
            <div className="flex flex-wrap items-center content-center gap-2 rounded-2xl border border-rose-100/80 dark:border-rose-900/50 bg-gradient-to-r from-rose-50 to-amber-50 dark:from-rose-900/20 dark:to-amber-900/20 px-3 py-2 text-rose-700 dark:text-rose-200 shadow-sm h-12">
              <span className="text-sm font-semibold">
                {selectedCount} selected (this page)
              </span>
              <button
                onClick={onClearSelection}
                className="inline-flex items-center justify-center h-9 text-xs font-semibold rounded-full px-3 bg-white/70 dark:bg-white/10 text-rose-700 dark:text-rose-200 hover:bg-white/90 dark:hover:bg-white/20 transition"
              >
                Clear
              </button>
              <button
                onClick={onBulkDelete}
                className="inline-flex items-center justify-center h-9 gap-2 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-3 text-white shadow hover:from-rose-600 hover:to-orange-600 transition"
              >
                <Trash2 size={16} />
                Delete
              </button>
            </div>
          )}
          <button
            onClick={onAddWord}
            className="inline-flex items-center justify-center h-12 gap-2 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg font-semibold"
          >
            <Plus size={18} />
            Add word
          </button>
        </div>
      </div>

      <div className="relative z-20 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <div className="relative h-12">
          <Search
            className="pointer-events-none absolute z-10 left-4 top-1/2 -translate-y-1/2 text-indigo-400 dark:text-indigo-300"
            size={20}
          />

          {searchTerm.length > 0 && (
            <button
              type="button"
              onClick={onClearSearch}
              className="absolute z-10 right-3 top-1/2 -translate-y-1/2 text-indigo-400 hover:text-indigo-600 dark:text-indigo-300 dark:hover:text-indigo-200 transition"
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setPage(0);
            }}
            placeholder="Search English or Georgian words..."
            className="w-full h-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 backdrop-blur-sm pl-12 pr-12 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-inner focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex items-center h-12 gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 backdrop-blur-sm pl-3 pr-[0.2rem] shadow-inner">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Page size
            </span>
            <div
              ref={pageSizeMenuRef}
              className={`relative flex-1 flex justify-end ${
                pageSizeMenuOpen ? "z-[90]" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => setPageSizeMenuOpen((open) => !open)}
                className={`inline-flex items-center justify-between w-full sm:w-44 h-10 px-3 rounded-xl border border-white/40 dark:border-gray-700/70 bg-gradient-to-r from-white to-gray-50 dark:from-gray-800 dark:to-gray-700 text-sm font-semibold text-gray-900 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all duration-150 ${
                  pageSizeMenuOpen ? "ring-2 ring-blue-500/30" : ""
                }`}
              >
                <span className="truncate">{pageSize} per page</span>
                <ChevronDown
                  className={`ml-2 text-gray-500 dark:text-gray-400 transition-transform ${
                    pageSizeMenuOpen ? "rotate-180" : ""
                  }`}
                  size={18}
                />
              </button>
              {pageSizeMenuOpen && (
                <div className="absolute right-0 top-[110%] w-full sm:w-44 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden z-[75]">
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {pageSizeMenuOpen &&
                      pageSizeOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            onPageSizeChange(option);
                            setPage(0);
                            setPageSizeMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between px-4 py-2 text-sm font-semibold transition-colors ${
                            option === pageSize
                              ? "bg-blue-50/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
                              : "text-gray-800 dark:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-gray-700/70"
                          }`}
                        >
                          {option} per page
                          {option === pageSize && (
                            <CheckSquare
                              size={16}
                              className="text-blue-600 dark:text-blue-300"
                            />
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="inline-flex items-center gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 backdrop-blur-sm px-4 py-2 shadow-inner">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Sort
            </span>
            <select
              value={sortOption}
              onChange={(e) => {
                onSortChange(e.target.value);
                setPage(0);
              }}
              className="h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/70 px-3 text-sm font-semibold text-gray-900 dark:text-gray-100 shadow-inner focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            >
              <option value="alpha-asc">Alphabetical (A → Z)</option>
              <option value="alpha-desc">Alphabetical (Z → A)</option>
              <option value="recent">Recently added</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
