import React, { useState, useEffect, useRef } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Search, Edit2, Trash2, Plus, X, AlertCircle, CheckSquare, Square, Bold, Palette, Sparkles, Layers, ChevronDown } from 'lucide-react';
import { sanitizeDescription } from '../lib/sanitizeDescription';
import { normalizeEnglishWord } from '../lib/normalizeEnglishWord';
import { applyFormatting } from '../lib/applyFormatting';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const isUniqueConstraintError = (error: any) => {
  if (!error) return false;
  return error.code === '23505' || (typeof error.message === 'string' && error.message.includes('words_user_word_unique'));
};

export default function WordManagement() {
const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [pageSizeMenuOpen, setPageSizeMenuOpen] = useState(false);
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
  const pageSizeMenuRef = useRef<HTMLDivElement>(null);
  const pageSizeOptions = [10, 25, 50, 100];

  const prevSearchTermRef = useRef(debouncedSearchTerm);

  useEffect(() => {
    const searchChanged = debouncedSearchTerm !== prevSearchTermRef.current;

    if (searchChanged) {
      prevSearchTermRef.current = debouncedSearchTerm;

      if (page !== 0) {
        setPage(0);
        return;
      }
    }

    loadWords();
  }, [page, pageSize, debouncedSearchTerm]);

  // Clear selections when page changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, pageSize, debouncedSearchTerm]);

  useEffect(() => {
    if (!pageSizeMenuOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (pageSizeMenuRef.current && !pageSizeMenuRef.current.contains(event.target as Node)) {
        setPageSizeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPageSizeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [pageSizeMenuOpen]);

  async function loadWords() {
    if (!user) return;

    setLoading(true);
    const term = debouncedSearchTerm.trim();
    try {
      if (term) {
        const [searchResult, countResult] = await Promise.all([
          supabase.rpc('search_words', {
            p_user_id: user.id,
            p_term: term,
            p_offset: page * pageSize,
            p_limit: pageSize
          }),
          // search_words_count only accepts user and term parameters
          supabase.rpc('search_words_count', {
            p_user_id: user.id,
            p_term: term
          })
        ]);

        if (searchResult.error) throw searchResult.error;
        if (countResult.error) throw countResult.error;

        setWords(searchResult.data || []);
        setTotalCount(typeof countResult.data === 'number' ? countResult.data : 0);
      } else {
        let query = supabase
          .from('words')
          .select('*', { count: 'exact' })
          .eq('user_id', user.id) // Filter by current user
          .order('english_word', { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        const { data, error, count } = await query;

        if (error) throw error;
        setWords(data || []);
        setTotalCount(count || 0);
      }
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
  const selectionRatio = words.length ? Math.min((selectedIds.size / words.length) * 100, 100) : 0;

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

      if (error) {
        if (isUniqueConstraintError(error)) {
          const normalized = normalizeEnglishWord(wordData.englishWord);
          const { data: existingWord } = await supabase
            .from('words')
            .select('*')
            .eq('user_id', user.id)
            .eq('english_word_norm', normalized)
            .maybeSingle();

          if (existingWord) {
            setDuplicateWord(existingWord);
            setNewWordData(wordData);
            setShowDuplicateModal(true);
            return;
          }
        }
        throw error;
      }
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
                  <span>Selected (this page)</span>
                  <span>{selectionRatio.toFixed(0)}%</span>
                </div>
                <p className="text-3xl font-extrabold">{selectedIds.size}</p>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden border border-white/20">
                  <div className="h-full bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400" style={{ width: `${selectionRatio}%` }} />
                </div>
                <p className="text-xs text-indigo-100/70">Selection applies to this page</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative bg-white/90 dark:bg-gray-900/70 rounded-3xl shadow-2xl border border-slate-100/60 dark:border-gray-800/80 p-6 transition-all duration-300 space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-white shadow-lg">
                <Sparkles size={16} />
                <span className="text-sm font-semibold">Manage words</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Smoother tooling for creating, editing, and reviewing entries.</p>
            </div>

            <div className="relative z-30 flex flex-wrap gap-3 justify-end items-center">
              {someSelected && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-100/80 dark:border-rose-900/50 bg-gradient-to-r from-rose-50 to-amber-50 dark:from-rose-900/20 dark:to-amber-900/20 px-3 py-2 text-rose-700 dark:text-rose-200 shadow-sm h-12">
                  <span className="text-sm font-semibold">{selectedIds.size} selected (this page)</span>
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="inline-flex items-center justify-center h-9 text-xs font-semibold rounded-full px-3 bg-white/70 dark:bg-white/10 text-rose-700 dark:text-rose-200 hover:bg-white/90 dark:hover:bg-white/20 transition"
                  >
                    Clear
                  </button>
                  <button
                    onClick={() => setShowBulkDeleteModal(true)}
                    className="inline-flex items-center justify-center h-9 gap-2 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-3 text-white shadow hover:from-rose-600 hover:to-orange-600 transition"
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              )}
              <button
                onClick={() => setShowAddModal(true)}
                className="inline-flex items-center justify-center h-12 gap-2 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-md hover:shadow-lg font-semibold"
              >
                <Plus size={18} />
                Add word
              </button>
            </div>
          </div>

          <div className="relative z-20 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
            <div className="relative h-12">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" size={20} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setPage(0);
                }}
                placeholder="Search English or Georgian words..."
                className="w-full h-full rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 backdrop-blur-sm pl-12 pr-4 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-inner focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>
            <div className="flex items-center h-12 gap-3 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 backdrop-blur-sm pl-3 pr-[0.2rem] shadow-inner">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Page size</span>
              <div
                ref={pageSizeMenuRef}
                className={`relative flex-1 flex justify-end ${pageSizeMenuOpen ? 'z-[90]' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setPageSizeMenuOpen(open => !open)}
                  className={`inline-flex items-center justify-between w-full sm:w-44 h-10 px-3 rounded-xl border border-white/40 dark:border-gray-700/70 bg-gradient-to-r from-white to-gray-50 dark:from-gray-800 dark:to-gray-700 text-sm font-semibold text-gray-900 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-all duration-150 ${pageSizeMenuOpen ? 'ring-2 ring-blue-500/30' : ''}`}
                >
                  <span className="truncate">{pageSize} per page</span>
                  <ChevronDown className={`ml-2 text-gray-500 dark:text-gray-400 transition-transform ${pageSizeMenuOpen ? 'rotate-180' : ''}`} size={18} />
                </button>
                {pageSizeMenuOpen && (
                  <div className="absolute right-0 top-[110%] w-full sm:w-44 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden z-[75]">
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {pageSizeMenuOpen &&
                        pageSizeOptions.map(option => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => {
                              setPageSize(option);
                              setPage(0);
                              setPageSizeMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between px-4 py-2 text-sm font-semibold transition-colors ${option === pageSize
                              ? 'bg-blue-50/80 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                              : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100/80 dark:hover:bg-gray-700/70'}`}
                          >
                            {option} per page
                            {option === pageSize && <CheckSquare size={16} className="text-blue-600 dark:text-blue-300" />}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
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
                      className={`p-2 rounded-xl border transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${allSelected
                        ? 'text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700 bg-gradient-to-br from-white to-blue-50 dark:from-gray-800 dark:to-gray-800 shadow-inner'
                        : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/70 dark:hover:bg-gray-700/60'}`}
                      disabled={words.length === 0}
                    >
                      {allSelected ? (
                        <CheckSquare size={20} className="text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Square size={20} />
                      )}
                    </button>
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
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4"></div>
                      <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">Loading words...</div>
                    </td>
                  </tr>
                ) : words.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
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
                  words.map((word) => (
                    <tr key={word.id} className={`hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-purple-50/50 dark:hover:from-gray-700/50 dark:hover:to-gray-600/50 ${selectedIds.has(word.id) ? 'bg-gradient-to-r from-blue-50/80 to-purple-50/80 dark:from-blue-900/20 dark:to-purple-900/20' : ''} transition-all duration-200`}>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => toggleSelect(word.id)}
                          className={`p-2 rounded-xl border transition-all duration-200 ${selectedIds.has(word.id)
                            ? 'text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-700 bg-gradient-to-br from-white to-blue-50 dark:from-gray-800 dark:to-gray-800 shadow-inner'
                            : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 bg-slate-50/80 dark:bg-gray-800/60 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/70 dark:hover:bg-gray-700/60'}`}
                        >
                          {selectedIds.has(word.id) ? (
                            <CheckSquare size={20} className="text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Square size={20} />
                          )}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-lg font-bold text-gray-900 dark:text-gray-100">
                        {word.english_word}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {word.georgian_definitions.map((def, defIdx) => (
                            <span key={defIdx} className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm">
                              <Sparkles size={14} className="text-blue-500" />
                              {def}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 hidden sm:table-cell max-w-md">
                        {word.description ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeDescription(word.description) }} />
                        ) : (
                          <span className="text-gray-400 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right space-x-3 whitespace-nowrap">
                        <button
                          onClick={() => {
                            setEditingWord(word);
                            setShowAddModal(true);
                          }}
                          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50/80 dark:hover:bg-gray-700/60 transition-all duration-200"
                          aria-label="Edit"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button
                          onClick={() => setDeleteModalWord(word)}
                          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 text-red-500 dark:text-red-400 hover:bg-red-50/80 dark:hover:bg-gray-700/60 transition-all duration-200"
                          aria-label="Delete"
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

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-4 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 border-t border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Page {page + 1} of {totalPages || 1}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page === 0}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 text-sm font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-800/70 text-sm font-semibold text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>

      {showAddModal && (
        <WordModal
          word={editingWord}
          onClose={() => {
            setShowAddModal(false);
            setEditingWord(null);
          }}
          onSave={() => {
            setShowAddModal(false);
            setEditingWord(null);
            loadWords();
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

        <div className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-700/50 dark:to-blue-900/50 rounded-2xl p-6 mb-6 border border-gray-200 dark:border-gray-600">
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
              <div dangerouslySetInnerHTML={{ __html: sanitizeDescription(word.description) }} />
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
            You are about to delete <strong>{count}</strong> word{count > 1 ? 's' : ''}. This action cannot be undone.
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
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const initialStateRef = useRef<{ englishWord: string; georgianDefs: string[]; description: string }>({
    englishWord: word?.english_word || '',
    georgianDefs: word?.georgian_definitions || [''],
    description: word?.description || '',
  });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  useEffect(() => {
    setEnglishWord(word?.english_word || '');
    setGeorgianDefs(word?.georgian_definitions || ['']);
    setDescription(word?.description || '');
    setShowColorPicker(false);
    setShowCloseConfirm(false);
    initialStateRef.current = {
      englishWord: word?.english_word || '',
      georgianDefs: word?.georgian_definitions || [''],
      description: word?.description || '',
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

  const handleFormatting = (format: 'bold' | 'color', color?: string) => {
    const textarea = descriptionRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    const result = applyFormatting(
      description,
      { start, end },
      format,
      color
    );

    if (!result) {
      return;
    }

    setDescription(result.nextText);

    // Set cursor position after formatted text
    requestAnimationFrame(() => {
      const nextTextarea = descriptionRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(result.nextCursor, result.nextCursor);
    });
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

          if (error) {
            if (isUniqueConstraintError(error)) {
              const normalized = normalizeEnglishWord(englishWord);
              const { data: existingWord } = await supabase
                .from('words')
                .select('*')
                .eq('user_id', user.id)
                .eq('english_word_norm', normalized)
                .maybeSingle();

              if (existingWord) {
                onDuplicateDetected(existingWord, {
                  englishWord,
                  georgianDefs: filteredDefs,
                  description
                });
                return;
              }
            }

            throw error;
          }
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
      <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 w-full max-w-lg my-3 relative transition-all duration-300">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-all duration-200 z-10"
        >
          <X size={24} />
        </button>

        <div className="max-h-[70vh] overflow-y-auto smooth-scrollbar p-6 pt-5">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              {word ? 'Edit Word' : 'Add New Word'}
            </h3>
            <div className="h-10" aria-hidden />
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
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-gray-600 bg-white/70 dark:bg-gray-700/60 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-gray-700 transition-all duration-200"
            >
              <Plus size={16} />
              Add definition
            </button>
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
                onClick={() => handleFormatting('bold')}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                <Bold size={16} />
                Bold
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowColorPicker(open => !open)}
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
                          handleFormatting('color', color);
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
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Preview</div>
                <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeDescription(description) }} />
              </div>
            )}
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
              {saving ? 'Saving...' : word ? 'Save changes' : 'Add word'}
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
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Close without saving?</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Closing now will discard your filled information.</p>
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
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[75]"
      onMouseDown={() => setShowCloseConfirm(true)}
    >
      <div
        className={[
          'relative bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl',
          'border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300',
        ].join(' ')}
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
              <span key={idx} className="inline-block bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/50 dark:to-purple-900/50 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium shadow-sm">
                {def}
              </span>
            ))}
          </div>
          {existingWord.description && (
            <div className="text-sm text-gray-600 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-600 pt-3">
              <div dangerouslySetInnerHTML={{ __html: sanitizeDescription(existingWord.description) }} />
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
                  <h4 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Close without saving?</h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400">Closing now will discard your filled information.</p>
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
  );
}
