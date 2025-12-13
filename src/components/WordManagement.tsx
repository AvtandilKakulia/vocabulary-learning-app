import React, { useState, useEffect, useRef } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Search, Edit2, Trash2, Plus, X, AlertCircle, CheckSquare, Square, Bold, Palette, Sparkles, Layers, ChevronDown } from 'lucide-react';

export default function WordManagement() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteModalWord, setDeleteModalWord] = useState<Word | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [duplicateWord, setDuplicateWord] = useState<Word | null>(null);
  const [newWordData, setNewWordData] = useState<{
    englishWord: string;
    georgianDefs: string[];
    description: string;
  } | null>(null);

  useEffect(() => {
    loadWords();
  }, [page, pageSize, searchTerm]);

  // Clear selections when page changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, searchTerm]);

  async function loadWords() {
    if (!user) return;

    setLoading(true);
    try {
      let query = supabase
        .from('words')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id) // Filter by current user
        .order('english_word', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (searchTerm) {
        query = query.or(
          `english_word.ilike.%${searchTerm}%,georgian_definitions.cs.[\"${searchTerm}\"]`
        );
      }

      const { data, error, count } = await query;

      if (error) throw error;
      setWords(data || []);
      setTotalCount(count || 0);
    } catch (error: any) {
      console.error('Error loading words:', error);
    } finally {
      setLoading(false);
    }
  }

  async function deleteWord(id: string) {
    if (!user) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('words')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id); // Ensure user can only delete their own words

      if (error) throw error;
      setDeleteModalWord(null);
      loadWords();
    } catch (error: any) {
      alert('Error deleting word: ' + error.message);
    } finally {
      setDeleting(false);
    }
  }

  async function bulkDeleteWords() {
    if (!user || selectedIds.size === 0) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('words')
        .delete()
        .in('id', Array.from(selectedIds))
        .eq('user_id', user.id); // Ensure user can only delete their own words

      if (error) throw error;
      setSelectedIds(new Set());
      setShowBulkDeleteModal(false);
      loadWords();
    } catch (error: any) {
      alert('Error deleting words: ' + error.message);
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelectAll() {
    if (selectedIds.size === words.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(words.map(w => w.id)));
    }
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const allSelected = words.length > 0 && selectedIds.size === words.length;
  const someSelected = selectedIds.size > 0;
  const selectionRatio = totalCount ? Math.min((selectedIds.size / totalCount) * 100, 100) : 0;

  const handleCopyDefinition = () => {
    if (duplicateWord && newWordData) {
      // Continue with adding the word but with copied definitions
      addWordWithData({
        ...newWordData,
        georgianDefs: [...duplicateWord.georgian_definitions]
      });
    }
    setShowDuplicateModal(false);
    setDuplicateWord(null);
    setNewWordData(null);
  };

  const handleIgnoreDuplicate = () => {
    if (newWordData) {
      // Continue with unique definitions
      addWordWithData(newWordData);
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

  const addWordWithData = async (wordData: {
    englishWord: string;
    georgianDefs: string[];
    description: string;
  }) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('words')
        .insert({
          user_id: user.id,
          english_word: wordData.englishWord,
          georgian_definitions: wordData.georgianDefs.filter(d => d.trim() !== ''),
          description: wordData.description || null,
        });

      if (error) throw error;
      loadWords();
      setShowAddModal(false);
    } catch (error: any) {
      alert('Error adding word: ' + error.message);
    }
  };

  return (
    <>
      <div className="space-y-8">
        {/* Header Section */}
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
              <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur p-4 shadow-xl">
                <p className="text-xs uppercase tracking-widest text-indigo-100/80 mb-1">Total words</p>
                <p className="text-3xl font-extrabold">{totalCount}</p>
                <p className="text-xs text-indigo-100/70 mt-2">Synced to your account</p>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur p-4 shadow-xl flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-widest text-indigo-100/80">
                  <span>Selected</span>
                  <span>{selectionRatio.toFixed(0)}%</span>
                </div>
                <p className="text-3xl font-extrabold">{selectedIds.size}</p>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden border border-white/20">
                  <div className="h-full bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400" style={{ width: `${selectionRatio}%` }} />
                </div>
                <p className="text-xs text-indigo-100/70">Ready for bulk actions</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/90 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-100/60 dark:border-gray-800/80 p-6 transition-all duration-300 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-white shadow-lg">
                <Sparkles size={16} />
                <span className="text-sm font-semibold">Manage words</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Smoother tooling for creating, editing, and reviewing entries.</p>
            </div>

            <div className="flex flex-wrap gap-3 justify-end">
              {someSelected && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-100/80 dark:border-rose-900/50 bg-gradient-to-r from-rose-50 to-amber-50 dark:from-rose-900/20 dark:to-amber-900/20 px-3 py-2 text-rose-700 dark:text-rose-200 shadow-sm">
                  <span className="text-sm font-semibold">{selectedIds.size} selected</span>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="text-xs font-semibold rounded-full px-3 py-1 bg-white/70 dark:bg-white/10 text-rose-700 dark:text-rose-200 hover:bg-white/90 dark:hover:bg-white/20 transition"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowBulkDeleteModal(true)}
                    className="flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-3 py-1 text-white shadow hover:from-rose-600 hover:to-orange-600 transition"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              )}
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg font-semibold"
              >
                <Plus size={18} />
                Add word
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 transform text-gray-400 dark:text-gray-500" size={20}/>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(0);
                }}
                placeholder="Search English or Georgian words..."
                className="w-full pl-12 pr-4 py-3 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/80 dark:bg-gray-800/70 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200 shadow-inner"
              />
            </div>
            <div className="flex gap-3">
              <div className="relative w-full">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(0);
                  }}
                  className="w-full appearance-none pr-12 pl-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/90 dark:bg-gray-800/80 backdrop-blur-sm text-gray-900 dark:text-gray-100 transition-all duration-200 shadow-inner"
                >
                  <option value={10}>10 per page</option>
                  <option value={25}>25 per page</option>
                  <option value={50}>50 per page</option>
                  <option value={100}>100 per page</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400" size={18} />
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white/90 dark:bg-gray-900/70 backdrop-blur-xl rounded-3xl shadow-2xl border border-slate-100/60 dark:border-gray-800/80 overflow-hidden transition-all duration-300">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600">
                <tr>
                  <th className="px-4 py-4 text-left w-12">
                    <button
                      onClick={toggleSelectAll}
                      className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 rounded-lg hover:bg-white/50 dark:hover:bg-gray-600/50 transition-all duration-200"
                      disabled={words.length === 0}
                    >
                      {allSelected ? (
                        <CheckSquare size={20} className="text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Square size={20} />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider w-12">
                    #
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    English Word
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Georgian Definitions
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider hidden sm:table-cell">
                    Description
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white/50 dark:bg-gray-800/50 divide-y divide-gray-200 dark:divide-gray-700 backdrop-blur-sm">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4"></div>
                      <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">Loading words...</div>
                    </td>
                  </tr>
                ) : words.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="w-24 h-24 mx-auto bg-gradient-to-br from-gray-400 to-gray-500 rounded-full flex items-center justify-center mb-6">
                        <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        No words found
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400">
                        Add your first word to get started!
                      </p>
                    </td>
                  </tr>
                ) : (
                  words.map((word, idx) => (
                    <tr key={word.id} className={`hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-purple-50/50 dark:hover:from-gray-700/50 dark:hover:to-gray-600/50 ${selectedIds.has(word.id) ? 'bg-gradient-to-r from-blue-50/80 to-purple-50/80 dark:from-blue-900/20 dark:to-purple-900/20' : ''} transition-all duration-200`}>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => toggleSelect(word.id)}
                          className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 rounded-lg hover:bg-white/50 dark:hover:bg-gray-700/50 transition-all duration-200"
                        >
                          {selectedIds.has(word.id) ? (
                            <CheckSquare size={20} className="text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Square size={20} />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-gray-600 dark:text-gray-400">
                        {page * pageSize + idx + 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-lg font-bold text-gray-900 dark:text-gray-100">
                        {word.english_word}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {word.georgian_definitions.map((def, defIdx) => (
                            <span key={defIdx} className="inline-block bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm">
                              {def}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell max-w-xs">
                        <div className="line-clamp-2" dangerouslySetInnerHTML={{ __html: word.description || '-' }} />
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <button
                          onClick={() => setEditingWord(word)}
                          className="text-blue-600 dark:text-blue-400 hover:text-purple-600 dark:hover:text-purple-400 mr-4 p-2 rounded-xl hover:bg-white/50 dark:hover:bg-gray-700/50 transition-all duration-200 transform hover:scale-105"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteModalWord(word)}
                          className="text-gray-400 hover:text-red-600 p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-6 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalCount)} of {totalCount} words
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm text-gray-700 dark:text-gray-300 font-semibold transition-all duration-200 transform hover:scale-105"
              >
                Previous
              </button>
              <div className="px-6 py-3 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 rounded-2xl text-sm font-bold text-blue-800 dark:text-blue-300 shadow-sm">
                Page {page + 1} of {totalPages}
              </div>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm text-gray-700 dark:text-gray-300 font-semibold transition-all duration-200 transform hover:scale-105"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modals moved outside space-y container to prevent margin interference */}
      {(showAddModal || editingWord) && (
        <WordModal
          word={editingWord}
          onClose={() => {
            setShowAddModal(false);
            setEditingWord(null);
          }}
          onSave={() => {
            loadWords();
            setShowAddModal(false);
            setEditingWord(null);
          }}
          onDuplicateDetected={(existingWord, wordData) => {
            setDuplicateWord(existingWord);
            setNewWordData(wordData);
            setShowDuplicateModal(true);
          }}
        />
      )}

      {deleteModalWord && (
        <DeleteWordModal
          word={deleteModalWord}
          deleting={deleting}
          onClose={() => setDeleteModalWord(null)}
          onConfirm={() => deleteWord(deleteModalWord.id)}
        />
      )}

      {showBulkDeleteModal && (
        <BulkDeleteModal
          count={selectedIds.size}
          deleting={deleting}
          onClose={() => setShowBulkDeleteModal(false)}
          onConfirm={bulkDeleteWords}
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

function DeleteWordModal({
  word,
  deleting,
  onClose,
  onConfirm
}: {
  word: Word;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void
}) {
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

        <div className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/50 dark:to-blue-900/20 rounded-2xl p-6 mb-6 border border-gray-200 dark:border-gray-600">
          <div className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-3">
            {word.english_word}
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {word.georgian_definitions.map((def, idx) => (
              <span key={idx} className="inline-block bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm">
                {def}
              </span>
            ))}
          </div>
          {word.description && (
            <div className="text-sm text-gray-600 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-600 pt-3">
              <div dangerouslySetInnerHTML={{ __html: word.description }} />
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
            {deleting ? 'Deleting...' : `Delete "${word.english_word}"`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkDeleteModal({
  count,
  deleting,
  onClose,
  onConfirm
}: {
  count: number;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <AlertCircle className="text-white" size={32} />
          </div>
          <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
            Delete {count} Word{count > 1 ? 's' : ''}
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            This will permanently remove the selected words from your vocabulary list.
          </p>
        </div>

        <div className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border border-orange-200 dark:border-orange-800 rounded-2xl p-4 mb-6">
          <p className="text-sm text-orange-800 dark:text-orange-300">
            You are about to delete <strong>{count}</strong> word{count > 1 ? 's' : ''}.
            This action cannot be undone.
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
            {deleting ? 'Deleting...' : `Delete ${count} Word${count > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
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
  onDuplicateDetected: (existingWord: Word, wordData: { englishWord: string; georgianDefs: string[]; description: string }) => void;
}) {
  const { user } = useAuth();
  const [englishWord, setEnglishWord] = useState(word?.english_word || '');
  const [georgianDefs, setGeorgianDefs] = useState<string[]>(word?.georgian_definitions || ['']);
  const [description, setDescription] = useState(word?.description || '');
  const [saving, setSaving] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setEnglishWord(word?.english_word || '');
    setGeorgianDefs(word?.georgian_definitions || ['']);
    setDescription(word?.description || '');
    setShowColorPicker(false);
  }, [word]);

  const handleClose = () => {
    setShowColorPicker(false);
    onClose();
  };

  const applyFormatting = (format: 'bold' | 'color', color?: string) => {
    const textarea = document.getElementById('description-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = description.substring(start, end);

    if (!selectedText) {
      alert('Please select text to format');
      return;
    }

    let formattedText = '';
    if (format === 'bold') {
      formattedText = `<strong>${selectedText}</strong>`;
    } else if (format === 'color' && color) {
      formattedText = `<span style="color: ${color}">${selectedText}</span>`;
    }

    const newDescription = description.substring(0, start) + formattedText + description.substring(end);
    setDescription(newDescription);

    // Set cursor position after formatted text
    setTimeout(() => {
      textarea.focus();
      const newPosition = start + formattedText.length;
      textarea.setSelectionRange(newPosition, newPosition);
    }, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      const filteredDefs = georgianDefs.filter(d => d.trim() !== '');

      if (word) {
        // Editing existing word
        const { error } = await supabase
          .from('words')
          .update({
            english_word: englishWord,
            georgian_definitions: filteredDefs,
            description: description || null,
          })
          .eq('id', word.id)
          .eq('user_id', user.id); // Ensure user can only edit their own words

        if (error) throw error;
        onSave();
      } else {
        // Adding new word - check for duplicates first
        const { data: existingWords, error: checkError } = await supabase
          .from('words')
          .select('*')
          .eq('user_id', user.id) // Check only in user's words
          .ilike('english_word', englishWord.trim());

        if (checkError) throw checkError;

        // If word already exists, notify parent component
        if (existingWords && existingWords.length > 0) {
          onDuplicateDetected(existingWords[0], {
            englishWord,
            georgianDefs: filteredDefs,
            description
          });
        } else {
          // No duplicate, proceed with adding
          const { error } = await supabase
            .from('words')
            .insert({
              user_id: user.id,
              english_word: englishWord,
              georgian_definitions: filteredDefs,
              description: description || null,
            });

          if (error) throw error;
          onSave();
        }
      }
    } catch (error: any) {
      alert('Error saving word: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const colors = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#000000'];

  useEffect(() => {
    if (!showColorPicker) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(event.target as Node)) {
        setShowColorPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showColorPicker]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowColorPicker(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md my-4 relative max-h-[90vh] overflow-y-auto smooth-scrollbar transition-all duration-300">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {word ? 'Edit Word' : 'Add New Word'}
          </h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              English Word
            </label>
            <input
              type="text"
              value={englishWord}
              onChange={(e) => setEnglishWord(e.target.value)}
              required
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Georgian Definitions
            </label>
            <div className="space-y-3">
              {georgianDefs.map((def, idx) => (
                <div key={idx} className="flex gap-3">
                  <input
                    type="text"
                    value={def}
                    onChange={(e) => {
                      const newDefs = [...georgianDefs];
                      newDefs[idx] = e.target.value;
                      setGeorgianDefs(newDefs);
                    }}
                    className="flex-1 px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
                    placeholder="Georgian translation"
                  />
                  {georgianDefs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setGeorgianDefs(georgianDefs.filter((_, i) => i !== idx))}
                      className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 p-3 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setGeorgianDefs([...georgianDefs, ''])}
              className="mt-3 text-blue-600 dark:text-blue-400 hover:text-purple-600 dark:hover:text-purple-400 text-sm font-semibold transition-colors"
            >
              + Add synonym
            </button>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Description (optional)
            </label>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => applyFormatting('bold')}
                className="p-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 transform hover:scale-105"
                title="Bold"
              >
                <Bold size={18} />
              </button>
              <div className="relative" ref={colorPickerRef}>
                <button
                  type="button"
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="p-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 transform hover:scale-105"
                  title="Text Color"
                >
                  <Palette size={18} />
                </button>
                {showColorPicker && (
                  <div className="absolute top-full mt-2 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm border border-white/20 dark:border-gray-700/20 rounded-2xl p-3 shadow-2xl z-10 flex gap-2">
                    {colors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          applyFormatting('color', color);
                          setShowColorPicker(false);
                        }}
                        className="w-8 h-8 rounded-xl border-2 border-white dark:border-gray-600 hover:scale-110 transition-all duration-200 shadow-lg"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <textarea
              id="description-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm font-mono text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 transition-all duration-200"
              placeholder="Add description (supports bold and colors)"
            />
            {description && (
              <div className="mt-3 p-4 border-2 border-gray-200 dark:border-gray-600 rounded-2xl bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/50 dark:to-blue-900/20">
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Preview:</div>
                <div dangerouslySetInnerHTML={{ __html: description }} />
              </div>
            )}
          </div>

          <div className="flex gap-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-2xl font-bold hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
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
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[75]">
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
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
              <span key={idx} className="inline-block bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm">
                {def}
              </span>
            ))}
          </div>
          {existingWord.description && (
            <div className="text-sm text-gray-600 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-600 pt-3">
              <div dangerouslySetInnerHTML={{ __html: existingWord.description }} />
            </div>
          )}
        </div>

        <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 mb-6">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            Would you like to copy this word's definitions to your new entry, or create a unique definition?
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onCancel}
            className="w-full sm:flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
          >
            Cancel
          </button>
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
      </div>
    </div>
  );
}
