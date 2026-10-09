import { StrictMode, useEffect } from 'react';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatestRequest } from './useLatestRequest';

describe('useLatestRequest', () => {
  it('supersedes requests, rejects old callbacks and never revives a repeated context', () => {
    const { result, rerender, unmount } = renderHook(({ key }) => useLatestRequest(key), { initialProps: { key: 'a' } });
    const oldBegin = result.current;
    const first = oldBegin()!;
    const second = result.current()!;
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    rerender({ key: 'b' });
    const third = result.current()!;
    expect(second()).toBe(false);
    expect(oldBegin()).toBeNull();
    expect(third()).toBe(true);
    rerender({ key: 'a' });
    expect(oldBegin()).toBeNull();
    expect(second()).toBe(false);
    const fourth = result.current()!;
    unmount();
    expect(fourth()).toBe(false);
    expect(result.current()).toBeNull();
  });

  it('invalidates the first StrictMode effect without disabling the replacement', () => {
    const requests: Array<() => boolean> = [];
    renderHook(() => {
      const begin = useLatestRequest('a');
      useEffect(() => { requests.push(begin()!); }, [begin]);
    }, { wrapper: StrictMode });
    expect(requests).toHaveLength(2);
    expect(requests[0]()).toBe(false);
    expect(requests[1]()).toBe(true);
  });
});
