import React, { useState, useEffect } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shuffle, ChevronRight, Check, X } from 'lucide-react';

export default function FreeMode() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<'en-to-geo' | 'geo-to-en'>('en-to-geo');
  const [userAnswer, setUserAnswer] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [loading, setLoading] = useState(true);
  const [answeredWords, setAnsweredWords] = useState<Set<number>>(new Set());
  const [correctAnswers, setCorrectAnswers] = useState<Set<number>>(new Set());
  const [showCompletionModal, setShowCompletionModal] = useState(false);

  useEffect(() => {
    loadWords();
  }, [shuffle]);

  async function loadWords() {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('words')
        .select('*');

      if (error) throw error;

      let wordsToUse = data || [];
      if (shuffle && wordsToUse.length > 0) {
        wordsToUse = [...wordsToUse].sort(() => Math.random() - 0.5);
      } else {
        wordsToUse = [...wordsToUse].sort((a, b) => 
          a.english_word.localeCompare(b.english_word)
        );
      }

      setWords(wordsToUse);
      setCurrentIndex(0);
      setUserAnswer('');
      setShowResult(false);
      setAnsweredWords(new Set());
      setCorrectAnswers(new Set());
      setShowCompletionModal(false);
    } catch (error: any) {
      console.error('Error loading words:', error);
    } finally {
      setLoading(false);
    }
  }

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

    // Track answered words
    const wordId = currentWord.id;
    setAnsweredWords(prev => new Set(prev).add(wordId));
    
    // Track correct answers
    if (correct) {
      setCorrectAnswers(prev => new Set(prev).add(wordId));
    }
  }

  function nextWord() {
    const nextIndex = (currentIndex + 1) % words.length;
    setCurrentIndex(nextIndex);
    setUserAnswer('');
    setShowResult(false);

    // Check if all words have been answered
    if (answeredWords.size >= words.length) {
      setShowCompletionModal(true);
    }
  }

  function getCompletionStats() {
    const totalWords = words.length;
    const answeredCount = answeredWords.size;
    const correctCount = correctAnswers.size;
    const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0;

    return { totalWords, answeredCount, correctCount, accuracy };
  }

  function getCompletionMessage() {
    const { accuracy, correctCount, totalWords } = getCompletionStats();
    
    if (accuracy >= 90) {
      return { 
        emoji: '🎉', 
        title: 'Excellent!', 
        message: `Perfect score! You're a language master! ${correctCount}/${totalWords} correct.` 
      };
    } else if (accuracy >= 70) {
      return { 
        emoji: '👍', 
        title: 'Great Job!', 
        message: `Well done! You're making great progress. ${correctCount}/${totalWords} correct.` 
      };
    } else if (accuracy >= 50) {
      return { 
        emoji: '🙂', 
        title: 'Good Effort!', 
        message: `Keep practicing! You're getting there. ${correctCount}/${totalWords} correct.` 
      };
    } else {
      return { 
        emoji: '💪', 
        title: 'Keep Going!', 
        message: `Don't give up! Practice makes perfect. ${correctCount}/${totalWords} correct.` 
      };
    }
  }

  function restartPractice() {
    setCurrentIndex(0);
    setUserAnswer('');
    setShowResult(false);
    setAnsweredWords(new Set());
    setCorrectAnswers(new Set());
    setShowCompletionModal(false);
    
    // Reshuffle if shuffle is enabled
    if (shuffle) {
      const shuffledWords = [...words].sort(() => Math.random() - 0.5);
      setWords(shuffledWords);
    }
  }

  const currentWord = words[currentIndex];
  const { totalWords, answeredCount, correctCount } = getCompletionStats();

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
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Progress Bar */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">
            Progress: {answeredCount}/{totalWords} words
          </span>
          <span className="text-sm font-medium text-gray-700">
            Correct: {correctCount}/{answeredCount}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(answeredCount / totalWords) * 100}%` }}
          ></div>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Free Mode - Practice</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setShuffle(!shuffle);
              loadWords();
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

      <div className="bg-white rounded-lg shadow-lg p-8">
        <div className="mb-6">
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
              className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                direction === 'en-to-geo'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
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
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Georgian → English
            </button>
          </div>
        </div>

        <div className="text-center mb-8">
          <div className="text-sm text-gray-500 mb-2">
            Word {currentIndex + 1} of {words.length}
          </div>
          <div className="text-4xl font-bold text-gray-900 mb-2">
            {direction === 'en-to-geo' 
              ? currentWord.english_word 
              : currentWord.georgian_definitions[0]
            }
          </div>
          {currentWord.description && (
            <div className="text-sm text-gray-600 mt-2 italic">
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
                className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors flex items-center justify-center gap-2"
              >
                Next Word
                <ChevronRight size={20} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Completion Modal */}
      {showCompletionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-center">
            <div className="text-6xl mb-4">{getCompletionMessage().emoji}</div>
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {getCompletionMessage().title}
            </h3>
            <p className="text-gray-600 mb-6">
              {getCompletionMessage().message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={restartPractice}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors"
              >
                Practice Again
              </button>
              <button
                onClick={() => setShowCompletionModal(false)}
                className="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-400 font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}