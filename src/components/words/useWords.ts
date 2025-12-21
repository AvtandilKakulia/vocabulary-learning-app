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
  partOfSpeech: string;
  isIrregularVerb: boolean;
  pastSimple: string | null;
  pastParticiple: string | null;
}

export interface AddWordResult {
  duplicateWord?: Word | null;
}

export const pageSizeOptions = [10, 25, 50, 100];

export type SortOption = "alpha-asc" | "alpha-desc" | "recent";

export function useWords() {
  const { user } = useAuth();
  const [words, setWords] = useState<Word[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [sortOption, setSortOption] = useState<SortOption>("alpha-asc");
  const prevSearchTermRef = useRef(debouncedSearchTerm);

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

  const loadWords = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    const term = debouncedSearchTerm.trim();
    try {
      if (term) {
        const searchQuery = applySorting(
          supabase.rpc("search_words", {
            p_user_id: user.id,
            p_term: term,
            p_offset: page * pageSize,
            p_limit: pageSize,
          })
        );

        const [searchResult, countResult] = await Promise.all([
          searchQuery,
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
          .eq("user_id", user.id);

        query = applySorting(query).range(
          page * pageSize,
          (page + 1) * pageSize - 1
        );

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
  }, [applySorting, debouncedSearchTerm, page, pageSize, user]);

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
          part_of_speech: wordData.partOfSpeech || "unspecified",
          is_irregular_verb: wordData.isIrregularVerb,
          past_simple: wordData.pastSimple,
          past_participle: wordData.pastParticiple,
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
          part_of_speech: wordData.partOfSpeech || "unspecified",
          is_irregular_verb: wordData.isIrregularVerb,
          past_simple: wordData.pastSimple,
          past_participle: wordData.pastParticiple,
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
    sortOption,
    setSortOption,
    loadWords,
    deleteWord,
    bulkDeleteWords,
    checkExistingEnglishWord,
    addWord,
    updateWord,
  };
}
