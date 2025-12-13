import React, { useState, useEffect, useRef } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { X, AlertCircle, Bold, Palette, Plus } from 'lucide-react';
import { sanitizeDescription } from '../lib/sanitizeDescription';
import { normalizeEnglishWord } from '../lib/normalizeEnglishWord';
import { applyFormatting } from '../lib/applyFormatting';

/**
 * TEST FILE
 * Purpose: isolate WordModal and check JSX correctness
 */

const isUniqueConstraintError = (error: any) => {
  if (!error) return false;
  return error.code === '23505';
};

export default function WordManagement() {
  const [open, setOpen] = useState(true);

  return (
    <>
      {open && (
        <WordModal
          word={null}
          onClose={() => setOpen(false)}
          onSave={() => setOpen(false)}
          onDuplicateDetected={() => {}}
        />
      )}
    </>
  );
}

function WordModal({
  word,
  onClose,
  onSave,
  onDuplicateDetected
}: {
  word: Word | null;
  onClose: () => void;
  onSave: () => void;
  onDuplicateDetected: (
    existingWord: Word,
    wordData: { englishWord: string; georgianDefs: string[]; description: string }
  ) => void;
}) {
  const { user } = useAuth();

  const [englishWord, setEnglishWord] = useState(word?.english_word || '');
  const [georgianDefs, setGeorgianDefs] = useState<string[]>(['']);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);

  const initialStateRef = useRef({
    englishWord: '',
    georgianDefs: [''],
    description: ''
  });

  useEffect(() => {
    initialStateRef.current = {
      englishWord,
      georgianDefs,
      description
    };
  }, []);

  const isDirty = () => {
    const initial = initialStateRef.current;
    return (
      englishWord !== initial.englishWord ||
      description !== initial.description ||
      georgianDefs.join('|') !== initial.georgianDefs.join('|')
    );
  };

  const handleClose = () => {
    if (isDirty()) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  };

  const handleFormatting = (format: 'bold' | 'color', color?: string) => {
    const textarea = descriptionRef.current;
    if (!textarea) return;

    const result = applyFormatting(
      description,
      { start: textarea.selectionStart, end: textarea.selectionEnd },
      format,
      color
    );

    if (!result) return;
    setDescription(result.nextText);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('words').insert({
        user_id: user.id,
        english_word: englishWord,
        georgian_definitions: georgianDefs,
        description
      });

      if (error) {
        if (isUniqueConstraintError(error)) return;
        throw error;
      }

      onSave();
    } catch (e) {
      alert('Save error');
    } finally {
      setSaving(false);
    }
  };

  const colors = ['#EF4444', '#3B82F6', '#10B981', '#000000'];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-3xl w-full max-w-lg p-6">
        <button onClick={handleClose} className="absolute top-4 right-4">
          <X size={24} />
        </button>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            value={englishWord}
            onChange={e => setEnglishWord(e.target.value)}
            placeholder="English word"
            className="w-full border p-2"
          />

          {georgianDefs.map((def, i) => (
            <input
              key={i}
              value={def}
              onChange={e => {
                const next = [...georgianDefs];
                next[i] = e.target.value;
                setGeorgianDefs(next);
              }}
              className="w-full border p-2"
              placeholder="Georgian definition"
            />
          ))}

          <button type="button" onClick={() => setGeorgianDefs([...georgianDefs, ''])}>
            <Plus size={16} /> Add
          </button>

          <textarea
            ref={descriptionRef}
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full border p-2"
          />

          <div className="flex gap-2">
            <button type="button" onClick={() => handleFormatting('bold')}>
              <Bold size={16} />
            </button>
            <button type="button" onClick={() => setShowColorPicker(v => !v)}>
              <Palette size={16} />
            </button>
          </div>

          {showColorPicker && (
            <div ref={colorPickerRef} className="flex gap-2">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  style={{ background: c, width: 24, height: 24 }}
                  onClick={() => handleFormatting('color', c)}
                />
              ))}
            </div>
          )}

          <button type="submit" disabled={saving}>
            Save
          </button>
        </form>

        {showCloseConfirm && (
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
            <div className="bg-white p-4 rounded-xl">
              <p>Close without saving?</p>
              <button onClick={() => setShowCloseConfirm(false)}>Back</button>
              <button
                onClick={() => {
                  setShowCloseConfirm(false);
                  onClose();
                }}
              >
                Discard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
