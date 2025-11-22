import React, { useState, useEffect } from 'react';
import { supabase, Word } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Shuffle, ChevronRight, Check, X } from 'lucide-react';

interface ProgressTracker {
  wordId: string;
  attempts: number;
  correctAnswers: number;
}

interface CompletionModalProps {
  isOpen: boolean;
  totalWords: number;
  correctAnswers: number;
  onRestart: () => void;
  onClose: () => void;
}

function CompletionModal({ isOpen, totalWords, correctAnswers, onRestart, onClose }: CompletionModalProps) {
  if (!isOpen) return null;

  const percentage = (correctAnswers / totalWords) * 100;
  let message = '';
  let emoji = '';
  let bgColor = '';

  if (percentage === 100) {
    message = 'Perfect Score! 🎉';
    emoji = '🌟';
    bgColor = 'bg-yellow-50 border-yellow-200';
  } else if (percentage >= 90) {
    message = 'Excellent Work! 🎯';
    emoji = '🎯';
    bgColor = 'bg-green-50 border-green-200';
  } else if (percentage >= 80) {
    message = 'Great Job! 👏';
    emoji = '👏';
    bgColor = 'bg-blue-50 border-blue-200';
  } else if (percentage >= 70) {
    message = 'Good Effort! 👍';
    emoji = '👍';
    bgColor = 'bg-purple-50 border-purple-200';
  } else if (percentage >= 60) {
    message = 'Not Bad! 💪';
    emoji = '💪';
    bgColor = 'bg-orange-50 border-orange-200';
  } else if (percentage >= 40) {
    message = 'Keep Practicing! 📚';
    emoji = '📚';
    bgColor = 'bg-orange-50 border-orange-200';
  } else {
    message = 'More Practice Needed! 🎯';
    emoji = '🎯';
    bgColor = 'bg-red-50 border-red-200';
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
        <div className="text-center">
          <div className="text-6xl mb-4">{emoji}</div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">{message}</h3>
          <div className="text-lg text-gray-600 mb-6">
            You answered <span className="font-bold text-blue-600">{correctAnswers}</span> out of{' '}
            <span className="font-bold">{totalWords}</span> questions correctly
          </div>
          <div className="text-sm text-gray-500 mb-6">
            Accuracy: {percentage.toFixed(1)}%
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
            >
              Close
            </button>
            <button
              onClick={onRestart}
              className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
            >
              Practice Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [progress, setProgress] = useState<ProgressTracker[]>([]);
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
      
      // Initialize progress tracker
      const initialProgress: ProgressTracker[] = wordsToUse.map(word => ({
        wordId: word.id,
        attempts: 0,
        correctAnswers: 0
      }));
      setProgress(initialProgress);
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

    // Update progress
    setProgress(prev => prev.map(p => {
      if (p.wordId === currentWord.id) {
        return {
          ...p,
          attempts: p.attempts + 1,
          correctAnswers: correct ? p.correctAnswers + 1 : p.correctAnswers
        };
      }
      return p;
    }));
  }

  function nextWord() {
    const nextIndex = (currentIndex + 1) % words.length;
    
    // Check if we've completed all words
    if (nextIndex === 0) {
      setShowCompletionModal(true);
    } else {
      setCurrentIndex(nextIndex);
      setUserAnswer('');
      setShowResult(false);
    }
  }

  function restartPractice() {
    // Reset progress and start over
    const initialProgress: ProgressTracker[] = words.map(word => ({
      wordId: word.id,
      attempts: 0,
      correctAnswers: 0
    }));
    setProgress(initialProgress);
    setCurrentIndex(0);
    setUserAnswer('');
    setShowResult(false);
    setShowCompletionModal(false);
  }

  const currentWord = words[currentIndex];
  
  // Calculate progress statistics
  const totalWords = words.length;
  const answeredWords = progress.filter(p => p.attempts > 0).length;
  const correctAnswers = progress.reduce((sum, p) => sum + p.correctAnswers, 0);

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

      {/* Progress Tracker */}
      <div className="bg-white rounded-lg shadow-md p-3">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-medium text-gray-700">Progress</span>
          <span className="text-xs text-gray-500">
            {answeredWords} / {totalWords} answered
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(answeredWords / totalWords) * 100}%` }}
          ></div>
        </div>
        {correctAnswers > 0 && answeredWords > 0 && (
          <div className="text-center mt-1">
            <span className="text-xs text-gray-600">
              Correct: {correctAnswers} ({((correctAnswers / answeredWords) * 100).toFixed(1)}%)
            </span>
          </div>
        )}
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
                {currentIndex === words.length - 1 ? 'Finish Test' : 'Next Word'}
                <ChevronRight size={20} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Completion Modal */}
      <CompletionModal 
        isOpen={showCompletionModal}
        totalWords={totalWords}
        correctAnswers={correctAnswers}
        onRestart={restartPractice}
        onClose={() => setShowCompletionModal(false)}
      />
    </div>
  );
}