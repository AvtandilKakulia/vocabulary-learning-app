import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useLatestRequest } from './hooks/useLatestRequest';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import AuthPage from './components/AuthPage';
import WordManagement from './components/WordManagement';
import ErrorBoundary from './components/ErrorBoundary';
import FreeMode from './components/FreeMode';
import TestMode from './components/TestMode';
import History from './components/History';
import UserProfile, { DeleteAccountModal } from './components/UserProfile';
import { BookOpen, Brain, ClipboardList, History as HistoryIcon, LogOut, User, Trash2, ChevronDown, Sun, Moon } from 'lucide-react';
import { supabase } from './lib/supabase';
import { deletionMessage } from './lib/accountDeletion';
import type { AccountDeletionOperations, CompleteAccountDeletion } from './lib/accountDeletion';
import { useRetiredAccount } from './hooks/useRetiredAccount';
import { eraseAccountRecovery } from './lib/eraseAccountRecovery';

type View = 'words' | 'free' | 'test' | 'history';

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { user, loading, signOut } = useAuth();
  const [currentView, setCurrentView] = useState<View>('words');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [deleteAccount, setDeleteAccount] = useState<{ id: string; email?: string } | null>(null);
  const deletionOperations = useRef<AccountDeletionOperations>(new Map());
  const appMounted = useRef(false);
  const [deletedAccounts, setDeletedAccounts] = useState<ReadonlySet<string>>(() => new Set());
  const [recoveryErasure, setRecoveryErasure] = useState<Record<string, 'pending' | 'verified' | 'incomplete'>>({});
  const [profileName, setProfileName] = useState<{ userId: string; name: string | null } | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userId = user?.id;
  const retired = useRetiredAccount(userId);
  // Invalidate during render, before a different account can commit the dialog.
  // Clearing the intent also prevents A -> B -> A from reviving confirmation.
  if (deleteAccount && deleteAccount.id !== userId) setDeleteAccount(null);
  const closeDeleteAccount = useCallback(() => setDeleteAccount(null), []);
  const beginProfileRead = useLatestRequest(JSON.stringify([userId]));
  const displayName = profileName?.userId === userId ? profileName?.name : null;

  useLayoutEffect(() => {
    appMounted.current = true;
    return () => { appMounted.current = false; };
  }, []);

  const loadDisplayName = useCallback(async () => {
    const isCurrent = beginProfileRead();
    if (!isCurrent || !userId) return;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      if (isCurrent()) setProfileName({ userId, name: data?.display_name || null });
    } catch (error) {
      if (isCurrent()) console.error('Error loading display name:', error);
    }
  }, [beginProfileRead, userId]);

  useEffect(() => {
    setProfileName(null);
    void loadDisplayName();
  }, [loadDisplayName]);

  // Close user menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-300 text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuthSuccess={() => {}} />;
  }

  if (deletedAccounts.has(user.id) || retired) {
    return <>
      <p role="status" className="p-4 text-center text-gray-900 dark:text-gray-100">{deletionMessage('deleted')}</p>
      <p role="alert" className="p-4 text-center text-gray-900 dark:text-gray-100">{recoveryErasure[user.id] === 'pending'
        ? 'Removing this account’s browser recovery data…'
        : recoveryErasure[user.id] === 'verified'
          ? 'This account’s Practice/Test recovery records were removed and their absence checked in this browser.'
          : 'This account is retired in this browser. Residual recovery data may remain; complete local erasure has not been verified.'}</p>
      <AuthPage onAuthSuccess={() => {}} />
    </>;
  }

  const handleLogoClick = () => {
    setCurrentView('words');
  };

  const handleProfileUpdated = () => {
    void loadDisplayName();
  };

  const handleAccountDeleted: CompleteAccountDeletion = async ({ operation }) => {
    // Confirmed deletion belongs to this App and UID, even if the dialog has
    // unmounted or another account is active. Dialog validity must not gate it.
    if (deletionOperations.current.get(operation.accountId) !== operation
      || operation.phase !== 'completing') return { error: null };
    // Public SDK signOut has no compare-and-remove UID parameter. Even local
    // scope can remove a replacement session after an await. Retire only this
    // account's app UI; do not mutate shared Auth storage or revoke any session.
    if (appMounted.current) {
      setDeletedAccounts(previous => new Set(previous).add(operation.accountId));
      setRecoveryErasure(previous => ({ ...previous, [operation.accountId]: 'pending' }));
    }
    // Account-level erasure survives dialog/App unmount; only UI updates are
    // mount-bound. The durable marker also informs a replacement App/peer tab.
    try {
      const result = await eraseAccountRecovery(operation.accountId);
      if (appMounted.current) setRecoveryErasure(previous => ({ ...previous,
        [operation.accountId]: result.verified ? 'verified' : 'incomplete' }));
      return { error: result.verified ? null : new Error('Residual browser recovery data may remain.') };
    } catch (error) {
      if (appMounted.current) setRecoveryErasure(previous => ({ ...previous, [operation.accountId]: 'incomplete' }));
      return { error };
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-8">
              <button
                onClick={handleLogoClick}
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                <BookOpen className="text-blue-600 dark:text-blue-400" size={28} />
                <span className="text-xl font-bold text-gray-900 dark:text-gray-100">Vocabulary Learning</span>
              </button>
              <div className="hidden md:flex gap-1">
                <button
                  onClick={() => setCurrentView('words')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    currentView === 'words'
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <BookOpen size={18} />
                  Words
                </button>
                <button
                  onClick={() => setCurrentView('free')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    currentView === 'free'
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <Brain size={18} />
                  Practice
                </button>
                <button
                  onClick={() => setCurrentView('test')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    currentView === 'test'
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <ClipboardList size={18} />
                  Test
                </button>
                <button
                  onClick={() => setCurrentView('history')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    currentView === 'history'
                      ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-medium'
                      : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <HistoryIcon size={18} />
                  History
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Theme Toggle Button */}
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
              </button>

              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <User size={18} />
                  <span className="text-sm hidden sm:inline">
                    {displayName || user.email}
                  </span>
                  <ChevronDown size={16} className={`transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                    <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {displayName || 'User'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user.email}</p>
                    </div>

                    <button
                      onClick={() => {
                        setShowProfileModal(true);
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <User size={16} />
                      Edit Profile
                    </button>

                    <button
                      onClick={() => {
                        setDeleteAccount({ id: user.id, email: user.email });
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                    >
                      <Trash2 size={16} />
                      Delete Account
                    </button>

                    <div className="border-t border-gray-200 dark:border-gray-700 my-1"></div>

                    <button
                      onClick={() => {
                        signOut();
                        setShowUserMenu(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2"
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="md:hidden bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-16 z-30 transition-colors">
        <div className="flex overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setCurrentView('words')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border-b-2 transition-colors ${
              currentView === 'words'
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-600 dark:text-gray-300'
            }`}
          >
            <BookOpen size={18} />
            Words
          </button>
          <button
            onClick={() => setCurrentView('free')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border-b-2 transition-colors ${
              currentView === 'free'
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-600 dark:text-gray-300'
            }`}
          >
            <Brain size={18} />
            Practice
          </button>
          <button
            onClick={() => setCurrentView('test')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border-b-2 transition-colors ${
              currentView === 'test'
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-600 dark:text-gray-300'
            }`}
          >
            <ClipboardList size={18} />
            Test
          </button>
          <button
            onClick={() => setCurrentView('history')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 border-b-2 transition-colors ${
              currentView === 'history'
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-600 dark:text-gray-300'
            }`}
          >
            <HistoryIcon size={18} />
            History
          </button>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'words' && (
          <ErrorBoundary>
            <WordManagement />
          </ErrorBoundary>
        )}
        {currentView === 'free' && <FreeMode />}
        {currentView === 'test' && <TestMode />}
        {currentView === 'history' && <History />}
      </main>

      {showProfileModal && (
        <UserProfile
          onClose={() => setShowProfileModal(false)}
          onProfileUpdated={handleProfileUpdated}
        />
      )}

      {deleteAccount && deleteAccount.id === userId && (
        <DeleteAccountModal
          account={deleteAccount}
          operations={deletionOperations.current}
          onClose={closeDeleteAccount}
          onDeleted={handleAccountDeleted}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <AppContent />
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
