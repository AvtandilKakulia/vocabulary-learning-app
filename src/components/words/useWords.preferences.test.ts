import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { query, supabaseMock } from '@/test/mocks';
import { WORDS_PAGE_SIZE_KEY, WORDS_SORT_KEY } from '@/lib/wordsPreferences';
import { useWords } from './useWords';

describe('Words preference initialization', () => {
  async function mount(size: number, sort: string) {
    const request = query({ data: [], count: 0, error: null });
    supabaseMock.from.mockReturnValue(request);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useWords());
    await act(async () => {});
    expect(result.current).toMatchObject({ pageSize: size, sortOption: sort, page: 0, loading: false });
    expect(supabaseMock.from).toHaveBeenCalledExactlyOnceWith('words');
    expect(request.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'user-a');
    expect(request.select).toHaveBeenCalledExactlyOnceWith('*', { count: 'exact' });
    expect(request.order).toHaveBeenCalledExactlyOnceWith(sort === 'recent' ? 'created_at' : 'english_word', { ascending: sort === 'alpha-asc' });
    expect(request.range).toHaveBeenCalledExactlyOnceWith(0, size - 1);
    expect(writes).not.toHaveBeenCalled();
  }

  it('uses 10 and alpha-asc without stored preferences', async () => {
    await mount(10, 'alpha-asc');
  });

  it.each([10, 25, 50, 100].flatMap(size => ['alpha-asc', 'alpha-desc', 'recent'].map(sort => ({ size, sort }))))(
    'restores $size / $sort before the first request without a default query or initialization write', async ({ size, sort }) => {
      localStorage.setItem(WORDS_PAGE_SIZE_KEY, String(size));
      localStorage.setItem(WORDS_SORT_KEY, sort);
      await mount(size, sort);
    });

  it.each(['', '0', '-1', '26', 'Infinity', '25.0', ' 25 ', '{broken', '{"size":50}', 'null'])(
    'rejects invalid size %j independently of a valid sort', async value => {
      localStorage.setItem(WORDS_PAGE_SIZE_KEY, value);
      localStorage.setItem(WORDS_SORT_KEY, 'recent');
      await mount(10, 'recent');
    });

  it.each(['', 'descending', 'RECENT', ' recent ', '{broken', 'null'])(
    'rejects invalid sort %j independently of a valid size', async value => {
      localStorage.setItem(WORDS_PAGE_SIZE_KEY, '50');
      localStorage.setItem(WORDS_SORT_KEY, value);
      await mount(50, 'alpha-asc');
    });

  it.each([WORDS_PAGE_SIZE_KEY, WORDS_SORT_KEY])('handles a failed read of %s independently', async blockedKey => {
    localStorage.setItem(WORDS_PAGE_SIZE_KEY, '25');
    localStorage.setItem(WORDS_SORT_KEY, 'alpha-desc');
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === blockedKey) throw new DOMException('Blocked', 'SecurityError');
      return getItem.call(this, key);
    });
    await mount(blockedKey === WORDS_PAGE_SIZE_KEY ? 10 : 25, blockedKey === WORDS_SORT_KEY ? 'alpha-asc' : 'alpha-desc');
  });
});
