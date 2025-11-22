import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import AuthPage from './components/AuthPage';
import WordManagement from './components/WordManagement';
import FreeMode from './components/FreeMode';
import TestMode from './components/TestMode';
import History from './components/History';
import UserProfile, { DeleteAccountModal } from './components/UserProfile';
import { BookOpen, Brain, ClipboardList, History as HistoryIcon, LogOut, User, Trash2, ChevronDown, Sun, Moon } from 'lucide-react';
import { supabase } from './lib/supabase';

type View = 'words' | 'free' | 'test' | 'history';

function AppContent() {
  const { theme, toggleTheme } = useTheme();
  const { user, loading, signOut } = useAuth();
  const [currentView, setCurrentView] = useState<View>('words');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Load user display name
  useEffect(() => {
    async function loadDisplayName() {
      if (!user) return;

      const { data } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();

      setDisplayName(data?.display_name || null);
    }
    loadDisplayName();
  }, [user]);

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

  const handleLogoClick = () => {
    setCurrentView('words');
  };

  const handleProfileUpdated = () => {
    // Reload display name after profile update
    supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name || null);
      });
  };

  const handleAccountDeleted = async () => {
    await signOut();
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
                        setShowDeleteModal(true);
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
        {currentView === 'words' && <WordManagement />}
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

      {showDeleteModal && (
        <DeleteAccountModal
          onClose={() => setShowDeleteModal(false)}
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
