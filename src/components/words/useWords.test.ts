import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import { useWords, type SortOption, type WordFormData } from './useWords';

const fullWord = word({
  english_word: 'go', is_irregular_verb: true, past_simple: 'went', past_participle: 'gone',
});

describe('useWords read errors', () => {
  it.each(['returned', 'rejected'] as const)('exposes %s read failures, blocks deletion, and clears the error on retry', async kind => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(failure.promise));
    const { result } = renderHook(() => useWords());
    await act(async () => {
      if (kind === 'returned') failure.resolve({ error: { message: 'private database details' } });
      else failure.reject(new Error('private database details'));
    });
    expect(result.current.readError).toBe('Unable to load your words. Please try again.');
    expect(result.current.loading).toBe(false);
    const calls = supabaseMock.from.mock.calls.length;
    await expect(result.current.deleteWord('word-1')).rejects.toThrow('Reload your words');
    await expect(result.current.bulkDeleteWords(['word-1'])).rejects.toThrow('Reload your words');
    expect(supabaseMock.from).toHaveBeenCalledTimes(calls);
    const retry = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(retry.promise));
    act(() => { void result.current.loadWords(); });
    expect(result.current.readError).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => retry.resolve({ data: [fullWord], count: 1, error: null }));
    expect(result.current.readError).toBeNull();
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.loading).toBe(false);
  });

  it.each([
    ['search_words', 'returned'], ['search_words_count', 'returned'],
    ['search_words', 'rejected'], ['search_words_count', 'rejected'],
  ] as const)('never partially commits when %s fails with a %s error; retry retains query context', async (rpc, kind) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await mountHook();
    vi.useFakeTimers();
    supabaseMock.rpc.mockImplementation(name => name === rpc
      ? kind === 'returned' ? Promise.resolve({ error: { message: 'failed' } }) : Promise.reject(new Error('failed'))
      : Promise.resolve({ data: name === 'search_words' ? [word({ id: 'uncommitted' })] : 99, error: null }));
    act(() => result.current.setSearchTerm('go'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => { result.current.setPage(2); result.current.setPageSize(25); result.current.setSortOption('recent'); });
    expect(result.current.readError).toBeTruthy();
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.totalCount).toBe(80);
    supabaseMock.rpc.mockClear();
    supabaseMock.rpc.mockImplementation(name => Promise.resolve({ data: name === 'search_words' ? [fullWord] : 61, error: null }));
    await act(async () => { await result.current.loadWords(); });
    expect(supabaseMock.rpc.mock.calls).toEqual([
      ['search_words', { p_user_id: 'user-a', p_term: 'go', p_offset: 50, p_limit: 25, p_sort: 'recent' }],
      ['search_words_count', { p_user_id: 'user-a', p_term: 'go' }],
    ]);
    expect(result.current).toMatchObject({ page: 2, pageSize: 25, sortOption: 'recent', searchTerm: 'go', totalCount: 61, readError: null });
  });

  it('keeps a newer failure when an obsolete success finishes, then recovers after repeated refreshes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query({ error: { message: 'new failure' } }));
    const { result } = renderHook(() => useWords());
    await act(async () => { await result.current.loadWords(); });
    await act(async () => old.resolve({ data: [fullWord], count: 99, error: null }));
    expect(result.current.readError).toBeTruthy();
    expect(result.current.totalCount).toBe(0);
    const first = deferred<QueryResult>();
    const second = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(first.promise)).mockReturnValueOnce(query(second.promise));
    act(() => { void result.current.loadWords(); void result.current.loadWords(); });
    await act(async () => first.resolve({ error: { message: 'stale retry' } }));
    expect(result.current.loading).toBe(true);
    expect(result.current.readError).toBeNull();
    await act(async () => second.resolve({ data: [], count: 0, error: null }));
    expect(result.current.loading).toBe(false);
    expect(result.current.readError).toBeNull();
  });
});

