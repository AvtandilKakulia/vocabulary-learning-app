import React, { useEffect } from "react";
import { ArrowRight, X } from "lucide-react";
import { Word } from "../../../lib/supabase";
import { sanitizeDescription } from "../../../lib/sanitizeDescription";
import { partOfSpeechStyles } from "../partOfSpeechStyles";
import ModalPortal from "./ModalPortal";

interface ViewWordModalProps {
  word: Word;
  onClose: () => void;
  onEdit?: (word: Word) => void;
}

export default function ViewWordModal({
  word,
  onClose,
  onEdit,
}: ViewWordModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

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

  const renderVerbInfo = () => {
    if (word.part_of_speech !== "verb") {
      return null;
    }

    if (word.is_irregular_verb && word.past_simple && word.past_participle) {
      return (
        <div className="flex flex-wrap gap-3 items-center text-sm text-gray-700 dark:text-gray-200">
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-semibold">
            Irregular verb
          </span>
          <div className="flex flex-wrap items-center gap-2 font-semibold">
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
        </div>
      );
    }

    return (
      <div className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-sm font-semibold">
        Regular verb
      </div>
    );
  };

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]"
        onClick={onClose}
      >
        <div
          className="relative bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 flex-none">
            <div className="space-y-3">
              <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {word.english_word}
              </h2>
              <div className="flex flex-wrap gap-2 items-center text-sm text-gray-600 dark:text-gray-300">
                {word.part_of_speech &&
                  word.part_of_speech !== "unspecified" && (
                    <span
                      className={`inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded-full shadow-sm ${
                        partOfSpeechStyles[word.part_of_speech] ||
                        partOfSpeechStyles.unspecified
                      }`}
                    >
                      {partOfSpeechLabels[word.part_of_speech] ||
                        word.part_of_speech}
                    </span>
                  )}
                {renderVerbInfo()}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="h-10 w-10 flex items-center justify-center rounded-xl bg-white/80 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 border border-white/40 dark:border-gray-700/60 shadow-md transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-6 space-y-6 flex-none">
            <div className="space-y-3 flex-none">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                Georgian Definitions
              </h3>
              <div className="flex flex-wrap gap-2">
                {word.georgian_definitions.map((def, idx) => (
                  <span
                    key={idx}
                    className="inline-flex rounded-full px-4 py-1.5 text-sm font-semibold bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/40 dark:to-purple-900/40 text-blue-800 dark:text-blue-200"
                  >
                    {def}
                  </span>
                ))}
              </div>
            </div>

            {word.description && (
              <div className="space-y-3 flex-none">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                  Description
                </h3>
                <div
                  className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/40 dark:to-blue-900/30 p-5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto modal-scrollbar"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeDescription(word.description),
                  }}
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex justify-end flex-none">
            <button
              onClick={() => onEdit?.(word)}
              className="px-6 py-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-md hover:shadow-lg transition-all hover:from-blue-700 hover:to-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-400 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
