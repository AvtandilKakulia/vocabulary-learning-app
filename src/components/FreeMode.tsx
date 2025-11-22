import React, { useState, useEffect } from 'react';
import { supabase, Word, TestMistake } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Check, X, RotateCcw } from 'lucide-react';

interface TestWord extends Word {
  userAnswer: string;
  isCorrect: boolean;
}

export default function TestMode() {
  const { user } = useAuth();
  const [stage, setStage] = useState<'setup' | 'testing' | 'results'>('setup');
  const [direction, setDirection] = useState<'en-to-geo' | 'geo-to-en'>('en-to-geo');
  const [wordCount, setWordCount] = useState(10);
  const [customCount, setCustomCount] = useState('');
  const [inputType, setInputType] = useState<'multiple' | 'text'>('text');
  const [testWords, setTestWords] = useState<TestWord[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function startTest() {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('words')
        .select('*');

      if (error) throw error;

      if (!data || data.length === 0) {
        alert('No words available. Add some words first!');
        return;
      }

      const count = wordCount === 0 ? parseInt(customCount) : wordCount;
      if (count <= 0 || count > data.length) {
        alert(`Please select between 1 and ${data.length} words`);
        return;
      }

      const shuffled = [...data].sort(() => Math.random() - 0.5).slice(0, count);
      const testData: TestWord[] = shuffled.map(word => ({
        ...word,
        userAnswer: '',
        isCorrect: false,
      }));

      setTestWords(testData);
      setCurrentQuestion(0);
      setUserAnswer('');
      setStage('testing');
    } catch (error: any) {
      console.error('Error starting test:', error);
      alert('Error starting test: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  function submitAnswer() {
    const currentWord = testWords[currentQuestion];
    const answer = userAnswer.trim().toLowerCase();
    let correct = false;

    if (direction === 'en-to-geo') {
      correct = currentWord.georgian_definitions.some(
        def => def.toLowerCase() === answer
      );
    } else {
      correct = currentWord.english_word.toLowerCase() === answer;
    }

    const updatedWords = [...testWords];
    updatedWords[currentQuestion] = {
      ...currentWord,
      userAnswer: userAnswer.trim(),
      isCorrect: correct,
    };
    setTestWords(updatedWords);

    if (currentQuestion < testWords.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setUserAnswer('');
    } else {
      finishTest(updatedWords);
    }
  }

  async function finishTest(finalWords: TestWord[]) {
    if (!user) return;

    const correctCount = finalWords.filter(w => w.isCorrect).length;
    const mistakes: TestMistake[] = finalWords
      .filter(w => !w.isCorrect)
      .map(w => ({
        english_word: w.english_word,
        user_answer: w.userAnswer,
        correct_definitions: w.georgian_definitions,
      }));

    try {
      const { error } = await supabase
        .from('test_history')
        .insert({
          user_id: user.id,
          test_direction: direction,
          total_words: finalWords.length,
          correct_count: correctCount,
          mistakes: mistakes,
        });

      if (error) throw error;
    } catch (error: any) {
      console.error('Error saving test history:', error);
    }

    setStage('results');
  }

  function resetTest() {
    setStage('setup');
    setTestWords([]);
    setCurrentQuestion(0);
    setUserAnswer('');
  }

  if (stage === 'setup') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Test Mode</h2>

        <div className="bg-white rounded-lg shadow-lg p-8 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Translation Direction
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setDirection('en-to-geo')}
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                  direction === 'en-to-geo'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                English → Georgian
              </button>
              <button
                onClick={() => setDirection('geo-to-en')}
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Number of Words
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[10, 20, 30].map(count => (
                <button
                  key={count}
                  onClick={() => {
                    setWordCount(count);
                    setCustomCount('');
                  }}
                  className={`px-4 py-2 rounded-lg border transition-colors ${
                    wordCount === count
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {count}
                </button>
              ))}
              <input
                type="number"
                value={customCount}
                onChange={(e) => {
                  setCustomCount(e.target.value);
                  setWordCount(0);
                }}
                placeholder="Custom"
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Input Type
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setInputType('text')}
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                  inputType === 'text'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Text Input
              </button>
              <button
                onClick={() => setInputType('multiple')}
                className={`flex-1 px-4 py-2 rounded-lg border transition-colors ${
                  inputType === 'multiple'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Multiple Choice
              </button>
            </div>
          </div>

          <button
            onClick={startTest}
            disabled={loading || (wordCount === 0 && !customCount)}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
          >
            {loading ? 'Loading...' : 'Start Test'}
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'testing') {
    const currentWord = testWords[currentQuestion];
    const progress = ((currentQuestion) / testWords.length) * 100;

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">Test in Progress</h2>
          <div className="text-sm text-gray-600">
            Question {currentQuestion + 1} of {testWords.length}
          </div>
        </div>

        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="text-4xl font-bold text-gray-900 mb-4">
              {direction === 'en-to-geo' 
                ? currentWord.english_word 
                : currentWord.georgian_definitions[0]
              }
            </div>
            {currentWord.description && (
              <div className="text-sm text-gray-600 italic">
                {currentWord.description}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <input
              type="text"
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && userAnswer.trim()) {
                  submitAnswer();
                }
              }}
              placeholder="Type your answer..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
              autoFocus
            />

            <button
              onClick={submitAnswer}
              disabled={!userAnswer.trim()}
              className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {currentQuestion < testWords.length - 1 ? 'Next Question' : 'Finish Test'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'results') {
    const correctCount = testWords.filter(w => w.isCorrect).length;
    const percentage = Math.round((correctCount / testWords.length) * 100);

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Test Results</h2>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="text-6xl font-bold text-gray-900 mb-2">
              {percentage}%
            </div>
            <div className="text-xl text-gray-600">
              {correctCount} out of {testWords.length} correct
            </div>
          </div>

          <div className="space-y-4 mb-6">
            <h3 className="font-bold text-lg text-gray-900">Review:</h3>
            {testWords.map((word, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border ${
                  word.isCorrect
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  {word.isCorrect ? (
                    <Check className="text-green-600 flex-shrink-0 mt-1" size={20} />
                  ) : (
                    <X className="text-red-600 flex-shrink-0 mt-1" size={20} />
                  )}
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">
                      {direction === 'en-to-geo' ? word.english_word : word.georgian_definitions[0]}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      Your answer: <span className="font-medium">{word.userAnswer || '(empty)'}</span>
                    </div>
                    {!word.isCorrect && (
                      <div className="text-sm text-gray-600 mt-1">
                        Correct: <span className="font-medium">
                          {direction === 'en-to-geo' 
                            ? word.georgian_definitions.join(', ')
                            : word.english_word
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={resetTest}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            <RotateCcw size={20} />
            Take Another Test
          </button>
        </div>
      </div>
    );
  }

  return null;
}
