// --- CODE BLOCK START ---

import React, { useState, useEffect, useMemo } from 'react';
import { supabase, TestHistory } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Trash2, ChevronDown, ChevronUp, CheckSquare, Square } from 'lucide-react';

export default function History() {
  const { user } = useAuth();
  const [history, setHistory] = useState<TestHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterDirection, setFilterDirection] = useState<'all' | 'en-to-geo' | 'geo-to-en'>('all');
  const [filterScore, setFilterScore] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'score'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadHistory();
  }, [sortBy, sortOrder]);

  async function loadHistory() {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('test_history')
        .select('*')
        .eq('user_id', user.id)
        .order('test_date', { ascending: false });

      if (error) throw error;
      setHistory(data || []);
    } catch (error: any) {
      console.error('Error loading history:', error);
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    const newSelected = new Set(selectedIds);
    newSelected.has(id) ? newSelected.delete(id) : newSelected.add(id);
    setSelectedIds(newSelected);
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredHistory.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredHistory.map(h => h.id)));
    }
  }

  async function deleteHistory(id: string) {
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('test_history')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setShowDeleteModal(null);
      setSelectedIds(prev => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
      loadHistory();
    } catch (error: any) {
      alert('Error deleting record: ' + error.message);
    } finally {
      setDeleting(false);
    }
  }

  async function bulkDeleteHistory() {
    if (selectedIds.size === 0) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('test_history')
        .delete()
        .in('id', Array.from(selectedIds));

      if (error) throw error;

      setSelectedIds(new Set());
      setShowBulkDeleteModal(false);
      loadHistory();
    } catch (error: any) {
      alert('Error deleting records: ' + error.message);
    } finally {
      setDeleting(false);
    }
  }

  async function clearAllHistory() {
    if (!confirm('Are you sure you want to delete ALL history?')) return;
    if (!user) return;

    try {
      await supabase
        .from('test_history')
        .delete()
        .eq('user_id', user.id);

      loadHistory();
    } catch (error: any) {
      alert('Error clearing history: ' + error.message);
    }
  }

  function getScoreEmoji(score: number) {
    if (score >= 90) return '🎉';
    if (score >= 80) return '😄';
    if (score >= 70) return '😊';
    if (score >= 60) return '🙂';
    if (score >= 50) return '😐';
    if (score >= 40) return '😕';
    if (score >= 30) return '😞';
    return '💔';
  }

  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      if (sortBy === 'date') {
        return sortOrder === 'desc'
          ? new Date(b.test_date).getTime() - new Date(a.test_date).getTime()
          : new Date(a.test_date).getTime() - new Date(b.test_date).getTime();
      } else {
        const scoreA = (a.correct_count / a.total_words) * 100;
        const scoreB = (b.correct_count / b.total_words) * 100;
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      }
    });
  }, [history, sortBy, sortOrder]);

  const filteredHistory = sortedHistory.filter(record => {
    if (filterDirection !== 'all' && record.test_direction !== filterDirection)
      return false;

    const percent = (record.correct_count / record.total_words) * 100;

    if (filterScore === 'high' && percent < 80) return false;
    if (filterScore === 'medium' && (percent < 50 || percent >= 80)) return false;
    if (filterScore === 'low' && percent >= 50) return false;

    return true;
  });

  const totalTests = filteredHistory.length;
  const avgScore =
    totalTests > 0
      ? Math.round(
          filteredHistory.reduce(
            (sum, r) => sum + (r.correct_count / r.total_words) * 100,
            0
          ) / totalTests
        )
      : 0;

  const allSelected =
    filteredHistory.length > 0 &&
    selectedIds.size === filteredHistory.length;

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          Test History & Statistics
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Track your learning progress and achievements
        </p>
      </div>

      {/* DELETE ACTIONS */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-xl p-6">
        <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
          <div className="flex gap-3">
            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl hover:scale-105 transition"
              >
                <Trash2 size={18} />
                Delete Selected ({selectedIds.size})
              </button>
            )}

            {history.length > 0 && (
              <button
                onClick={clearAllHistory}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl hover:scale-105 transition"
              >
                <Trash2 size={18} />
                Clear All
              </button>
            )}
          </div>
        </div>

        {/* STATS */}
        {totalTests > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white/80 dark:bg-gray-800/80 p-6 rounded-2xl shadow">
              <div className="text-sm text-blue-600 dark:text-blue-400 mb-2">
                Total Tests
              </div>
              <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {totalTests}
              </div>
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 p-6 rounded-2xl shadow">
              <div className="text-sm text-green-600 dark:text-green-400 mb-2">
                Average Score
              </div>
              <div className="text-4xl font-bold flex items-center gap-3 bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
                {avgScore}% {getScoreEmoji(avgScore)}
              </div>
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 p-6 rounded-2xl shadow">
              <div className="text-sm text-purple-600 dark:text-purple-400 mb-2">
                Total Questions
              </div>
              <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                {filteredHistory.reduce((s, r) => s + r.total_words, 0)}
              </div>
            </div>
          </div>
        )}

        {/* FILTERS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-6 bg-white/80 dark:bg-gray-800/80 rounded-2xl shadow">
          <div>
            <label className="block text-sm font-semibold mb-2">Direction</label>
            <select
              value={filterDirection}
              onChange={(e) =>
                setFilterDirection(e.target.value as any)
              }
              className="w-full px-4 py-3 rounded-xl border"
            >
              <option value="all">All</option>
              <option value="en-to-geo">English → Georgian</option>
              <option value="geo-to-en">Georgian → English</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Score Range
            </label>
            <select
              value={filterScore}
              onChange={(e) =>
                setFilterScore(e.target.value as any)
              }
              className="w-full px-4 py-3 rounded-xl border"
            >
              <option value="all">All</option>
              <option value="high">High (80–100%)</option>
              <option value="medium">Medium (50–79%)</option>
              <option value="low">Low (0–49%)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as any)
              }
              className="w-full px-4 py-3 rounded-xl border"
            >
              <option value="date">Date</option>
              <option value="score">Score</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Order
            </label>
            <select
              value={sortOrder}
              onChange={(e) =>
                setSortOrder(e.target.value as any)
              }
              className="w-full px-4 py-3 rounded-xl border"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* HISTORY LIST */}
      <div className="bg-white/80 dark:bg-gray-800/80 rounded-3xl shadow-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">Loading...</div>
        ) : filteredHistory.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            No results found.
          </div>
        ) : (
          <div>
            {/** SELECTION BANNER */}
            {selectedIds.size > 0 && (
              <div className="p-4 bg-blue-50 border-b">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-blue-700">
                    {selectedIds.size} selected
                  </span>

                  <div className="flex gap-4">
                    <button
                      onClick={toggleSelectAll}
                      className="text-sm text-blue-600"
                    >
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-sm text-blue-600"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              </div>
            )}

            {filteredHistory.map(record => {
              const percent = Math.round(
                (record.correct_count / record.total_words) * 100
              );
              const expanded = expandedId === record.id;

              return (
                <div
                  key={record.id}
                  className={`p-6 border-b hover:bg-blue-50/40 ${
                    selectedIds.has(record.id)
                      ? 'bg-blue-50/60'
                      : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4 flex-1">
                      <button
                        onClick={() => toggleSelect(record.id)}
                        className="p-1"
                      >
                        {selectedIds.has(record.id) ? (
                          <CheckSquare size={20} className="text-blue-600" />
                        ) : (
                          <Square size={20} />
                        )}
                      </button>

                      <div className="flex-1">
                        <div className="flex items-center gap-4 mb-2">
                          <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                            {percent}%
                          </div>
                          <div className="text-lg font-semibold">
                            ({record.correct_count}/{record.total_words}){' '}
                            {getScoreEmoji(percent)}
                          </div>

                          <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">
                            {record.test_direction === 'en-to-geo'
                              ? 'English → Georgian'
                              : 'Georgian → English'}
                          </span>
                        </div>

                        <div className="text-sm text-gray-500">
                          {new Date(record.test_date).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {record.mistakes.length > 0 && (
                        <button
                          onClick={() =>
                            setExpandedId(expanded ? null : record.id)
                          }
                          className="p-2"
                        >
                          {expanded ? (
                            <ChevronUp size={20} />
                          ) : (
                            <ChevronDown size={20} />
                          )}
                        </button>
                      )}

                      <button
                        onClick={() => setShowDeleteModal(record.id)}
                        className="p-2 text-red-600"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>

                  {expanded && record.mistakes.length > 0 && (
                    <div className="mt-6 pt-6 border-t">
                      <div className="text-lg font-semibold mb-4">
                        Mistakes ({record.mistakes.length}):
                      </div>

                      <div className="grid gap-4">
                        {record.mistakes.map((m, idx) => (
                          <div
                            key={idx}
                            className="p-4 bg-red-50 border border-red-200 rounded-xl"
                          >
                            <div className="font-bold text-lg mb-2">
                              {m.english_word}
                            </div>

                            <div className="text-sm mb-1">
                              Your answer:{' '}
                              <span className="font-semibold text-red-700">
                                {m.user_answer || '(empty)'}
                              </span>
                            </div>

                            <div className="text-sm">
                              Correct:{' '}
                              <span className="font-semibold text-green-700">
                                {m.correct_definitions.join(', ')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DELETE MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-red-500 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg width="32" height="32" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>

              <h3 className="text-2xl font-bold text-red-600 mb-2">
                Delete Test Record
              </h3>

              <p className="text-gray-600">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowDeleteModal(null)}
                disabled={deleting}
                className="flex-1 px-6 py-3 border rounded-xl"
              >
                Cancel
              </button>

              <button
                onClick={() => deleteHistory(showDeleteModal)}
                disabled={deleting}
                className="flex-1 px-6 py-3 bg-red-500 text-white rounded-xl"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK DELETE MODAL */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-red-500 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg width="32" height="32" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>

              <h3 className="text-2xl font-bold text-red-600 mb-2">
                Delete {selectedIds.size} Record{selectedIds.size > 1 ? 's' : ''}
              </h3>

              <p className="text-gray-600">
                This will permanently remove the selected records.
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-red-700">
                You are about to delete{' '}
                <strong>{selectedIds.size}</strong> test record
                {selectedIds.size > 1 ? 's' : ''}.  
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={deleting}
                className="flex-1 px-6 py-3 border rounded-xl"
              >
                Cancel
              </button>

              <button
                onClick={bulkDeleteHistory}
                disabled={deleting}
                className="flex-1 px-6 py-3 bg-red-500 text-white rounded-xl"
              >
                {deleting
                  ? 'Deleting...'
                  : `Delete ${selectedIds.size} Record${selectedIds.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// --- CODE BLOCK END ---
