import React, { useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import { Word } from "../../../lib/supabase";
import { sanitizeDescription } from "../../../lib/sanitizeDescription";
import ModalPortal from "./ModalPortal";

interface DuplicateWordModalProps {
  existingWords: Word[];
  adding: boolean;
  error: string | null;
  onAddAnotherMeaning: () => void;
  onEditExisting: (word: Word) => void;
  onCancel: () => void;
}

export default function DuplicateWordModal({
  existingWords,
  adding,
  error,
  onAddAnotherMeaning,
  onEditExisting,
  onCancel,
}: DuplicateWordModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !adding) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [adding, onCancel]);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]"
        onMouseDown={() => {
          if (!adding) onCancel();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-word-title"
          className="relative bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 md:p-8 w-full max-w-xl max-h-[85vh] overflow-y-auto modal-scrollbar"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={adding}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 disabled:opacity-60"
            aria-label="Back to draft"
          >
            <X size={22} />
          </button>

          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <AlertCircle className="text-white" size={28} />
            </div>
            <h3
              id="duplicate-word-title"
              className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2"
            >
              Word Already Exists
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              Review your existing entries. You can add your draft as another
              meaning or edit one of these entries.
            </p>
          </div>

          <ul className="space-y-4 mb-6">
            {existingWords.map((existingWord) => (
              <li
                key={existingWord.id}
                className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/50 dark:to-blue-900/20 rounded-2xl p-5 border border-gray-200 dark:border-gray-600"
              >
                <div className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-3">
                  {existingWord.english_word}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {existingWord.georgian_definitions.map((def, idx) => (
                    <span
                      key={idx}
                      className="inline-block bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm"
                    >
                      {def}
                    </span>
                  ))}
                </div>
                {existingWord.description && (
                  <div
                    className="text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-600 pt-3 break-words"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeDescription(existingWord.description),
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => onEditExisting(existingWord)}
                  disabled={adding}
                  className="mt-4 px-4 py-2 border-2 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-200 rounded-xl font-semibold bg-white/70 dark:bg-gray-800/60 hover:bg-blue-50 dark:hover:bg-gray-700 transition-all duration-200 disabled:opacity-60"
                >
                  Edit existing entry
                </button>
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={adding}
              className="w-full sm:flex-1 px-5 py-3 border-2 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-2xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 disabled:opacity-60"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onAddAnotherMeaning}
              disabled={adding}
              autoFocus
              className="w-full sm:flex-1 px-5 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg disabled:opacity-60"
            >
              {adding ? "Adding..." : "Add as another meaning"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
