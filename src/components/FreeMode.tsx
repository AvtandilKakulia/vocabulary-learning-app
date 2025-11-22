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
      
      // Filter out guessed words if re-guess is disabled
      if (!allowReguess) {
        wordsToUse = wordsToUse.filter(word => !guessedWords.has(word.english_word));
      }
      
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
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading words...</div>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">No words available. Add some words to start practicing!</p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Free Mode - Practice</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShuffle(!shuffle);
              // Let the useEffect handle the reload
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              shuffle
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Shuffle size={18} />
            Shuffle
          </button>
        </div>
      </div>

      {/* Progress Tracking */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 transition-colors">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-lg font-semibold text-blue-900 dark:text-blue-100">
              Correct: {correctCount} / {totalAttempts}
            </div>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}% Success Rate
            </div>
          </div>
          <button
            onClick={() => setShowResetModal(true)}
            className="px-4 py-2 text-sm bg-blue-100 dark:bg-blue-800 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-700 transition-colors"
          >
            Reset Progress
          </button>
        </div>
      </div>

      {/* Re-guess toggle */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 transition-colors">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={allowReguess}
            onChange={(e) => {
              setAllowReguess(e.target.checked);
              // Don't immediately reload words - let the useEffect handle it with debouncing
            }}
            className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Allow re-guessing previously correct words (Default: No)
          </span>
        </label>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 transition-colors">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Translation Direction
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDirection('en-to-geo');
                setUserAnswer('');
                setShowResult(false);
              }}
              className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                direction === 'en-to-geo'
                  ? 'bg-blue-600 dark:bg-blue-700 text-white border-blue-600 dark:border-blue-600'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
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
              className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                direction === 'geo-to-en'
                  ? 'bg-blue-600 dark:bg-blue-700 text-white border-blue-600 dark:border-blue-600'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
              }`}
            >
              Georgian → English
            </button>
          </div>
        </div>

        <div className="text-center mb-8">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Word {currentIndex + 1} of {words.length}
            {currentIndex >= words.length - 1 && (
              <span className="ml-2 px-2 py-1 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 rounded-full text-xs font-medium">
                Final Word!
              </span>
            )}
          </div>
          <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {direction === 'en-to-geo' 
              ? currentWord.english_word 
              : currentWord.georgian_definitions.join(', ')
            }
          </div>
          {currentWord.description && (
            <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 italic">
              {currentWord.description}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
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
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />
          </div>

          {showResult && (
            <div className={`p-4 rounded-lg ${
              isCorrect 
                ? 'bg-green-50 border border-green-200' 
                : 'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {isCorrect ? (
                  <>
                    <Check className="text-green-600" size={24} />
                    <span className="font-medium text-green-800">Correct!</span>
                  </>
                ) : (
                  <>
                    <X className="text-red-600" size={24} />
                    <span className="font-medium text-red-800">Incorrect</span>
                  </>
                )}
              </div>
              <div className="text-sm text-gray-700">
                <span className="font-medium">Correct answer{currentWord.georgian_definitions.length > 1 ? 's' : ''}:</span>{' '}
                {direction === 'en-to-geo' 
                  ? currentWord.georgian_definitions.join(', ')
                  : currentWord.english_word
                }
              </div>
            </div>
          )}

          <div className="flex gap-2">
            {!showResult ? (
              <button
                onClick={checkAnswer}
                disabled={!userAnswer.trim()}
                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Check Answer
              </button>
            ) : (
              <button
                onClick={nextWord}
                className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  currentIndex >= words.length - 1 
                    ? 'bg-green-600 hover:bg-green-700 text-white' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
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

      {/* Reset Progress Modal moved outside space-y container */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="text-amber-600" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Reset Practice Progress
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  This will clear all your current session statistics including correct/total attempts and word progress.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800">
                <strong>Current Progress:</strong><br/>
                Correct: {correctCount} / {totalAttempts} attempts<br/>
                Success Rate: {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
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
                className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium transition-colors"
              >
                Reset Progress
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completion Dialog */}
      {showCompletionDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md transition-colors">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-shrink-0 w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center">
                <svg className="text-white" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 12l2 2 4-4"></path>
                  <path d="M21 12c-1 0-3-1-3-3s2-3 3-3 3 1 3 3-2 3-3 3"></path>
                  <path d="M3 12c1 0 3-1 3-3s-2-3-3-3-3 1-3 3 2 3 3 3"></path>
                  <path d="M13 12h3"></path>
                  <path d="M8 12H5"></path>
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                  🎉 Practice Session Complete!
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Congratulations on completing all {words.length} words!
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6 transition-colors">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-900 dark:text-blue-100 mb-1">
                  {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
                </div>
                <div className="text-sm text-blue-700 dark:text-blue-300 mb-3">Success Rate</div>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{correctCount}</div>
                    <div className="text-gray-600 dark:text-gray-400">Correct</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totalAttempts}</div>
                    <div className="text-gray-600 dark:text-gray-400">Total Attempts</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="text-center mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Great job! Your progress will be reset so you can start fresh for your next practice session.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCompletionDialogOk}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-700 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 dark:hover:from-blue-800 dark:hover:to-indigo-800 font-medium transition-all duration-200 flex items-center justify-center gap-2"
              >
                <Check size={20} />
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
