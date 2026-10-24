import { apiFixture, storageFixture, makeClient, stop, observe, nextTurn, payload, json, rejectedRefresh, deferred, equal, assert } from '../r4-auth-01/fixtures.mjs';

export const initialCases = ['initial-get', 'initial-denied', 'preflight-denied', 'initial-transient',
  'initial-empty', 'initial-expired', 'initial-missing-refresh', 'initial-invalid-envelope',
  'initial-malformed-user', 'late-subscription-get', 'initial-callback-throws'];
export const refreshCases = ['refresh-success-4', 'terminal-success-4', 'terminal-get-2', 'terminal-get-4',
  'terminal-remove-2', 'terminal-remove-4', 'terminal-abort-4', 'terminal-quota-4',
  'terminal-delayed-4', 'terminal-lost-ack-4'];
export const names = [...initialCases, ...refreshCases];
export const isPatched = which => which === 'patched';
export const upstreamPatch = which => ['pr2709', 'pr2742', 'patched'].includes(which);

// Supported adapter instrumentation: retain the real exception and rethrow it.
// No fabricated null session, volatile fallback, SDK-private mutation or timeout.
function healthAdapter(store) {
  const health = { errors: [] };
  const storage = Object.fromEntries(['getItem', 'setItem', 'removeItem'].map(method => [method, async (...args) => {
    try { return await store.storage[method](...args); }
    catch (error) { health.errors.push(error); throw error; }
  }]));
  return { health, storage };
}
export async function runCase(createClient, which, version, name) {
  assert(names.includes(name), 'Unknown case');
  const store = storageFixture(`auth01b-${crypto.randomUUID()}`), api = apiFixture();
  const { health, storage } = healthAdapter(store);
  const events = [], logs = [], originalError = console.error, originalWarn = console.warn;
  console.error = (...args) => { logs.push({ kind: 'error', message: args.map(String).join(' ') }); originalError(...args); };
  console.warn = (...args) => { logs.push({ kind: 'warn', message: args.map(String).join(' ') }); originalWarn(...args); };
  let client, sub;
  const failure = new Error(`INJECTED_${name}`);
  if (name.includes('denied')) failure.name = 'SecurityError';
  if (name.includes('abort')) failure.name = 'AbortError';
  if (name.includes('quota')) failure.name = 'QuotaExceededError';
  try {
    if (initialCases.includes(name)) {
      const seed = payload('A');
      if (['initial-expired', 'initial-missing-refresh'].includes(name)) seed.expires_at = 1;
      if (name === 'initial-missing-refresh') seed.refresh_token = '';
      if (name === 'initial-invalid-envelope') delete seed.access_token;
      if (name === 'initial-malformed-user') { seed.user = 'not-an-object'; storage.isServer = true; }
      if (name !== 'initial-empty') store.bytes.set(store.key, JSON.stringify(seed));
      if (name === 'preflight-denied') equal(await storage.getItem(store.key), JSON.stringify(seed));
      if (['initial-get', 'initial-denied', 'preflight-denied', 'initial-transient'].includes(name)) {
        store.arm({ method: 'get', key: store.key, error: failure, once: name === 'initial-transient' });
      }
      client = makeClient(createClient, { ...store, storage }, api, { autoRefreshToken: name === 'initial-expired' });
      const initialized = await client.auth.initialize();
      await client.auth.stopAutoRefresh();
      console.log('INITIAL ' + JSON.stringify({ which, name, error: initialized.error?.name ?? null,
        storageFailures: health.errors.length, residual: store.bytes.has(store.key) }));
      // Drain the SDK's own initial subscription, then register a real public listener.
      await nextTurn();
      if (name === 'late-subscription-get') {
        equal((await client.auth.getSession()).data.session.user.id, 'A');
        store.arm({ method: 'get', key: store.key, error: failure });
      }
      const readBase = store.calls.filter(c => c.method === 'get' && c.key === store.key).length;
      sub = client.auth.onAuthStateChange((event, session) => {
        events.push({ event, uid: session?.user?.id ?? null });
        if (name === 'initial-callback-throws') throw failure;
      }).data.subscription;
      await store.waitFor('get', readBase + 1); await nextTurn();
      const get = observe(client.auth.getSession()); await get.done;
      // Protected admission requires both public error checks and an intact storage boundary.
      // An INITIAL_SESSION event is never itself authentication authority.
      const session = get.value?.data?.session;
      const admitted = !initialized.error && !health.errors.length && get.state === 'success'
        && session && typeof session.user === 'object' && typeof session.user.id === 'string'
        && typeof session.access_token === 'string' && !!session.access_token
        && typeof session.refresh_token === 'string' && !!session.refresh_token;
      const raw = store.bytes.get(store.key);
      return { which, version, name, initialized: initialized.error?.name ?? null,
        get: get.state, getError: get.error?.name ?? null, events, admitted: admitted ? session.user.id : null,
        actionable: initialized.error?.name ?? health.errors[0]?.name ?? get.error?.name ?? null,
        residual: raw !== undefined, rawUnchanged: raw === JSON.stringify(seed),
        refreshCalls: api.calls.filter(c => c.kind === 'refresh').length, logs };
    }

    client = makeClient(createClient, { ...store, storage }, api);
    equal((await client.auth.initialize()).error, null);
    equal((await client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' })).error, null);
    const initial = deferred();
    sub = client.auth.onAuthStateChange(event => { events.push(event); if (event === 'INITIAL_SESSION') initial.resolve(); }).data.subscription;
    await initial.promise;
    const gate = api.hold('refresh', 'A');
    const callers = [observe(client.auth.refreshSession({ refresh_token: payload('A').refresh_token }))];
    await gate.reached.promise;
    const count = name.endsWith('-2') ? 2 : 4;
    for (let i = 1; i < count; i++) callers.push(observe(client.auth.refreshSession({ refresh_token: payload('A').refresh_token })));
    await nextTurn();
    let ack;
    const terminal = name !== 'refresh-success-4';
    if (terminal) {
      store.bytes.set(store.key, JSON.stringify({ ...payload('A'), expires_at: 1 }));
      api.refreshResponse = rejectedRefresh;
    }
    if (name.includes('-get-')) store.arm({ method: 'get', key: store.key, error: failure });
    else if (name.includes('-delayed-')) ack = store.gate('remove', true);
    else if (!['refresh-success-4', 'terminal-success-4'].includes(name)) {
      store.arm({ method: 'remove', key: store.key, error: failure, commit: name.includes('lost-ack') });
    }
    gate.response.resolve(terminal ? rejectedRefresh() : json(payload('A', 'renewed')));
    if (ack) {
      await ack.reached.promise;
      equal(callers.map(c => c.state), Array(count).fill('pending'), 'Must await durable cleanup acknowledgement');
      equal(store.bytes.has(store.key), false, 'Commit and acknowledgement are distinct');
      ack.release.resolve();
    }
    await callers[0].done;
    console.log('REFRESH_FIRST ' + JSON.stringify({ which, name, state:callers[0].state, error:callers[0].error?.name ?? null }));
    await nextTurn();
    const brokenWaiters = which !== 'baseline' && !isPatched(which)
      && !['refresh-success-4', 'terminal-success-4', 'terminal-delayed-4'].includes(name);
    if (!brokenWaiters) await Promise.all(callers.map(c => c.done));
    const beforeRetry = callers.map(c => ({ state: c.state, error: c.error?.name ?? null, message: c.error?.message ?? null }));
    const residual = store.bytes.has(store.key);
    const removals = store.calls.filter(c => c.method === 'remove' && c.key === store.key).length;
    const beforeEvents = [...events], beforeCalls = api.calls.filter(c => c.kind === 'refresh').length;
    store.clear(); api.refreshResponse = null;
    // New token bypasses a legitimate Auth-error cooldown; this is an explicit new operation.
    const later = observe(client.auth.refreshSession({ refresh_token: payload('A', 'retry').refresh_token }));
    await later.done; await nextTurn();
    equal(later.state, 'success');
    assert(store.bytes.get(store.key)?.includes('renewed'));
    assert(api.clientHeaders.every(header => header?.includes(version)), 'Wrong SDK artifact');
    return { which, version, name, callers: beforeRetry, afterRetry: callers.map(c => c.state), later: later.state,
      residual, removals, events: beforeEvents, refreshCalls: beforeCalls, logs };
  } finally {
    store.clear(); sub?.unsubscribe(); if (client) await stop(client);
    console.error = originalError; console.warn = originalWarn;
  }
}
