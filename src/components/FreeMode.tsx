import React, { useState, useEffect } from 'react';
import { supabase, Word, TestMistake } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shuffle, ChevronRight, Check, X } from 'lucide-react';

type Direction = 'en-to-geo' | 'geo-to-en';

interface PracticeProgress {
  correctCount: number;
  totalAttempts: number;
  guessedWords: string[];
  direction: Direction;
  shuffle: boolean;
  allowReguess: boolean;
  currentIndex: number;
  wordIds: string[];
  mistakes: TestMistake[];
}

export default function FreeMode() {
  const { user } = useAuth();

  const [allWords, setAllWords] = useState<Word[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<Direction>('geo-to-en');
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
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [mistakes, setMistakes] = useState<TestMistake[]>([]);
  const [savingHistory, setSavingHistory] = useState(false);

  const successRate =
    totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0;

  // Helper: build ordered word list given options
  function buildWordOrder(
    base: Word[],
    allow: boolean,
    shuffleEnabled: boolean,
    guessed: Set<string>
  ): Word[] {
    let list = base;

    if (!allow && guessed.size > 0) {
      const guessedSet = guessed;
      list = list.filter((w) => !guessedSet.has(w.english_word));
    }

    if (shuffleEnabled) {
      list = [...list].sort(() => Math.random() - 0.5);
    } else {
      list = [...list].sort((a, b) =>
        a.english_word.localeCompare(b.english_word)
      );
    }

    return list;
  }

  // Initial load: words + restore practice progress if present
  useEffect(() => {
    if (!user) return;

    initializeWords(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function initializeWords(restoreFromSaved: boolean = true) {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('words')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      const all = data || [];
      setAllWords(all);

      let usedDirection: Direction = direction;
      let usedShuffle = shuffle;
      let usedAllowReguess = allowReguess;
      let usedCorrectCount = correctCount;
      let usedTotalAttempts = totalAttempts;
      let usedGuessedWords: Set<string> = guessedWords;
      let usedMistakes: TestMistake[] = mistakes;
      let usedCurrentIndex = currentIndex;
      let savedWordIds: string[] | undefined;

      if (restoreFromSaved) {
        const savedRaw =
          typeof window !== 'undefined'
            ? localStorage.getItem('vocab_practice_progress')
            : null;

        if (savedRaw) {
          try {
            const saved: PracticeProgress = JSON.parse(savedRaw);

            usedDirection = saved.direction || usedDirection;
            usedShuffle =
              typeof saved.shuffle === 'boolean' ? saved.shuffle : usedShuffle;
            usedAllowReguess =
              typeof saved.allowReguess === 'boolean'
                ? saved.allowReguess
                : usedAllowReguess;
            usedCorrectCount = saved.correctCount || 0;
            usedTotalAttempts = saved.totalAttempts || 0;
            usedGuessedWords = new Set<string>(saved.guessedWords || []);
            usedMistakes = saved.mistakes || [];
            usedCurrentIndex =
              typeof saved.currentIndex === 'number' ? saved.currentIndex : 0;
            savedWordIds = Array.isArray(saved.wordIds)
              ? saved.wordIds
              : undefined;
          } catch (err) {
            console.error('Error parsing practice progress:', err);
            if (typeof window !== 'undefined') {
              localStorage.removeItem('vocab_practice_progress');
            }
          }
        }
      }

      setDirection(usedDirection);
      setShuffle(usedShuffle);
      setAllowReguess(usedAllowReguess);
      setCorrectCount(usedCorrectCount);
      setTotalAttempts(usedTotalAttempts);
      setGuessedWords(usedGuessedWords);
      setMistakes(usedMistakes);

      let practiceWords: Word[];

      // If we have a stored order, reconstruct it to avoid changing the current word
      if (savedWordIds && savedWordIds.length > 0) {
        const byId = new Map(all.map((w) => [w.id, w]));
        const ordered: Word[] = savedWordIds
          .map((id) => byId.get(id))
          .filter((w): w is Word => !!w);

        // append any new words that didn't exist when progress was saved
        const usedIds = new Set(ordered.map((w) => w.id));
        const extras = all.filter((w) => !usedIds.has(w.id));

        practiceWords = [...ordered, ...extras];
      } else {
        // No previous order – build fresh
        practiceWords = buildWordOrder(
          all,
          usedAllowReguess,
          usedShuffle,
          usedGuessedWords
        );
      }

      setWords(practiceWords);

      const safeIndex =
        practiceWords.length === 0
          ? 0
          : Math.min(
              Math.max(usedCurrentIndex, 0),
              practiceWords.length - 1
            );

      setCurrentIndex(safeIndex);
      setUserAnswer('');
      setShowResult(false);
      setIsCorrect(false);
    } catch (err) {
      console.error('Error loading words:', err);
    } finally {
      setLoading(false);
    }
  }

  // Persist progress (including order + current word)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!words.length) return;

    const progress: PracticeProgress = {
      correctCount,
      totalAttempts,
      guessedWords: Array.from(guessedWords),
      direction,
      shuffle,
      allowReguess,
      currentIndex,
      wordIds: words.map((w) => w.id),
      mistakes,
    };

    localStorage.setItem('vocab_practice_progress', JSON.stringify(progress));
  }, [
    correctCount,
    totalAttempts,
    guessedWords,
    direction,
    shuffle,
    allowReguess,
    currentIndex,
    words,
    mistakes,
  ]);

  function checkAnswer() {
    if (!words[currentIndex]) return;

    const currentWord = words[currentIndex];
    const answer = userAnswer.trim().toLowerCase();

    let correct = false;
    if (direction === 'en-to-geo') {
      // user types Georgian, compare against all Georgian definitions
      correct = currentWord.georgian_definitions.some(
        (def) => def.toLowerCase() === answer
      );
    } else {
      // user types English, compare against English word
      correct = currentWord.english_word.toLowerCase() === answer;
    }

    setIsCorrect(correct);
    setShowResult(true);

    setTotalAttempts((prev) => prev + 1);
    if (correct) {
      setCorrectCount((prev) => prev + 1);
    } else {
      // track mistakes for summary/history
      setMistakes((prev) => [
        ...prev,
        {
          english_word: currentWord.english_word,
          user_answer: userAnswer.trim(),
          correct_definitions: currentWord.georgian_definitions,
        },
      ]);
    }

    setGuessedWords((prev) => new Set([...prev, currentWord.english_word]));
  }

  // When user presses "Next" after checking answer
  function nextWord() {
    if (words.length === 0) return;

    // If this is the last word in the current cycle, end practice
    if (currentIndex === words.length - 1) {
      finishPractice();
      return;
    }

    setCurrentIndex((prev) => Math.min(prev + 1, words.length - 1));
    setUserAnswer('');
    setShowResult(false);
    setIsCorrect(false);
  }

  // Toggle shuffle and rebuild order from allWords
  function toggleShuffle() {
    setShuffle((prev) => {
      const next = !prev;
      if (allWords.length > 0) {
        const newOrder = buildWordOrder(
          allWords,
          allowReguess,
          next,
          guessedWords
        );
        setWords(newOrder);
        setCurrentIndex(0);
        setUserAnswer('');
        setShowResult(false);
        setIsCorrect(false);
      }
      return next;
    });
  }

  // Finish practice: show summary + save to history
  async function finishPractice() {
    if (totalAttempts === 0) {
      // No attempts yet, just show an empty summary (no history entry)
      setShowSummaryModal(true);
      return;
    }

    setShowSummaryModal(true);

    if (!user) return;

    try {
      setSavingHistory(true);
      const { error } = await supabase.from('test_history').insert({
        user_id: user.id,
        test_direction: direction,
        total_words: totalAttempts,
        correct_count: correctCount,
        mistakes,
      });

      if (error) {
        console.error('Error saving practice history:', error);
      }
    } catch (err) {
      console.error('Error saving practice history:', err);
    } finally {
      setSavingHistory(false);
    }
  }

  async function handleResetConfirm() {
    setShowResetModal(false);
    setCorrectCount(0);
    setTotalAttempts(0);
    setGuessedWords(new Set());
    setMistakes([]);
    setUserAnswer('');
    setShowResult(false);
    setIsCorrect(false);
    setCurrentIndex(0);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('vocab_practice_progress');
    }
    await initializeWords(false);
  }

  async function handlePracticeAgain() {
    setShowSummaryModal(false);
    setCorrectCount(0);
    setTotalAttempts(0);
    setGuessedWords(new Set());
    setMistakes([]);
    setUserAnswer('');
    setShowResult(false);
    setIsCorrect(false);
    setCurrentIndex(0);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('vocab_practice_progress');
    }
    await initializeWords(false);
  }

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
        <p className="text-gray-500 mb-4">
          No words available. Add some words to start practicing!
        </p>
      </div>
    );
  }

  const currentWord = words[currentIndex];

  return (
    <>
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">
            Free Mode - Practice
          </h2>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8 space-y-6">
          {/* Top bar: Translation Direction + Progress + Shuffle/Reset */}
          <div className="flex flex-wrap justify-between gap-6 items-start">
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
                    setIsCorrect(false);
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
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
                    setIsCorrect(false);
                  }}
                  className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                    direction === 'geo-to-en'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Geo → Eng
                </button>
              </div>
            </div>

            {/* Progress + controls */}
            <div className="flex flex-col items-end gap-3">
              <div className="text-right">
                <div className="text-xs uppercase tracking-wide text-gray-400">
                  Progress
                </div>
                <div className="text-lg font-semibold text-blue-900">
                  Correct: {correctCount} / {totalAttempts}
                </div>
                <div className="text-sm text-blue-700">
                  {successRate}% Success Rate
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={toggleShuffle}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    shuffle
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Shuffle size={18} />
                  Shuffle
                </button>
                <button
                  onClick={() => setShowResetModal(true)}
                  className="px-4 py-2 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Current word */}
          <div className="border-t border-gray-100 pt-6">
            <div className="text-center mb-8">
              <div className="text-sm text-gray-500 mb-2">
                Word {currentIndex + 1} of {words.length}
              </div>
              <div className="text-4xl font-bold text-gray-900 mb-2">
                {direction === 'en-to-geo'
                  ? currentWord.english_word
                  : currentWord.georgian_definitions.join(', ')}
              </div>
              {currentWord.description && (
                <div className="text-sm text-gray-600 mt-2 italic">
                  {currentWord.description}
                </div>
              )}
            </div>

            {/* Answer input + result + actions */}
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
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
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
                        <span className="font-medium text-green-800">
                          Correct!
                        </span>
                      </>
                    ) : (
                      <>
                        <X className="text-red-600" size={24} />
                        <span className="font-medium text-red-800">
                          Incorrect
                        </span>
                      </>
                    )}
                  </div>
                  {!isCorrect && (
                    <div className="text-sm text-gray-700">
                      <span className="font-medium">Correct answer:</span>{' '}
                      {direction === 'en-to-geo'
                        ? currentWord.georgian_definitions.join(', ')
                        : currentWord.english_word}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap justify-between gap-3 mt-2">
                <button
                  type="button"
                  onClick={finishPractice}
                  disabled={savingHistory}
                  className="px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 text-sm font-medium transition-colors"
                >
                  {savingHistory ? 'Saving…' : 'Finish Practice'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!showResult) {
                      checkAnswer();
                    } else {
                      nextWord();
                    }
                  }}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  {showResult ? (
                    <>
                      Next Word
                      <ChevronRight size={18} />
                    </>
                  ) : (
                    'Check Answer'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Re-guess toggle */}
        <div className="bg-white rounded-lg shadow p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={allowReguess}
              onChange={(e) => {
                const checked = e.target.checked;
                setAllowReguess(checked);
                if (allWords.length > 0) {
                  const newOrder = buildWordOrder(
                    allWords,
                    checked,
                    shuffle,
                    guessedWords
                  );
                  setWords(newOrder);
                  setCurrentIndex(0);
                  setUserAnswer('');
                  setShowResult(false);
                  setIsCorrect(false);
                }
              }}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="text-sm font-medium text-gray-700">
              Allow re-guessing previously correct words (Default: No)
            </span>
          </label>
        </div>
      </div>

      {/* Practice Summary Modal */}
      {showSummaryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Practice Summary
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              You answered{' '}
              <span className="font-semibold">{correctCount}</span> out of{' '}
              <span className="font-semibold">{totalAttempts}</span> attempts
              correctly ({successRate}% success rate).
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-900 space-y-1">
              <div>
                <strong>Direction:</strong>{' '}
                {direction === 'en-to-geo' ? 'Eng → Geo' : 'Geo → Eng'}
              </div>
              <div>
                <strong>Total attempts:</strong> {totalAttempts}
              </div>
              <div>
                <strong>Correct answers:</strong> {correctCount}
              </div>
            </div>

            {mistakes.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">
                  Your Mistakes
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {mistakes.map((m, idx) => (
                    <div
                      key={idx}
                      className="border border-gray-200 rounded-lg p-2 text-sm"
                    >
                      <div className="font-medium text-gray-900">
                        {m.english_word}
                      </div>
                      <div className="text-gray-600">
                        Your answer:{' '}
                        <span className="font-semibold">
                          {m.user_answer || '—'}
                        </span>
                      </div>
                      <div className="text-gray-600">
                        Correct:{' '}
                        <span className="font-semibold">
                          {m.correct_definitions.join(', ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowSummaryModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 font-medium transition-colors"
              >
                Close
              </button>
              <button
                onClick={handlePracticeAgain}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Practice Again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Progress Modal */}
      {showResetModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[70]">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <div className="flex items-start gap-4 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <svg
                  className="text-amber-600"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Reset Practice Progress
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  This will clear all your current session statistics including
                  correct/total attempts and word progress.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800">
                <strong>Current Progress:</strong>
                <br />
                Correct: {correctCount} / {totalAttempts} attempts
                <br />
                Success Rate: {successRate}%
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
                onClick={handleResetConfirm}
                className="flex-1 px-4 py-2.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 font-medium transition-colors"
              >
                Reset Progress
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
