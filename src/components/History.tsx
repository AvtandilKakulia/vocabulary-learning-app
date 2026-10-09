// --- CODE BLOCK START ---

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase, TestHistory } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { sanitizeDescription } from '../lib/sanitizeDescription';
import { Trash2, ChevronDown, ChevronUp, CheckSquare, Square } from 'lucide-react';

interface BulkConfirmation {
  ids: string[];
  userId: string;
  direction: string;
  score: string;
}

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
  const [bulkConfirmation, setBulkConfirmation] = useState<BulkConfirmation | null>(null);
  const bulkConfirmationRef = useRef<BulkConfirmation | null>(null);
  const bulkDeletingRef = useRef(false);
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
    if (bulkDeletingRef.current || !visibleIds.has(id)) return;
    const newSelected = new Set(eligibleIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    changeSelection(newSelected);
  }

  function toggleSelectAll() {
    changeSelection(allSelected ? new Set() : new Set(visibleIds));
  }

  function closeBulkConfirmation() {
    // Invalidate immediately, including a queued click before React rerenders.
    bulkConfirmationRef.current = null;
    setBulkConfirmation(null);
  }

  function changeSelection(ids: Set<string>) {
    if (bulkDeletingRef.current) return;
    closeBulkConfirmation();
    setSelectedIds(ids);
  }

  function confirmBulkDelete() {
    if (!user || loading || deleting || bulkDeletingRef.current || eligibleIds.length === 0) return;
    const confirmation = { ids: [...eligibleIds], userId: user.id, direction: filterDirection, score: filterScore };
    bulkConfirmationRef.current = confirmation;
    setBulkConfirmation(confirmation);
  }

  async function deleteHistory(id: string) {
    if (!user) return;

    setDeleting(true);
    try {
      const { error } = await supabase
        .from('test_history')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

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
    const confirmation = bulkConfirmationRef.current;
    if (!user || !confirmation || loading || deleting || bulkDeletingRef.current) return;
    if (confirmation.userId !== user.id || confirmation.direction !== filterDirection || confirmation.score !== filterScore) {
      closeBulkConfirmation();
      return;
    }
    // Never expand the confirmed scope. Recheck selection AND visibility at send time.
    const ids = confirmation.ids.filter(id => selectedIds.has(id) && visibleIds.has(id));
    if (ids.length === 0) {
      closeBulkConfirmation();
      return;
    }

    bulkDeletingRef.current = true;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('test_history')
        .delete()
        .in('id', ids)
        .eq('user_id', user.id);

      if (error) throw error;

      setSelectedIds(new Set());
      closeBulkConfirmation();
      loadHistory();
    } catch (error: any) {
      alert('Error deleting records: ' + error.message);
    } finally {
      bulkDeletingRef.current = false;
      setDeleting(false);
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

  const visibleIds = new Set(filteredHistory.map(record => record.id));
  // Hidden/deleted stale state is never counted or made actionable.
  const eligibleIds = [...selectedIds].filter(id => visibleIds.has(id));
  const allSelected = filteredHistory.length > 0 && filteredHistory.every(record => selectedIds.has(record.id));
  const confirmedIds = bulkConfirmation?.ids.filter(id => selectedIds.has(id) && visibleIds.has(id)) ?? [];

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

      {/* SELECTION, STATS AND FILTERS */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-xl p-6">
        <div role="group" aria-label="History selection toolbar" className="mb-6 space-y-3">
          <p aria-live="polite" className="min-h-12 text-sm font-semibold text-blue-700 dark:text-blue-300 sm:min-h-6">
            {eligibleIds.length} of {visibleIds.size} visible records selected
          </p>
          <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3">
            <button
              onClick={toggleSelectAll}
              disabled={deleting || loading || visibleIds.size === 0}
              className="min-h-16 min-w-0 break-words rounded-xl border px-3 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            {/* A non-interactive slot reserves space without a hidden focus target. */}
            <div className="min-h-16 min-w-0">
              {eligibleIds.length > 0 && !allSelected && (
                <button
                  onClick={() => changeSelection(new Set())}
                  disabled={deleting || loading}
                  className="h-full min-h-16 w-full break-words rounded-xl border px-3 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Clear Selection
                </button>
              )}
            </div>
            <button
              onClick={confirmBulkDelete}
              disabled={deleting || loading || eligibleIds.length === 0}
              className="col-span-2 flex min-h-16 min-w-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
            >
              <Trash2 size={18} aria-hidden="true" className="shrink-0" />
              <span>Delete Selected ({eligibleIds.length})</span>
            </button>
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
              disabled={deleting}
              onChange={(e) => {
                if (bulkDeletingRef.current) return;
                changeSelection(new Set());
                setFilterDirection(e.target.value as any);
              }}
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
              disabled={deleting}
              onChange={(e) => {
                if (bulkDeletingRef.current) return;
                changeSelection(new Set());
                setFilterScore(e.target.value as any);
              }}
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
              disabled={deleting}
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
              disabled={deleting}
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
                        disabled={deleting}
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
                              {m.question_prompt ?? m.english_word}
                            </div>
                            {m.description?.trim() && (
                              <div
                                className="text-sm text-gray-600 mb-2 break-words"
                                dangerouslySetInnerHTML={{
                                  __html: sanitizeDescription(m.description),
                                }}
                              />
                            )}

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
      {bulkConfirmation && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="bulk-delete-title"
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-red-500 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg width="32" height="32" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>

              <h3 id="bulk-delete-title" className="text-2xl font-bold text-red-600 mb-2">
                Delete {confirmedIds.length} Record{confirmedIds.length !== 1 ? 's' : ''}
              </h3>

              <p className="text-gray-600">
                This will permanently remove the selected records.
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-red-700">
                You are about to delete{' '}
                <strong>{confirmedIds.length}</strong> test record
                {confirmedIds.length !== 1 ? 's' : ''}.
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={closeBulkConfirmation}
                disabled={deleting}
                className="flex-1 px-6 py-3 border rounded-xl"
              >
                Cancel
              </button>

              <button
                onClick={bulkDeleteHistory}
                disabled={deleting || loading || confirmedIds.length === 0}
                className="flex-1 px-6 py-3 bg-red-500 text-white rounded-xl"
              >
                {deleting
                  ? 'Deleting...'
                  : `Delete ${confirmedIds.length} Record${confirmedIds.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// --- CODE BLOCK END ---
