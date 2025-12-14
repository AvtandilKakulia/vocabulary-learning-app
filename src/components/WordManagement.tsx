import React, { useEffect, useState } from 'react';
import { Sparkles, Layers, CheckSquare } from 'lucide-react';
import { Word } from '../lib/supabase';
import WordToolbar from './words/WordToolbar';
import WordTable from './words/WordTable';
import Pagination from './words/Pagination';
import WordModal from './words/modals/WordModal';
import DeleteWordModal from './words/modals/DeleteWordModal';
import BulkDeleteModal from './words/modals/BulkDeleteModal';
import DuplicateWordModal from './words/modals/DuplicateWordModal';
import { useWords, WordFormData } from './words/useWords';

export default function WordManagement() {
  const {
    words,
    loading,
    searchTerm,
    setSearchTerm,
    debouncedSearchTerm,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalCount,
    loadWords,
    deleteWord,
    bulkDeleteWords,
    checkExistingEnglishWord,
    addWord,
    updateWord,
  } = useWords();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteModalWord, setDeleteModalWord] = useState<Word | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateWord, setDuplicateWord] = useState<Word | null>(null);
  const [newWordData, setNewWordData] = useState<WordFormData | null>(null);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, debouncedSearchTerm]);

  const toggleSelectAll = () => {
    if (selectedIds.size === words.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(words.map(w => w.id)));
    }
};

    const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
     };

     const handleCopyDefinition = async () => {
    if (duplicateWord && newWordData) {
      try {
        const result = await addWord({
          ...newWordData,
          georgianDefs: [...duplicateWord.georgian_definitions]
        });

        if (result.duplicateWord) {
          setDuplicateWord(result.duplicateWord);
          setNewWordData({ ...newWordData, georgianDefs: [...duplicateWord.georgian_definitions] });
          setShowDuplicateModal(true);
          return;
        }

        await loadWords();
      } catch (error: any) {
        alert('Error adding word: ' + error.message);
      }
      }
    setShowDuplicateModal(false);
    setDuplicateWord(null);
    setNewWordData(null);
  };

  const handleIgnoreDuplicate = async () => {
    if (newWordData) {
       try {
        const result = await addWord(newWordData);

        if (result.duplicateWord) {
          setDuplicateWord(result.duplicateWord);
          setNewWordData(newWordData);
          setShowDuplicateModal(true);
          return;
        }

        await loadWords();
      } catch (error: any) {
        alert('Error adding word: ' + error.message);
      }
    }
    setShowDuplicateModal(false);
    setDuplicateWord(null);
    setNewWordData(null);
  };

  const handleCancelDuplicate = () => {
    setShowDuplicateModal(false);
    setDuplicateWord(null);
    setNewWordData(null);
    setShowAddModal(false);
    setEditingWord(null);
  };

  const handleDeleteWord = async (id: string) => {
    setDeleting(true);
    try {
      await deleteWord(id);
      setDeleteModalWord(null);
      await loadWords();
    } catch (error: any) {
      alert('Error deleting word: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDeleteWords = async () => {
    if (selectedIds.size === 0) return;

    setDeleting(true);
    try {
      await bulkDeleteWords(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowBulkDeleteModal(false);
      await loadWords();
      } catch (error: any) {
        alert('Error deleting words: ' + error.message);
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const allSelected = words.length > 0 && selectedIds.size === words.length;
  const someSelected = selectedIds.size > 0;
  const selectionRatio = words.length ? Math.min((selectedIds.size / words.length) * 100, 100) : 0;

  return (
    <>
      <div className="space-y-8"></div>
      <div className="relative overflow-hidden rounded-3xl border border-white/10 dark:border-white/5 bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-800 text-white shadow-2xl">
          <div
            className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_35%),radial-gradient(circle_at_80%_0,rgba(14,165,233,0.2),transparent_40%),radial-gradient(circle_at_40%_80%,rgba(168,85,247,0.18),transparent_42%)]"
            aria-hidden
          />
          <div className="relative grid gap-8 md:grid-cols-[1.15fr_0.85fr] px-6 py-8 md:px-10 md:py-10">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-100 shadow-sm backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Live word workspace
              </div>
              <div className="flex items-start gap-3">
                <Sparkles className="mt-1 text-indigo-200" size={24} />
                <div>
                  <h1 className="text-3xl md:text-4xl font-black leading-tight drop-shadow-[0_10px_35px_rgba(59,130,246,0.35)]">
                    Word Studio
                  </h1>
                  <p className="mt-3 text-lg text-slate-100/85 max-w-2xl">
                    Curate a bilingual library with a calmer, glassy surface and clearer actions.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-indigo-50">
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 shadow-sm backdrop-blur">
                  <Layers size={16} />
                  Organize faster
                </span>
                <span className="flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-2 shadow-sm backdrop-blur">
                  <CheckSquare size={16} />
                  Bulk ready
                </span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 shadow-xl">
                <p className="text-xs uppercase tracking-widest text-indigo-100/80 mb-1">Total words</p>
                <p className="text-3xl font-extrabold">{totalCount}</p>
                <p className="text-xs text-indigo-100/70 mt-2">Synced to your account</p>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 p-4 shadow-xl flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-widest text-indigo-100/80">
                  <span>Selected (this page)</span>
                  <span>{selectionRatio.toFixed(0)}%</span>
                </div>
                <p className="text-3xl font-extrabold">{selectedIds.size}</p>
                {!loading && words.length > 0 && selectedIds.size > 0 && (
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden border border-white/20">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400"
                      style={{ width: `${selectionRatio}%` }}
                    />
                  </div>
                )}
                <p className="text-xs text-indigo-100/70">Selection applies to this page</p>
              </div>
            </div>
          </div>
        </div>

<WordToolbar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onClearSearch={() => {
            setSearchTerm('');
            setPage(0);
          }}
          pageSize={pageSize}
          onPageSizeChange={(size) => setPageSize(size)}
          pageSizeMenuOpen={pageSizeMenuOpen}
          setPageSizeMenuOpen={setPageSizeMenuOpen}
          setPage={setPage}
          someSelected={someSelected}
          selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          onBulkDelete={() => setShowBulkDeleteModal(true)}
          onAddWord={() => setShowAddModal(true)}
        />

        <WordTable
          words={words}
          loading={loading}
          allSelected={allSelected}
          selectedIds={selectedIds}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelect={toggleSelect}
          onEdit={(word) => {
            setEditingWord(word);
            setShowAddModal(true);
          }}
          onDelete={setDeleteModalWord}
        />

        <Pagination page={page} totalPages={totalPages} setPage={setPage} />
      </div>

      {showAddModal && (
        <WordModal
          word={editingWord}
          onClose={() => {
            setShowAddModal(false);
            setEditingWord(null);
          }}
          onSave={async () => {
            setShowAddModal(false);
            setEditingWord(null);
            await loadWords();
          }}
          onDuplicateDetected={(existingWord, wordData) => {
            setDuplicateWord(existingWord);
            setNewWordData(wordData);
            setShowDuplicateModal(true);
          }}
          addWord={addWord}
          updateWord={updateWord}
          checkExistingEnglishWord={checkExistingEnglishWord}
        />
      )}

      {deleteModalWord && (
        <DeleteWordModal
          word={deleteModalWord}
          deleting={deleting}
          onClose={() => setDeleteModalWord(null)}
          onConfirm={() => handleDeleteWord(deleteModalWord.id)}
        />
      )}

      {showBulkDeleteModal && (
        <BulkDeleteModal
          count={selectedIds.size}
          deleting={deleting}
          onClose={() => setShowBulkDeleteModal(false)}
          onConfirm={handleBulkDeleteWords}
        />
      )}

      {showDuplicateModal && duplicateWord && (
        <DuplicateWordModal
          existingWord={duplicateWord}
          onMakeUnique={handleIgnoreDuplicate}
          onCopy={handleCopyDefinition}
          onCancel={handleCancelDuplicate}
        />
      )}
    </>
  );
}
