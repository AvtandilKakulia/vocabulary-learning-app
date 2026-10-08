import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, client } = vi.hoisted(() => ({
  createClient: vi.fn(),
  client: { mocked: true },
}));

// Exercise this module's initialization without constructing a real SDK client.
// The shared fetch/XHR/WebSocket guards remain active for every test.
vi.mock('@supabase/supabase-js', () => ({ createClient }));

beforeEach(() => {
  vi.resetModules();
  createClient.mockReset().mockReturnValue(client);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('Supabase environment configuration', () => {
  it.each([
    [undefined, 'test-public-key'],
    ['', 'test-public-key'],
    [' \t ', 'test-public-key'],
    ['https://example.invalid', undefined],
    ['https://example.invalid', ''],
    ['https://example.invalid', ' \n '],
    [undefined, undefined],
  ])('rejects missing or blank configuration (%j, %j) before creating a client', async (url, key) => {
    vi.stubEnv('VITE_SUPABASE_URL', url);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', key);
    await expect(import('./supabase')).rejects.toThrow(
      /Set non-empty VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.*\.env\.local.*Vercel/,
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('passes the configured URL and public key to the client, trimming surrounding whitespace', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://example.invalid ');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', ' test-public-key ');
    const { supabase } = await import('./supabase');
    expect(createClient).toHaveBeenCalledExactlyOnceWith('https://example.invalid', 'test-public-key');
    expect(supabase).toBe(client);
  });
});
