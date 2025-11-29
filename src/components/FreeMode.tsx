import React, { useState, useEffect, useCallback } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shuffle, ChevronRight, Check, X } from 'lucide-react';

export default function FreeMode() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<'en-to-geo' | 'geo-to-en'>('geo-to-en');
  const [userAnswer, setUserAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [loading, setLoading] = useState(true);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [guessedWords, setGuessedWords] = useState<Set<string>>(new Set());
  const [allowReguess, setAllowReguess] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showCompletionDialog, setShowCompletionDialog] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [progressLoaded, setProgressLoaded] = useState(false);

  // Load progress from localStorage on component mount
  useEffect(() => {
    const savedProgress = localStorage.getItem('vocab_practice_progress');
    if (savedProgress) {
      try {
        const progress = JSON.parse(savedProgress);
        setCorrectCount(progress.correctCount || 0);
        setTotalAttempts(progress.totalAttempts || 0);
        setGuessedWords(new Set(progress.guessedWords || []));
      } catch (error) {
        // Error loading progress
      }
    }
    // Always start with a fresh session when component mounts
    setSessionCompleted(false);
    setProgressLoaded(true);
  }, []);

  const loadWords = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('words')
        .select('*')
        .eq('user_id', user.id); // Filter by current user

      if (error) throw error;

      let wordsToUse = data || [];
      
      // If allowReguess is enabled, show all words (no filtering)
      // If allowReguess is disabled, we still show all words but just track progress
      // The filtering should not remove words from practice entirely
      
      if (shuffle && wordsToUse.length > 0) {
        wordsToUse = [...wordsToUse].sort(() => Math.random() - 0.5);
      } else {
        wordsToUse = [...wordsToUse].sort((a, b) => 
          a.english_word.localeCompare(b.english_word)
        );
      }

      // Only reset currentIndex if we have no valid words or currentIndex is out of bounds
      if (wordsToUse.length === 0) {
        setCurrentIndex(0);
        setUserAnswer('');
        setShowResult(false);
      } else if (currentIndex >= wordsToUse.length) {
        // Only reset if we actually ran out of words
        setCurrentIndex(0);
        setUserAnswer('');
        setShowResult(false);
      }

      setWords(wordsToUse);
    } catch (error: any) {
      // Error loading words
    } finally {
      setLoading(false);
    }
  }, [user, allowReguess, shuffle, guessedWords, currentIndex]);

  useEffect(() => {
    if (progressLoaded) {
      loadWords();
    }
  }, [loadWords, progressLoaded]);

  // Handle allowReguess changes with a small delay to avoid conflicts
  useEffect(() => {
    if (progressLoaded) {
      const timer = setTimeout(() => {
        loadWords();
      }, 100); // Small delay to ensure navigation state is stable
      
      return () => clearTimeout(timer);
    }
  }, [allowReguess, progressLoaded]);

  // Handle shuffle changes with a small delay to avoid conflicts
  useEffect(() => {
    if (progressLoaded) {
      const timer = setTimeout(() => {
        loadWords();
      }, 100); // Small delay to ensure navigation state is stable
      
      return () => clearTimeout(timer);
    }
  }, [shuffle, progressLoaded]);

  // Save progress to localStorage whenever it changes
  useEffect(() => {
    const progress = {
      correctCount,
      totalAttempts,
      guessedWords: Array.from(guessedWords),
      timestamp: Date.now()
    };
    localStorage.setItem('vocab_practice_progress', JSON.stringify(progress));
  }, [correctCount, totalAttempts, guessedWords]);

  function checkAnswer() {
    if (!words[currentIndex]) return;

    const currentWord = words[currentIndex];
    const answer = userAnswer.trim().toLowerCase();

    let correct = false;
    if (direction === 'en-to-geo') {
      correct = currentWord.georgian_definitions.some(
        def => def.toLowerCase() === answer
      );
    } else {
      correct = currentWord.english_word.toLowerCase() === answer;
    }
    
    setIsCorrect(correct);
    setShowResult(true);
    
    // Track progress
    setTotalAttempts(prev => prev + 1);
    if (correct) {
      setCorrectCount(prev => prev + 1);
    }
    
    // Add to guessed words set
    setGuessedWords(prev => new Set([...prev, currentWord.english_word]));
  }

  function nextWord() {
    // Check if we're at the last word
    if (currentIndex >= words.length - 1) {
      // This was the last word - show completion dialog
      setShowCompletionDialog(true);
      return;
    }
    
    // Move to next word
    setCurrentIndex(currentIndex + 1);
    setUserAnswer('');
    setShowResult(false);
  }

  function handleCompletionDialogOk() {
    // Reset all progress data
    setCorrectCount(0);
    setTotalAttempts(0);
    setGuessedWords(new Set());
    localStorage.removeItem('vocab_practice_progress');
    
    // Reset session state for new practice session
    setShowCompletionDialog(false);
    setSessionCompleted(false);
    setCurrentIndex(0);
    setUserAnswer('');
    setShowResult(false);
    
    // Reload words to reflect the reset progress
    loadWords();
  }

  const currentWord = words[currentIndex];

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4"></div>
          <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">Loading your words...</div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">Preparing your practice session</div>
        </div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="mb-8">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
              Ready to Start Learning?
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
              No words available yet. Add some words to your vocabulary collection to start practicing!
            </p>
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl p-6 border border-blue-200 dark:border-blue-800">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-semibold">Pro tip:</span> Add words with different definitions and contexts to make your practice sessions more engaging and effective.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 transition-all duration-500">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header Section */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            Vocabulary Practice
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Master new words with interactive practice sessions
          </p>
        </div>

        {/* Progress Dashboard */}
        <div className="mb-8">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-2">
                  <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                    {correctCount}
                  </div>
                  <div className="text-2xl text-gray-400">/</div>
                  <div className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                    {totalAttempts}
                  </div>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Success Rate: <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-20 h-20">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-gray-200 dark:text-gray-700"
                      />
                      <path
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        strokeWidth="3"
                        strokeDasharray={`${totalAttempts > 0 ? (correctCount / totalAttempts) * 100 : 0}, 100`}
                        className="text-blue-600 dark:text-blue-400"
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
                      </span>
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={() => setShowResetModal(true)}
                  className="px-4 py-2 text-sm bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl hover:from-red-600 hover:to-pink-600 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  Reset Progress
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Controls Row */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Translation Direction */}
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Translation Direction
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setDirection('en-to-geo');
                  setUserAnswer('');
                  setShowResult(false);
                }}
                className={`px-4 py-3 rounded-xl font-medium transition-all duration-200 transform hover:scale-105 ${
                  direction === 'en-to-geo'
                    ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                English → Georgian
              </button>
              <button
                onClick={() => {
                  setDirection('geo-to-en');
                  setUserAnswer('');
                  setShowResult(false);
                }}
                className={`px-4 py-3 rounded-xl font-medium transition-all duration-200 transform hover:scale-105 ${
                  direction === 'geo-to-en'
                    ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Georgian → English
              </button>
            </div>
          </div>

          {/* Settings */}
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Shuffle Words
                </span>
                <button
                  onClick={() => {
                    setShuffle(!shuffle);
                    // Let the useEffect handle the reload
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    shuffle ? 'bg-gradient-to-r from-green-500 to-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    shuffle ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Allow re-guessing words
                </span>
                <button
                  onClick={() => {
                    setAllowReguess(!allowReguess);
                    // Let the useEffect handle the reload
                  }}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    allowReguess ? 'bg-gradient-to-r from-orange-500 to-red-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    allowReguess ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Main Practice Card */}
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/30 dark:border-gray-700/30 overflow-hidden transition-all duration-300">
          {/* Progress Bar */}
          <div className="h-2 bg-gray-200 dark:bg-gray-700">
            <div 
              className="h-full bg-gradient-to-r from-red-500 to-pink-500 transition-all duration-500"
              style={{ width: `${((currentIndex + 1) / words.length) * 100}%` }}
            />
          </div>

          <div className="p-8 md:p-12">
            {/* Word Counter */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 rounded-full text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                <span>Word {currentIndex + 1} of {words.length}</span>
                {currentIndex >= words.length - 1 && (
                  <span className="ml-2 px-2 py-1 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-full text-xs font-bold animate-pulse">
                    Final Word!
                  </span>
                )}
              </div>
            </div>

            {/* Word Display */}
            <div className="text-center mb-12">
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent mb-4 leading-tight">
                {direction === 'en-to-geo' 
                  ? currentWord.english_word 
                  : currentWord.georgian_definitions.join(', ')
                }
              </div>
              {currentWord.description && (
                <div className="text-lg text-gray-500 dark:text-gray-400 italic max-w-2xl mx-auto">
                  {currentWord.description}
                </div>
              )}
            </div>

            {/* Answer Input */}
            <div className="max-w-md mx-auto space-y-6">
              <div className="relative">
                <input
                  type="text"
                  value={userAnswer}
                  onChange={(e) => setUserAnswer(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !showResult) {
                      checkAnswer();
                    } else if (e.key === 'Enter' && showResult) {
                      nextWord();
                    }
                  }}
                  disabled={showResult}
                  placeholder="Type your answer..."
                  className="w-full px-6 py-4 text-lg border-2 border-gray-200 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all duration-200"
                />
              </div>

              {/* Result Feedback */}
              {showResult && (
                <div className={`p-6 rounded-2xl border-2 transition-all duration-300 transform ${
                  isCorrect 
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800 shadow-lg shadow-green-500/10' 
                    : 'bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 border-red-200 dark:border-red-800 shadow-lg shadow-red-500/10'
                }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`p-2 rounded-full ${
                      isCorrect ? 'bg-green-500' : 'bg-red-500'
                    }`}>
                      {isCorrect ? (
                        <Check className="text-white" size={24} />
                      ) : (
                        <X className="text-white" size={24} />
                      )}
                    </div>
                    <span className={`text-xl font-bold ${
                      isCorrect ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                    }`}>
                      {isCorrect ? 'Perfect!' : 'Not quite right'}
                    </span>
                  </div>
                  <div className={`text-base ${
                    isCorrect ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                  }`}>
                    <span className="font-semibold">
                      Correct answer{currentWord.georgian_definitions.length > 1 ? 's' : ''}:
                    </span>{' '}
                    {direction === 'en-to-geo' 
                      ? currentWord.georgian_definitions.join(', ')
                      : currentWord.english_word
                    }
                  </div>
                </div>
              )}

              {/* Action Button */}
              <div className="pt-4">
                {!showResult ? (
                  <button
                    onClick={checkAnswer}
                    disabled={!userAnswer.trim()}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-2xl font-bold text-base hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
                  >
                    Check Answer
                  </button>
                ) : (
                  <button
                    onClick={nextWord}
                    className={`w-full px-6 py-3 rounded-2xl font-bold text-base transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 ${
                      currentIndex >= words.length - 1 
                        ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700' 
                        : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700'
                    }`}
                  >
                    {currentIndex >= words.length - 1 ? 'Finish Practice' : 'Next Word'}
                    {currentIndex >= words.length - 1 ? (
                      <Check size={20} />
                    ) : (
                      <ChevronRight size={20} />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Progress Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg className="text-white" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
                Reset Progress
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                This will clear all your current session statistics and start fresh
              </p>
            </div>

            <div className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border border-orange-200 dark:border-orange-800 rounded-2xl p-6 mb-8">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Current Progress:</h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{correctCount}</div>
                  <div className="text-gray-600 dark:text-gray-400">Correct</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">{totalAttempts}</div>
                  <div className="text-gray-600 dark:text-gray-400">Total Attempts</div>
                </div>
              </div>
              <div className="text-center mt-4 pt-4 border-t border-orange-200 dark:border-orange-700">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">Success Rate</div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setCorrectCount(0);
                  setTotalAttempts(0);
                  setGuessedWords(new Set());
                  localStorage.removeItem('vocab_practice_progress');
                  setShowResetModal(false);
                  setSessionCompleted(false);
                  // Reload words to reflect the reset progress
                  loadWords();
                }}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl font-semibold hover:from-orange-600 hover:to-red-600 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
              >
                Reset Progress
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completion Dialog */}
      {showCompletionDialog && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-lg transition-all duration-300">
            <div className="text-center mb-8">
              <div className="w-24 h-24 mx-auto bg-gradient-to-br from-green-400 via-emerald-500 to-teal-500 rounded-full flex items-center justify-center mb-6 shadow-2xl animate-pulse">
                <Check className="text-white" size={48} strokeWidth={3} />
              </div>
              <h3 className="text-3xl font-bold bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent mb-3">
                🎉 Amazing Work!
              </h3>
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-2">
                You've completed all {words.length} words!
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Ready for your next challenge?
              </p>
            </div>

            <div className="bg-gradient-to-r from-green-50 via-emerald-50 to-teal-50 dark:from-green-900/20 dark:via-emerald-900/20 dark:to-teal-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-6 mb-8">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full mb-4 shadow-lg">
                  <span className="text-3xl font-bold text-white">
                    {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
                  </span>
                </div>
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Success Rate
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-6">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600 dark:text-green-400 mb-1">{correctCount}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">Correct Answers</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-1">{totalAttempts}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Attempts</div>
                </div>
              </div>
            </div>

            <div className="text-center mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Your progress will be reset so you can start fresh for your next practice session.
              </p>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleCompletionDialogOk}
                className="flex-1 px-8 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-2xl font-bold text-lg hover:from-green-700 hover:to-emerald-700 transition-all duration-200 transform hover:scale-105 shadow-xl hover:shadow-2xl flex items-center justify-center gap-3"
              >
                <Check size={24} />
                Continue Learning
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
