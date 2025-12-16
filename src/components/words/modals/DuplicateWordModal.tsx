import React, { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { Word } from "../../../lib/supabase";
import { sanitizeDescription } from "../../../lib/sanitizeDescription";
import ModalPortal from "./ModalPortal";

interface DuplicateWordModalProps {
  existingWord: Word;
  onMakeUnique: () => void;
  onCopy: () => void;
  onCancel: () => void;
}

export default function DuplicateWordModal({
  existingWord,
  onMakeUnique,
  onCopy,
  onCancel,
}: DuplicateWordModalProps) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowCloseConfirm(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]"
        onMouseDown={() => setShowCloseConfirm(true)}
      >
        <div
          className="relative bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => setShowCloseConfirm(true)}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200"
            aria-label="Close"
          >
            <X size={22} />
          </button>

          <div className="text-center mb-6">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-purple-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <AlertCircle className="text-white" size={32} />
            </div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
              Word Already Exists
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              You already have this word in your vocabulary list.
            </p>
          </div>

          <div className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/50 dark:to-blue-900/20 rounded-2xl p-6 mb-6 border border-gray-200 dark:border-gray-600">
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
              <div className="text-sm text-gray-600 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-600 pt-3">
                <div
                  dangerouslySetInnerHTML={{
                    __html: sanitizeDescription(existingWord.description),
                  }}
                />
              </div>
            )}
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 mb-6">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Would you like to copy this word's definitions to your new entry,
              or create a unique definition?
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onCopy}
              className="w-full sm:flex-1 px-6 py-3 border-2 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-200 rounded-2xl font-semibold bg-white/70 dark:bg-gray-800/60 hover:bg-blue-50 dark:hover:bg-gray-700 transition-all duration-200"
            >
              Copy Definitions
            </button>
            <button
              onClick={onMakeUnique}
              autoFocus
              className="w-full sm:flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
            >
              Make Unique Definition
            </button>
          </div>

          {showCloseConfirm && (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-20 rounded-3xl">
              <div className="bg-white/95 dark:bg-gray-800/95 rounded-2xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 w-full max-w-sm space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="text-blue-500" size={24} />
                  <div>
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Close without saving?
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Closing now will discard your filled information.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setShowCloseConfirm(false)}
                    className="w-full sm:flex-1 px-5 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
                  >
                    Go back
                  </button>
                  <button
                    onClick={() => {
                      setShowCloseConfirm(false);
                      onCancel();
                    }}
                    className="w-full sm:flex-1 px-5 py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-xl font-semibold hover:from-red-600 hover:to-orange-600 transition-all duration-200 shadow-lg"
                  >
                    Close and discard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
