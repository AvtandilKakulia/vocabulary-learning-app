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
          className="relative bg-white/95 dark:bg-slate-900/92 backdrop-blur-xl rounded-3xl shadow-[0_25px_70px_-30px_rgba(15,23,42,0.65)] border border-white/50 dark:border-white/10 w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col ring-1 ring-black/5 dark:ring-white/5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-8 pt-8 pb-6 bg-gradient-to-b from-white/80 via-white/60 to-white/40 dark:from-slate-900/80 dark:via-slate-900/70 dark:to-slate-900/60 border-b border-white/70 dark:border-white/10">
            <div className="space-y-4">
              <h2 className="text-4xl font-black text-gray-900 dark:text-gray-100 leading-tight tracking-tight drop-shadow-[0_1px_1px_rgba(0,0,0,0.06)]">
                {word.english_word}
              </h2>
              <div className="flex flex-wrap gap-2 items-center text-sm text-gray-600/90 dark:text-gray-300/90">
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
              className="h-10 w-10 flex items-center justify-center rounded-full bg-white/80 dark:bg-gray-800/70 text-gray-600 dark:text-gray-300 border border-white/60 dark:border-white/10 shadow-md hover:bg-white dark:hover:bg-gray-700/80 transition-all"
            >
              <X size={18} />
            </button>
          </div>

          <div className="px-8 pb-8 pt-6 overflow-hidden bg-gradient-to-b from-white/70 via-white/40 to-white/30 dark:from-slate-900/70 dark:via-slate-900/60 dark:to-slate-900/50">
            <div className="rounded-2xl border border-white/70 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 shadow-inner divide-y divide-white/70 dark:divide-white/10">
              <div className="p-6 space-y-4">
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-[0.18em]">
                  Georgian Definitions
                </h3>
                <div className="flex flex-wrap gap-2">
                  {word.georgian_definitions.map((def, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-2 bg-white/85 dark:bg-slate-800/70 text-blue-900 dark:text-blue-100 px-3 py-1 rounded-full text-sm font-semibold shadow-sm ring-1 ring-blue-100/80 dark:ring-indigo-900/50"
                    >
                      {def}
                    </span>
                  ))}
                </div>
              </div>
              {word.description && (
                <div className="p-6 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-[0.18em]">
                    Description
                  </h3>
                  <div
                    className="text-base text-gray-700 dark:text-gray-200 leading-relaxed whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto pr-3 pl-3 py-3 rounded-xl bg-white/80 dark:bg-slate-900/60 border border-white/70 dark:border-white/10 shadow-inner modal-scrollbar"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeDescription(word.description),
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="px-8 pb-8 pt-4 flex justify-end bg-gradient-to-t from-white/70 via-white/60 to-transparent dark:from-gray-950/60 dark:via-gray-900/60 dark:to-transparent border-t border-white/60 dark:border-white/5">
            {onEdit && (
              <button
                onClick={() => onEdit(word)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold shadow-lg hover:shadow-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-400 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950"
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