describe('useWords read races', () => {
  it('refreshes the current sort after a mutation settles with an older refresh callback', async () => {
    const { result } = await mountHook();
    const refreshAfterMutation = result.current.loadWords;
    const mutation = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(mutation.promise));
    const saving = result.current.deleteWord('word-1');
    const beforeDeletion = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(beforeDeletion.promise));
    act(() => result.current.setSortOption('recent'));
    const afterDeletion = query({ data: [], count: 0, error: null });
    supabaseMock.from.mockReturnValueOnce(afterDeletion);
    await act(async () => {
      mutation.resolve({ error: null });
      await saving;
      await refreshAfterMutation();
    });
    expect(afterDeletion.order).toHaveBeenCalledWith('created_at', { ascending: false });
    await act(async () => beforeDeletion.resolve({ data: [fullWord], count: 1, error: null }));
    expect(result.current.words).toEqual([]);
    expect(result.current.totalCount).toBe(0);
  });

  it.each(['sort', 'page', 'page size'] as const)('invalidates both pending RPC results when search %s changes', async trigger => {
    const { result } = await mountHook();
    vi.useFakeTimers();
    const oldRows = deferred<QueryResult>();
    const oldCount = deferred<QueryResult>();
    const rows = deferred<QueryResult>();
    const count = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValueOnce(oldRows.promise).mockReturnValueOnce(oldCount.promise)
      .mockReturnValueOnce(rows.promise).mockReturnValueOnce(count.promise);
    act(() => result.current.setSearchTerm('go'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    act(() => {
      if (trigger === 'sort') result.current.setSortOption('alpha-desc');
      if (trigger === 'page') result.current.setPage(1);
      if (trigger === 'page size') result.current.setPageSize(25);
    });
    await act(async () => { oldRows.resolve({ data: [word({ id: 'old' })], error: null }); oldCount.resolve({ data: 91, error: null }); });
    expect(result.current.loading).toBe(true);
    expect(result.current.totalCount).toBe(80);
    await act(async () => { rows.resolve({ data: [fullWord], error: null }); count.resolve({ data: 7, error: null }); });
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.totalCount).toBe(7);
    expect(result.current.loading).toBe(false);
  });

  it.each(['sort', 'page', 'page size', 'refresh'] as const)('keeps the latest result and count after a %s change', async trigger => {
    const old = deferred<QueryResult>();
    const current = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query(current.promise));
    const { result } = renderHook(() => useWords());
    act(() => {
      if (trigger === 'sort') result.current.setSortOption('recent');
      if (trigger === 'page') result.current.setPage(1);
      if (trigger === 'page size') result.current.setPageSize(25);
      if (trigger === 'refresh') void result.current.loadWords();
    });
    const newest = word({ id: 'newest' });
    await act(async () => current.resolve({ data: [newest], count: 22, error: null }));
    await act(async () => old.resolve({ data: [fullWord], count: 99, error: null }));
    expect(result.current.words).toEqual([newest]);
    expect(result.current.totalCount).toBe(22);
    expect(result.current.loading).toBe(false);
  });

  it('does not end loading when an obsolete request completes first', async () => {
    const old = deferred<QueryResult>();
    const current = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise)).mockReturnValueOnce(query(current.promise));
    const { result } = renderHook(() => useWords());
    act(() => { void result.current.loadWords(); });
    await act(async () => old.resolve({ data: [fullWord], count: 99, error: null }));
    expect(result.current.loading).toBe(true);
    expect(result.current.words).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    await act(async () => current.resolve({ data: [], count: 0, error: null }));
    expect(result.current.loading).toBe(false);
  });

  it.each(['returned', 'rejected'] as const)('ignores stale %s errors after a successful refresh', async kind => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const old = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(old.promise));
    const { result } = renderHook(() => useWords());
    await act(async () => { await result.current.loadWords(); });
    await act(async () => {
      if (kind === 'returned') old.resolve({ error: { message: 'Old failure' } });
      else old.reject(new Error('Old failure'));
    });
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.totalCount).toBe(80);
    expect(result.current.loading).toBe(false);
    expect(logged).not.toHaveBeenCalled();
  });

  it('keeps RPC rows/count paired across rapid searches, page resets and search-to-normal transitions', async () => {
    const { result } = await mountHook();
    vi.useFakeTimers();
    const aRows = deferred<QueryResult>();
    const aCount = deferred<QueryResult>();
    const bRows = deferred<QueryResult>();
    const bCount = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValueOnce(aRows.promise).mockReturnValueOnce(aCount.promise)
      .mockReturnValueOnce(bRows.promise).mockReturnValueOnce(bCount.promise);
    await act(async () => { result.current.setPage(3); });
    act(() => result.current.setSearchTerm('a'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.page).toBe(0);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words', expect.objectContaining({ p_term: 'a', p_offset: 0 }));
    act(() => result.current.setSearchTerm('ab'));
    act(() => result.current.setSearchTerm('abc'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(4);
    const newest = word({ id: 'abc' });
    await act(async () => bRows.resolve({ data: [newest], error: null }));
    expect(result.current.loading).toBe(true);
    expect(result.current.words).toEqual([fullWord]);
    await act(async () => aCount.resolve({ data: 91, error: null }));
    await act(async () => bCount.resolve({ data: 12, error: null }));
    expect(result.current.words).toEqual([newest]);
    expect(result.current.totalCount).toBe(12);
    await act(async () => aRows.resolve({ data: [word({ id: 'a' })], error: null }));
    expect(result.current.words).toEqual([newest]);
    expect(result.current.totalCount).toBe(12);

    const staleSearch = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValueOnce(staleSearch.promise).mockResolvedValueOnce({ data: 66, error: null });
    act(() => result.current.setPage(2));
    act(() => result.current.setSearchTerm(''));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.page).toBe(0);
    await act(async () => staleSearch.resolve({ data: [newest], error: null }));
    expect(result.current.words).toEqual([fullWord]);
    expect(result.current.totalCount).toBe(80);
  });

  it('invalidates a pending normal page before the changed search resets to page zero', async () => {
    const { result } = await mountHook();
    vi.useFakeTimers();
    const oldPage = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(oldPage.promise));
    act(() => result.current.setPage(4));
    const rows = deferred<QueryResult>();
    supabaseMock.rpc.mockReturnValueOnce(rows.promise).mockResolvedValueOnce({ data: 2, error: null });
    act(() => result.current.setSearchTerm('go'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await act(async () => oldPage.resolve({ data: [word({ id: 'obsolete page' })], count: 101, error: null }));
    expect(result.current.page).toBe(0);
    expect(result.current.loading).toBe(true);
    expect(result.current.totalCount).toBe(80);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(2);
    await act(async () => rows.resolve({ data: [fullWord], error: null }));
    expect(result.current.totalCount).toBe(2);
  });

  it('rejects previous-account reads and refresh callbacks, then clears on sign-out', async () => {
    const a = deferred<QueryResult>();
    const b = deferred<QueryResult>();
    const bQuery = query(b.promise);
    supabaseMock.from.mockReturnValueOnce(query(a.promise)).mockReturnValueOnce(bQuery);
    const { result, rerender } = renderHook(() => useWords());
    const oldRefresh = result.current.loadWords;
    authMock.user = { id: 'user-b' };
    rerender();
    expect(bQuery.eq).toHaveBeenCalledWith('user_id', 'user-b');
    const currentWord = word({ id: 'b', user_id: 'user-b' });
    await act(async () => b.resolve({ data: [currentWord], count: 1, error: null }));
    await act(async () => { await oldRefresh(); a.resolve({ data: [fullWord], count: 80, error: null }); });
    expect(supabaseMock.from).toHaveBeenCalledTimes(2);
    expect(result.current.words).toEqual([currentWord]);
    authMock.user = null;
    rerender();
    expect(result.current.words).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)('ignores a pending %s after unmount', async completion => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending = deferred<QueryResult>();
    supabaseMock.from.mockReturnValueOnce(query(pending.promise));
    const { result, unmount } = renderHook(() => useWords());
    const before = result.current;
    unmount();
    await act(async () => {
      if (completion === 'resolve') pending.resolve({ data: [fullWord], count: 80, error: null });
      else pending.reject(new Error('Unmounted'));
    });
    expect(result.current).toBe(before);
    expect(logged).not.toHaveBeenCalled();
  });
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
