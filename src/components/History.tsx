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
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
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
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
      loadHistory();
    } catch (error: any) {
      alert('Error deleting history: ' + error.message);
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
      alert('Error deleting history: ' + error.message);
    } finally {
      setDeleting(false);
    }
  }

  async function clearAllHistory() {
    if (!confirm('Are you sure you want to delete ALL test history? This cannot be undone.')) return;
    if (!user) return;

    try {
      const { error } = await supabase
        .from('test_history')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;
      loadHistory();
    } catch (error: any) {
      alert('Error clearing history: ' + error.message);
    }
  }

  function getScoreEmoji(score: number): string {
    if (score >= 90) return '🎉';
    if (score >= 80) return '😄';
    if (score >= 70) return '😊';
    if (score >= 60) return '🙂';
    if (score >= 50) return '😐';
    if (score >= 40) return '😕';
    if (score >= 30) return '😞';
    return '💔';
  }

  // Sort history when sort criteria change
  const sortedHistory = useMemo(() => {
    return [...history].sort((a, b) => {
      if (sortBy === 'date') {
        const dateA = new Date(a.test_date).getTime();
        const dateB = new Date(b.test_date).getTime();
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      } else {
        const scoreA = (a.correct_count / a.total_words) * 100;
        const scoreB = (b.correct_count / b.total_words) * 100;
        return sortOrder === 'desc' ? scoreB - scoreA : scoreA - scoreB;
      }
    });
  }, [history, sortBy, sortOrder]);

  const filteredHistory = sortedHistory
    .filter(record => {
      if (filterDirection !== 'all' && record.test_direction !== filterDirection) {
        return false;
      }

      if (filterScore !== 'all') {
        const percentage = (record.correct_count / record.total_words) * 100;
        if (filterScore === 'high' && percentage < 80) return false;
        if (filterScore === 'medium' && (percentage < 50 || percentage >= 80)) return false;
        if (filterScore === 'low' && percentage >= 50) return false;
      }

      return true;
    });

  const totalTests = filteredHistory.length;
  const avgScore = totalTests > 0 
    ? Math.round(filteredHistory.reduce((sum, r) => sum + (r.correct_count / r.total_words) * 100, 0) / totalTests)
    : 0;

  const allSelected = filteredHistory.length > 0 && selectedIds.size === filteredHistory.length;

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
          Test History & Statistics
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Track your learning progress and achievements
        </p>
      </div>
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex gap-3">
            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl hover:from-red-600 hover:to-pink-600 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
              >
                <Trash2 size={18} />
                Delete Selected ({selectedIds.size})
              </button>
            )}
            {history.length > 0 && (
              <button
                onClick={clearAllHistory}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl hover:from-red-600 hover:to-pink-600 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
              >
                <Trash2 size={18} />
                Clear All
              </button>
            )}
          </div>
        </div>

      {totalTests > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="text-sm text-blue-600 dark:text-blue-400 mb-2 font-semibold">Total Tests</div>
            <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">{totalTests}</div>
          </div>
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="text-sm text-green-600 dark:text-green-400 mb-2 font-semibold">Average Score</div>
            <div className="text-4xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent flex items-center gap-3">
              {avgScore}% <span className="text-3xl">{getScoreEmoji(avgScore)}</span>
            </div>
          </div>
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="text-sm text-purple-600 dark:text-purple-400 mb-2 font-semibold">Total Questions</div>
            <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
              {filteredHistory.reduce((sum, r) => sum + r.total_words, 0)}
            </div>
          </div>
        </div>
      )}

      {/* Filters Section */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Direction
            </label>
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as any)}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 transition-all duration-200"
            >
              <option value="all">All Directions</option>
              <option value="en-to-geo">English → Georgian</option>
              <option value="geo-to-en">Georgian → English</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Score Range
            </label>
            <select
              value={filterScore}
              onChange={(e) => setFilterScore(e.target.value as any)}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 transition-all duration-200"
            >
              <option value="all">All Scores</option>
              <option value="high">High (80-100%)</option>
              <option value="medium">Medium (50-79%)</option>
              <option value="low">Low (0-49%)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'date' | 'score')}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 transition-all duration-200"
            >
              <option value="date">Date</option>
              <option value="score">Score</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Order
            </label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
              className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm text-gray-900 dark:text-gray-100 transition-all duration-200"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 overflow-hidden transition-all duration-300">
        {loading ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4"></div>
            <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">Loading history...</div>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-gray-400 to-gray-500 rounded-full flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
              {history.length === 0 ? 'No test history yet' : 'No matching tests'}
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {history.length === 0 
                ? 'Complete a test to see your results here!'
                : 'Try adjusting your filters to see more results.'
              }
            </p>
          </div>
        ) : (
          <div>
            {selectedIds.size > 0 && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border-b border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
                    {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
                  </span>
                  <div className="flex gap-4">
                    <button
                      onClick={toggleSelectAll}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:text-purple-600 dark:hover:text-purple-400 font-semibold transition-colors"
                    >
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:text-purple-600 dark:hover:text-purple-400 font-semibold transition-colors"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredHistory.map((record) => {
                const percentage = Math.round((record.correct_count / record.total_words) * 100);
                const isExpanded = expandedId === record.id;
                const isSelected = selectedIds.has(record.id);

                return (
                  <div key={record.id} className={`p-6 hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-purple-50/50 dark:hover:from-gray-700/50 dark:hover:to-gray-600/50 ${isSelected ? 'bg-gradient-to-r from-blue-50/80 to-purple-50/80 dark:from-blue-900/20 dark:to-purple-900/20' : ''} transition-all duration-200`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        <button
                          onClick={() => toggleSelect(record.id)}
                          className="text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors p-1 rounded-lg hover:bg-white/50 dark:hover:bg-gray-700/50"
                        >
                          {isSelected ? (
                            <CheckSquare size={20} className="text-blue-600 dark:text-blue-400" />
                          ) : (
                            <Square size={20} />
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-4 mb-3">
                            <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                              {percentage}%
                            </div>
                            <div className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                              ({record.correct_count}/{record.total_words}) {getScoreEmoji(percentage)}
                            </div>
                            <span className="px-3 py-1 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-semibold">
                              {record.test_direction === 'en-to-geo' 
                                ? 'English → Georgian' 
                                : 'Georgian → English'
                              }
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {new Date(record.test_date).toLocaleString('en-US', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {record.mistakes.length > 0 && (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : record.id)}
                            className="text-blue-600 dark:text-blue-400 hover:text-purple-600 dark:hover:text-purple-400 p-2 rounded-xl hover:bg-white/50 dark:hover:bg-gray-700/50 transition-all duration-200"
                          >
                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                          </button>
                        )}
                        <button
                          onClick={() => setShowDeleteModal(record.id)}
                          className="text-red-600 hover:text-red-800 p-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-all duration-200"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && record.mistakes.length > 0 && (
                      <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                        <div className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                          Mistakes ({record.mistakes.length}):
                        </div>
                        <div className="grid gap-4">
                          {record.mistakes.map((mistake, idx) => (
                            <div key={idx} className="bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 p-4 rounded-2xl border border-red-200 dark:border-red-800 shadow-sm">
                              <div className="font-bold text-gray-900 dark:text-gray-100 text-lg mb-2">
                                {mistake.english_word}
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">
                                Your answer: <span className="font-semibold text-red-700 dark:text-red-300">{mistake.user_answer || '(empty)'}</span>
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-400">
                                Correct: <span className="font-semibold text-green-700 dark:text-green-300">
                                  {mistake.correct_definitions.join(', ')}
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
          </div>
        )}
      </div>

      {/* Single Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg className="text-white" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
                Delete Test Record
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowDeleteModal(null)}
                disabled={deleting}
                className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteHistory(showDeleteModal)}
                disabled={deleting}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl font-semibold hover:from-orange-600 hover:to-red-600 disabled:opacity-50 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
              >
                {deleting ? 'Deleting...' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg className="text-white" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2\">\n                Delete {selectedIds.size} Record{selectedIds.size > 1 ? 's' : ''}\n              </h3>\n              <p className=\"text-gray-600 dark:text-gray-400\">\n                This will permanently remove the selected test records.\n              </p>\n            </div>\n\n            <div className=\"bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border border-orange-200 dark:border-orange-800 rounded-2xl p-4 mb-6\">\n              <p className=\"text-sm text-orange-800 dark:text-orange-300\">\n                You are about to delete <strong>{selectedIds.size}</strong> test record{selectedIds.size > 1 ? 's' : ''}. \n                This action cannot be undone.\n              </p>\n            </div>\n\n            <div className=\"flex gap-4\">\n              <button\n                onClick={() => setShowBulkDeleteModal(false)}\n                disabled={deleting}\n                className=\"flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200\"\n              >\n                Cancel\n              </button>\n              <button\n                onClick={bulkDeleteHistory}\n                disabled={deleting}\n                className=\"flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl font-semibold hover:from-orange-600 hover:to-red-600 disabled:opacity-50 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl\"\n              >\n                {deleting ? 'Deleting...' : `Delete ${selectedIds.size} Record${selectedIds.size > 1 ? 's' : ''}`}\n              </button>\n            </div>\n          </div>\n        </div>\n      )}\n    </div>\n  );\n}
    </div>
  );
}
