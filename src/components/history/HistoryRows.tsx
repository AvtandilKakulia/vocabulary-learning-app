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
  return (
    <div
      data-history-id={record.id}
      className={`p-6 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-blue-50/40 dark:hover:bg-gray-700 ${
        selected
          ? 'bg-blue-50/60 dark:bg-blue-950/60'
          : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4 flex-1">
          <button
            aria-label={`Select record from ${date}`}
            aria-pressed={selected}
            onClick={() => onSelect(record.id)}
            disabled={disabled}
            className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 p-1"
          >
            {selected ? (
              <CheckSquare size={20} className="text-blue-600 dark:text-blue-300" />
            ) : (
              <Square size={20} />
            )}
          </button>

          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-4 mb-2">
              <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-300 dark:to-purple-300">
                {percent}%
              </div>
              <div className="text-lg font-semibold">
                ({record.correct_count}/{record.total_words}){' '}
                {scoreEmoji(percent)}
              </div>

              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold dark:bg-blue-950 dark:text-blue-200">
                {record.test_direction === 'en-to-geo'
                  ? 'English → Georgian'
                  : 'Georgian → English'}
              </span>
            </div>

            <div className="text-sm text-gray-500 dark:text-gray-400">
              {date}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
            className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 p-2 text-red-600 dark:text-red-300"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {expanded && record.mistakes.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="text-lg font-semibold mb-4">
            Mistakes ({record.mistakes.length}):
          </div>

          <div className="grid gap-4">
            {record.mistakes.map((m, idx) => (
              <div
                key={idx}
                className="p-4 bg-red-50 border border-red-200 rounded-xl dark:bg-red-950 dark:border-red-800"
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
                  Your answer:{' '}
                  <span className="font-semibold text-red-700 dark:text-red-300">
                    {m.user_answer || '(empty)'}
                  </span>
                </div>

                <div className="text-sm">
                  Correct:{' '}
                  <span className="font-semibold text-green-700 dark:text-green-300">
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
