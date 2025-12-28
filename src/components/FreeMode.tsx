import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Plus, Shuffle, X } from "lucide-react";
import { supabase, Word, TestMistake } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { sanitizeDescription } from "../lib/sanitizeDescription";

const STORAGE_KEY = "vocab_practice_session_state_v2";

type Direction = "en-to-geo" | "geo-to-en";
type OrderMode = "random" | "db-order";

type StoredSession = {
  userId: string;
  queueIds: string[];
  direction: Direction;
  orderMode: OrderMode;
  allowReguess: boolean;
  correctCount: number;
  totalAttempts: number;
  mistakes: TestMistake[];
};

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
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [loading, setLoading] = useState(true);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [mistakes, setMistakes] = useState<TestMistake[]>([]);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [sessionInitialized, setSessionInitialized] = useState(false);

  const uniqueWordCount = useMemo(
    () => new Set(words.map((word) => word.id)).size,
    [words]
  );

  const currentWord = useMemo(() => {
    if (wordQueue.length === 0) return undefined;
    return words.find((w) => w.id === wordQueue[0]);
  }, [wordQueue, words]);

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
          setWordQueue(parsed.queueIds ?? []);
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
  }, [orderMode, sessionInitialized, totalAttempts, wordQueue, words]);

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
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [
    allowReguess,
    correctCount,
    direction,
    mistakes,
    orderMode,
    totalAttempts,
    user,
    wordQueue,
    sessionInitialized,
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
    setShowResult(false);
    setAnswerInputs([""]);
  };

  const handleOrderChange = (newOrder: OrderMode) => {
    setOrderMode(newOrder);
    setShowResult(false);
    setAnswerInputs([""]);
    setCorrectCount(0);
    setTotalAttempts(0);
    setMistakes([]);
    setWordQueue([]);
    setWords([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleCheckAnswer = () => {
    if (!currentWord) return;
    const cleaned = answerInputs
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (cleaned.length === 0) return;

    const normalizedInputs = cleaned.map(normalize);
    let correct = false;

    if (direction === "en-to-geo") {
      const normalizedDefs = currentWord.georgian_definitions.map(normalize);
      if (normalizedInputs.length === 1) {
        correct = normalizedDefs.includes(normalizedInputs[0]);
      } else {
        correct = normalizedInputs.every((input) =>
          normalizedDefs.includes(input)
        );
      }
    } else {
      const target = normalize(currentWord.english_word);
      correct = normalizedInputs.every((input) => input === target);
    }

    setIsCorrect(correct);
    setShowResult(true);
    setTotalAttempts((prev) => prev + 1);
    if (correct) {
      setCorrectCount((prev) => prev + 1);
    } else {
      setMistakes((prev) => [
        ...prev,
        {
          english_word: currentWord.english_word,
          user_answer: cleaned.join(", "),
          correct_definitions:
            direction === "en-to-geo"
              ? currentWord.georgian_definitions
              : [currentWord.english_word],
        },
      ]);
    }
  };

  const proceedToNextWord = () => {
    if (!currentWord) return;
    setShowResult(false);
    setAnswerInputs([""]);

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
    setAnswerInputs([""]);
    setShowResult(false);
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
        mistakes,
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
  };

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
                    <svg
                      className="w-full h-full transform -rotate-90"
                      viewBox="0 0 36 36"
                    >
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
                        strokeWidth="3"
                        strokeDasharray={`${successRate}, 100`}
                        className="text-blue-600 dark:text-blue-400"
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

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 dark:border-gray-700/20 p-6 transition-all duration-300">
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
              Translation Direction
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleDirectionChange("en-to-geo")}
                className={`px-4 py-3 rounded-xl font-medium transition-all duration-200 transform hover:scale-105 ${
                  direction === "en-to-geo"
                    ? "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg"
                    : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                }`}
              >
                English → Georgian
              </button>
              <button
                onClick={() => handleDirectionChange("geo-to-en")}
                className={`px-4 py-3 rounded-xl font-medium transition-all duration-200 transform hover:scale-105 ${
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
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition ${
                      orderMode === "random"
                        ? "bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    <Shuffle size={16} /> Random
                  </button>
                  <button
                    onClick={() => handleOrderChange("db-order")}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition ${
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

            <div
              className={`absolute right-6 top-6 max-w-sm transition-all duration-300 ${
                showResult
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 -translate-y-2 pointer-events-none"
              }`}
            >
              <div
                className={`p-5 rounded-2xl border-2 shadow-lg backdrop-blur-sm ${
                  isCorrect
                    ? "bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800 shadow-green-500/10"
                    : "bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-900/20 dark:to-pink-900/20 border-red-200 dark:border-red-800 shadow-red-500/10"
                }`}
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`p-2 rounded-full ${
                      isCorrect ? "bg-green-500" : "bg-red-500"
                    }`}
                  >
                    {isCorrect ? (
                      <Check className="text-white" size={24} />
                    ) : (
                      <X className="text-white" size={24} />
                    )}
                  </div>
                  <span
                    className={`text-xl font-bold ${
                      isCorrect
                        ? "text-green-800 dark:text-green-200"
                        : "text-red-800 dark:text-red-200"
                    }`}
                  >
                    {isCorrect ? "Great job!" : "Not quite right"}
                  </span>
                </div>
                <div
                  className={`${
                    isCorrect
                      ? "text-green-700 dark:text-green-300"
                      : "text-red-700 dark:text-red-300"
                  } text-base`}
                >
                  <span className="font-semibold">
                    Correct answer
                    {direction === "en-to-geo" &&
                    currentWord.georgian_definitions.length > 1
                      ? "s"
                      : ""}
                    :
                  </span>{" "}
                  {direction === "en-to-geo"
                    ? currentWord.georgian_definitions.join(", ")
                    : currentWord.english_word}
                </div>
              </div>
            </div>

            <div className="text-center mb-6">
              <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent mb-2 leading-tight">
                {direction === "en-to-geo"
                  ? currentWord.english_word
                  : currentWord.georgian_definitions.join(", ")}
              </div>
              {currentWord.part_of_speech &&
                currentWord.part_of_speech !== "unspecified" && (
                  <div className="text-md text-gray-500 dark:text-gray-400 mb-2">
                    ({currentWord.part_of_speech})
                  </div>
                )}
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
              {answerInputs.map((value, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => {
                      const newInputs = [...answerInputs];
                      newInputs[idx] = e.target.value;
                      setAnswerInputs(newInputs);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !showResult) {
                        handleCheckAnswer();
                      } else if (e.key === "Enter" && showResult) {
                        proceedToNextWord();
                      }
                    }}
                    disabled={showResult}
                    placeholder="Type your answer..."
                    className="flex-1 px-6 py-4 text-lg border-2 border-gray-200 dark:border-gray-600 rounded-2xl bg-white/50 dark:bg-gray-700/50 backdrop-blur-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all duration-200 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 caret-blue-600 dark:caret-blue-400"
                  />
                  {idx === answerInputs.length - 1 && (
                    <button
                      onClick={addInput}
                      className="p-3 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 shadow-lg hover:shadow-xl disabled:opacity-50"
                      disabled={showResult}
                      aria-label="Add another answer"
                    >
                      <Plus size={18} />
                    </button>
                  )}
                </div>
              ))}

              <div className="flex flex-col md:flex-row gap-3 pt-4">
                {!showResult ? (
                  <button
                    onClick={handleCheckAnswer}
                    disabled={answerInputs.every((a) => !a.trim())}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-3 rounded-2xl font-bold text-base hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
                  >
                    Check Answer
                  </button>
                ) : (
                  <button
                    onClick={proceedToNextWord}
                    className={`flex-1 px-6 py-3 rounded-2xl font-bold text-base transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl flex items-center justify-center gap-3 ${
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
                    onClick={() => setShowFinishModal(true)}
                    className="px-4 py-3 rounded-2xl font-semibold border-2 border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-white/70 dark:bg-gray-800/70 hover:border-blue-400 dark:hover:border-blue-500 transition-all duration-200"
                  >
                    Finish
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

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
                className="flex-1 px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-2xl text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-2xl font-semibold hover:from-orange-600 hover:to-red-600 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
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
                className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-bold hover:from-blue-700 hover:to-purple-700 transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl"
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
