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
          className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-800/40 w-full max-w-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-8 pt-8 pb-4">
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-gray-900 dark:text-gray-100">
                {word.english_word}
              </h2>
              <div className="flex flex-wrap gap-3 items-center">
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
              className="h-10 w-10 flex items-center justify-center rounded-2xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-8 pb-8 space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-[0.18em] mb-3">
                Georgian Definitions
              </h3>
              <div className="flex flex-wrap gap-2">
                {word.georgian_definitions.map((def, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 text-blue-800 dark:text-blue-200 px-3 py-1 rounded-full text-sm font-semibold shadow-sm"
                  >
                    {def}
                  </span>
                ))}
              </div>
            </div>

            {word.description && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-[0.18em]">
                  Description
                </h3>
                <div
                  className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeDescription(word.description),
                  }}
                />
              </div>
            )}
          </div>

          <div className="px-8 pb-8 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-6 py-3 rounded-2xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Close
            </button>
            {onEdit && (
              <button
                onClick={() => onEdit(word)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all"
              >
                Edit
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
