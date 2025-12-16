import React, { useEffect, useRef, useState } from "react";
import { AlertCircle, Bold, Palette, Plus, Sparkles, X } from "lucide-react";
import { Word } from "../../../lib/supabase";
import { sanitizeDescription } from "../../../lib/sanitizeDescription";
import { applyFormatting } from "../../../lib/applyFormatting";
import { AddWordResult, WordFormData } from "../useWords";
import ModalPortal from "./ModalPortal";

interface WordModalProps {
  word: Word | null;
  onClose: () => void;
  onSave: () => void;
  onDuplicateDetected: (existingWord: Word, wordData: WordFormData) => void;
  addWord: (wordData: WordFormData) => Promise<AddWordResult>;
  updateWord: (wordId: string, wordData: WordFormData) => Promise<void>;
  checkExistingEnglishWord: (englishWord: string) => Promise<Word | null>;
}

export default function WordModal({
  word,
  onClose,
  onSave,
  onDuplicateDetected,
  addWord,
  updateWord,
  checkExistingEnglishWord,
}: WordModalProps) {
  const [englishWord, setEnglishWord] = useState(word?.english_word || "");
  const [georgianDefs, setGeorgianDefs] = useState<string[]>(
    word?.georgian_definitions || [""]
  );
  const [description, setDescription] = useState(word?.description || "");
  const [saving, setSaving] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const initialStateRef = useRef<{
    englishWord: string;
    georgianDefs: string[];
    description: string;
  }>({
    englishWord: word?.english_word || "",
    georgianDefs: word?.georgian_definitions || [""],
    description: word?.description || "",
  });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    setEnglishWord(word?.english_word || "");
    setGeorgianDefs(word?.georgian_definitions || [""]);
    setDescription(word?.description || "");
    setShowColorPicker(false);
    setShowCloseConfirm(false);
    initialStateRef.current = {
      englishWord: word?.english_word || "",
      georgianDefs: word?.georgian_definitions || [""],
      description: word?.description || "",
    };
  }, [word]);

  const isDirty = () => {
    const initial = initialStateRef.current;
    const defsDirty =
      georgianDefs.length !== initial.georgianDefs.length ||
      georgianDefs.some((def, idx) => def !== initial.georgianDefs[idx]);

    return (
      englishWord !== initial.englishWord ||
      description !== initial.description ||
      defsDirty
    );
  };

  const handleClose = () => {
    if (isDirty()) {
      setShowColorPicker(false);
      setShowCloseConfirm(true);
    } else {
      setShowColorPicker(false);
      onClose();
    }
  };

  const handleFormatting = (format: "bold" | "color", color?: string) => {
    const textarea = descriptionRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const result = applyFormatting(description, { start, end }, format, color);

    if (!result) {
      return;
    }

    setDescription(result.nextText);

    requestAnimationFrame(() => {
      const nextTextarea = descriptionRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(result.nextCursor, result.nextCursor);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setSaving(true);
    try {
      const filteredDefs = georgianDefs.filter((d) => d.trim() !== "");
      const wordData: WordFormData = {
        englishWord,
        georgianDefs: filteredDefs,
        description,
      };

      if (word) {
        await updateWord(word.id, wordData);
        onSave();
      } else {
        const existingWord = await checkExistingEnglishWord(englishWord);
        if (existingWord) {
          onDuplicateDetected(existingWord, wordData);
          return;
        }

        const result = await addWord(wordData);
        if (result.duplicateWord) {
          onDuplicateDetected(result.duplicateWord, wordData);
          return;
        }

        onSave();
      }
    } catch (error: any) {
      alert("Error saving word: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const colors = [
    "#EF4444",
    "#F59E0B",
    "#10B981",
    "#3B82F6",
    "#8B5CF6",
    "#EC4899",
    "#000000",
  ];

  useEffect(() => {
    if (!showColorPicker) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        colorPickerRef.current &&
        !colorPickerRef.current.contains(event.target as Node)
      ) {
        setShowColorPicker(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showColorPicker]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowColorPicker(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <ModalPortal>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
        <div
          className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm
             rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20
             w-full max-w-lg relative transition-all duration-300
             max-h-[85vh] overflow-y-auto overflow-hidden modal-scrollbar"
        >
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 z-10"
          >
            <X size={24} />
          </button>

          <div className="absolute left-4 top-3 -rotate-3">
            <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-white shadow-lg">
              <Sparkles size={14} />
              {word ? "Edit Word" : "New Word"}
            </div>
          </div>

          <div className="p-6 md:p-8 space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-gray-900 dark:text-gray-100 leading-tight">
                {word ? "Refine your entry" : "Add a new word"}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {word
                  ? "Edit the details below to update your vocabulary entry."
                  : "Add a bilingual entry with structured definitions and formatted context."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    English Word
                  </label>
                  <input
                    type="text"
                    value={englishWord}
                    onChange={(e) => setEnglishWord(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/70 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
                    placeholder="Enter the English word"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Georgian Definitions
                  </label>
                  <div className="space-y-3">
                    {georgianDefs.map((def, idx) => (
                      <div key={idx} className="flex gap-2">
                        <input
                          type="text"
                          value={def}
                          onChange={(e) => {
                            const newDefs = [...georgianDefs];
                            newDefs[idx] = e.target.value;
                            setGeorgianDefs(newDefs);
                          }}
                          className="flex-1 px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/70 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
                          placeholder={`Definition ${idx + 1}`}
                          required
                        />
                        {georgianDefs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              const newDefs = georgianDefs.filter(
                                (_, i) => i !== idx
                              );
                              setGeorgianDefs(newDefs);
                            }}
                            className="flex items-center justify-center px-3 rounded-full bg-gray-100/70 dark:bg-gray-700/40 text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50/70 dark:hover:bg-red-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 transition-all duration-200"
                            aria-label="Remove definition"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setGeorgianDefs([...georgianDefs, ""])}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-200 bg-blue-50/70 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all duration-200"
                    >
                      <Plus size={16} />
                      Add definition
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                    Description
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                      <Bold size={14} />
                      <span>Rich text</span>
                    </span>
                  </label>
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => handleFormatting("bold")}
                      className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                    >
                      <Bold size={16} />
                      Bold
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowColorPicker((open) => !open)}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
                      >
                        <Palette size={16} />
                        Color
                      </button>
                      {showColorPicker && (
                        <div
                          ref={colorPickerRef}
                          className="absolute top-full left-0 mt-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg flex gap-2 z-20"
                        >
                          {colors.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => {
                                handleFormatting("color", color);
                                setShowColorPicker(false);
                              }}
                              style={{ backgroundColor: color }}
                              className="w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <textarea
                    ref={descriptionRef}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
                    placeholder="Add additional context or example sentences..."
                  />
                  {description && (
                    <div className="mt-3 p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/60 dark:bg-gray-800/60">
                      <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">
                        Preview
                      </div>
                      <div
                        className="prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: sanitizeDescription(description),
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200 dark:border-gray-700 mt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-full sm:flex-1 px-5 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-gray-200 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full sm:flex-1 px-5 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-60"
                >
                  {saving ? "Saving..." : word ? "Save changes" : "Add word"}
                </button>
              </div>
            </form>
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
                    Keep editing
                  </button>

                  <button
                    onClick={() => {
                      setShowColorPicker(false);
                      setShowCloseConfirm(false);
                      onClose();
                    }}
                    className="w-full sm:flex-1 px-5 py-3 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-xl font-semibold hover:from-red-600 hover:to-orange-600 transition-all duration-200 shadow-lg"
                  >
                    Discard
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
