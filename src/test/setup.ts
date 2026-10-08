import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

// A missed application-boundary mock must fail before the real client starts.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => { throw new Error('Real Supabase client forbidden in tests'); },
}));

const networkAttempts: string[] = [];
function blockNetwork(kind: string): never {
  networkAttempts.push(kind);
  throw new Error(`Unexpected ${kind}: tests must use module-boundary mocks`);
}

beforeEach(() => {
  localStorage.clear();
  networkAttempts.length = 0;
  vi.stubGlobal('fetch', () => blockNetwork('fetch'));
  vi.spyOn(XMLHttpRequest.prototype, 'open').mockImplementation(() => blockNetwork('XHR'));
  vi.stubGlobal('WebSocket', class { constructor() { blockNetwork('WebSocket'); } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  // Detect attempts even when application error handling catches the exception.
  expect(networkAttempts).toEqual([]);
});
