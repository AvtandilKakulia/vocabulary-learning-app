import React, { useState, useEffect } from 'react';
import { Word } from '../lib/supabase';
import { X, AlertCircle } from 'lucide-react';
import { sanitizeDescription } from '../lib/sanitizeDescription';

/**
 * TEST FILE
 * Purpose: isolate DuplicateWordModal JSX
 */

export default function WordManagement() {
  return (
    <DuplicateWordModal
      existingWord={{
        id: '1',
        english_word: 'test',
        georgian_definitions: ['ტესტი'],
        description: 'example',
        user_id: 'u1',
        created_at: '',
      } as Word}
      onMakeUnique={() => {}}
      onCopy={() => {}}
      onCancel={() => {}}
    />
  );
}

function DuplicateWordModal({
  existingWord,
  onMakeUnique,
  onCopy,
  onCancel
}: {
  existingWord: Word;
  onMakeUnique: () => void;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowCloseConfirm(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
      onMouseDown={() => setShowCloseConfirm(true)}
    >
      <div
        className="relative bg-white rounded-3xl p-8 w-full max-w-md"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button onClick={() => setShowCloseConfirm(true)} className="absolute top-3 right-3">
          <X size={22} />
        </button>

        <h3 className="text-xl font-bold mb-4">Word already exists</h3>

        <div className="mb-4">
          <strong>{existingWord.english_word}</strong>
          <div className="flex gap-2 mt-2">
            {existingWord.georgian_definitions.map((def, idx) => (
              <span key={idx} className="px-2 py-1 bg-gray-200 rounded">
                {def}
              </span>
            ))}
          </div>
          {existingWord.description && (
            <div
              className="mt-2 text-sm"
              dangerouslySetInnerHTML={{ __html: sanitizeDescription(existingWord.description) }}
            />
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onCopy}>Copy</button>
          <button onClick={onMakeUnique}>Make unique</button>
        </div>

        {showCloseConfirm && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="bg-white p-4 rounded-xl">
              <AlertCircle />
              <p>Close without saving?</p>
              <button onClick={() => setShowCloseConfirm(false)}>Back</button>
              <button onClick={onCancel}>Discard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
