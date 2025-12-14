import React from "react";
import { AlertCircle, X } from "lucide-react";
import { Word } from "../../../lib/supabase";
import { sanitizeDescription } from "../../../lib/sanitizeDescription";

interface DeleteWordModalProps {
  word: Word;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeleteWordModal({
  word,
  deleting,
  onClose,
  onConfirm,
}: DeleteWordModalProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <AlertCircle className="text-white" size={32} />
          </div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
            Delete Word
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            This action cannot be undone.
          </p>
        </div>

        <div className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/50 dark:to-blue-900/50 rounded-2xl p-6 mb-6 border border-gray-200 dark:border-gray-600">
          <div className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-3">
            {word.english_word}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {word.georgian_definitions.map((def, idx) => (
              <span
                key={idx}
                className="inline-block bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm"
              >
                {def}
              </span>
            ))}
          </div>
          {word.description && (
            <div className="text-sm text-gray-600 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-600 pt-3">
              <div
                dangerouslySetInnerHTML={{
                  __html: sanitizeDescription(word.description),
                }}
              />
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl font-semibold hover:from-orange-600 hover:to-red-600 disabled:opacity-50 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
          >
            {deleting ? "Deleting..." : `Delete "${word.english_word}"`}
          </button>
        </div>
      </div>
    </div>
  );
}
