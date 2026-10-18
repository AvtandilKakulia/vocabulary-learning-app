import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase, Word } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { normalizeEnglishWord } from "../../lib/normalizeEnglishWord";
import { useLatestRequest } from "../../hooks/useLatestRequest";
import { readWordsPageSize, readWordsSort, type SortOption } from "../../lib/wordsPreferences";

export { pageSizeOptions, type SortOption } from "../../lib/wordsPreferences";

export interface WordFormData {
  englishWord: string;
  georgianDefs: string[];
  description: string;
  partOfSpeech: string;
  isIrregularVerb: boolean;
  pastSimple: string | null;
  pastParticiple: string | null;
}

function validateWordFormData(data: WordFormData): { englishWord: string; georgianDefs: string[] } {
  const englishWord = data.englishWord.trim();
  const georgianDefs = data.georgianDefs.map((definition) => definition.trim()).filter(Boolean);
  if (!englishWord) throw new Error("Please enter an English word.");
  if (georgianDefs.length === 0) throw new Error("Please enter at least one Georgian definition.");
  return { englishWord, georgianDefs };
}

async function verifyWordMutation(
  mutation: PromiseLike<{ error: unknown; count: number | null }>,
  expectedCount: number,
  action: "save" | "delete"
) {
  const failureMessage = `Unable to ${action} your words. Please try again.`;
  // Check the mutation response itself, not a pre-read that can become stale.
  const { error, count } = await Promise.resolve(mutation).catch(() => {
    throw new Error(failureMessage);
  });
  if (error) throw new Error(failureMessage);
  if (count === expectedCount) return;

  if (action === "save") {
    throw new Error(count === 0
      ? "This word could not be saved. It may have changed, been deleted, or become inaccessible since you opened it. Your changes are still in the editor. Copy them, then reload and reopen the latest word before trying again."
      : "The save result could not be confirmed. Copy your changes and reload before trying again.");
  }
  if (count === 0) {
    throw new Error("No words were deleted. They may no longer exist or be accessible. Review the refreshed list before selecting again.");
  }
  if (Number.isInteger(count) && count !== null && count > 0 && count < expectedCount) {
    throw new Error(`Only ${count} of ${expectedCount} selected words were deleted. Review the refreshed list before selecting again.`);
  }
  throw new Error("The deletion result could not be confirmed. Review the refreshed list before selecting again.");
}

