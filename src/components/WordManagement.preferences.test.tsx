import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { word } from '@/test/fixtures';
import { HISTORY_PAGE_SIZE_KEY } from '@/lib/historyPreferences';
import { WORDS_PAGE_SIZE_KEY, WORDS_SORT_KEY, type SortOption } from '@/lib/wordsPreferences';
import type { Word } from '@/lib/supabase';
import WordManagement from './WordManagement';

const labels = { 'alpha-asc': 'Alphabetical (A → Z)', 'alpha-desc': 'Alphabetical (Z → A)', recent: 'Recently added' };
const searchPlaceholder = 'Search English or Georgian words...';

function fixtures(userId = 'user-a', count = 61) {
  return Array.from({ length: count }, (_, index) => word({
    id: `${userId}-${index}`, user_id: userId, english_word: `entry-${String(index).padStart(3, '0')}`,
    // Date order differs from either alphabetical order.
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index % 2 === 0 ? index : 200 - index)).toISOString(),
  }));
}

// Apply account filtering and global sorting before inclusive ranges, as the
// real standard query and Search RPC do. No network or real records are used.
function server(rows = [...fixtures(), ...fixtures('user-b')]) {
  const requests: { userId: string; sort: SortOption; start: number; end: number }[] = [];
  const replies: (QueryResult | Promise<QueryResult>)[] = [];
  function sorted(userId: string, sort: SortOption, term = '') {
    const field = sort === 'recent' ? 'created_at' : 'english_word';
    return rows.filter(row => row.user_id === userId && (row.english_word.includes(term) || row.georgian_definitions.some(def => def.includes(term))))
      .sort((a, b) => a[field].localeCompare(b[field]) * (sort === 'alpha-asc' ? 1 : -1));
  }
  supabaseMock.from.mockImplementation(table => {
    expect(table).toBe('words');
    const chain = query();
    let userId = '';
    let sort: SortOption = 'alpha-asc';
    chain.eq.mockImplementation((key, value) => { expect(key).toBe('user_id'); userId = value; return chain; });
    chain.order.mockImplementation((key, options) => { sort = key === 'created_at' ? 'recent' : options.ascending ? 'alpha-asc' : 'alpha-desc'; return chain; });
    chain.range.mockImplementation((start, end) => {
      expect(chain.select).toHaveBeenCalledExactlyOnceWith('*', { count: 'exact' });
      requests.push({ userId, sort, start, end });
      const matching = sorted(userId, sort);
      return query(replies.shift() ?? { data: matching.slice(start, end + 1), count: matching.length, error: null });
    });
    return chain;
  });
  supabaseMock.rpc.mockImplementation((name, args) => {
    const matching = sorted(args.p_user_id, args.p_sort ?? 'alpha-asc', args.p_term);
    if (name === 'search_words_count') return Promise.resolve({ data: matching.length, error: null });
    expect(name).toBe('search_words');
    return Promise.resolve({ data: matching.slice(args.p_offset, args.p_offset + args.p_limit), error: null });
  });
  return { requests, replies, sorted, remove: (ids: string[]) => { rows = rows.filter(row => !ids.includes(row.id)); } };
}

function button(name: string) {
  // Locate controls by their visible label without computing accessible names
  // for every row action in the table on each pagination interaction.
  const control = screen.getAllByText(name, { exact: true }).map(node => node.closest('button')).find(Boolean);
  expect(control).toBeInTheDocument();
  return control!;
}
async function click(name: string) {
  const control = button(name);
  expect(control).toBeEnabled();
  await act(async () => fireEvent.click(control));
}
async function chooseSort(from: SortOption, to: SortOption) {
  await click(labels[from]);
  await click(labels[to]);
}
async function chooseSize(from: number, to: number) {
  await click(`${from} per page`);
  await click(`${to} per page`);
}
function expectRows(rows: Word[]) {
  const table = screen.getByRole('table');
  const names = Array.from(table.querySelectorAll('tbody tr')).map(row => row.querySelector('td:nth-child(2) span')?.textContent);
  expect(names).toEqual(rows.map(row => row.english_word[0].toUpperCase() + row.english_word.slice(1)));
}
function preferences(size = 25, sort: SortOption = 'alpha-desc') {
  localStorage.setItem(WORDS_PAGE_SIZE_KEY, String(size));
  localStorage.setItem(WORDS_SORT_KEY, sort);
}

