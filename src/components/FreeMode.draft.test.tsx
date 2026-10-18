import { Profiler, StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authMock, deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { word } from '../test/fixtures';
import { practiceSessionKey } from '../lib/practiceSessions';
import FreeMode from './FreeMode';

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

describe.each([false, true])('Practice draft readiness (StrictMode: %s)', strict => {
  it.each([
    ['early', 'success'], ['early', 'failure'],
    ['initialized', 'success'], ['initialized', 'failure'],
  ] as const)('keeps %s B input before and after A save %s', async (timing, outcome) => {
    const aKey = practiceSessionKey('user-a');
    const bKey = practiceSessionKey('user-b');
    const pending = deferred<QueryResult>();
    const save = query(pending.promise);
    const aWord = word();
    const aRead = deferred<QueryResult>();
    const bWord = word({ id: 'b', user_id: 'user-b', english_word: 'B private word' });
    const bRead = deferred<QueryResult>();
    const bLoad = query(bRead.promise);
    supabaseMock.from.mockImplementation(table => {
      if (table === 'test_history') return save;
      if (table === 'words') return authMock.user?.id === 'user-a'
        ? query(aRead.promise) : bLoad;
      throw new Error(`Unexpected table: ${table}`);
    });
    let entered = false;
    const enterDraft = () => {
      entered = true;
      const input = screen.getByRole('textbox');
      // The commit callback is already inside the read resolution's act scope.
      // Avoid nesting RTL's event act while React is still committing that read.
      if (timing === 'early') {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'B input');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else fireEvent.change(input, { target: { value: 'B input' } });
    };
    const view = () => {
      const practice = <Profiler id="draft-readiness" onRender={() => {
        // Exercise the first committed editable DOM, before passive effects.
        // No effect is mocked or delayed, and A's save remains unresolved.
        if (timing === 'early' && authMock.user?.id === 'user-b' && !entered && screen.queryByRole('textbox')) enterDraft();
      }}><FreeMode /></Profiler>;
      return strict ? <StrictMode>{practice}</StrictMode> : practice;
    };
    const { rerender } = render(view());
    const user = userEvent.setup();
    await waitFor(() => expect(supabaseMock.from).toHaveBeenCalledWith('words'));
    await act(async () => aRead.resolve({ data: [aWord], error: null }));
    await screen.findByRole('textbox');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wrong' } });
    await user.click(screen.getByRole('button', { name: 'Check Answer' }));
    await user.click(screen.getByRole('button', { name: 'Finish Practice' }));
    await user.click(await screen.findByRole('button', { name: 'Close & Save' }));
    const payload = structuredClone(save.insert.mock.calls[0][0]);
    const aCopy = localStorage.getItem(aKey);
    authMock.user = { id: 'user-b' };
    rerender(view());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await waitFor(() => expect(bLoad.range).toHaveBeenCalled());
    await act(async () => bRead.resolve({ data: [bWord], error: null }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(bKey)!)).toEqual({
      userId: 'user-b', queueIds: ['b'], direction: 'en-to-geo', orderMode: 'random',
      allowReguess: false, correctCount: 0, totalAttempts: 0, mistakes: [],
      attemptedWordIds: [], unresolvedWordIds: [], hasChecked: false, completed: false,
    }));
    if (timing === 'initialized') enterDraft();
    expect(entered).toBe(true);
    // A settled initialization must already preserve the draft, independently of A.
    expect(screen.getByRole('textbox')).toHaveValue('B input');
    expect(localStorage.getItem(aKey)).toBe(aCopy);
    const bCopy = localStorage.getItem(bKey);
    await act(async () => {
      if (outcome === 'success') pending.resolve({ error: null });
      else pending.reject(new Error('old save failed'));
    });
    expect(screen.getByRole('textbox')).toHaveValue('B input');
    expect(localStorage.getItem(bKey)).toBe(bCopy);
    expect(localStorage.getItem(aKey)).toBe(outcome === 'success' ? null : aCopy);
    expect(screen.queryByText('Result saved to History')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to save result')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Practice Summary' })).not.toBeInTheDocument();
    expect(save.insert).toHaveBeenCalledExactlyOnceWith(payload);
  });
});
