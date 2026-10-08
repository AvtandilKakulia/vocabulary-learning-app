import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, query, supabaseMock } from '@/test/mocks';
import { word } from '@/test/fixtures';
import { useWords, type SortOption, type WordFormData } from './useWords';

const fullWord = word({
  english_word: 'go', is_irregular_verb: true, past_simple: 'went', past_participle: 'gone',
});

async function mountHook() {
  const hook = renderHook(() => useWords());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

beforeEach(() => {
  supabaseMock.from.mockReturnValue(query({ data: [fullWord], count: 80, error: null }));
});

describe('useWords query contracts', () => {
  it.each<[SortOption, string, boolean]>([
    ['alpha-asc', 'english_word', true],
    ['alpha-desc', 'english_word', false],
    ['recent', 'created_at', false],
  ])('loads user-scoped pages in %s order', async (sort, column, ascending) => {
    const load = query({ data: [fullWord], count: 80, error: null });
    supabaseMock.from.mockReturnValue(load);
    const { result } = await mountHook();
    expect(supabaseMock.from).toHaveBeenCalledWith('words');
    expect(load.select).toHaveBeenCalledWith('*', { count: 'exact' });
    expect(load.eq).toHaveBeenCalledWith('user_id', 'user-a');
    expect(load.range).toHaveBeenLastCalledWith(0, 9);
    await act(async () => {
      result.current.setSortOption(sort);
      result.current.setPageSize(25);
      result.current.setPage(2);
    });
    expect(load.order).toHaveBeenLastCalledWith(column, { ascending });
    expect(load.range).toHaveBeenLastCalledWith(50, 74);
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.totalCount).toBe(80);
  });

  it('passes sorting/pagination into Search RPCs, retains complete words, and resets changed searches', async () => {
    // Promise-only RPCs intentionally expose no .order(): the server sorts before paging.
    supabaseMock.rpc.mockImplementation((name) => Promise.resolve({
      data: name === 'search_words' ? [fullWord] : 61, error: null,
    }));
    const { result } = await mountHook();
    vi.useFakeTimers();
    await act(async () => { result.current.setPage(3); });
    await act(async () => { result.current.setSearchTerm('  go  '); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.page).toBe(0);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words', {
      p_user_id: 'user-a', p_term: 'go', p_offset: 0, p_limit: 10, p_sort: 'alpha-asc',
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words_count', {
      p_user_id: 'user-a', p_term: 'go',
    });
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.totalCount).toBe(61);

    for (const sort of ['alpha-desc', 'recent'] as const) {
      supabaseMock.rpc.mockClear();
      await act(async () => {
        result.current.setPage(2);
        result.current.setSortOption(sort);
      });
      expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words', {
        p_user_id: 'user-a', p_term: 'go', p_offset: 20, p_limit: 10, p_sort: sort,
      });
    }
    supabaseMock.rpc.mockClear();
    await act(async () => { result.current.setSearchTerm('went'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.page).toBe(0);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words', {
      p_user_id: 'user-a', p_term: 'went', p_offset: 0, p_limit: 10, p_sort: 'recent',
    });
    expect(supabaseMock.rpc).not.toHaveBeenCalledWith('search_words',
      expect.objectContaining({ p_term: 'went', p_offset: 20 }));
  });

  it('returns every matching sense using a normalized, user-scoped duplicate lookup', async () => {
    const { result } = await mountHook();
    const senses = [word(), word({ id: 'sense-2', georgian_definitions: ['მოსავალი'] })];
    const lookup = query({ data: senses, error: null });
    supabaseMock.from.mockReturnValue(lookup);
    expect(await result.current.checkExistingEnglishWords('  YIELD \t WAY  ')).toEqual(senses);
    expect(lookup.select).toHaveBeenCalledWith('*');
    expect(lookup.eq.mock.calls).toEqual([
      ['user_id', 'user-a'], ['english_word_norm', 'yield way'],
    ]);
    expect(lookup.order.mock.calls).toEqual([
      ['created_at', { ascending: true }], ['id', { ascending: true }],
    ]);
  });

  it('scopes single and bulk deletion by both identity and owner', async () => {
    const { result } = await mountHook();
    const single = query();
    const bulk = query();
    supabaseMock.from.mockReturnValueOnce(single).mockReturnValueOnce(bulk);
    await result.current.deleteWord('word-1');
    await result.current.bulkDeleteWords(['word-2', 'word-3']);
    expect(single.delete).toHaveBeenCalledOnce();
    expect(single.eq.mock.calls).toEqual([['id', 'word-1'], ['user_id', 'user-a']]);
    expect(bulk.delete).toHaveBeenCalledOnce();
    expect(bulk.in).toHaveBeenCalledWith('id', ['word-2', 'word-3']);
    expect(bulk.eq).toHaveBeenCalledWith('user_id', 'user-a');
    supabaseMock.from.mockClear();
    await result.current.bulkDeleteWords([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('inserts ownership and preserves grammatical fields on scoped updates while filtering blanks', async () => {
    const { result } = await mountHook();
    const insert = query();
    const update = query();
    supabaseMock.from.mockReturnValueOnce(insert).mockReturnValueOnce(update);
    const form: WordFormData = {
      englishWord: 'go', georgianDefs: ['', '  ', 'წასვლა', ' სვლა '],
      description: 'Changed description', partOfSpeech: 'verb',
      isIrregularVerb: true, pastSimple: 'went', pastParticiple: 'gone',
    };
    const payload = {
      english_word: 'go', georgian_definitions: ['წასვლა', ' სვლა '],
      description: 'Changed description', part_of_speech: 'verb',
      is_irregular_verb: true, past_simple: 'went', past_participle: 'gone',
    };
    await result.current.addWord(form);
    await result.current.updateWord(fullWord.id, form);
    expect(insert.insert).toHaveBeenCalledWith({ ...payload, user_id: 'user-a' });
    expect(update.update).toHaveBeenCalledWith(payload);
    expect(update.eq.mock.calls).toEqual([['id', fullWord.id], ['user_id', 'user-a']]);
  });

  it('does not issue word queries or mutations without an authenticated user', async () => {
    authMock.user = null;
    supabaseMock.from.mockClear();
    const { result } = renderHook(() => useWords());
    await act(async () => {
      await result.current.deleteWord('word-1');
      await result.current.bulkDeleteWords(['word-1']);
      expect(await result.current.checkExistingEnglishWords('yield')).toEqual([]);
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