describe('Words display preferences', () => {
  it('preserves both choices through numbered/Next/Previous pages and their boundaries', async () => {
    preferences();
    const api = server();
    render(<WordManagement />);
    await screen.findByText('Page 1 of 3');
    expectRows(api.sorted('user-a', 'alpha-desc').slice(0, 25));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await click('Next');
    expectRows(api.sorted('user-a', 'alpha-desc').slice(25, 50));
    await click('3');
    expectRows(api.sorted('user-a', 'alpha-desc').slice(50));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await click('Previous');
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(api.requests.map(({ start, end }) => [start, end])).toEqual([[0, 24], [25, 49], [50, 74], [25, 49]]);
    expect(localStorage.getItem(WORDS_SORT_KEY)).toBe('alpha-desc');
    expect(localStorage.getItem(WORDS_PAGE_SIZE_KEY)).toBe('25');
  });

  it('resets only the page when either preference changes, preserving the other choice', async () => {
    preferences();
    const api = server();
    render(<WordManagement />);
    await screen.findByText('Page 1 of 3');
    await click('Next');
    await chooseSort('alpha-desc', 'recent');
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expectRows(api.sorted('user-a', 'recent').slice(0, 25));
    await click('Next');
    await chooseSize(25, 50);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expectRows(api.sorted('user-a', 'recent').slice(0, 50));
    expect(api.requests.at(-1)).toEqual({ userId: 'user-a', sort: 'recent', start: 0, end: 49 });
    expect(localStorage.getItem(WORDS_SORT_KEY)).toBe('recent');
    expect(localStorage.getItem(WORDS_PAGE_SIZE_KEY)).toBe('50');
  });

  it('restores explicit choices after section navigation and a fresh mount, without restoring search, page or selection', async () => {
    localStorage.setItem(HISTORY_PAGE_SIZE_KEY, '100');
    const api = server();
    const view = render(<WordManagement />);
    await screen.findByText('Page 1 of 7');
    expectRows(api.sorted('user-a', 'alpha-asc').slice(0, 10));
    await chooseSort('alpha-asc', 'recent');
    await chooseSize(10, 25);
    await click('Next');
    const search = screen.getByPlaceholderText(searchPlaceholder);
    vi.useFakeTimers();
    fireEvent.change(search, { target: { value: 'entry' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    fireEvent.click(within(screen.getByRole('table').querySelector('thead')!).getByRole('button'));
    expect(screen.getByText('25 selected (this page)')).toBeInTheDocument();
    view.rerender(<div>Another section</div>);
    const reads = api.requests.length;
    view.rerender(<WordManagement />);
    await screen.findByText('Page 1 of 3');
    expect(api.requests.slice(reads)).toEqual([{ userId: 'user-a', sort: 'recent', start: 0, end: 24 }]);
    expect(screen.getByPlaceholderText(searchPlaceholder)).toHaveValue('');
    expect(screen.queryByText(/selected \(this page\)/)).not.toBeInTheDocument();
    view.unmount();
    render(<WordManagement />); // Fresh React state, as after a browser reload.
    await screen.findByText('Page 1 of 3');
    expectRows(api.sorted('user-a', 'recent').slice(0, 25));
    expect(screen.getByRole('button', { name: labels.recent })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '25 per page' })).toBeInTheDocument();
    expect({ ...localStorage }).toEqual({ [WORDS_PAGE_SIZE_KEY]: '25', [WORDS_SORT_KEY]: 'recent', [HISTORY_PAGE_SIZE_KEY]: '100' });
  });

  it.each(['entry', 'დათმობა'])('retains restored parameters in debounced %s Search, count, page boundaries and clear', async term => {
    preferences(25, 'alpha-desc');
    const api = server();
    render(<WordManagement />);
    await screen.findByText('Page 1 of 3');
    await click('Next');
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), { target: { value: term } });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(supabaseMock.rpc.mock.calls).toEqual([
      ['search_words', { p_user_id: 'user-a', p_term: term, p_offset: 0, p_limit: 25, p_sort: 'alpha-desc' }],
      ['search_words_count', { p_user_id: 'user-a', p_term: term }],
    ]);
    vi.useRealTimers();
    expectRows(api.sorted('user-a', 'alpha-desc', term).slice(0, 25));
    await click('3');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('search_words', expect.objectContaining({ p_offset: 50, p_limit: 25, p_sort: 'alpha-desc' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await chooseSort('alpha-desc', 'recent');
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expectRows(api.sorted('user-a', 'recent', term).slice(0, 25));
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), { target: { value: '' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    vi.useRealTimers();
    expect(api.requests.at(-1)).toEqual({ userId: 'user-a', sort: 'recent', start: 0, end: 24 });
    expectRows(api.sorted('user-a', 'recent').slice(0, 25));
  });

  it('keeps defaults and explicit in-memory changes usable when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    const api = server();
    render(<WordManagement />);
    await screen.findByText('Page 1 of 7');
    await chooseSort('alpha-asc', 'recent');
    await chooseSize(10, 25);
    await click('Next');
    expectRows(api.sorted('user-a', 'recent').slice(25, 50));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the latest preference query after out-of-order responses and retries failures with the same choices', async () => {
    preferences();
    const api = server();
    const old = deferred<QueryResult>();
    api.replies.push(old.promise);
    render(<WordManagement />);
    await chooseSort('alpha-desc', 'recent');
    expectRows(api.sorted('user-a', 'recent').slice(0, 25));
    await act(async () => old.resolve({ data: [word({ english_word: 'stale' })], count: 999, error: null }));
    expectRows(api.sorted('user-a', 'recent').slice(0, 25));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.replies.push({ error: { message: 'Unavailable' } });
    await chooseSize(25, 10);
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load your words');
    expect(screen.queryByText('Page 1 of 7')).not.toBeInTheDocument();
    await click('Retry');
    expect(api.requests.at(-1)).toEqual({ userId: 'user-a', sort: 'recent', start: 0, end: 9 });
    expectRows(api.sorted('user-a', 'recent').slice(0, 10));
  });

  it('isolates delayed responses across A → B → A, sign-out/in and unmount under StrictMode', async () => {
    preferences(10, 'recent');
    const api = server([word({ id: 'a', english_word: 'alpha' }), word({ id: 'b', user_id: 'user-b', english_word: 'beta' })]);
    const first = deferred<QueryResult>();
    const second = deferred<QueryResult>();
    api.replies.push(first.promise, second.promise);
    const ui = <StrictMode><WordManagement /></StrictMode>;
    const view = render(ui);
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><WordManagement /></StrictMode>);
    await screen.findByText('Beta');
    await act(async () => {
      first.resolve({ data: [word({ english_word: 'obsolete' })], count: 99, error: null });
      second.resolve({ data: [word({ english_word: 'obsolete' })], count: 99, error: null });
    });
    expect(screen.queryByText('Obsolete')).not.toBeInTheDocument();
    authMock.user = { id: 'user-a' };
    view.rerender(<StrictMode><WordManagement /></StrictMode>);
    await screen.findByText('Alpha');
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
    const late = deferred<QueryResult>();
    api.replies.push(late.promise);
    await chooseSize(10, 25);
    authMock.user = null;
    const reads = api.requests.length;
    view.rerender(<StrictMode><WordManagement /></StrictMode>);
    await act(async () => late.resolve({ data: [word({ english_word: 'signedout' })], count: 1, error: null }));
    expect(api.requests).toHaveLength(reads);
    expect(screen.queryByText('Signedout')).not.toBeInTheDocument();
    authMock.user = { id: 'user-b' };
    view.rerender(<StrictMode><WordManagement /></StrictMode>);
    await screen.findByText('Beta');
    expect(screen.getByRole('button', { name: '25 per page' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: labels.recent })).toBeInTheDocument();
    const unmounted = deferred<QueryResult>();
    api.replies.push(unmounted.promise);
    await chooseSort('recent', 'alpha-desc');
    view.unmount();
    render(ui);
    await screen.findByText('Beta');
    await act(async () => unmounted.resolve({ data: [word({ english_word: 'unmounted' })], count: 999, error: null }));
    expect(screen.queryByText('Unmounted')).not.toBeInTheDocument();
    expect(api.requests.every(request => request.userId === 'user-a' || request.userId === 'user-b')).toBe(true);
    expect({ ...localStorage }).toEqual({ [WORDS_PAGE_SIZE_KEY]: '25', [WORDS_SORT_KEY]: 'alpha-desc' });
  });

  it('keeps selection and confirmed bulk deletion restricted to the displayed page with restored preferences', async () => {
    preferences(25, 'recent');
    const api = server();
    render(<WordManagement />);
    await screen.findByText('Page 1 of 3');
    fireEvent.click(within(screen.getByRole('table').querySelector('thead')!).getByRole('button'));
    expect(screen.getByText('25 selected (this page)')).toBeInTheDocument();
    await click('Next');
    expect(screen.queryByText(/selected \(this page\)/)).not.toBeInTheDocument();
    const page = api.sorted('user-a', 'recent').slice(25, 50);
    fireEvent.click(within(screen.getByRole('table').querySelector('thead')!).getByRole('button'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(screen.getByRole('heading', { name: 'Delete 25 Words' })).toBeInTheDocument();
    const deletion = query({ count: 25, error: null });
    supabaseMock.from.mockReturnValueOnce(deletion);
    api.remove(page.map(row => row.id));
    await click('Delete 25 Words');
    expect(deletion.in).toHaveBeenCalledExactlyOnceWith('id', page.map(row => row.id));
    expect(deletion.eq).toHaveBeenCalledExactlyOnceWith('user_id', 'user-a');
    expect(screen.queryByText(/selected \(this page\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
    expectRows(api.sorted('user-a', 'recent').slice(25, 50));
    expect(api.sorted('user-b', 'recent')).toHaveLength(61);
  });
});
