import { memo, useCallback, useState } from 'react';
import { Trash2, ChevronDown, ChevronUp, CheckSquare, Square } from 'lucide-react';
import type { TestHistory } from '../../lib/supabase';
import { sanitizeDescription } from '../../lib/sanitizeDescription';

interface Actions {
  disabled: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  scoreEmoji: (score: number) => string;
}
interface RowProps extends Actions {
  record: TestHistory;
  selected: boolean;
  expanded: boolean;
  onExpand: (id: string) => void;
}

const HistoryRow = memo(function HistoryRow({ record, selected, expanded, disabled, onSelect, onDelete, onExpand, scoreEmoji }: RowProps) {
  const percent = Math.round(record.correct_count / record.total_words * 100);
  const date = new Date(record.test_date).toLocaleString();
  const summary = <>
    <span className="flex flex-wrap items-center gap-4 mb-2">
      <span className="text-2xl font-bold text-slate-900 dark:bg-gradient-to-r dark:from-blue-300 dark:to-purple-300 dark:bg-clip-text dark:text-transparent">{percent}%</span>
      <span className="text-lg font-semibold">({record.correct_count}/{record.total_words}){' '}{scoreEmoji(percent)}</span>
      <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold dark:bg-blue-950 dark:text-blue-200">
        {record.test_direction === 'en-to-geo' ? 'English → Georgian' : 'Georgian → English'}
      </span>
    </span>
    <span className="block text-sm text-slate-600 dark:text-gray-400">{date}</span>
  </>;
  return (
    <div
      data-history-id={record.id}
      className={`p-4 sm:p-6 border-b border-slate-400/70 dark:border-gray-700 text-gray-900 dark:text-gray-100 dark:hover:bg-gray-700 ${
        selected
          ? 'bg-blue-100 hover:bg-blue-200 dark:bg-blue-950/60'
          : 'odd:bg-white even:bg-slate-50 hover:bg-blue-50 dark:odd:bg-transparent dark:even:bg-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2 sm:gap-4 flex-1">
          <button
            aria-label={`Select record from ${date}`}
            aria-pressed={selected}
            onClick={() => onSelect(record.id)}
            disabled={disabled}
            className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 shrink-0 p-1"
          >
            {selected ? (
              <CheckSquare size={20} className="text-blue-600 dark:text-blue-300" />
            ) : (
              <Square size={20} />
            )}
          </button>

          {record.mistakes.length > 0 ? (
            <button type="button" aria-label={`${expanded ? 'Collapse' : 'Expand'} record from ${date}: ${percent}% (${record.correct_count}/${record.total_words}), ${record.test_direction === 'en-to-geo' ? 'English → Georgian' : 'Georgian → English'}`}
              aria-expanded={expanded} onClick={() => onExpand(record.id)}
              className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:focus-visible:ring-blue-300">
              {summary}
            </button>
          ) : <div className="min-w-0 flex-1">{summary}</div>}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {record.mistakes.length > 0 && (
            <button
              aria-label={expanded ? "Hide mistakes" : "Show mistakes"}
              aria-expanded={expanded}
              onClick={() =>
                onExpand(record.id)
              }
              className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 p-2"
            >
              {expanded ? (
                <ChevronUp size={20} />
              ) : (
                <ChevronDown size={20} />
              )}
            </button>
          )}

          <button
            aria-label={`Delete record from ${date}`}
            onClick={() => onDelete(record.id)}
            disabled={disabled}
            className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:focus-visible:ring-red-400 dark:focus-visible:ring-offset-gray-800 p-2 rounded-xl border border-transparent bg-transparent hover:bg-red-100 dark:hover:bg-red-900"
          >
            <Trash2 size={18} className="text-red-600 dark:text-red-400" />
          </button>
        </div>
      </div>

      {expanded && record.mistakes.length > 0 && (
        <div className="mt-6 pt-6 border-t border-slate-300 dark:border-gray-700">
          <div className="text-lg font-semibold mb-4">
            Mistakes ({record.mistakes.length}):
          </div>

          <div className="grid gap-4">
            {record.mistakes.map((m, idx) => (
              <div
                key={idx}
                className="min-w-0 break-words p-4 bg-slate-100 border border-slate-300 rounded-xl dark:bg-gray-900 dark:border-red-900/60"
              >
                <div className="font-bold text-lg mb-2">
                  {m.question_prompt ?? m.english_word}
                </div>
                {m.description?.trim() && (
                  <div
                    className="text-sm text-gray-600 mb-2 break-words dark:text-gray-300"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeDescription(m.description),
                    }}
                  />
                )}

                <div className="text-sm mb-1">
                  <span className="font-bold text-red-700 dark:text-red-300">Your answer:</span>{' '}
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {m.user_answer || '(empty)'}
                  </span>
                </div>

                <div className="text-sm">
                  <span className="font-bold text-green-700 dark:text-green-300">Correct:</span>{' '}
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {m.correct_definitions.join(', ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>

  );
});

// Expansion is local to the bounded list. It neither recomputes full-history
// statistics nor rerenders unrelated rows; keys and expansion always use IDs.
export default function HistoryRows({ records, selectedIds, ...actions }: Actions & {
  records: TestHistory[];
  selectedIds: Set<string>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpanded = useCallback((id: string) => setExpandedId(previous => previous === id ? null : id), []);
  return <div data-history-rows>{records.map(record => (
    <HistoryRow key={record.id} record={record} selected={selectedIds.has(record.id)}
      expanded={expandedId === record.id} onExpand={toggleExpanded} {...actions} />
  ))}</div>;
}
