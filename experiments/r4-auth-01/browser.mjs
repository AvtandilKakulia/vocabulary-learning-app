import { createClient } from '@supabase/supabase-js';
import { GenerationStore, indexedEngine } from '../r4-sec-11/storage.mjs';
import { CompatibilityManager } from './manager.mjs';
import { generationChecks, unsafeControls } from './generation-cases.mjs';
import { probe, probeNames } from './storage-cases.mjs';
import { expectedCrash, verifyProbe } from './expectations.mjs';
import { apiFixture, deferred, equal, assert, rejects, json, payload, rejectedRefresh, observe, nextTurn, storageFixture, makeClient, stop } from './fixtures.mjs';
globalThis.fetch = () => { throw new Error('External network forbidden in browser fixture'); };
const version = AUTH01_VERSION; // Supplied by esbuild for the explicitly selected installed package.
globalThis.poc = { version, assert, equal, rejects, json, payload, rejectedRefresh, deferred, observe, errors: [], logs: [] };
addEventListener('unhandledrejection', event => {
  poc.errors.push(String(event.reason)); poc.errorWaiter?.resolve();
}); // Observation only: never preventDefault or install a rejection suppressor.
addEventListener('error', event => { poc.errors.push(event.message); poc.errorWaiter?.resolve(); });
globalThis.ready = (async () => {
  assert(!!navigator.locks && !!indexedDB && !!BroadcastChannel);
  const name = new URLSearchParams(location.search).get('db');
  assert(name?.startsWith('r4-sec-11-auth01-'));
  const engine = await indexedEngine(name), store = new GenerationStore(engine), api = apiFixture();
  const channel = new BroadcastChannel(`${name}:hint`);
  const manager = new CompatibilityManager(store, { createClient, transport: api.transport, notify: () => channel.postMessage({ hint: true }) });
  Object.assign(poc, { engine, store, api, manager, channel, entries: {}, pauseHints: false, queuedHints: [], hintWaiter: null });
  channel.onmessage = () => {
    if (poc.pauseHints) poc.queuedHints.push(true); else manager.signal();
    poc.hintWaiter?.resolve();
  };
  poc.drainHints = async () => { poc.pauseHints = false; if (poc.queuedHints.splice(0).length) manager.signal(); await manager.settled(); };
  poc.login = async (label, uid) => {
    const entry = await manager.begin(); poc.entries[label] = entry;
    await manager.signIn(entry, uid); await entry.client.auth.getSession(); await manager.settled(); return entry.handle;
  };
  poc.bytes = async label => (await store.snapshot()).generations[poc.entries[label].handle.id].values;
  poc.preserve = async (label, before) => {
    await manager.settled(); await manager.synchronize(); const entry = poc.entries[label];
    equal(await poc.bytes(label), before); equal(manager.view?.id, entry.handle.id);
    equal((await store.snapshot()).active, entry.handle.id);
    equal((await entry.client.auth.getSession()).data.session?.user.id, entry.uid);
  };
  poc.matrix = async () => {
    const records = [];
    for (const name of probeNames) {
      const before = poc.errors.length; poc.errorWaiter = deferred();
      const result = await probe(createClient, version, name);
      if (expectedCrash(version, name)) await poc.errorWaiter.promise;
      await nextTurn();
      const observed = poc.errors.slice(before);
      const expectedErrors = version === '2.83.0' && name === 'concurrent-set' ? 2 : expectedCrash(version, name) ? 1 : 0;
      equal(observed.length, expectedErrors, `${name}: unexpected browser errors ${JSON.stringify(observed)}`);
      for (const error of observed) assert(error.includes(`INJECTED_${name}`), 'Unrelated browser error');
      verifyProbe(result); records.push({ ...result, unhandled: observed });
    }
    poc.errorWaiter = null; return records;
  };
  poc.common = () => generationChecks(createClient, version, () => indexedEngine(`r4-sec-11-auth01-common-${crypto.randomUUID()}`));
  poc.controls = () => unsafeControls(createClient, version);
  poc.startInterval = async () => {
    const store = storageFixture(`interval-${crypto.randomUUID()}`), api = apiFixture();
    const client = makeClient(createClient, store, api);
    await client.auth.initialize();
    await client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' });
    await client.auth.getSession();
    const refreshed = deferred();
    const subscription = client.auth.onAuthStateChange(event => { if (event === 'TOKEN_REFRESHED') refreshed.resolve(); }).data.subscription;
    // Observe the actual host interval without accelerating/replacing its clock.
    // Make the fixture expire only when that native callback runs; unrelated
    // initial getSession work cannot be mistaken for an interval-driven refresh.
    const nativeSetInterval = globalThis.setInterval;
    const observation = { fired: 0, delay: null };
    globalThis.setInterval = (callback, delay, ...args) => {
      observation.delay = delay;
      return nativeSetInterval(() => {
        observation.fired++;
        store.bytes.set(store.key, JSON.stringify({ ...payload('A'), expires_at: Math.floor(Date.now() / 1000) + 10 }));
        return callback(...args);
      }, delay);
    };
    const started = performance.now();
    try { await client.auth.startAutoRefresh(); } finally { globalThis.setInterval = nativeSetInterval; }
    equal(observation.delay, 30000);
    poc.interval = { store, api, client, refreshed, subscription, started, observation };
  };
  poc.finishInterval = async () => {
    const i = poc.interval; await i.refreshed.promise; const elapsed = performance.now() - i.started;
    i.subscription.unsubscribe(); await stop(i.client);
    equal(i.observation.fired, 1); assert(elapsed >= 25000, 'Not a native 30s interval');
    equal(i.api.calls.filter(c => c.kind === 'refresh').length, 1);
    assert(i.store.bytes.get(i.store.key).includes('renewed'));
    return { elapsedMs: elapsed, refreshCalls: 1 };
  };
  poc.startVisibility = async () => {
    const store = storageFixture(`visibility-${crypto.randomUUID()}`), api = apiFixture(), initialTick = deferred();
    store.bytes.set(store.key, JSON.stringify(payload('A')));
    const client = makeClient(createClient, store, api, { autoRefreshToken: true,
      debug: (...args) => { if (args.includes('#_autoRefreshTokenTick()') && args.includes('end')) initialTick.resolve(); } });
    await client.auth.initialize(); await initialTick.promise;
    const refreshed = deferred();
    const subscription = client.auth.onAuthStateChange(event => { if (event === 'TOKEN_REFRESHED') refreshed.resolve(); }).data.subscription;
    poc.visibility = { store, api, client, refreshed, subscription };
  };
  poc.waitVisibility = expected => {
    if (document.visibilityState === expected) return Promise.resolve();
    return new Promise(resolve => { const changed = () => { if (document.visibilityState === expected) { removeEventListener('visibilitychange', changed); resolve(); } }; addEventListener('visibilitychange', changed); });
  };
  poc.expireHidden = () => {
    equal(document.visibilityState, 'hidden');
    poc.visibility.store.bytes.set(poc.visibility.store.key, JSON.stringify({ ...payload('A'), expires_at: 1 }));
    equal(poc.visibility.api.calls.filter(c => c.kind === 'refresh').length, 0);
  };
  poc.finishVisibility = async () => {
    const v = poc.visibility; await v.refreshed.promise;
    equal(document.visibilityState, 'visible'); equal(v.api.calls.filter(c => c.kind === 'refresh').length, 1);
    v.subscription.unsubscribe(); await stop(v.client); return true;
  };
  return true;
})();
