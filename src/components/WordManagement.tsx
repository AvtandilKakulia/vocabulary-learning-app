import React, { useState, useEffect } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Search, Edit2, Trash2, Plus, X, AlertCircle, CheckSquare, Square, Bold, Palette } from 'lucide-react';

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
          `english_word.ilike.%${searchTerm}%,georgian_definitions.cs.["${searchTerm}"]`
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
      <div className="space-y-6">
        <div className="flex justify-between items-center flex-wrap gap-4">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Word Management</h2>
          <div className="flex gap-2">
            {someSelected && (
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-200 dark:border-red-800 transition-colors"
              >
                <Trash2 size={20} />
                Delete ({selectedIds.size})
              </button>
            )}
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-blue-600 dark:bg-blue-700 text-white px-4 py-2 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-800 transition-colors"
            >
              <Plus size={20} />
              Add Word
            </button>
          </div>
        </div>

        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" size={20} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(0);
              }}
              placeholder="Search English or Georgian words..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
            />
          </div>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto transition-colors">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-3 py-3 text-left w-12">
                  <button
                    onClick={toggleSelectAll}
                    className="text-gray-500 hover:text-gray-700"
                    disabled={words.length === 0}
                  >
                    {allSelected ? (
                      <CheckSquare size={20} className="text-blue-600" />
                    ) : (
                      <Square size={20} />
                    )}
                  </button>
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-12">
                  #
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  English Word
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Georgian Definitions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">
                  Description
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 transition-colors">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : words.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                    No words found. Add your first word to get started!
                  </td>
                </tr>
              ) : (
                words.map((word, idx) => (
                  <tr key={word.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedIds.has(word.id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''} transition-colors`}>
                    <td className="px-3 py-4">
                      <button
                        onClick={() => toggleSelect(word.id)}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        {selectedIds.has(word.id) ? (
                          <CheckSquare size={20} className="text-blue-600" />
                        ) : (
                          <Square size={20} />
                        )}
                      </button>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {page * pageSize + idx + 1}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                      {word.english_word}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 dark:text-gray-100">
                      <div className="flex flex-wrap gap-1">
                        {word.georgian_definitions.map((def, idx) => (
                          <span key={idx} className="inline-block bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 px-2 py-1 rounded text-xs sm:text-sm">
                            {def}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell max-w-xs">
                      <div className="line-clamp-2" dangerouslySetInnerHTML={{ __html: word.description || '-' }} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => setEditingWord(word)}
                        className="text-blue-600 hover:text-blue-900 mr-3 p-1"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => setDeleteModalWord(word)}
                        className="text-gray-400 hover:text-red-600 p-1"
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

        {totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, totalCount)} of {totalCount} words
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 transition-colors"
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
          onClose={handleIgnoreDuplicate}
          onCopy={handleCopyDefinition}
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
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertCircle className="text-amber-600" size={22} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Delete Word
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="font-medium text-gray-900 mb-2">
            {word.english_word}
          </div>
          <div className="flex flex-wrap gap-1">
            {word.georgian_definitions.map((def, idx) => (
              <span key={idx} className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                {def}
              </span>
            ))}
          </div>
          {word.description && (
            <p className="text-sm text-gray-500 mt-2 italic">
              <div dangerouslySetInnerHTML={{ __html: word.description }} />
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium transition-colors"
          >
            {deleting ? 'Deleting...' : 'Delete Word'}
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
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-[60]">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertCircle className="text-amber-600" size={22} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Delete {count} Word{count > 1 ? 's' : ''}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              This will permanently remove the selected words from your vocabulary list.
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-amber-800">
            You are about to delete <strong>{count}</strong> word{count > 1 ? 's' : ''}. 
            This action cannot be undone.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium transition-colors"
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md my-4 relative max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-200">
          <h3 className="text-xl font-bold text-gray-900">
            {word ? 'Edit Word' : 'Add New Word'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded transition-colors">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              English Word
            </label>
            <input
              type="text"
              value={englishWord}
              onChange={(e) => setEnglishWord(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Georgian Definitions
            </label>
            {georgianDefs.map((def, idx) => (
              <div key={idx} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={def}
                  onChange={(e) => {
                    const newDefs = [...georgianDefs];
                    newDefs[idx] = e.target.value;
                    setGeorgianDefs(newDefs);
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Georgian translation"
                />
                {georgianDefs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setGeorgianDefs(georgianDefs.filter((_, i) => i !== idx))}
                    className="text-red-600 hover:text-red-800"
                  >
                    <X size={20} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGeorgianDefs([...georgianDefs, ''])}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              + Add synonym
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                onClick={() => applyFormatting('bold')}
                className="p-2 border border-gray-300 rounded hover:bg-gray-50"
                title="Bold"
              >
                <Bold size={18} />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  className="p-2 border border-gray-300 rounded hover:bg-gray-50"
                  title="Text Color"
                >
                  <Palette size={18} />
                </button>
                {showColorPicker && (
                  <div className="absolute top-full mt-1 bg-white border border-gray-300 rounded-lg p-2 shadow-lg z-10 flex gap-1">
                    {colors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          applyFormatting('color', color);
                          setShowColorPicker(false);
                        }}
                        className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
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
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              placeholder="Add description (supports bold and colors)"
            />
            {description && (
              <div className="mt-2 p-2 border border-gray-200 rounded bg-gray-50">
                <div className="text-xs text-gray-500 mb-1">Preview:</div>
                <div dangerouslySetInnerHTML={{ __html: description }} />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
  onClose, 
  onCopy 
}: { 
  existingWord: Word; 
  onClose: () => void; 
  onCopy: () => void; 
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-[75]">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
            <AlertCircle className="text-blue-600" size={22} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Word Already Exists
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              You already have this word in your vocabulary list.
            </p>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="font-medium text-gray-900 mb-2">
            {existingWord.english_word}
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {existingWord.georgian_definitions.map((def, idx) => (
              <span key={idx} className="inline-block bg-blue-100 text-blue-800 px-2 py-1 rounded text-sm">
                {def}
              </span>
            ))}
          </div>
          {existingWord.description && (
            <p className="text-sm text-gray-500 italic">
              <div dangerouslySetInnerHTML={{ __html: existingWord.description }} />
            </p>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">
            Would you like to copy this word's definitions to your new entry, or create a unique definition?
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
          >
            Make Unique Definition
          </button>
          <button
            onClick={onCopy}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            Copy Definitions
          </button>
        </div>
      </div>
    </div>
  );
}
