import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';

// Each committed context has its own identity, even when A -> B -> A repeats a key.
// Invalidate at commit, before passive effects start replacement reads.
export function useLatestRequest(contextKey: string) {
  const context = useMemo(() => ({ key: contextKey }), [contextKey]);
  const activeContext = useRef<typeof context | null>(null);
  const generation = useRef(0);

  useLayoutEffect(() => {
    activeContext.current = context;
    return () => {
      activeContext.current = null;
      generation.current += 1;
    };
  }, [context]);

  return useCallback(() => {
    // A mutation may finish with an old refresh callback after the context changed.
    if (activeContext.current !== context) return null;
    const request = ++generation.current;
    return () => activeContext.current === context && generation.current === request;
  }, [context]);
}
