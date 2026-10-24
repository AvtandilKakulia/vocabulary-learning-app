// --- CODE BLOCK START ---

import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useSyncExternalStore } from 'react';
import { supabase, TestHistory } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useLatestRequest } from '../hooks/useLatestRequest';
import HistoryRows from './history/HistoryRows';
import HistoryPagination from './history/HistoryPagination';
import { HISTORY_PAGE_SIZES, readHistoryPageSize, rememberHistoryPageSize } from '../lib/historyPreferences';
import { beginHistoryDeletion, getHistoryDeletionState, subscribeHistoryDeletion } from '../lib/historyDeletion';
import { Trash2, ChevronDown } from 'lucide-react';

const HISTORY_BATCH_SIZE = 500;
// 100 UUIDs keep the encoded filter near 4 KB, well below the previous 19 KB
// request for 500 IDs. Never send a second batch before the first has settled.
const DELETE_BATCH_SIZE = 100;

interface BulkConfirmation {
  ids: string[];
  userId: string;
  direction: string;
  score: string;
}

interface BulkOutcome {
  userId: string;
  ids: string[];
  stopped: boolean;
  remaining: string[] | null;
}

interface SelectionView {
  userId: string | undefined;
  direction: string;
  score: string;
  loading: boolean;
  selected: Set<string>;
  visible: Set<string>;
}

