import React, { useState, useEffect } from 'react';
import { supabase, Word, TestMistake } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Check, X, RotateCcw } from 'lucide-react';

interface TestWord extends Word {
  userAnswer: string;
  isCorrect: boolean;
}

export default function TestMode() {
  console.log('🚀 TestMode component mounted!'); // This should always show when component loads
  const { user } = useAuth();
  const [stage, setStage] = useState<'setup' | 'testing' | 'results'>('setup');
  const [direction, setDirection] = useState<'en-to-geo' | 'geo-to-en'>('geo-to-en');
  const [wordCount, setWordCount] = useState(10);
  const [customCount, setCustomCount] = useState('');
  const [inputType, setInputType] = useState<'multiple' | 'text'>('multiple');
  const [testWords, setTestWords] = useState<TestWord[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [userAnswer, setUserAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [multipleChoiceOptions, setMultipleChoiceOptions] = useState<string[]>([]);

  function generateMultipleChoiceOptions(correctAnswer: string, allWords: Word[], direction: string) {
    const options = [correctAnswer.trim().toLowerCase()];

    // Build pool of wrong answers
    const wrongPool = allWords.flatMap(w =>
      direction === 'en-to-geo'
        ? (w.georgian_definitions || []).map(d => d.trim().toLowerCase())
        : [w.english_word.trim().toLowerCase()]
    );

    const wrongOnly = wrongPool.filter(x => x !== correctAnswer.trim().toLowerCase());
    const shuffledWrong = wrongOnly.sort(() => Math.random() - 0.5);

    for (const wrong of shuffledWrong) {
      if (options.length >= 4) break;
      if (!options.includes(wrong)) options.push(wrong);
    }

    return options.sort(() => Math.random() - 0.5);
  }

  async function startTest() {
    if (!user) return;

    setLoading(true);
    try {
      const { data: allWords, error } = await supabase
        .from('words')
        .select('*')
        .eq('user_id', user.id);

      if (error) throw error;

      if (!allWords || allWords.length === 0) {
        alert('No words available. Add some words first!');
        return;
      }

      // Safely parse count
      const count = wordCount === 0 ? parseInt(customCount || '0', 10) : wordCount;
      if (count <= 0 || count > allWords.length) {
        alert(`Please select between 1 and ${allWords.length} words`);
        return;
      }

      // Random selection
      const shuffled = [...allWords].sort(() => Math.random() - 0.5).slice(0, count);
      const testData: TestWord[] = shuffled.map(word => ({
        ...word,
        userAnswer: '',
        isCorrect: false,
      }));

      setTestWords(testData);
      setCurrentQuestion(0);
      setUserAnswer('');

      // Generate options for first question if multiple choice
      if (inputType === 'multiple') {
        const firstWord = testData[0];
        const correctAnswer = direction === 'en-to-geo'
          ? (firstWord.georgian_definitions || []).join(', ')
          : firstWord.english_word;

        const options = generateMultipleChoiceOptions(correctAnswer, allWords, direction);
        setMultipleChoiceOptions(options);
      }

      setStage('testing');
    } catch (err: any) {
      console.error('Error starting test:', err);
      alert('Error starting test: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function submitAnswer() {
    if (!testWords[currentQuestion]) return;

    const currentWord = testWords[currentQuestion];
    const correctAnswer = direction === 'en-to-geo'
      ? (currentWord.georgian_definitions || []).join(', ')
      : currentWord.english_word;

    // Update the current word with user answer and correctness
    const updatedWords = [...testWords];
    updatedWords[currentQuestion] = {
      ...currentWord,
      userAnswer,
      isCorrect: userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase(),
    };
    setTestWords(updatedWords);

    const isLastQuestion = currentQuestion >= testWords.length - 1;

    if (isLastQuestion) {
      finishTest(updatedWords);
    } else {
      const nextQuestion = currentQuestion + 1;
      setCurrentQuestion(nextQuestion);
      setUserAnswer('');

      // Generate next multiple choice options
      if (inputType === 'multiple') {
        const nextWord = updatedWords[nextQuestion];
        const nextCorrect = direction === 'en-to-geo'
          ? (nextWord.georgian_definitions || []).join(', ')
          : nextWord.english_word;

        // Use original pool (all words) instead of testWords
        const options = generateMultipleChoiceOptions(nextCorrect, updatedWords, direction);
        setMultipleChoiceOptions(options);
      }
    }
  }

  function finishTest(finalWords: TestWord[]) {
    console.log('🏁 FINISHTEST() CALLED with', finalWords.length, 'words');
    console.log('Setting stage to results');
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
    console.log('🔄 RENDERING TESTING STAGE');
    console.log('current stage:', stage);
    console.log('currentQuestion:', currentQuestion);
    console.log('testWords.length:', testWords.length);

    const currentWord = testWords[currentQuestion];
    const progress = ((currentQuestion) / testWords.length) * 100;
    
    console.log('currentWord:', currentWord?.english_word || currentWord?.georgian_definitions);
    console.log('progress:', progress + '%');

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
                : currentWord.georgian_definitions.join(', ')
              }
            </div>
            {currentWord.description && (
              <div className="text-sm text-gray-600 italic">
                <div dangerouslySetInnerHTML={{ __html: currentWord.description }} />
              </div>
            )}
          </div>

          <div className="space-y-4">
            {inputType === 'text' ? (
              <input
                type="text"
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && userAnswer.trim()) {
                    console.log('Enter key pressed - submitting answer');
                    submitAnswer();
                  }
                }}
                placeholder="Type your answer..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                autoFocus
              />
            ) : (
              <div className="space-y-3">
                {multipleChoiceOptions.map((option, idx) => (
                  <label key={idx} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="multipleChoice"
                      value={option}
                      checked={userAnswer === option}
                      onChange={(e) => setUserAnswer(e.target.value)}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-lg">{option}</span>
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={submitAnswer}
              disabled={!userAnswer.trim()}
              className={`w-full px-6 py-3 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors ${
                currentQuestion >= testWords.length - 1 
                  ? 'bg-green-600 hover:bg-green-700 text-white' 
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {currentQuestion < testWords.length - 1 ? 'Next Question' : 'Finish Test'}
            </button>
            {currentQuestion >= testWords.length - 1 && (
              <p className="text-sm text-green-600 text-center mt-2 font-medium">
                This is your final question!
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'results') {
    console.log('🎯 RENDERING RESULTS STAGE');
    console.log('current stage:', stage);
    const correctCount = testWords.filter(w => w.isCorrect).length;
    const percentage = Math.round((correctCount / testWords.length) * 100);
    console.log('correctCount:', correctCount, 'percentage:', percentage);

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
                      {direction === 'en-to-geo' ? word.english_word : word.georgian_definitions.join(', ')}
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
