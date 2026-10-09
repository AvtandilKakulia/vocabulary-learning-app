import React, { useState, useRef, useEffect } from 'react';
import { supabase, Word, TestHistory, TestMistake } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Check, X, RotateCcw, CheckCircle2, AlertCircle, Info, Loader2 } from 'lucide-react';
import { sanitizeDescription } from '../lib/sanitizeDescription';
import {
  CompletedTestResult, matchesCompletedTest, persistPendingTest, removePendingTest,
} from '../lib/pendingTestResults';
import {
  ActiveTestSession, TestQuestion, checkpointCompletedTest, persistActiveTest, readTestRecovery, removeActiveTest,
} from '../lib/activeTestSessions';

type HistorySaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type TestDirection = TestHistory['test_direction'];
type InputType = 'multiple' | 'text';

interface TestSession {
  userId: string;
  active: ActiveTestSession | null;
  hasActiveCopy: boolean;
  hasCompletedCheckpoint: boolean;
  result: CompletedTestResult | null;
  saveStatus: HistorySaveStatus;
  hasPersistedCopy: boolean;
}

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function getAnswerLabel(word: Pick<Word, 'english_word' | 'georgian_definitions'>, direction: TestDirection): string {
  return direction === 'en-to-geo'
    ? word.georgian_definitions.join(', ')
    : word.english_word;
}

function isCorrectAnswer(word: TestQuestion, answer: string, direction: TestDirection, inputType: InputType): boolean {
  const normalized = normalizeAnswer(answer);
  if (direction === 'en-to-geo' && inputType === 'text') {
    return word.georgian_definitions.some(definition => normalizeAnswer(definition) === normalized);
  }

  // Multiple Choice uses the full sense label; Georgian → English uses the word.
  return normalized === normalizeAnswer(getAnswerLabel(word, direction));
}

