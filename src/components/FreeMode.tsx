import React, { useState, useEffect, useCallback } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shuffle, Check, X, ChevronRight } from 'lucide-react';

export default function FreeMode() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [filteredWords, setFilteredWords] = useState<Word[]>([]);
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
  const [progressLoaded, setProgressLoaded] = useState(false);

  // Load progress on mount
  useEffect(() => {
    const savedProgress = localStorage.getItem('vocab_practice_progress');
    if (savedProgress) {
      try {
        const progress = JSON.parse(savedProgress);
        setCorrectCount(progress.correctCount || 0);
        setTotalAttempts(progress.totalAttempts || 0);
        setGuessedWords(new Set(progress.guessedWords || []));
        setCurrentIndex(progress.currentIndex || 0);
      } catch {}
    }
    setProgressLoaded(true);
  }, []);

  // Load words from Supabase
  const loadWords = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('words')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      let wordsToUse = data || [];

      if (shuffle) {
        wordsToUse = [...wordsToUse].sort(() => Math.random() - 0.5);
      } else {
        wordsToUse = [...wordsToUse].sort((a, b) => a.english_word.localeCompare(b.english_word));
      }

      setWords(wordsToUse);
    } finally {
      setLoading(false);
    }
  }, [user, shuffle]);

  // Filter words based on guessedWords and allowReguess
  useEffect(() => {
    if (!progressLoaded) return;

    const filtered = allowReguess
      ? words
      : words.filter(w => !guessedWords.has(w.english_word));

    setFilteredWords(filtered);

    // Adjust currentIndex if out of bounds
    if (currentIndex >= filtered.length) setCurrentIndex(0);
  }, [words, guessedWords, allowReguess, currentIndex, progressLoaded]);

  // Persist progress
  useEffect(() => {
    if (!progressLoaded) return;

    const progress = {
      correctCount,
      totalAttempts,
      guessedWords: Array.from(guessedWords),
      currentIndex,
      timestamp: Date.now(),
    };
    localStorage.setItem('vocab_practice_progress', JSON.stringify(progress));
  }, [correctCount, totalAttempts, guessedWords, currentIndex, progressLoaded]);

  useEffect(() => {
    if (progressLoaded) loadWords();
  }, [loadWords, progressLoaded]);

  function checkAnswer() {
    if (!filteredWords[currentIndex]) return;

    const currentWord = filteredWords[currentIndex];
    const answer = userAnswer.trim().toLowerCase();
    let correct = false;

    if (direction === 'en-to-geo') {
      correct = currentWord.georgian_definitions.some(def => def.toLowerCase() === answer);
    } else {
      correct = currentWord.english_word.toLowerCase() === answer;
    }

    setIsCorrect(correct);
    setShowResult(true);
    setTotalAttempts(prev => prev + 1);
    if (correct) setCorrectCount(prev => prev + 1);

    // Add word to guessedWords regardless of correct/incorrect
    setGuessedWords(prev => new Set([...prev, currentWord.english_word]));
  }

  function nextWord() {
    if (currentIndex >= filteredWords.length - 1) {
      setShowCompletionDialog(true);
      return;
    }

    setCurrentIndex(prev => prev + 1);
    setUserAnswer('');
    setShowResult(false);
  }

  function handleCompletionDialogOk() {
    setCorrectCount(0);
    setTotalAttempts(0);
    setGuessedWords(new Set());
    setCurrentIndex(0);
    localStorage.removeItem('vocab_practice_progress');
    setShowCompletionDialog(false);
    loadWords();
  }

  const currentWord = filteredWords[currentIndex];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        Loading words...
      </div>
    );
  }

  if (filteredWords.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No words available to practice.
      </div>
    );
  }

  return (
    <>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Shuffle + Allow Re-guess */}
        <div className="flex justify-between items-center gap-4">
          <button
            onClick={() => setShuffle(prev => !prev)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              shuffle ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Shuffle size={18} />
            Shuffle
          </button>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowReguess}
              onChange={e => setAllowReguess(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Allow re-guess</span>
          </label>
        </div>

        {/* Progress */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
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

        {/* Word display */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              Word {currentIndex + 1} of {filteredWords.length}
              {currentIndex >= filteredWords.length - 1 && (
                <span className="ml-2 px-2 py-1 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 rounded-full text-xs font-medium">
                  Final Word!
                </span>
              )}
            </div>
            <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {direction === 'en-to-geo' ? currentWord.english_word : currentWord.georgian_definitions.join(', ')}
            </div>
            {currentWord.description && (
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 italic">{currentWord.description}</div>
            )}
          </div>

          <div className="space-y-4">
            <input
              type="text"
              value={userAnswer}
              onChange={e => setUserAnswer(e.target.value)}
              onKeyPress={e => {
                if (e.key === 'Enter' && !showResult) checkAnswer();
                else if (e.key === 'Enter' && showResult) nextWord();
              }}
              disabled={showResult}
              placeholder="Type your answer..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />

            {showResult && (
              <div className={`p-4 rounded-lg ${isCorrect ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
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
                  <strong>Correct answer{currentWord.georgian_definitions.length > 1 ? 's' : ''}:</strong>{' '}
                  {direction === 'en-to-geo' ? currentWord.georgian_definitions.join(', ') : currentWord.english_word}
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
                    currentIndex >= filteredWords.length - 1
                      ? 'bg-green-600 hover:bg-green-700 text-white'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {currentIndex >= filteredWords.length - 1 ? 'Finish Practice' : 'Next Word'}
                  {currentIndex >= filteredWords.length - 1 ? <Check size={20} /> : <ChevronRight size={20} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reset Progress Modal */}
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
                <h3 className="text-lg font-semibold text-gray-900">Reset Practice Progress</h3>
                <p className="text-sm text-gray-500 mt-1">
                  This will clear all your current session statistics including correct/total attempts and word progress.
                </p>
              </div>
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
                  setCurrentIndex(0);
                  localStorage.removeItem('vocab_practice_progress');
                  setShowResetModal(false);
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
                <Check className="text-white" size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">🎉 Practice Session Complete!</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Congratulations on completing all {filteredWords.length} words!
                </p>
              </div>
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
