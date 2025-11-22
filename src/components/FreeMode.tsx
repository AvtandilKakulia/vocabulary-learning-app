import React, { useState, useEffect, useCallback } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shuffle, ChevronRight, Check, X } from 'lucide-react';

export default function FreeMode() {
  const { user } = useAuth();
  const [allWords, setAllWords] = useState<Word[]>([]);
  const [remainingWords, setRemainingWords] = useState<Word[]>([]);
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
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

  // Load progress from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('vocab_practice_progress');
    if (saved) {
      try {
        const progress = JSON.parse(saved);
        setCorrectCount(progress.correctCount || 0);
        setTotalAttempts(progress.totalAttempts || 0);
        setGuessedWords(new Set(progress.guessedWords || []));
      } catch {}
    }
  }, []);

  // Save progress to localStorage
  useEffect(() => {
    const progress = {
      correctCount,
      totalAttempts,
      guessedWords: Array.from(guessedWords),
      timestamp: Date.now(),
    };
    localStorage.setItem('vocab_practice_progress', JSON.stringify(progress));
  }, [correctCount, totalAttempts, guessedWords]);

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

      let words: Word[] = data || [];

      // Apply shuffle
      if (shuffle && words.length > 0) {
        words = [...words].sort(() => Math.random() - 0.5);
      } else {
        words = [...words].sort((a, b) =>
          a.english_word.localeCompare(b.english_word)
        );
      }

      setAllWords(words);
    } catch (error) {
      console.error('Error loading words:', error);
    } finally {
      setLoading(false);
    }
  }, [user, shuffle]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  // Compute remaining words based on guessedWords and allowReguess
  useEffect(() => {
    let remaining: Word[];
    if (allowReguess) {
      remaining = [...allWords];
    } else {
      remaining = allWords.filter(
        (w) => !guessedWords.has(w.english_word)
      );
    }

    setRemainingWords(remaining);

    if (remaining.length > 0) {
      setCurrentWord(remaining[0]);
    } else {
      setCurrentWord(null);
    }
  }, [allWords, guessedWords, allowReguess]);

  const checkAnswer = () => {
    if (!currentWord) return;

    const answer = userAnswer.trim().toLowerCase();
    let correct = false;

    if (direction === 'en-to-geo') {
      correct = currentWord.georgian_definitions.some(
        (def) => def.toLowerCase() === answer
      );
    } else {
      correct = currentWord.english_word.toLowerCase() === answer;
    }

    setIsCorrect(correct);
    setShowResult(true);
    setTotalAttempts((prev) => prev + 1);
    if (correct) setCorrectCount((prev) => prev + 1);

    setGuessedWords((prev) => new Set(prev).add(currentWord.english_word));
  };

  const nextWord = () => {
    if (remainingWords.length <= 1) {
      setShowCompletionDialog(true);
      return;
    }
    const nextIndex = remainingWords.findIndex((w) => w.english_word === currentWord?.english_word) + 1;
    setCurrentWord(remainingWords[nextIndex]);
    setUserAnswer('');
    setShowResult(false);
  };

  const handleResetProgress = () => {
    setCorrectCount(0);
    setTotalAttempts(0);
    setGuessedWords(new Set());
    localStorage.removeItem('vocab_practice_progress');
    setShowResetModal(false);
    loadWords();
  };

  const handleCompletionDialogOk = () => {
    handleResetProgress();
    setShowCompletionDialog(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading words...</div>
      </div>
    );
  }

  if (!currentWord) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">
          No words available for practice. Add some words!
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Shuffle + Allow Re-guess */}
        <div className="flex gap-4 items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
          <button
            onClick={() => setShuffle(!shuffle)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
              shuffle
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Shuffle size={18} /> Shuffle
          </button>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowReguess}
              onChange={(e) => setAllowReguess(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Allow re-guessing words
            </span>
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
                {totalAttempts > 0
                  ? Math.round((correctCount / totalAttempts) * 100)
                  : 0}
                % Success Rate
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

        {/* Current Word */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <div className="text-center mb-4">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              Word {allWords.length - remainingWords.length + 1} of {allWords.length}
            </div>
            <div className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {direction === 'en-to-geo'
                ? currentWord.english_word
                : currentWord.georgian_definitions.join(', ')}
            </div>
            {currentWord.description && (
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-2 italic">
                {currentWord.description}
              </div>
            )}
          </div>

          <div className="mb-4">
            <input
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !showResult) checkAnswer();
                else if (e.key === 'Enter' && showResult) nextWord();
              }}
              disabled={showResult}
              placeholder="Type your answer..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
            />
          </div>

          {showResult && (
            <div
              className={`p-4 rounded-lg ${
                isCorrect
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
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
                Correct answer{currentWord.georgian_definitions.length > 1 ? 's' : ''}:{' '}
                {direction === 'en-to-geo'
                  ? currentWord.georgian_definitions.join(', ')
                  : currentWord.english_word}
              </div>
            </div>
          )}

          <div className="mt-4">
            {!showResult ? (
              <button
                onClick={checkAnswer}
                disabled={!userAnswer.trim()}
                className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
              >
                Check Answer
              </button>
            ) : (
              <button
                onClick={nextWord}
                className={`w-full px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  remainingWords.length <= 1
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {remainingWords.length <= 1 ? 'Finish Practice' : 'Next Word'}
                {remainingWords.length <= 1 ? <Check size={20} /> : <ChevronRight size={20} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reset Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Reset Practice Progress
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              This will clear all current statistics.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResetProgress}
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
            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
              🎉 Practice Session Complete!
            </h3>
            <div className="text-center mb-6">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Great job! You completed the session.
              </p>
            </div>
            <button
              onClick={handleCompletionDialogOk}
              className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-700 dark:to-indigo-700 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 dark:hover:from-blue-800 dark:hover:to-indigo-800 font-medium transition-all duration-200 flex items-center justify-center gap-2"
            >
              <Check size={20} /> Continue
            </button>
          </div>
        </div>
      )}
    </>
  );
}
