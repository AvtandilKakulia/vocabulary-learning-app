import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { practiceBrowser } from './practiceBrowser';

// Each test models a fresh browser realm, including retirement remembered when
// localStorage is blocked. Keep the real implementation; isolate only its lifetime.
vi.mock('@/lib/recoveryStorage', async importOriginal => {
  const actual = await importOriginal<typeof import('../lib/recoveryStorage')>();
  let store = actual.createRecoveryStore();
  beforeEach(() => { store = actual.createRecoveryStore(); });
  return { ...actual, recoveryStore: {
    state: (...args: Parameters<typeof store.state>) => store.state(...args),
    retire: (...args: Parameters<typeof store.retire>) => store.retire(...args),
    subscribe: (...args: Parameters<typeof store.subscribe>) => store.subscribe(...args),
    write: (...args: Parameters<typeof store.write>) => store.write(...args),
  } };
});

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
  const browser = practiceBrowser();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: browser.locks });
  vi.stubGlobal('BroadcastChannel', browser.BroadcastChannel);
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
