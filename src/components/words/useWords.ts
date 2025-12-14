import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, Word } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { normalizeEnglishWord } from "../../lib/normalizeEnglishWord";

const isUniqueConstraintError = (error: any) => {
  if (!error) return false;
  return (
    error.code === "23505" ||
    (typeof error.message === "string" &&
      error.message.includes("words_user_word_unique"))
  );
};

export interface WordFormData {
  englishWord: string;
  georgianDefs: string[];
  description: string;
}

export interface AddWordResult {
  duplicateWord?: Word | null;
}

export const pageSizeOptions = [10, 25, 50, 100];

export function useWords() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const prevSearchTermRef = useRef(debouncedSearchTerm);

  const loadWords = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    const term = debouncedSearchTerm.trim();
    try {
      if (term) {
        const [searchResult, countResult] = await Promise.all([
          supabase.rpc("search_words", {
            p_user_id: user.id,
            p_term: term,
            p_offset: page * pageSize,
            p_limit: pageSize,
          }),
          supabase.rpc("search_words_count", {
            p_user_id: user.id,
            p_term: term,
          }),
        ]);

        if (searchResult.error) throw searchResult.error;
        if (countResult.error) throw countResult.error;

        setWords(searchResult.data || []);
        setTotalCount(
          typeof countResult.data === "number" ? countResult.data : 0
        );
      } else {
        let query = supabase
          .from("words")
          .select("*", { count: "exact" })
          .eq("user_id", user.id)
          .order("english_word", { ascending: true })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        const { data, error, count } = await query;

        if (error) throw error;
        setWords(data || []);
        setTotalCount(count || 0);
      }
    } catch (error: any) {
      console.error("Error loading words:", error);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchTerm, page, pageSize, user]);

  useEffect(() => {
    const searchChanged = debouncedSearchTerm !== prevSearchTermRef.current;

    if (searchChanged) {
      prevSearchTermRef.current = debouncedSearchTerm;

      if (page !== 0) {
        setPage(0);
        return;
      }
    }

    loadWords();
  }, [page, pageSize, debouncedSearchTerm, loadWords]);

  const deleteWord = useCallback(
    async (id: string) => {
      if (!user) return;

      const { error } = await supabase
        .from("words")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);

      if (error) throw error;
    },
    [user]
  );

  const bulkDeleteWords = useCallback(
    async (ids: string[]) => {
      if (!user || ids.length === 0) return;

      const { error } = await supabase
        .from("words")
        .delete()
        .in("id", ids)
        .eq("user_id", user.id);

      if (error) throw error;
    },
    [user]
  );

  const checkExistingEnglishWord = useCallback(
    async (englishWord: string) => {
      if (!user) return null;

      const { data: existingWords, error: checkError } = await supabase
        .from("words")
        .select("*")
        .eq("user_id", user.id)
        .ilike("english_word", englishWord.trim());

      if (checkError) throw checkError;
      return existingWords && existingWords.length > 0
        ? existingWords[0]
        : null;
    },
    [user]
  );

  const findExistingByNormalized = useCallback(
    async (englishWord: string) => {
      if (!user) return null;

      const normalized = normalizeEnglishWord(englishWord);
      const { data: existingWord } = await supabase
        .from("words")
        .select("*")
        .eq("user_id", user.id)
        .eq("english_word_norm", normalized)
        .maybeSingle();

      return existingWord || null;
    },
    [user]
  );

  const addWord = useCallback(
    async (wordData: WordFormData): Promise<AddWordResult> => {
      if (!user) return {};

      try {
        const { error } = await supabase.from("words").insert({
          user_id: user.id,
          english_word: wordData.englishWord,
          georgian_definitions: wordData.georgianDefs.filter(
            (d) => d.trim() !== ""
          ),
          description: wordData.description || null,
        });

        if (error) {
          if (isUniqueConstraintError(error)) {
            const existingWord = await findExistingByNormalized(
              wordData.englishWord
            );
            if (existingWord) {
              return { duplicateWord: existingWord };
            }
          }
          throw error;
        }

        return {};
      } catch (error) {
        throw error;
      }
    },
    [findExistingByNormalized, user]
  );

  const updateWord = useCallback(
    async (wordId: string, wordData: WordFormData) => {
      if (!user) return;

      const { error } = await supabase
        .from("words")
        .update({
          english_word: wordData.englishWord,
          georgian_definitions: wordData.georgianDefs.filter(
            (d) => d.trim() !== ""
          ),
          description: wordData.description || null,
        })
        .eq("id", wordId)
        .eq("user_id", user.id);

      if (error) throw error;
    },
    [user]
  );

  return {
    words,
    loading,
    searchTerm,
    setSearchTerm,
    debouncedSearchTerm,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalCount,
    loadWords,
    deleteWord,
    bulkDeleteWords,
    checkExistingEnglishWord,
    addWord,
    updateWord,
  };
}