export function useWords() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const readReadyRef = useRef(false);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(readWordsPageSize);
  const [totalCount, setTotalCount] = useState(0);
  const [sortOption, setSortOption] = useState<SortOption>(readWordsSort);
  const prevSearchTermRef = useRef(debouncedSearchTerm);
  const userId = user?.id;
  const beginRead = useLatestRequest(JSON.stringify([userId, debouncedSearchTerm, page, pageSize, sortOption]));

  useEffect(() => {
    setWords([]);
    setTotalCount(0);
  }, [userId]);

  const applySorting = useCallback(
    <T>(query: T) => {
      switch (sortOption) {
        case "alpha-desc":
          // @ts-expect-error Supabase query builder
          return query.order("english_word", { ascending: false });
        case "recent":
          // @ts-expect-error Supabase query builder
          return query.order("created_at", { ascending: false });
        case "alpha-asc":
        default:
          // @ts-expect-error Supabase query builder
          return query.order("english_word", { ascending: true });
      }
    },
    [sortOption]
  );

  const loadWordsForContext = useCallback(async () => {
    const isCurrent = beginRead();
    if (!isCurrent) return;
    readReadyRef.current = false;
    setReadError(null);
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const term = debouncedSearchTerm.trim();
    try {
      if (term) {
        const searchQuery = supabase.rpc("search_words", {
          p_user_id: userId,
          p_term: term,
          p_offset: page * pageSize,
          p_limit: pageSize,
          p_sort: sortOption,
        });

        const [searchResult, countResult] = await Promise.all([
          searchQuery,
          supabase.rpc("search_words_count", {
            p_user_id: userId,
            p_term: term,
          }),
        ]);

        if (!isCurrent()) return;
        if (searchResult.error) throw searchResult.error;
        if (countResult.error) throw countResult.error;

        setWords(searchResult.data || []);
        setTotalCount(
          typeof countResult.data === "number" ? countResult.data : 0
        );
        readReadyRef.current = true;
      } else {
        let query = supabase
          .from("words")
          .select("*", { count: "exact" })
          .eq("user_id", userId);

        query = applySorting(query).range(
          page * pageSize,
          (page + 1) * pageSize - 1
        );

        const { data, error, count } = await query;

        if (!isCurrent()) return;
        if (error) throw error;
        setWords(data || []);
        setTotalCount(count || 0);
        readReadyRef.current = true;
      }
    } catch (error: any) {
      if (!isCurrent()) return;
      console.error("Error loading words:", error);
      setReadError("Unable to load your words. Please try again.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [applySorting, beginRead, debouncedSearchTerm, page, pageSize, sortOption, userId]);

  // A save/delete can finish after sorting or paging changed. Refresh the latest
  // query for that owner instead of reusing the mutation handler's old closure.
  const latestRead = useRef({ userId, load: loadWordsForContext });
  useLayoutEffect(() => {
    latestRead.current = { userId, load: loadWordsForContext };
  }, [userId, loadWordsForContext]);
  const loadWords = useCallback(async () => {
    if (latestRead.current.userId === userId) await latestRead.current.load();
  }, [userId]);

  useEffect(() => {
    const searchChanged = debouncedSearchTerm !== prevSearchTermRef.current;

    if (searchChanged) {
      prevSearchTermRef.current = debouncedSearchTerm;

      if (page !== 0) {
        setPage(0);
        return;
      }
    }

    void loadWordsForContext();
  }, [page, pageSize, debouncedSearchTerm, loadWordsForContext]);

  const deleteWord = useCallback(
    async (id: string) => {
      if (!user) throw new Error("Please sign in before changing your words.");
      if (!readReadyRef.current) throw new Error("Reload your words before deleting.");

      await verifyWordMutation(supabase
        .from("words")
        .delete({ count: "exact" })
        .eq("id", id)
        .eq("user_id", user.id), 1, "delete");
    },
    [user]
  );

  const bulkDeleteWords = useCallback(
    async (ids: string[]) => {
      if (!user) throw new Error("Please sign in before changing your words.");
      if (ids.length === 0) return;
      if (!readReadyRef.current) throw new Error("Reload your words before deleting.");
      const uniqueIds = [...new Set(ids)];

      await verifyWordMutation(supabase
        .from("words")
        .delete({ count: "exact" })
        .in("id", uniqueIds)
        .eq("user_id", user.id), uniqueIds.length, "delete");
    },
    [user]
  );

  const checkExistingEnglishWords = useCallback(
    async (englishWord: string): Promise<Word[]> => {
      if (!user) return [];

      const { data: existingWords, error: checkError } = await supabase
        .from("words")
        .select("*")
        .eq("user_id", user.id)
        .eq("english_word_norm", normalizeEnglishWord(englishWord))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });

      if (checkError) throw checkError;
      return existingWords || [];
    },
    [user]
  );

  const addWord = useCallback(
    async (wordData: WordFormData): Promise<void> => {
      if (!user) throw new Error("Please sign in before changing your words.");

      const validated = validateWordFormData(wordData);
      const { error } = await supabase.from("words").insert({
        user_id: user.id,
        english_word: validated.englishWord,
        part_of_speech: wordData.partOfSpeech || "unspecified",
        is_irregular_verb: wordData.isIrregularVerb,
        past_simple: wordData.pastSimple,
        past_participle: wordData.pastParticiple,
        georgian_definitions: validated.georgianDefs,
        description: wordData.description || null,
      });

      if (error) throw error;
    },
    [user]
  );

  const updateWord = useCallback(
    async (wordId: string, wordData: WordFormData, expectedUpdatedAt: Word["updated_at"]) => {
      if (!user) throw new Error("Please sign in before changing your words.");

      const validated = validateWordFormData(wordData);
      if (typeof expectedUpdatedAt !== "string" || !expectedUpdatedAt.trim()) {
        throw new Error("The original word version is missing. Copy your changes, then reload and reopen the word before saving.");
      }
      // Keep the exact server string (including microseconds); Date/ISO conversion
      // loses precision. The DB must advance updated_at on EVERY update:
      // see the R3-A01 deployment prerequisite in supabase/README.md.
      await verifyWordMutation(supabase
        .from("words")
        .update({
          english_word: validated.englishWord,
          part_of_speech: wordData.partOfSpeech || "unspecified",
          is_irregular_verb: wordData.isIrregularVerb,
          past_simple: wordData.pastSimple,
          past_participle: wordData.pastParticiple,
          georgian_definitions: validated.georgianDefs,
          description: wordData.description || null,
        }, { count: "exact" })
        .eq("id", wordId)
        .eq("user_id", user.id)
        .eq("updated_at", expectedUpdatedAt), 1, "save");
    },
    [user]
  );

  return {
    words,
    loading,
    readError,
    searchTerm,
    setSearchTerm,
    debouncedSearchTerm,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalCount,
    sortOption,
    setSortOption,
    loadWords,
    deleteWord,
    bulkDeleteWords,
    checkExistingEnglishWords,
    addWord,
    updateWord,
  };
}
