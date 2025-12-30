import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronRight, Plus, Shuffle, X } from "lucide-react";
import { supabase, Word, TestMistake } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { sanitizeDescription } from "../lib/sanitizeDescription";

const STORAGE_KEY = "vocab_practice_session_state_v2";

type Direction = "en-to-geo" | "geo-to-en";
type OrderMode = "random" | "db-order";
type InputStatus = "idle" | "correct" | "incorrect";

type StoredSession = {
  userId: string;
  queueIds: string[];
  direction: Direction;
  orderMode: OrderMode;
  allowReguess: boolean;
  correctCount: number;
  totalAttempts: number;
  mistakes: MistakeWithId[];
  attemptedWordIds?: string[];
  hasChecked?: boolean;
};

type MistakeWithId = TestMistake & { word_id?: string };

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export default function FreeMode() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [wordQueue, setWordQueue] = useState<string[]>([]);
  const [direction, setDirection] = useState<Direction>("en-to-geo");
  const [orderMode, setOrderMode] = useState<OrderMode>("random");
  const [allowReguess, setAllowReguess] = useState(false);
  const [answerInputs, setAnswerInputs] = useState<string[]>([""]);
  const [inputStatuses, setInputStatuses] = useState<InputStatus[]>(["idle"]);
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [mistakes, setMistakes] = useState<MistakeWithId[]>([]);
  const [attemptedWordIds, setAttemptedWordIds] = useState<string[]>([]);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const previousAllowReguess = useRef(allowReguess);
  const restoredHasCheckedRef = useRef(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const shouldFocusInput = useRef(false);

  const uniqueWordCount = useMemo(
    () => new Set(words.map((word) => word.id)).size,
    [words]
  );

  const currentWord = useMemo(() => {
    if (wordQueue.length === 0) return undefined;
    return words.find((w) => w.id === wordQueue[0]);
  }, [wordQueue, words]);

  const isIrregularActive = useMemo(
    () =>
      Boolean(
        currentWord?.is_irregular_verb &&
          currentWord?.past_simple &&
          currentWord?.past_participle
      ),
    [currentWord]
  );

  const successRate =
    totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0;

  const getEmojiForRate = (rate: number) => {
    if (rate >= 90) return "🎉";
    if (rate >= 80) return "😄";
    if (rate >= 70) return "😊";
    if (rate >= 60) return "🙂";
    if (rate >= 50) return "😐";
    if (rate >= 40) return "😕";
    if (rate >= 30) return "😞";
    return "💔";
  };

  const getProgressColor = (rate: number) => {
    if (rate >= 85) return "text-green-500 dark:text-green-400";
    if (rate >= 60) return "text-blue-500 dark:text-blue-400";
    if (rate >= 40) return "text-amber-500 dark:text-amber-400";
    return "text-orange-500 dark:text-orange-400";
  };

  const progressDasharray = useMemo(() => {
    const radius = 15.9155;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.max(0, Math.min(successRate, 100));
    const filled = (progress / 100) * circumference;
    return `${filled} ${circumference}`;
  }, [successRate]);

  const progressColorClass = useMemo(
    () => getProgressColor(successRate),
    [successRate]
  );

  const loadWords = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      let query = supabase.from("words").select("*").eq("user_id", user.id);
      if (orderMode === "db-order") {
        query = query.order("created_at", { ascending: true });
      }
      const { data, error } = await query;
      if (error) throw error;
      const fetched = data || [];
      setWords(orderMode === "random" ? shuffleArray(fetched) : fetched);
    } catch (error) {
      console.error("Error loading words:", error);
    } finally {
      setLoading(false);
    }
  }, [orderMode, user]);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  useEffect(() => {
    if (!user) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed: StoredSession = JSON.parse(saved);
        if (parsed.userId === user.id) {
          setDirection(parsed.direction ?? "en-to-geo");
          setOrderMode(parsed.orderMode ?? "random");
          setAllowReguess(parsed.allowReguess ?? false);
          setCorrectCount(parsed.correctCount ?? 0);
          setTotalAttempts(parsed.totalAttempts ?? 0);
          setMistakes(parsed.mistakes ?? []);
          const restoredQueue = parsed.queueIds ?? [];
          setAttemptedWordIds(parsed.attemptedWordIds ?? []);

          const savedHasChecked = parsed.hasChecked ?? false;
          if (savedHasChecked && restoredQueue.length > 0) {
            setWordQueue(restoredQueue.slice(1));
            setHasChecked(false);
            restoredHasCheckedRef.current = false;
          } else {
            setWordQueue(restoredQueue);
            setHasChecked(savedHasChecked);
            restoredHasCheckedRef.current = false;
          }
        }
      } catch (err) {
        console.error("Error loading saved session", err);
      }
    }
    setSessionInitialized(true);
  }, [user]);

  useEffect(() => {
    if (!sessionInitialized || !user || !words.length) return;

    const validIds = words.map((w) => w.id);
    let queueIds = wordQueue.filter((id) => validIds.includes(id));

    const newWordIds = validIds.filter(
      (id) => !queueIds.includes(id) && !attemptedWordIds.includes(id)
    );

    if (newWordIds.length > 0) {
      const orderedNewIds =
        orderMode === "db-order"
          ? words.filter((w) => newWordIds.includes(w.id)).map((w) => w.id)
          : shuffleArray(newWordIds);
      queueIds = [...queueIds, ...orderedNewIds];
    }

    if (queueIds.length === 0) {
      if (totalAttempts > 0) return;
      queueIds = orderMode === "random" ? shuffleArray(validIds) : validIds;
      setCorrectCount(0);
      setTotalAttempts(0);
      setMistakes([]);
    }
    if (JSON.stringify(queueIds) !== JSON.stringify(wordQueue)) {
      setWordQueue(queueIds);
    }
  }, [
    orderMode,
    sessionInitialized,
    totalAttempts,
    wordQueue,
    words,
    attemptedWordIds,
    user,
  ]);

  useEffect(() => {
    if (!sessionInitialized || !user) return;
    const state: StoredSession = {
      userId: user.id,
      queueIds: wordQueue,
      direction,
      orderMode,
      allowReguess,
      correctCount,
      totalAttempts,
      mistakes,
      attemptedWordIds,
      hasChecked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [
    allowReguess,
    correctCount,
    direction,
    attemptedWordIds,
    mistakes,
    orderMode,
    totalAttempts,
    user,
    wordQueue,
    sessionInitialized,
    hasChecked,
  ]);

  useEffect(() => {
    if (!sessionInitialized || loading) return;
    if (wordQueue.length === 0 && words.length > 0 && totalAttempts > 0) {
      setShowFinishModal(true);
    }
  }, [
    loading,
    sessionInitialized,
    totalAttempts,
    wordQueue.length,
    words.length,
  ]);

  const handleDirectionChange = (newDirection: Direction) => {
    setDirection(newDirection);
    setAnswerInputs([""]);
    setInputStatuses(["idle"]);
    setHasChecked(false);
  };

  const handleOrderChange = (newOrder: OrderMode) => {
    setOrderMode(newOrder);
    setAnswerInputs([""]);
    setInputStatuses(["idle"]);
    setHasChecked(false);
    setCorrectCount(0);
    setTotalAttempts(0);
    setMistakes([]);
    setWordQueue([]);
    setWords([]);
    setAttemptedWordIds([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleCheckAnswer = () => {
    if (!currentWord) return;
    const trimmedInputs = answerInputs.map((a) => a.trim());
    if (trimmedInputs.every((a) => a.length === 0)) return;

    let statuses: InputStatus[] = trimmedInputs.map(() => "incorrect");
    let correct = false;

    if (isIrregularActive && direction === "geo-to-en") {
      const targetForms = [
        currentWord.english_word,
        currentWord.past_simple,
        currentWord.past_participle,
      ];
      statuses = trimmedInputs.map((input, index) => {
        if (!input) return "incorrect";
        return normalize(input) === normalize(targetForms[index] || "")
          ? "correct"
          : "incorrect";
      });
      correct = statuses.every((status) => status === "correct");
    } else if (direction === "en-to-geo") {
      const normalizedDefs = currentWord.georgian_definitions.map(normalize);
      statuses = trimmedInputs.map((input) => {
        if (!input) return "incorrect";
        return normalizedDefs.includes(normalize(input))
          ? "correct"
          : "incorrect";
      });
      correct = statuses.every((status) => status === "correct");
    } else {
      const target = normalize(currentWord.english_word);
      statuses = trimmedInputs.map((input) => {
        if (!input) return "incorrect";
        return normalize(input) === target ? "correct" : "incorrect";
      });
      correct = statuses.every((status) => status === "correct");
    }

    setInputStatuses(statuses);
    setHasChecked(true);
    setIsCorrect(correct);
    setTotalAttempts((prev) => prev + 1);
    setAttemptedWordIds((prev) =>
      prev.includes(currentWord.id) ? prev : [...prev, currentWord.id]
    );
    if (correct) {
      setCorrectCount((prev) => prev + 1);
    } else {
      setMistakes((prev) => [
        ...prev,
        {
          word_id: currentWord.id,
          english_word: currentWord.english_word,
          user_answer: trimmedInputs.filter((a) => a.length > 0).join(", "),
          correct_definitions:
            direction === "en-to-geo"
              ? currentWord.georgian_definitions
              : [currentWord.english_word],
        },
      ]);
    }

    setTimeout(() => {
      inputRefs.current.forEach((ref) => ref?.blur());
      nextButtonRef.current?.focus();
    }, 0);
  };

  const proceedToNextWord = () => {
    if (!currentWord) return;
    setHasChecked(false);
    setInputStatuses(["idle"]);
    setAnswerInputs([""]);
    shouldFocusInput.current = true;

    let updatedQueue = wordQueue.slice(1);
    if (!isCorrect && allowReguess) {
      updatedQueue = [...updatedQueue, currentWord.id];
    }
    setWordQueue(updatedQueue);
  };

  const handleReset = () => {
    setCorrectCount(0);
    setTotalAttempts(0);
    setMistakes([]);
    setAttemptedWordIds([]);
    setAnswerInputs([""]);
    setInputStatuses(["idle"]);
    setHasChecked(false);
    if (words.length > 0) {
      const orderedIds =
        orderMode === "random"
          ? shuffleArray(words.map((w) => w.id))
          : words.map((w) => w.id);
      setWordQueue(orderedIds);
    } else {
      setWordQueue([]);
    }
    localStorage.removeItem(STORAGE_KEY);
    setShowResetModal(false);
  };

  const handleFinishClose = async () => {
    if (!user) return;
    const testDate = new Date();

    try {
      await supabase.from("test_history").insert({
        user_id: user.id,
        test_date: testDate.toISOString(),
        test_direction: direction,
        total_words: totalAttempts,
        correct_count: correctCount,
        mistakes: mistakes.map(({ word_id, ...rest }) => rest),
      });
    } catch (error) {
      console.error("Error saving history:", error);
    }

    localStorage.removeItem(STORAGE_KEY);
    setShowFinishModal(false);
    handleReset();
  };

  const addInput = () => {
    setAnswerInputs((prev) => [...prev, ""]);
    setInputStatuses((prev) => [...prev, "idle"]);
    setHasChecked(false);
  };

  const removeInput = (index: number) => {
    if (answerInputs.length === 1) return;
    setAnswerInputs((prev) => prev.filter((_, idx) => idx !== index));
    setInputStatuses((prev) => prev.filter((_, idx) => idx !== index));
    setHasChecked(false);
  };

  const handleFinishRequest = () => {
    if (totalAttempts === 0) return;
    setShowFinishConfirm(true);
  };

  const handleConfirmFinish = () => {
    if (totalAttempts === 0) return;
    setShowFinishConfirm(false);
    setShowFinishModal(true);
  };

  useEffect(() => {
    if (!currentWord || !sessionInitialized) {
      setAnswerInputs([""]);
      setInputStatuses(["idle"]);
      setHasChecked(false);
      return;
    }

    const shouldUseThreeInputs = direction === "geo-to-en" && isIrregularActive;
    const inputCount = shouldUseThreeInputs ? 3 : 1;

    setAnswerInputs(Array(inputCount).fill(""));
    setInputStatuses(Array(inputCount).fill("idle"));
    setHasChecked(false);
  }, [currentWord?.id, direction, isIrregularActive]);

  useEffect(() => {
    if (!shouldFocusInput.current) return;

    const firstInput = inputRefs.current[0];
    if (firstInput) {
      firstInput.focus();
      shouldFocusInput.current = false;
    }
  }, [answerInputs]);

  useEffect(() => {
    if (!previousAllowReguess.current && allowReguess) {
      const mistakeIds = Array.from(
        new Set(
          mistakes
            .map((mistake) => mistake.word_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      if (mistakeIds.length) {
        setWordQueue((prev) => {
          const existing = new Set(prev);
          const toAdd = mistakeIds.filter((id) => !existing.has(id));
          return toAdd.length ? [...prev, ...toAdd] : prev;
        });
      }
    }
    previousAllowReguess.current = allowReguess;
  }, [allowReguess, mistakes]);

  const formattedDate = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mb-4" />
          <div className="text-xl font-semibold text-gray-700 dark:text-gray-300">
            Loading your words...
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Preparing your practice session
          </div>
        </div>
      </div>
    );
  }

  if (!currentWord && !showFinishModal) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="mb-8">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500 to-purple-500 rounded-full flex items-center justify-center mb-6">
              <svg
                className="w-12 h-12 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            </div>
            <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
              Ready to Start Learning?
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
              No words available yet. Add some words to your vocabulary
              collection to start practicing!
            </p>
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-2xl p-6 border border-blue-200 dark:border-blue-800">
              <div className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-semibold">Pro tip:</span> Add words with
                different definitions and contexts to make your practice
                sessions more engaging and effective.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-purple-900/20 transition-all duration-500">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-4">
            Vocabulary Practice
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Master new words with interactive practice sessions
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Translation Direction
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleDirectionChange("en-to-geo")}
                className={`px-4 py-3 rounded-xl font-medium transition-all duration-200 transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
                  direction === "en-to-geo"
                    ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                English → Georgian
              </button>
              <button
                onClick={() => handleDirectionChange("geo-to-en")}
                className={`px-4 py-3 rounded-xl font-medium transition-all duration-200 transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
                  direction === "geo-to-en"
                    ? "bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                Georgian → English
              </button>
            </div>
          </div>

          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Word Order
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleOrderChange("random")}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
                      orderMode === "random"
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <Shuffle size={16} /> Random
                  </button>
                  <button
                    onClick={() => handleOrderChange("db-order")}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
                      orderMode === "db-order"
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    In database order
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Allow re-guessing wrong answers
                </span>
                <button
                  onClick={() => setAllowReguess((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    allowReguess
                      ? "bg-gradient-to-r from-orange-500 to-red-500"
                      : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      allowReguess ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <div className="flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-4 mb-2">
                  <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                    {totalAttempts}
                  </div>
                  <div className="text-2xl text-gray-400">/</div>
                  <div className="text-3xl font-bold text-gray-600 dark:text-gray-400">
                    {correctCount}
                  </div>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Total words in dictionary:{" "}
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {uniqueWordCount}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-20 h-20">
                    <svg className="w-full h-full" viewBox="0 0 36 36">
                      <path
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        className="text-gray-200 dark:text-gray-700"
                      />
                      <path
                        d="M18 2.0845
                          a 15.9155 15.9155 0 0 1 0 31.831
                          a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={progressDasharray}
                        strokeDashoffset={
                          progressDasharray ? (2 * Math.PI * 15.9155) / 4 : 0
                        }
                        className={progressColorClass}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        {successRate}%
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowResetModal(true)}
                  className="px-4 py-2 text-sm bg-gradient-to-r from-red-500 to-pink-500 text-white rounded-xl hover:from-red-600 hover:to-pink-600 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105"
                >
                  Reset Progress
                </button>
              </div>
            </div>
          </div>
        </div>

        {currentWord && (
          <div className="relative bg-white/90 dark:bg-gray-800/80 backdrop-blur-lg rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-600 dark:text-blue-400">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                Practice Session
              </div>
              {wordQueue.length === 1 && (
                <span className="text-xs px-3 py-1 rounded-full bg-gradient-to-r from-yellow-100 to-orange-100 dark:from-yellow-900/20 dark:to-orange-900/20 text-yellow-800 dark:text-yellow-200 font-bold animate-pulse">
                  Final Word!
                </span>
              )}
            </div>

            <div className="text-center mb-6">
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent mb-2 leading-relaxed md:leading-[1.4] py-1">
                {direction === "en-to-geo"
                  ? currentWord.english_word
                  : currentWord.georgian_definitions.join(", ")}
              </div>
              {(() => {
                const partLabel = currentWord.is_irregular_verb
                  ? "verb - irregular"
                  : currentWord.part_of_speech;
                return partLabel && partLabel !== "unspecified" ? (
                  <div className="text-md text-gray-500 dark:text-gray-400 mb-2">
                    ({partLabel})
                  </div>
                ) : null;
              })()}
              {currentWord.description && (
                <div
                  className="text-base text-gray-500 dark:text-gray-400 italic max-w-2xl mx-auto whitespace-pre-wrap break-words max-h-40 md:max-h-48 overflow-y-auto modal-scrollbar"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeDescription(currentWord.description),
                  }}
                />
              )}
            </div>

            <div className="max-w-xl mx-auto space-y-4">
              {answerInputs.map((value, idx) => {
                const status = hasChecked
                  ? inputStatuses[idx] || "incorrect"
                  : "idle";
                const statusClasses =
                  status === "correct"
                    ? "border-green-500 focus:border-green-500 focus:ring-green-500/20 bg-green-50/60 dark:bg-green-900/10"
                    : status === "incorrect" && hasChecked
                    ? "border-red-500 focus:border-red-500 focus:ring-red-500/20 bg-red-50/60 dark:bg-red-900/10"
                    : "border-gray-200 dark:border-gray-600";

                return (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      ref={(el) => (inputRefs.current[idx] = el)}
                      type="text"
                      value={value}
                      onChange={(e) => {
                        const newInputs = [...answerInputs];
                        newInputs[idx] = e.target.value;
                        setAnswerInputs(newInputs);
                        setHasChecked(false);
                        setInputStatuses((prev) => {
                          const updated = [...prev];
                          updated[idx] = "idle";
                          return updated;
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();

                          if (!hasChecked) {
                            handleCheckAnswer();
                          } else {
                            proceedToNextWord();
                          }
                        }
                      }}
                      placeholder={
                        isIrregularActive
                          ? `Form ${idx + 1}`
                          : "Type your answer..."
                      }
                      className={`flex-1 px-6 py-4 text-lg border-2 rounded-2xl bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm focus:ring-4 transition-all duration-200 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 caret-blue-600 dark:caret-blue-400 ${statusClasses}`}
                    />
                    {direction === "en-to-geo" &&
                      (idx === answerInputs.length - 1 ? (
                        <button
                          onClick={addInput}
                          className="p-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 shadow-lg hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                          aria-label="Add another answer"
                        >
                          <Plus size={18} />
                        </button>
                      ) : (
                        <button
                          onClick={() => removeInput(idx)}
                          className="p-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 shadow disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                          aria-label="Remove answer"
                          disabled={hasChecked}
                        >
                          <X size={18} />
                        </button>
                      ))}
                  </div>
                );
              })}

              <div className="flex flex-col md:flex-row gap-3 pt-4">
                {!hasChecked ? (
                  <button
                    onClick={handleCheckAnswer}
                    disabled={answerInputs.every((a) => !a.trim())}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-2xl font-bold text-base hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                  >
                    Check Answer
                  </button>
                ) : (
                  <button
                    ref={nextButtonRef}
                    onClick={proceedToNextWord}
                    className={`flex-1 px-6 py-3 rounded-2xl font-bold text-base transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
                      wordQueue.length <= 1
                        ? "bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700"
                        : "bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
                    }`}
                  >
                    {wordQueue.length <= 1 ? "Finish Practice" : "Next Word"}
                    {wordQueue.length <= 1 ? (
                      <Check size={20} />
                    ) : (
                      <ChevronRight size={20} />
                    )}
                  </button>
                )}

                {wordQueue.length > 1 && (
                  <button
                    onClick={handleFinishRequest}
                    disabled={totalAttempts === 0}
                    className="px-4 py-3 rounded-2xl font-semibold border-2 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-white/70 dark:bg-gray-800/70 hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {showFinishConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg
                  className="text-white"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <path d="M9 12l2 2 4-4"></path>
                </svg>
              </div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                Finish Practice
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Are you sure you want to finish this practice session?
              </p>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 mb-8 text-center">
              <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                {correctCount}/{totalAttempts} correct ({successRate}%)
              </div>
              <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Progress will be saved to your history.
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowFinishConfirm(false)}
                className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmFinish}
                disabled={totalAttempts === 0}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-semibold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
              >
                Finish
              </button>
            </div>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-md transition-all duration-300">
            <div className="text-center mb-6">
              <div className="w-20 h-20 mx-auto bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <svg
                  className="text-white"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </div>
              <h3 className="text-2xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent mb-2">
                Reset Progress
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                This will clear all your current session statistics and start
                fresh
              </p>
            </div>

            <div className="bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 border border-orange-200 dark:border-orange-800 rounded-2xl p-6 mb-8">
              <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                Current Progress:
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {correctCount}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">
                    Correct
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {totalAttempts}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">
                    Total Attempts
                  </div>
                </div>
              </div>
              <div className="text-center mt-4 pt-4 border-t border-orange-200 dark:border-orange-700">
                <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {successRate}%
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Success Rate
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl font-semibold hover:from-orange-600 hover:to-red-600 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-orange-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
              >
                Reset Progress
              </button>
            </div>
          </div>
        </div>
      )}

      {showFinishModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[80]">
          <div className="bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/20 dark:border-gray-700/20 p-8 w-full max-w-lg transition-all duration-300">
            <div className="flex justify-between items-start mb-6">
              <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Practice Summary
              </h3>
            </div>

            <div className="text-center mb-6">
              <div className="text-5xl mb-2">
                {getEmojiForRate(successRate)}
              </div>
              <div className="text-xl font-semibold text-gray-800 dark:text-gray-200">
                {correctCount}/{totalAttempts} correct ({successRate}%)
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {formattedDate()}
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 via-purple-50 to-slate-50 dark:from-blue-900/20 dark:via-purple-900/20 dark:to-slate-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6 mb-6 text-center">
              <div className="text-lg text-gray-700 dark:text-gray-300">
                {successRate >= 80 && "Fantastic performance! Keep it up!"}
                {successRate >= 60 &&
                  successRate < 80 &&
                  "Great work! A little more practice and you will nail it."}
                {successRate >= 40 &&
                  successRate < 60 &&
                  "Nice effort! Review the tricky ones and try again."}
                {successRate < 40 &&
                  "Every attempt counts. Keep practicing and you will improve!"}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleFinishClose}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-bold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-purple-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900"
              >
                Close & Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