export default function History() {
  const { user } = useAuth();
  const [history, setHistory] = useState<TestHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const readFailedRef = useRef(false);
  const [pageSize, setPageSize] = useState(readHistoryPageSize);
  const [page, setPage] = useState(0);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const scrollToList = useRef(false);
  const [filterDirection, setFilterDirection] = useState<'all' | 'en-to-geo' | 'geo-to-en'>('all');
  const [filterScore, setFilterScore] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'score'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null);
  const [bulkConfirmation, setBulkConfirmation] = useState<BulkConfirmation | null>(null);
  const bulkConfirmationRef = useRef<BulkConfirmation | null>(null);
  const [bulkOutcome, setBulkOutcome] = useState<BulkOutcome | null>(null);
  const bulkOutcomeRef = useRef<BulkOutcome | null>(null);
  const selectionView = useRef<SelectionView | null>(null);
  const userId = user?.id;
  const deletionState = useSyncExternalStore(subscribeHistoryDeletion, () => getHistoryDeletionState(userId));
  const deleting = deletionState.busy;
  const deletionVersion = deletionState.version;
  const loadedDeletionVersion = useRef<number | null>(null);
  const startedRead = useRef<(() => Promise<void>) | null>(null);
  useLayoutEffect(() => () => { startedRead.current = null; }, []);
  const beginMutation = useLatestRequest(userId);
  // Sorting only presents the loaded collection; it must not restart or cancel
  // an authoritative read. Account and deletion-version guards still apply.
  const beginRead = useLatestRequest(userId);

  useLayoutEffect(() => {
    setHistory([]);
    setPage(0);
    scrollToList.current = false;
    setLoading(true);
    setReadError(null);
    setSelectedIds(new Set());
    bulkConfirmationRef.current = null;
    setBulkConfirmation(null);
    bulkOutcomeRef.current = null;
    setBulkOutcome(null);
    setShowDeleteModal(null);
    loadedDeletionVersion.current = null;
  }, [userId]);

  const loadHistoryForContext = useCallback(async () => {
    if (getHistoryDeletionState(userId).busy) return;
    const isLatest = beginRead();
    if (!isLatest) return;
    const isCurrent = () => isLatest() && getHistoryDeletionState(userId).version === deletionVersion;
    setReadError(null);
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const records: TestHistory[] = [];
      const seenIds = new Set<string>();
      let expectedCount: number | undefined;

      // A short page may reflect a server cap below our batch size. Advance by
      // actual rows and use the authorized count, rather than page length, to finish.
      do {
        if (!isCurrent()) return;
        const offset = records.length;
        const { data, error, count } = await supabase
          .from('test_history')
          .select('*', offset === 0 ? { count: 'exact' } : {})
          .eq('user_id', userId)
          .order('test_date', { ascending: false })
          .order('id', { ascending: false })
          .range(offset, offset + HISTORY_BATCH_SIZE - 1);

        if (!isCurrent()) return;
        if (error) throw error;
        if (expectedCount === undefined) {
          if (count === null || !Number.isSafeInteger(count) || count < 0) {
            throw new Error('Invalid history count');
          }
          expectedCount = count;
        }
        if (!Array.isArray(data) || data.length > HISTORY_BATCH_SIZE ||
            offset + data.length > expectedCount || (data.length === 0 && offset < expectedCount)) {
          throw new Error('Incomplete history response');
        }
        for (const record of data as TestHistory[]) {
          if (!record || typeof record.id !== 'string' || !record.id || record.user_id !== userId || seenIds.has(record.id)) {
            throw new Error('Invalid or overlapping history records');
          }
          seenIds.add(record.id);
          records.push(record);
        }
      } while (records.length < expectedCount);

      readFailedRef.current = false;
      loadedDeletionVersion.current = deletionVersion;
      setHistory(records);
      const outcome = bulkOutcomeRef.current;
      if (outcome?.userId === userId && outcome.remaining === null) {
        const present = new Set(records.map(record => record.id));
        const verified = { ...outcome, remaining: outcome.ids.filter(id => present.has(id)) };
        bulkOutcomeRef.current = verified;
        setBulkOutcome(verified);
        // Retain only the original confirmed IDs still authorized by this read.
        // A retry requires a fresh click and confirmation; new rows never join it.
        setSelectedIds(new Set(verified.remaining));
      }
    } catch (error: any) {
      if (!isCurrent()) return;
      console.error('Error loading history:', error);
      readFailedRef.current = true;
      setReadError('Unable to load your history. Please try again.');
      setHistory([]);
      setSelectedIds(new Set());
      bulkConfirmationRef.current = null;
      setBulkConfirmation(null);
      setShowDeleteModal(null);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRead, userId, deletionVersion]);

  // Retry uses the latest committed read context without allowing an old
  // account's callback to start a read for the current account.
  const latestRead = useRef({ userId, load: loadHistoryForContext });
  useLayoutEffect(() => {
    latestRead.current = { userId, load: loadHistoryForContext };
  }, [userId, loadHistoryForContext]);
  const loadHistory = useCallback(async () => {
    if (latestRead.current.userId === userId) await latestRead.current.load();
  }, [userId]);

  useEffect(() => {
    if (deleting || startedRead.current === loadHistoryForContext) return;
    startedRead.current = loadHistoryForContext;
    void loadHistoryForContext();
  }, [loadHistoryForContext, deleting]);

  function toggleSelect(id: string) {
    if (getHistoryDeletionState(userId).busy || !visibleIds.has(id)) return;
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
    if (getHistoryDeletionState(userId).busy) return;
    closeBulkConfirmation();
    setSelectedIds(ids);
  }

  function confirmBulkDelete() {
    const view = selectionView.current;
    if (!user || !view || view.userId !== user.id || readFailedRef.current || view.loading || getHistoryDeletionState(userId).busy ||
        loadedDeletionVersion.current !== getHistoryDeletionState(userId).version) return;
    const ids = [...view.selected].filter(id => view.visible.has(id));
    if (ids.length === 0) return;
    const confirmation = { ids, userId: user.id, direction: view.direction, score: view.score };
    bulkConfirmationRef.current = confirmation;
    setBulkConfirmation(confirmation);
  }

  async function deleteHistory(id: string) {
    if (!user || readFailedRef.current || getHistoryDeletionState(userId).busy) return;
    const isCurrent = beginMutation();
    if (!isCurrent) return;
    const release = beginHistoryDeletion(user.id);
    if (!release) return;

    let deleted = false;
    try {
      const { error } = await supabase
        .from('test_history')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      deleted = !error;
      if (!isCurrent()) return;
      if (error) throw error;

      setShowDeleteModal(null);
      setSelectedIds(prev => {
        const s = new Set(prev);
        s.delete(id);
        return s;
      });
    } catch (error: any) {
      if (isCurrent()) alert('Error deleting record: ' + error.message);
    } finally {
      release(deleted);
    }
  }

  async function bulkDeleteHistory(confirmation: BulkConfirmation) {
    const view = selectionView.current;
    if (!user || !view || view.userId !== user.id || readFailedRef.current || bulkConfirmationRef.current !== confirmation || view.loading ||
        getHistoryDeletionState(userId).busy || loadedDeletionVersion.current !== getHistoryDeletionState(userId).version) return;
    if (confirmation.userId !== user.id || confirmation.direction !== view.direction || confirmation.score !== view.score) {
      closeBulkConfirmation();
      return;
    }
    // Never expand the confirmed scope. Recheck selection AND visibility at send time.
    const ids = confirmation.ids.filter(id => view.selected.has(id) && view.visible.has(id));
    if (ids.length === 0) {
      closeBulkConfirmation();
      return;
    }

    const isCurrent = beginMutation();
    if (!isCurrent) return;
    const release = beginHistoryDeletion(user.id);
    if (!release) return;
    beginRead(); // Supersede any pre-mutation response before it can publish stale rows.
    // Consume this confirmation synchronously; queued/stale callbacks cannot retry.
    bulkConfirmationRef.current = null;
    bulkOutcomeRef.current = null;
    setBulkOutcome(null);
    let stopped = false;
    try {
      for (let offset = 0; offset < ids.length; offset += DELETE_BATCH_SIZE) {
        if (!isCurrent()) return;
        const batch = ids.slice(offset, offset + DELETE_BATCH_SIZE);
        const { data, error } = await supabase.from('test_history').delete()
          .in('id', batch).eq('user_id', user.id).select('id');
        if (!isCurrent()) return;
        if (error) throw error;
        // A successful HTTP response alone does not prove every requested row
        // was deleted (RLS, missing rows, or a truncated/malformed response).
        if (!Array.isArray(data) || data.length !== batch.length ||
            new Set(data.map(row => row?.id)).size !== batch.length ||
            data.some(row => !row || !batch.includes(row.id))) {
          throw new Error('Could not verify the deleted batch');
        }
      }
    } catch {
      stopped = true; // A lost/error response cannot prove whether the server committed.
    } finally {
      if (isCurrent()) {
        const outcome = { userId: user.id, ids, stopped, remaining: null };
        bulkOutcomeRef.current = outcome;
        setBulkOutcome(outcome);
        closeBulkConfirmation();
      }
      // Release invalidates reads and triggers one authoritative, paginated reload.
      // No optimistic removal and no automatic retry of destructive requests.
      release();
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
  useLayoutEffect(() => {
    selectionView.current = { userId, direction: filterDirection, score: filterScore, loading, selected: selectedIds, visible: visibleIds };
    return () => { selectionView.current = null; };
  });

  // Selection and statistics above use ALL matching records. Only rendering is
  // paginated; page changes never enter the authoritative read context.
  const totalPages = Math.max(1, Math.ceil(totalTests / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const offset = currentPage * pageSize;
  const pageHistory = filteredHistory.slice(offset, offset + pageSize);
  useEffect(() => {
    if (!loading && !readError) setPage(previous => Math.min(previous, totalPages - 1));
  }, [loading, readError, totalPages]);

  function changePage(nextPage: number) {
    const view = selectionView.current;
    if (!view || view.userId !== userId || view.loading || readFailedRef.current ||
        getHistoryDeletionState(userId).busy || nextPage < 0 || nextPage >= totalPages || nextPage === currentPage) return;
    scrollToList.current = true;
    setPage(nextPage);
  }

  function changePageSize(value: string) {
    const nextSize = HISTORY_PAGE_SIZES.find(size => String(size) === value);
    if (!nextSize || selectionView.current?.userId !== userId || getHistoryDeletionState(userId).busy) return;
    // Keep the old first visible record inside the new page, then clamp.
    setPage(Math.min(Math.floor(offset / nextSize), Math.max(0, Math.ceil(totalTests / nextSize) - 1)));
    setPageSize(nextSize);
    rememberHistoryPageSize(nextSize);
  }

  useLayoutEffect(() => {
    if (!scrollToList.current) return;
    scrollToList.current = false;
    listHeading.current?.focus({ preventScroll: true });
    listHeading.current?.scrollIntoView?.({ block: 'start' });
  }, [currentPage]);

  return (
    <div className="space-y-8 text-gray-900 dark:text-gray-100">
      {/* HEADER */}
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-300 dark:to-purple-300">
          Test History & Statistics
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Track your learning progress and achievements
        </p>
      </div>

      {/* SELECTION, STATS AND FILTERS */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl rounded-3xl shadow-xl p-6">
        <div role="group" aria-label="History selection toolbar" className="mb-6 space-y-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 dark:border-gray-700 dark:bg-gray-900/50 sm:p-4">
          <p aria-live="polite" className="break-words text-sm font-semibold leading-6 tabular-nums text-blue-800 dark:text-blue-200">
            {eligibleIds.length} of {visibleIds.size} matching records selected across all pages
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              onClick={toggleSelectAll}
              disabled={deleting || loading || visibleIds.size === 0}
              className="min-h-11 min-w-0 break-words rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold leading-5 text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:bg-gray-800 dark:text-blue-200 dark:hover:bg-gray-700 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-gray-900 sm:min-w-64 sm:max-w-full"
            >
              {allSelected ? 'Deselect All' : `Select All ${visibleIds.size} Filtered Records`}
            </button>
            {eligibleIds.length > 0 && !allSelected && (
              <button
                onClick={() => changeSelection(new Set())}
                disabled={deleting || loading}
                className="min-h-11 min-w-0 break-words rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold leading-5 text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:bg-gray-800 dark:text-blue-200 dark:hover:bg-gray-700 dark:focus-visible:ring-blue-400 dark:focus-visible:ring-offset-gray-900"
              >
                Clear Selection
              </button>
            )}
            <button
              onClick={confirmBulkDelete}
              disabled={deleting || loading || eligibleIds.length === 0}
              className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold leading-5 text-red-700 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900 dark:focus-visible:ring-red-400 dark:focus-visible:ring-offset-gray-900 sm:ml-auto"
            >
              <Trash2 size={18} aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 break-words tabular-nums">Delete Selected ({eligibleIds.length})</span>
            </button>
          </div>
        </div>

        {/* STATS */}
        {!loading && !readError && totalTests > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div className="bg-white/80 dark:bg-gray-800/80 p-6 rounded-2xl shadow">
              <div className="text-sm text-blue-600 dark:text-blue-400 mb-2">
                Total Tests
              </div>
              <div className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-300 dark:to-purple-300">
                {totalTests}
              </div>
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 p-6 rounded-2xl shadow">
              <div className="text-sm text-green-700 dark:text-green-400 mb-2">
                Average Score
              </div>
              <div className="text-4xl font-bold flex items-center gap-3 bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent dark:from-green-300 dark:to-emerald-300">
                {avgScore}% {getScoreEmoji(avgScore)}
              </div>
            </div>

            <div className="bg-white/80 dark:bg-gray-800/80 p-6 rounded-2xl shadow">
              <div className="text-sm text-purple-600 dark:text-purple-400 mb-2">
                Total Questions
              </div>
              <div className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent dark:from-purple-300 dark:to-pink-300">
                {filteredHistory.reduce((s, r) => s + r.total_words, 0)}
              </div>
            </div>
          </div>
        )}

        {/* FILTERS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-6 bg-white/80 dark:bg-gray-800/80 rounded-2xl shadow">
          <div>
            <label className="block text-sm font-semibold mb-2">Direction</label>
            <div className="relative">
            <select
              value={filterDirection}
              disabled={deleting}
              onChange={(e) => {
                if (getHistoryDeletionState(userId).busy) return;
                changeSelection(new Set());
                setFilterDirection(e.target.value as any);
                setPage(0);
              }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 w-full appearance-none pl-4 pr-12 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 dark:[color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <option value="all">All</option>
              <option value="en-to-geo">English → Georgian</option>
              <option value="geo-to-en">Georgian → English</option>
            </select>
            <ChevronDown aria-hidden="true" focusable="false" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-300" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Score Range
            </label>
            <div className="relative">
            <select
              value={filterScore}
              disabled={deleting}
              onChange={(e) => {
                if (getHistoryDeletionState(userId).busy) return;
                changeSelection(new Set());
                setFilterScore(e.target.value as any);
                setPage(0);
              }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 w-full appearance-none pl-4 pr-12 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 dark:[color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <option value="all">All</option>
              <option value="high">High (80–100%)</option>
              <option value="medium">Medium (50–79%)</option>
              <option value="low">Low (0–49%)</option>
            </select>
            <ChevronDown aria-hidden="true" focusable="false" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-300" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Sort By
            </label>
            <div className="relative">
            <select
              value={sortBy}
              disabled={deleting}
              onChange={(e) => { if (!getHistoryDeletionState(userId).busy) { setSortBy(e.target.value as any); setPage(0); } }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 w-full appearance-none pl-4 pr-12 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 dark:[color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <option value="date">Date</option>
              <option value="score">Score</option>
            </select>
            <ChevronDown aria-hidden="true" focusable="false" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-300" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2">
              Order
            </label>
            <div className="relative">
            <select
              value={sortOrder}
              disabled={deleting}
              onChange={(e) => { if (!getHistoryDeletionState(userId).busy) { setSortOrder(e.target.value as any); setPage(0); } }}
              className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 w-full appearance-none pl-4 pr-12 py-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:border-gray-500 dark:bg-gray-900 dark:text-gray-100 dark:[color-scheme:dark] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
            <ChevronDown aria-hidden="true" focusable="false" size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 dark:text-gray-300" />
            </div>
          </div>
        </div>
      </div>

      {bulkOutcome && bulkOutcome.userId === userId && (
        <div role="status" aria-live="polite" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-800 dark:bg-gray-800 dark:text-blue-100">
          {bulkOutcome.stopped && <p>Deletion stopped after an unsuccessful request. The request may have reached the server.</p>}
          {bulkOutcome.remaining === null ? (
            <p>{readError
              ? 'History could not be refreshed. Some records may have been deleted; the remaining records are unknown. Retry loading History before confirming another deletion.'
              : 'Refreshing History to verify the outcome. Some records may already have been deleted.'}</p>
          ) : bulkOutcome.remaining.length === 0 ? (
            <p>History refreshed: all {bulkOutcome.ids.length} confirmed records are no longer in your History.</p>
          ) : (
            <p>History refreshed: {bulkOutcome.ids.length - bulkOutcome.remaining.length} of {bulkOutcome.ids.length} confirmed records are no longer in your History; {bulkOutcome.remaining.length} remain. Review the remaining selection and confirm Delete Selected to retry.</p>
          )}
        </div>
      )}

      {/* HISTORY LIST */}
      <section aria-label="History display controls" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 ref={listHeading} tabIndex={-1} className="text-xl font-semibold scroll-mt-4 focus-visible:outline-blue-500">History records</h2>
          {!loading && !readError && <p aria-live="polite" className="text-sm text-gray-600 dark:text-gray-400">
            Showing {totalTests ? offset + 1 : 0}–{Math.min(offset + pageSize, totalTests)} of {totalTests} records
          </p>}
          {!loading && !readError && totalPages === 1 && <p className="text-sm text-gray-600 dark:text-gray-400">Page 1 of 1</p>}
        </div>
        <label className="flex flex-wrap items-center gap-3 text-sm font-semibold">
          Records per page
          <select value={pageSize} onChange={event => changePageSize(event.target.value)} disabled={deleting}
            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 px-3 py-2 rounded-xl border bg-white dark:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">
            {HISTORY_PAGE_SIZES.map(size => <option key={size} value={size}>{size} records</option>)}
          </select>
        </label>
      </section>
      {!loading && !readError && totalPages > 1 && <HistoryPagination position="top" page={currentPage}
        totalPages={totalPages} disabled={deleting} onPageChange={changePage} />}
      <div className="bg-white/80 dark:bg-gray-800/80 rounded-3xl shadow-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">Loading...</div>
        ) : readError ? (
          <div role="alert" className="p-12 text-center text-red-700 dark:text-red-300">
            <p>{readError}</p>
            <button type="button" onClick={() => { void loadHistory(); }} className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 mt-4 rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500">
              Retry
            </button>
          </div>
        ) : filteredHistory.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-gray-400">
            No results found.
          </div>
        ) : (
          <HistoryRows key={userId} records={pageHistory} selectedIds={selectedIds} disabled={deleting}
            onSelect={toggleSelect} scoreEmoji={getScoreEmoji}
            onDelete={id => { if (!getHistoryDeletionState(userId).busy) setShowDeleteModal(id); }} />
        )}
      </div>

      {!loading && !readError && totalPages > 1 && <HistoryPagination position="bottom" page={currentPage}
        totalPages={totalPages} disabled={deleting} onPageChange={changePage} />}

      {/* DELETE MODAL */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md dark:bg-gray-800">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-red-700 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg width="32" height="32" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>

              <h3 className="text-2xl font-bold text-red-600 mb-2 dark:text-red-300">
                Delete Test Record
              </h3>

              <p className="text-gray-600 dark:text-gray-300">
                This action cannot be undone.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowDeleteModal(null)}
                disabled={deleting}
                className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 flex-1 px-6 py-3 border rounded-xl border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>

              <button
                onClick={() => deleteHistory(showDeleteModal)}
                disabled={deleting}
                className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 flex-1 px-6 py-3 bg-red-700 text-white rounded-xl"
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
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md dark:bg-gray-800">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-red-700 text-white rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg width="32" height="32" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
              </div>

              <h3 id="bulk-delete-title" className="text-2xl font-bold text-red-600 mb-2 dark:text-red-300">
                Delete {confirmedIds.length} Record{confirmedIds.length !== 1 ? 's' : ''}
              </h3>

              <p className="text-gray-600 dark:text-gray-300">
                This will permanently remove the selected records.
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 dark:bg-red-950 dark:border-red-800">
              <p className="text-sm text-red-700 dark:text-red-300">
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
                className="disabled:opacity-50 disabled:cursor-not-allowed flex-1 px-6 py-3 border rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 border-gray-300 dark:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancel
              </button>

              <button
                onClick={() => { void bulkDeleteHistory(bulkConfirmation); }}
                disabled={deleting || loading || confirmedIds.length === 0}
                className="disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-blue-300 dark:focus-visible:ring-offset-gray-800 flex-1 px-6 py-3 bg-red-700 text-white rounded-xl"
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
