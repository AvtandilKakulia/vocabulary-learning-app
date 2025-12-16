import React from "react";
import { AlertCircle } from "lucide-react";
import ModalPortal from "./ModalPortal";

interface BulkDeleteModalProps {
  count: number;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function BulkDeleteModal({
  count,
  deleting,
  onClose,
  onConfirm,
}: BulkDeleteModalProps) {
  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
        <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
          <div className="text-center mb-6">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <AlertCircle className="text-white" size={32} />
            </div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
              Delete {count} Word{count > 1 ? "s" : ""}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              This will permanently remove the selected words from your
              vocabulary list.
            </p>
          </div>

          <div className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border border-orange-200 dark:border-orange-800 rounded-2xl p-4 mb-6">
            <p className="text-sm text-orange-800 dark:text-orange-300">
              You are about to delete <strong>{count}</strong> word
              {count > 1 ? "s" : ""}. This action cannot be undone.
            </p>
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
              {deleting
                ? "Deleting..."
                : `Delete ${count} Word${count > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
