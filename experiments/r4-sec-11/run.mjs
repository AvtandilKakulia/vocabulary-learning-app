import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modelEngine } from './storage.mjs';
import { runChecks } from './checks.mjs';
import { fakeApi, controlledLocks, equal, assert, json, payload, rejectedRefresh } from './fixtures.mjs';

globalThis.fetch = () => { throw new Error('External network forbidden in PoC'); };
console.log('Category: real installed SDK + deterministic transactional model; not native browser evidence.');
const checks = await runChecks(async () => modelEngine());
let controls = 0;
for (const scenario of ['queued logout', 'in-flight logout', 'refresh success', 'refresh failure']) {
  const api = fakeApi(), locks = controlledLocks(), bytes = new Map(), key = `unsafe-${crypto.randomUUID()}`;
  const client = createClient('https://generation-poc.invalid', 'synthetic-public-key', {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storageKey: key, lock: locks.lock,
      storage: { getItem: k => bytes.get(k) ?? null, setItem: (k, v) => { bytes.set(k, v); }, removeItem: k => { bytes.delete(k); } } },
    global: { fetch: api.transport },
  });
  await client.auth.initialize();
  const login = uid => client.auth.signInWithPassword({ email: `${uid}@poc.invalid`, password: 'synthetic-only' });
  await login('A'); await client.auth.getSession();
  const queued = scenario === 'queued logout', refresh = scenario.startsWith('refresh');
  const gate = queued ? locks.hold(key) : api.hold(refresh ? 'refresh' : 'logout', 'A');
  const pending = refresh ? client.auth.refreshSession() : client.auth.signOut({ scope: 'local' });
  await gate.reached.promise; await login('B'); const b = bytes.get(key);
  if (queued) gate.release.resolve();
  else gate.response.resolve(refresh ? (scenario === 'refresh success' ? json(payload('A', 'late')) : rejectedRefresh()) : new Response(null, { status: 204 }));
  await pending;
  assert(bytes.get(key) !== b, 'Unsafe control unexpectedly preserved B');
  const session = (await client.auth.getSession()).data.session;
  equal(session?.user.id ?? null, scenario === 'refresh success' ? 'A' : null);
  if (!refresh) equal(api.calls.find(c => c.kind === 'logout').uid, queued ? 'B' : 'A');
  await client.auth.stopAutoRefresh(); controls++;
  console.log(`UNSAFE CONTROL ${controls}: ${scenario} reproduces B session loss`);
}
const incompatible = spawnSync(process.execPath, [fileURLToPath(new URL('./rejected-storage.mjs', import.meta.url))], { encoding: 'utf8', windowsHide: true });
equal(incompatible.status, 1);
assert(incompatible.stdout.includes('PUBLIC_REFRESH_REJECTION_CAUGHT'));
assert(incompatible.stderr.includes('Error: POC_STORAGE_REJECTION'));
console.log('EXPECTED FAILED DESIGN: throwing refresh storage setter causes uncaught SDK deferred rejection, despite caught public rejection.');
console.log(`PASS: ${checks} isolated generation checks; ${controls} unsafe shared-client controls; 1 failing-design reproduction.`);