function shuffle<T>(items: T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function generateMultipleChoiceOptions(currentWord: Word, vocabulary: Word[], direction: TestDirection): string[] {
  const correctLabel = getAnswerLabel(currentWord, direction);
  const correctKey = normalizeAnswer(correctLabel);
  const currentEnglish = normalizeAnswer(currentWord.english_word);
  const hasContext = Boolean(currentWord.description?.trim());
  const acceptedDefinitions = new Set(currentWord.georgian_definitions.map(normalizeAnswer));
  const distractors = new Map<string, string>();

  for (const candidate of vocabulary) {
    if (candidate.id === currentWord.id) continue;

    // Without question context, another sense of the same English word is ambiguous.
    if (direction === 'en-to-geo' && !hasContext &&
      normalizeAnswer(candidate.english_word) === currentEnglish) continue;

    const label = getAnswerLabel(candidate, direction);
    const key = normalizeAnswer(label);
    if (!key || key === correctKey || distractors.has(key)) continue;

    // Another row's label must not offer an accepted definition as a wrong answer.
    if (direction === 'en-to-geo' && (
      acceptedDefinitions.has(key) ||
      candidate.georgian_definitions.some(definition => acceptedDefinitions.has(normalizeAnswer(definition)))
    )) continue;

    distractors.set(key, label);
  }

  return shuffle([correctLabel, ...shuffle([...distractors.values()]).slice(0, 3)]);
}

export default function TestMode() {
  const { user } = useAuth();
  // Account changes remount all session state before another user can see it.
  return user ? <AccountTestMode key={user.id} userId={user.id} /> : null;
}

function AccountTestMode({ userId }: { userId: string }) {
  const [recovery] = useState(() => readTestRecovery(userId));
  const restored = recovery.results[0] ?? null;
  const active = restored ? null : recovery.sessions[0] ?? null;
  const [stage, setStage] = useState<'setup' | 'testing' | 'results'>(restored ? 'results' : active ? 'testing' : 'setup');
  const [direction, setDirection] = useState<TestDirection>(active?.direction ?? 'geo-to-en');
  const [wordCount, setWordCount] = useState(active?.wordCount ?? 10);
  const [customCount, setCustomCount] = useState(active?.customCount ?? '');
  const [inputType, setInputType] = useState<InputType>(active?.inputType ?? 'multiple');
  const [testWords, setTestWords] = useState<TestQuestion[]>(active?.questions ?? []);
  const [currentQuestion, setCurrentQuestion] = useState(active?.currentQuestion ?? 0);
  const [userAnswer, setUserAnswer] = useState(active?.draftAnswer ?? '');
  const [loading, setLoading] = useState(false);
  const [multipleChoiceOptions, setMultipleChoiceOptions] = useState<string[]>(active?.questions[active.currentQuestion].options ?? []);
  const [historySaveStatus, setHistorySaveStatus] = useState<HistorySaveStatus>(restored ? 'pending' : 'idle');
  const [storageWarning, setStorageWarning] = useState(recovery.warning);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const mounted = useRef(true);
  const starting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Ref guards take effect immediately, before React can render disabled buttons.
  const testSessionRef = useRef<TestSession | null>(restored
    ? { userId, active: null, result: restored, saveStatus: 'pending',
      hasPersistedCopy: recovery.pendingCopyIds.has(restored.id), hasActiveCopy: recovery.activeCopyIds.has(restored.id),
      hasCompletedCheckpoint: recovery.completedCopyIds.has(restored.id) }
    : active ? { userId, active, result: null, saveStatus: 'idle', hasPersistedCopy: false, hasActiveCopy: true, hasCompletedCheckpoint: false } : null);

  function saveActiveProgress(next: ActiveTestSession) {
    const session = testSessionRef.current;
    if (!session || session.result) return;
    session.active = next;
    const persisted = persistActiveTest(next);
    session.hasActiveCopy ||= persisted;
    setStorageWarning(persisted ? '' :
      'Current progress could not be stored in your browser. Navigation or refresh may lose the current session or recent answers. Keep this tab open.');
  }

  function changeAnswer(answer: string) {
    const session = testSessionRef.current;
    if (!session?.active || session.result || showRestartConfirm || answer === session.active.draftAnswer) return;
    setUserAnswer(answer);
    // Write only on actual input/progress changes, never from render or mount effects.
    saveActiveProgress({ ...session.active, draftAnswer: answer });
  }

  async function startTest() {
    if (testSessionRef.current || starting.current) return;

    starting.current = true;
    setLoading(true);
    try {
      const { data: allWords, error } = await supabase
        .from('words')
        .select('*')
        .eq('user_id', userId);

      if (!mounted.current) return;
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

      // Use the loaded vocabulary to freeze options, then retain only selected questions.
      const vocabulary: Word[] = allWords.map(word => ({
        ...word,
        georgian_definitions: [...word.georgian_definitions],
      }));
      const testData: TestQuestion[] = shuffle(vocabulary).slice(0, count).map(word => ({
        id: word.id, english_word: word.english_word,
        georgian_definitions: [...word.georgian_definitions], description: word.description,
        userAnswer: '',
        isCorrect: false,
        // Freeze options for all selected questions; recovery never needs the dictionary.
        options: inputType === 'multiple' ? generateMultipleChoiceOptions(word, vocabulary, direction) : [],
      }));

      const next: ActiveTestSession = {
        id: crypto.randomUUID(), userId, startedAt: new Date().toISOString(), direction, inputType,
        wordCount, customCount, questions: testData, currentQuestion: 0, draftAnswer: '',
      };
      testSessionRef.current = { userId, active: next, result: null, saveStatus: 'idle', hasPersistedCopy: false, hasActiveCopy: false, hasCompletedCheckpoint: false };
      // Persist even a zero-answer test before presenting its first question.
      saveActiveProgress(next);
      // Settings may have changed while the vocabulary request was in flight.
      setDirection(next.direction);
      setInputType(next.inputType);
      setWordCount(next.wordCount);
      setCustomCount(next.customCount);
      setHistorySaveStatus('idle');
      setTestWords(testData);
      setCurrentQuestion(0);
      setUserAnswer('');

      setMultipleChoiceOptions(testData[0].options);

      setStage('testing');
    } catch (err: any) {
      console.error('Error starting test:', err);
      alert('Error starting test: ' + err.message);
    } finally {
      starting.current = false;
      setLoading(false);
    }
  }

  function submitAnswer() {
    const session = testSessionRef.current;
    if (!session?.active || !testWords[currentQuestion] || session.result || showRestartConfirm ||
      session.active.currentQuestion !== currentQuestion) return;

    const currentWord = session.active.questions[currentQuestion];
    const answer = session.active.draftAnswer;

    // Update the current word with user answer and correctness
    const updatedWords = [...session.active.questions];
    updatedWords[currentQuestion] = {
      ...currentWord,
      userAnswer: answer,
      isCorrect: isCorrectAnswer(currentWord, answer, session.active.direction, session.active.inputType),
    };
    setTestWords(updatedWords);

    const isLastQuestion = currentQuestion >= testWords.length - 1;

    if (isLastQuestion) {
      finishTest(updatedWords);
    } else {
      const nextQuestion = currentQuestion + 1;
      setCurrentQuestion(nextQuestion);
      setUserAnswer('');

      setMultipleChoiceOptions(updatedWords[nextQuestion].options);
      saveActiveProgress({ ...session.active, questions: updatedWords, currentQuestion: nextQuestion, draftAnswer: '' });
    }
  }

  function finishTest(finalWords: TestQuestion[]) {
    const session = testSessionRef.current;
    if (!session || session.result) return;

    const mistakes: TestMistake[] = finalWords
      .filter(word => word.isCorrect === false)
      .map(word => ({
        english_word: word.english_word,
        user_answer: word.userAnswer,
        correct_definitions: direction === 'en-to-geo'
          ? [...word.georgian_definitions]
          : [word.english_word],
        question_prompt: direction === 'en-to-geo'
          ? word.english_word
          : word.georgian_definitions.join(', '),
        description: word.description || null,
      }));

    // Capture the completed payload once, including the final answer and date.
    // Retries use this same snapshot instead of rebuilding it from React state.
    session.result = {
      id: session.active!.id,
      user_id: session.userId,
      test_date: new Date().toISOString(),
      test_direction: direction,
      total_words: finalWords.length,
      correct_count: finalWords.filter(word => word.isCorrect === true).length,
      mistakes,
    };
    setStage('results');
    void saveTestResult();
  }

  async function saveTestResult() {
    const session = testSessionRef.current;
    if (!session?.result || session.saveStatus === 'saving' || session.saveStatus === 'saved' || showDiscardConfirm) return;

    session.saveStatus = 'saving';
    setHistorySaveStatus('saving');
    // Persist synchronously BEFORE issuing the request, including its stable ID.
    // A reload during an interrupted response must reuse the same payload and ID.
    const persisted = persistPendingTest(session.result);
    // A failed retry write does not mean an earlier recovery copy disappeared.
    session.hasPersistedCopy ||= persisted;
    if (!session.hasPersistedCopy && session.hasActiveCopy && checkpointCompletedTest(session.result)) {
      session.hasCompletedCheckpoint = true;
    }
    // Keep the last active snapshot until a completed snapshot can replace it.
    const recoverable = session.hasPersistedCopy || session.hasCompletedCheckpoint;
    const activeRemoved = session.hasPersistedCopy ? clearActiveCopy(session) : !session.hasActiveCopy;
    setStorageWarning(recoverable ? (activeRemoved || session.hasCompletedCheckpoint ? '' :
      'The completed result is recoverable, but its earlier session copy could not be removed. Recovery will show the completed result.') :
      'This result could not be stored in your browser. Keep this tab open: leaving or refreshing may lose it. Retry saving to History.');
    try {
      // Do not commit while storage can still resurrect an older active snapshot
      // without the exact completed timestamp/payload needed to confirm that commit.
      if (session.hasActiveCopy && !recoverable) {
        throw new Error('Could not preserve the completed result. Keep this tab open and retry when browser storage is available.');
      }
      if (userId !== session.userId) {
        throw new Error('Sign in to the account that took this test to save its result.');
      }

      const { error } = await supabase.from('test_history').insert(session.result);
      if (error) {
        if (error.code !== '23505') throw error;
        // A previous attempt may have committed before its response was lost.
        // Do not update/overwrite History, or treat any arbitrary conflict as success.
        const { data, error: lookupError } = await supabase.from('test_history')
          .select('id,user_id,test_date,test_direction,total_words,correct_count,mistakes')
          .eq('id', session.result.id).eq('user_id', session.userId);
        if (lookupError) throw lookupError;
        if (!Array.isArray(data) || data.length !== 1 || !matchesCompletedTest(data[0], session.result)) {
          throw new Error('Could not confirm the existing History record. Your pending result has been kept.');
        }
      }

      session.saveStatus = 'saved';
      setHistorySaveStatus('saved');
      // If cleanup fails, retain the completed record as a durable guard against
      // restoring an obsolete unfinished session on the next mount.
      const removed = clearActiveCopy(session) && (!session.hasPersistedCopy || removePendingTest(session.result));
      if (removed) session.hasPersistedCopy = false;
      setStorageWarning(removed ? '' :
        'Saved to History, but the browser copy could not be removed. It may appear again; retrying will not create another record.');
    } catch (error) {
      console.error('Error saving test result:', error);
      session.saveStatus = 'error';
      setHistorySaveStatus('error');
    }
  }

  function clearActiveCopy(session: TestSession): boolean {
    if (!session.hasActiveCopy) return true;
    const id = session.result?.id ?? session.active?.id;
    if (!id || !removeActiveTest(session.userId, id)) return false;
    session.hasActiveCopy = false;
    session.hasCompletedCheckpoint = false;
    return true;
  }

  function restartTest() {
    const session = testSessionRef.current;
    if (!showRestartConfirm || !session?.active || session.result) return;
    if (!clearActiveCopy(session)) {
      setStorageWarning('Could not remove the saved active session. Progress has been kept; cancel or try again when browser storage is available.');
      return;
    }
    startNextTest();
  }

  function resetTest() {
    const session = testSessionRef.current;
    if (session?.saveStatus === 'saving') return;
    if (session?.result && session.saveStatus !== 'saved') {
      setShowDiscardConfirm(true);
      return;
    }
    startNextTest();
  }

  function discardResult() {
    const session = testSessionRef.current;
    if (!showDiscardConfirm || !session?.result || session.saveStatus === 'saving') return;
    // A newly completed result whose every write failed exists only in memory.
    // Restored or successfully persisted results still require confirmed removal.
    if (!clearActiveCopy(session) || (session.hasPersistedCopy && !removePendingTest(session.result))) {
      setStorageWarning('Could not remove the pending browser copy. The result has been kept; cancel and retry saving, or try discarding again.');
      return;
    }
    startNextTest();
  }

  function startNextTest() {
    const finishedId = testSessionRef.current?.result?.id ?? testSessionRef.current?.active?.id;
    // Other tabs may have completed more tests. Recover them without overwriting.
    const pending = readTestRecovery(userId);
    const next = pending.results.find(result => result.id !== finishedId);
    const nextActive = next ? null : pending.sessions.find(session => session.id !== finishedId) ?? null;
    testSessionRef.current = next
      ? { userId, active: null, result: next, saveStatus: 'pending', hasPersistedCopy: pending.pendingCopyIds.has(next.id),
        hasActiveCopy: pending.activeCopyIds.has(next.id), hasCompletedCheckpoint: pending.completedCopyIds.has(next.id) }
      : nextActive ? { userId, active: nextActive, result: null, saveStatus: 'idle', hasPersistedCopy: false,
        hasActiveCopy: true, hasCompletedCheckpoint: false } : null;
    setStorageWarning(pending.warning);
    setHistorySaveStatus(next ? 'pending' : 'idle');
    setStage(next ? 'results' : nextActive ? 'testing' : 'setup');
    setShowDiscardConfirm(false);
    setShowRestartConfirm(false);
    setTestWords(nextActive?.questions ?? []);
    setCurrentQuestion(nextActive?.currentQuestion ?? 0);
    setUserAnswer(nextActive?.draftAnswer ?? '');
    setMultipleChoiceOptions(nextActive?.questions[nextActive.currentQuestion].options ?? []);
    if (nextActive) {
      setDirection(nextActive.direction);
      setInputType(nextActive.inputType);
      setWordCount(nextActive.wordCount);
      setCustomCount(nextActive.customCount);
    }
  }

  if (stage === 'setup') {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Test Mode</h2>
        {storageWarning && <p role="alert">{storageWarning}</p>}

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

        {storageWarning && <p role="alert">{storageWarning}</p>}
        <button onClick={() => setShowRestartConfirm(true)} disabled={showRestartConfirm}
          className="px-4 py-2 border rounded-lg">Restart Test</button>
        {showRestartConfirm && (
          <div role="alertdialog" aria-modal="true" aria-labelledby="restart-test-title"
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-md space-y-4">
              <h3 id="restart-test-title" className="font-bold">Abandon this unfinished test?</h3>
              <p>Your current questions, answers and progress will be lost. Confirm to return to test setup.</p>
              <button autoFocus onClick={() => setShowRestartConfirm(false)} className="px-4 py-2 border rounded">Cancel</button>
              <button onClick={restartTest} className="px-4 py-2 bg-red-600 text-white rounded">Discard progress</button>
            </div>
          </div>
        )}

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
                <div dangerouslySetInnerHTML={{ __html: sanitizeDescription(currentWord.description) }} />
              </div>
            )}
          </div>

          <div className="space-y-4">
            {inputType === 'text' ? (
              <input
                type="text"
                value={userAnswer}
                onChange={(e) => changeAnswer(e.target.value)}
                disabled={showRestartConfirm}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && userAnswer.trim()) {
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
                      onChange={(e) => changeAnswer(e.target.value)}
                      disabled={showRestartConfirm}
                      className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-lg">{option}</span>
                  </label>
                ))}
              </div>
            )}

            <button
              onClick={submitAnswer}
              disabled={!userAnswer.trim() || showRestartConfirm}
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
    const session = testSessionRef.current!;
    const result = session.result!;
    const correctCount = result.correct_count;
    const percentage = Math.round((correctCount / result.total_words) * 100);
    const isSaveError = historySaveStatus === 'error';
    const isSaved = historySaveStatus === 'saved';
    const isSaving = historySaveStatus === 'saving';
    const hasRecoveryCopy = session.hasPersistedCopy || session.hasCompletedCheckpoint;
    const StatusIcon = isSaveError ? AlertCircle : isSaved ? CheckCircle2 : isSaving ? Loader2 : Info;
    const statusColors = isSaveError
      ? 'border-red-300 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950 dark:text-red-100'
      : isSaved
        ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100'
        : isSaving
          ? 'border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100'
          : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100';

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">Test Results</h2>

        <div role={isSaveError ? 'alert' : 'status'} aria-live={isSaveError ? 'assertive' : 'polite'}
          aria-atomic="true" aria-labelledby="test-save-status"
          className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm sm:p-5 ${statusColors}`}>
          <StatusIcon size={24} aria-hidden="true" focusable="false"
            className={`mt-0.5 shrink-0 ${isSaving ? 'motion-safe:animate-spin' : ''}`} />
          <div className="min-w-0 flex-1 break-words">
            <p id="test-save-status" className="min-h-12 font-semibold leading-6">
              {historySaveStatus === 'pending' && 'Recovered a completed test. Saving to History has not been confirmed. Retry Save to check and save it.'}
              {isSaving && 'Saving result to History...'}
              {isSaved && 'Result saved to History successfully.'}
              {isSaveError && (hasRecoveryCopy
                ? 'Failed to save result to History. Your completed test has been preserved.'
                : 'Failed to save result to History. Your completed test is kept in this tab only.')}
            </p>
            {storageWarning && <p role={isSaveError ? undefined : 'alert'} className="mt-2 text-sm leading-6">{storageWarning}</p>}
            {/* Reserve the action row so retry/success transitions do not jump. */}
            <div className="mt-2 min-h-11">
              {(isSaveError || historySaveStatus === 'pending') && (
                <button
                  onClick={() => void saveTestResult()}
                  disabled={showDiscardConfirm}
                  className="min-h-11 w-full rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-300 dark:text-blue-950 dark:hover:bg-blue-200 dark:focus-visible:outline-blue-300 sm:w-auto"
                >
                  Retry Save
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="text-6xl font-bold text-gray-900 mb-2">
              {percentage}%
            </div>
            <div className="text-xl text-gray-600">
              {correctCount} out of {result.total_words} correct
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {result.test_direction === 'en-to-geo' ? 'English → Georgian' : 'Georgian → English'}
              {' · '}{new Date(result.test_date).toLocaleString()}
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <h3 className="font-bold text-lg text-gray-900">Review:</h3>
            {testWords.length === 0 && (
              <>
                <p>Recovered score and mistakes. Individual correct answers are not stored.</p>
                {result.mistakes.map((mistake, index) => (
                  <div key={index} className="p-4 rounded-lg border bg-red-50 border-red-200">
                    <div className="font-medium">{mistake.question_prompt ?? mistake.english_word}</div>
                    {mistake.description && <div dangerouslySetInnerHTML={{ __html: sanitizeDescription(mistake.description) }} />}
                    <div>Your answer: {mistake.user_answer || '(empty)'}</div>
                    <div>Correct: {mistake.correct_definitions.join(', ')}</div>
                  </div>
                ))}
              </>
            )}
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
            disabled={historySaveStatus === 'saving' || showDiscardConfirm}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors"
          >
            <RotateCcw size={20} />
            Take Another Test
          </button>
        </div>
        {showDiscardConfirm && (
          <div role="alertdialog" aria-modal="true" aria-labelledby="discard-test-title"
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 max-w-md space-y-4">
              <h3 id="discard-test-title" className="font-bold">Discard this completed test?</h3>
              <p>Saving to History has not been confirmed. Discarding removes this browser's recovery copy and you cannot retry it here. If an earlier request reached the server, its History record will remain.</p>
              <button autoFocus onClick={() => setShowDiscardConfirm(false)} className="px-4 py-2 border rounded">Cancel</button>
              <button onClick={discardResult} disabled={historySaveStatus === 'saving'} className="px-4 py-2 bg-red-600 text-white rounded">Discard result</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
