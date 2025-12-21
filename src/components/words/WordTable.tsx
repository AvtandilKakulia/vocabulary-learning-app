import React from "react";
import {
  Edit2,
  Trash2,
  CheckSquare,
  Square,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { Word } from "../../lib/supabase";
import { sanitizeDescription } from "../../lib/sanitizeDescription";
import { formatRelativeDate } from "../../lib/formatRelativeDate";
import { partOfSpeechStyles } from "./partOfSpeechStyles";

interface WordTableProps {
  words: Word[];
  loading: boolean;
  allSelected: boolean;
  selectedIds: Set<string>;
  onToggleSelectAll: () => void;
  onToggleSelect: (id: string) => void;
  onEdit: (word: Word) => void;
  onDelete: (word: Word) => void;
  onView: (word: Word) => void;
}

export default function WordTable({
  words,
  loading,
  allSelected,
  selectedIds,
  onToggleSelectAll,
  onToggleSelect,
  onEdit,
  onDelete,
  onView,
}: WordTableProps) {
  const partOfSpeechLabels: Record<string, string> = {
    noun: "Noun",
    verb: "Verb",
    adjective: "Adjective",
    adverb: "Adverb",
    preposition: "Preposition",
    conjunction: "Conjunction",
    pronoun: "Pronoun",
    unspecified: "Unspecified",
  };

  return (
    <div className="bg-white/90 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-100/60 dark:border-gray-800/80 overflow-hidden transition-all duration-300">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
          <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600">
            <tr>
              <th className="px-4 py-4 text-left w-12">
                <button
                  onClick={onToggleSelectAll}
                  className={`p-2 rounded-xl border transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                    allSelected
                      ? "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700 bg-gradient-to-br from-white to-blue-50 dark:from-gray-800 dark:to-gray-800 shadow-inner"
                      : "text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/70 dark:hover:bg-gray-700/60"
                  }`}
                  disabled={words.length === 0}
                >
                  {allSelected ? (
                    <CheckSquare
                      size={20}
                      className="text-blue-600 dark:text-blue-400"
                    />
                  ) : (
                    <Square size={20} />
                  )}
                </button>
              </th>
              <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                English Word
              </th>
              <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Georgian Definitions
              </th>
              <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider hidden sm:table-cell">
                Description
              </th>
              <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white/50 dark:bg-gray-800/50 divide-y divide-gray-200 dark:divide-gray-700 backdrop-blur-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4"></div>
                  <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">
                    Loading words...
                  </div>
                </td>
              </tr>
            ) : words.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center">
                  <div className="w-24 h-24 mx-auto bg-gradient-to-br from-gray-400 to-gray-500 rounded-full flex items-center justify-center mb-6">
                    <svg
                      className="w-12 h-12 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                      />
                    </svg>
                  </div>
                  <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">
                    No words yet
                  </div>
                  <p className="mt-2 text-gray-500 dark:text-gray-400">
                    Start by adding your first word to build your vocabulary
                    list.
                  </p>
                </td>
              </tr>
            ) : (
              words.map((word) => (
                <tr
                  key={word.id}
                  className="hover:bg-blue-50/50 dark:hover:bg-gray-800/60 transition-colors"
                  onClick={() => onView(word)}
                >
                  <td className="px-4 py-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(word.id);
                      }}
                      className={`p-2 rounded-xl border transition-all duration-200 ${
                        selectedIds.has(word.id)
                          ? "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700 bg-gradient-to-br from-white to-blue-50 dark:from-gray-800 dark:to-gray-800 shadow-inner"
                          : "text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/70 dark:hover:bg-gray-700/60"
                      }`}
                    >
                      {selectedIds.has(word.id) ? (
                        <CheckSquare
                          size={18}
                          className="text-blue-600 dark:text-blue-400"
                        />
                      ) : (
                        <Square size={18} />
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="inline-flex items-center gap-4">
                      {word.part_of_speech === "verb" &&
                      word.is_irregular_verb &&
                      word.past_simple &&
                      word.past_participle ? (
                        <div className="inline-flex items-center gap-2 text-base font-bold text-gray-900 dark:text-gray-100">
                          <span>{word.english_word}</span>
                          <ArrowRight
                            size={16}
                            className="text-gray-500 dark:text-gray-400"
                          />
                          <span>{word.past_simple}</span>
                          <ArrowRight
                            size={16}
                            className="text-gray-500 dark:text-gray-400"
                          />
                          <span>{word.past_participle}</span>
                        </div>
                      ) : (
                        <span className="text-base font-bold text-gray-900 dark:text-gray-100">
                          {word.english_word}
                        </span>
                      )}
                      {word.part_of_speech &&
                        word.part_of_speech !== "unspecified" && (
                          <span
                            className={`inline-flex items-center text-[10px] font-semibold px-2.5 py-1 rounded-full shadow-sm ${
                              partOfSpeechStyles[word.part_of_speech] ||
                              partOfSpeechStyles.unspecified
                            }`}
                          >
                            {partOfSpeechLabels[word.part_of_speech] ||
                              word.part_of_speech}
                          </span>
                        )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">
                      {formatRelativeDate(word.created_at)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-2">
                      {word.georgian_definitions.map((def, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 text-blue-800 dark:text-blue-200 px-3 py-1 rounded-full text-sm font-semibold shadow-sm"
                        >
                          <Sparkles
                            size={16}
                            className="text-blue-600 dark:text-indigo-300"
                            strokeWidth={2.5}
                          />
                          {def}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <div
                      className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeDescription(word.description || ""),
                      }}
                    />
                  </td>
                  <td className="px-6 py-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEdit(word);
                        }}
                        className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50/80 dark:hover:bg-gray-700/60 transition-all duration-200"
                        aria-label="Edit"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(word);
                        }}
                        className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 text-red-500 dark:text-red-400 hover:bg-red-50/80 dark:hover:bg-gray-700/60 transition-all duration-200"
                        aria-label="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
