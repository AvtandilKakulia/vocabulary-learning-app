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
  <div className="min-h-screen bg-gradient-to-br from-[#EEF5FF] to-[#F7F9FC] flex items-start justify-center py-10 px-4">
    <div className="w-full max-w-4xl bg-white shadow-xl rounded-xl p-6 border border-gray-100">

      {/* ===================== DASHBOARD GRID (60/40) ===================== */}
      <div className="grid grid-cols-5 gap-6">

        {/* ===================== LEFT COLUMN (60%) ===================== */}
        <div className="col-span-3 space-y-6">

          {/* Translation Direction */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Translation Direction
            </label>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDirection('en-to-geo');
                  setUserAnswer('');
                  setShowResult(false);
                }}
                className={`flex-1 px-3 py-2 text-sm rounded-md border transition ${
                  direction === 'en-to-geo'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Eng → Geo
              </button>

              <button
                onClick={() => {
                  setDirection('geo-to-en');
                  setUserAnswer('');
                  setShowResult(false);
                }}
                className={`flex-1 px-3 py-2 text-sm rounded-md border transition ${
                  direction === 'geo-to-en'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Geo → Eng
              </button>
            </div>
          </div>

          {/* Word Display */}
          <div className="text-center space-y-1">
            <div className="text-xs text-gray-500">
              Word {currentIndex + 1} of {words.length}
            </div>

            <div className="text-3xl font-bold text-gray-900">
              {direction === 'en-to-geo'
                ? currentWord.english_word
                : currentWord.georgian_definitions.join(', ')}
            </div>

            {currentWord.description && (
              <div className="text-xs text-gray-600 italic">
                {currentWord.description}
              </div>
            )}
          </div>

          {/* Input */}
          <input
            type="text"
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !showResult) checkAnswer();
              else if (e.key === 'Enter' && showResult) nextWord();
            }}
            disabled={showResult}
            placeholder="Type your answer…"
            className="w-full px-3 py-2 border rounded-md text-sm focus:ring-1 focus:ring-blue-500"
          />

          {/* Result Box */}
          {showResult && (
            <div
              className={`p-3 rounded-md text-sm border ${
                isCorrect
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                {isCorrect ? (
                  <>
                    <Check className="text-green-600" size={18} />
                    <span className="font-medium text-green-800">Correct!</span>
                  </>
                ) : (
                  <>
                    <X className="text-red-600" size={18} />
                    <span className="font-medium text-red-800">Incorrect</span>
                  </>
                )}
              </div>

              {!isCorrect && (
                <p className="text-center text-gray-700">
                  <strong>Answer:</strong>{' '}
                  {direction === 'en-to-geo'
                    ? currentWord.georgian_definitions.join(', ')
                    : currentWord.english_word}
                </p>
              )}
            </div>
          )}

        </div>

        {/* ===================== RIGHT COLUMN (40%) ===================== */}
        <div className="col-span-2 space-y-4">

          {/* Progress */}
          <div className="bg-gray-50 border border-gray-200 p-4 rounded-md text-center">
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Progress
            </div>
            <div className="text-lg font-semibold text-gray-900">
              {correctCount} / {totalAttempts}
            </div>
            <div className="text-xs text-blue-700 font-medium">
              {totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0}%
            </div>
          </div>

          {/* Shuffle */}
          <button
            onClick={() => setShuffle(!shuffle)}
            className={`w-full px-3 py-2 rounded-md text-sm border flex items-center justify-center gap-2 transition ${
              shuffle
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Shuffle size={16} />
            Shuffle
          </button>

          {/* Reset */}
          <button
            onClick={() => setShowResetModal(true)}
            className="w-full px-3 py-2 text-sm rounded-md border bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            Reset Progress
          </button>

          {/* Re-guess Toggle */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowReguess}
              onChange={() => setAllowReguess(!allowReguess)}
              className="w-4 h-4"
            />
            Allow re-guessing
          </label>

        </div>
      </div>

      {/* ===================== BOTTOM BUTTONS ===================== */}
      <div className="flex gap-4 mt-8">
        <button
          onClick={() => setShowCompletionDialog(true)}
          className="flex-1 px-3 py-2 text-sm border rounded-md bg-white hover:bg-gray-50"
        >
          Finish Practice
        </button>

        <button
          onClick={() => (!showResult ? checkAnswer() : nextWord())}
          className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center gap-1"
        >
          {showResult ? (
            <>
              Next <ChevronRight size={16} />
            </>
          ) : (
            'Check Answer'
          )}
        </button>
      </div>

    </div>
  </div>
);
}
