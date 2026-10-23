// Deliberately failing SDK compatibility probe. The parent checks the exact
// nonzero exit and error. No global rejection handler conceals the SDK defect.
import { createClient } from '@supabase/supabase-js';
import { fakeApi, json, payload } from './fixtures.mjs';
const api = fakeApi(), bytes = new Map();
let rejectWrites = false;
globalThis.fetch = () => { throw new Error('External network forbidden'); };
const client = createClient('https://generation-poc.invalid', 'synthetic-public-key', {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'rejected-probe',
    storage: { getItem: k => bytes.get(k) ?? null, removeItem: k => { bytes.delete(k); },
      setItem: (k, v) => { if (rejectWrites) throw new Error('POC_STORAGE_REJECTION'); bytes.set(k, v); } } },
  global: { fetch: api.transport },
});
await client.auth.initialize();
await client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' });
const gate = api.hold('refresh', 'A');
const pending = client.auth.refreshSession().then(() => { throw new Error('Expected failure'); }, e => {
  if (e.message !== 'POC_STORAGE_REJECTION') throw e;
  console.log('PUBLIC_REFRESH_REJECTION_CAUGHT');
});
await gate.reached.promise; rejectWrites = true; gate.response.resolve(json(payload('A', 'late')));
await pending;
await client.auth.stopAutoRefresh();
