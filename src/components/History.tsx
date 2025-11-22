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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Test History & Statistics</h2>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <button
              onClick={() => setShowBulkDeleteModal(true)}
              className="flex items-center gap-2 text-red-600 hover:text-red-800 px-4 py-2 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={18} />
              Delete Selected ({selectedIds.size})
            </button>
          )}
          {history.length > 0 && (
            <button
              onClick={clearAllHistory}
              className="flex items-center gap-2 text-red-600 hover:text-red-800 px-4 py-2 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 size={18} />
              Clear All
            </button>
          )}
        </div>
      </div>

      {totalTests > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow p-6 border border-blue-200">
            <div className="text-sm text-blue-700 mb-1 font-medium">Total Tests</div>
            <div className="text-3xl font-bold text-blue-900">{totalTests}</div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow p-6 border border-green-200">
            <div className="text-sm text-green-700 mb-1 font-medium">Average Score</div>
            <div className="text-3xl font-bold text-green-900 flex items-center gap-2">
              {avgScore}% {getScoreEmoji(avgScore)}
            </div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow p-6 border border-purple-200">
            <div className="text-sm text-purple-700 mb-1 font-medium">Total Questions</div>
            <div className="text-3xl font-bold text-purple-900">
              {filteredHistory.reduce((sum, r) => sum + r.total_words, 0)}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Direction
            </label>
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Directions</option>
              <option value="en-to-geo">English → Georgian</option>
              <option value="geo-to-en">Georgian → English</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Score Range
            </label>
            <select
              value={filterScore}
              onChange={(e) => setFilterScore(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">All Scores</option>
              <option value="high">High (80-100%)</option>
              <option value="medium">Medium (50-79%)</option>
              <option value="low">Low (0-49%)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Sort By
            </label>
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'date' | 'score')}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="date">Date</option>
                <option value="score">Score</option>
              </select>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Loading history...</div>
        ) : filteredHistory.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            {history.length === 0 
              ? 'No test history yet. Complete a test to see your results here!'
              : 'No tests match the selected filters.'
            }
          </div>
        ) : (
          <div>
            {selectedIds.size > 0 && (
              <div className="p-4 bg-blue-50 border-b border-blue-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-blue-700">
                    {selectedIds.size} item{selectedIds.size > 1 ? 's' : ''} selected
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={toggleSelectAll}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {allSelected ? 'Deselect All' : 'Select All'}
                    </button>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>
              </div>
            )}
            <div className="divide-y divide-gray-200">
              {filteredHistory.map((record) => {
                const percentage = Math.round((record.correct_count / record.total_words) * 100);
                const isExpanded = expandedId === record.id;
                const isSelected = selectedIds.has(record.id);

                return (
                  <div key={record.id} className={`p-6 hover:bg-gray-50 ${isSelected ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <button
                          onClick={() => toggleSelect(record.id)}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          {isSelected ? (
                            <CheckSquare size={20} className="text-blue-600" />
                          ) : (
                            <Square size={20} />
                          )}
                        </button>
                        <div className="flex-1">
                          <div className="flex items-center gap-4 mb-2">
                            <div className="text-lg font-semibold text-gray-900">
                              {percentage}% ({record.correct_count}/{record.total_words}) {getScoreEmoji(percentage)}
                            </div>
                            <span className="text-sm text-gray-600">
                              {record.test_direction === 'en-to-geo' 
                                ? 'English → Georgian' 
                                : 'Georgian → English'
                              }
                            </span>
                          </div>
                          <div className="text-sm text-gray-500">
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
                            className="text-blue-600 hover:text-blue-800 p-2"
                          >
                            {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                          </button>
                        )}
                        <button
                          onClick={() => setShowDeleteModal(record.id)}
                          className="text-red-600 hover:text-red-800 p-2"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>

                    {isExpanded && record.mistakes.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className="text-sm font-medium text-gray-700 mb-2">
                          Mistakes ({record.mistakes.length}):
                        </div>
                        <div className="space-y-2">
                          {record.mistakes.map((mistake, idx) => (
                            <div key={idx} className="bg-red-50 p-3 rounded-lg">
                              <div className="font-medium text-gray-900">
                                {mistake.english_word}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                Your answer: <span className="font-medium">{mistake.user_answer || '(empty)'}</span>
                              </div>
                              <div className="text-sm text-gray-600">
                                Correct: <span className="font-medium">
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
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="text-amber-600" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Delete Test Record
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteModal(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteHistory(showDeleteModal)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium transition-colors"
              >
                {deleting ? 'Deleting...' : 'Delete Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="text-amber-600" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Delete {selectedIds.size} Record{selectedIds.size > 1 ? 's' : ''}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  This will permanently remove the selected test records.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800">
                You are about to delete <strong>{selectedIds.size}</strong> test record{selectedIds.size > 1 ? 's' : ''}. 
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={bulkDeleteHistory}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 font-medium transition-colors"
              >
                {deleting ? 'Deleting...' : `Delete ${selectedIds.size} Record${selectedIds.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
