import { GenerationStore, indexedEngine } from './storage.mjs';
import { GenerationManager } from './manager.mjs';
import { runChecks } from './checks.mjs';
import { fakeApi, deferred, equal, assert, rejects, json, payload, rejectedRefresh } from './fixtures.mjs';

// Static loopback fixture only. Neither the SDK nor this page may use real HTTP.
globalThis.fetch = () => { throw new Error('External network forbidden in browser PoC'); };
globalThis.poc = { assert, equal, rejects, json, payload, rejectedRefresh, deferred, errors: [] };
addEventListener('unhandledrejection', event => poc.errors.push(String(event.reason)));
addEventListener('error', event => poc.errors.push(event.message));
globalThis.ready = (async () => {
  assert(!!navigator.locks && !!indexedDB && !!BroadcastChannel, 'Native APIs required');
  const name = new URLSearchParams(location.search).get('db');
  assert(name?.startsWith('r4-sec-11-'));
  const engine = await indexedEngine(name), store = new GenerationStore(engine), api = fakeApi();
  const channel = new BroadcastChannel(`${name}:hint`);
  const manager = new GenerationManager(store, { transport: api.transport, notify: () => channel.postMessage({ hint: true }) });
  Object.assign(poc, { engine, store, api, manager, channel, entries: {}, queuedHints: [], pauseHints: false, hintWaiter: null });
  channel.onmessage = () => {
    // Message identity/action fields have no authority; no direct removal.
    if (poc.pauseHints) poc.queuedHints.push(true); else manager.signal();
    poc.hintWaiter?.resolve();
  };
  poc.drainHints = async () => { poc.pauseHints = false; if (poc.queuedHints.splice(0).length) manager.signal(); await manager.settled(); };
  poc.login = async (label, uid) => {
    const entry = await manager.begin(); poc.entries[label] = entry;
    await manager.signIn(entry, uid); await entry.client.auth.getSession(); await manager.settled();
    return entry.handle;
  };
  poc.bytes = async label => (await store.snapshot()).generations[poc.entries[label].handle.id].values;
  poc.preserve = async (label, before) => {
    await manager.settled(); await manager.synchronize();
    const entry = poc.entries[label];
    equal(await poc.bytes(label), before); equal(manager.view?.id, entry.handle.id);
    equal((await store.snapshot()).active, entry.handle.id);
    equal((await entry.client.auth.getSession()).data.session?.user.id, entry.uid);
    equal(poc.errors, []);
  };
  poc.common = () => runChecks(() => indexedEngine(`r4-sec-11-check-${crypto.randomUUID()}`));
  return true;
})();
