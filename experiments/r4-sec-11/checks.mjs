import { GenerationStore } from './storage.mjs';
import { GenerationManager } from './manager.mjs';
import { assert, equal, rejects, payload, json, rejectedRefresh, fakeApi, controlledLocks, deferred } from './fixtures.mjs';

// Run unchanged against both the transactional model and real browser IndexedDB.
export async function runChecks(engineFactory, log = console.log) {
  let count = 0;
  async function check(name, fn) {
    const engine = await engineFactory(), store = new GenerationStore(engine);
    const api = fakeApi(), locks = controlledLocks();
    const manager = new GenerationManager(store, { transport: api.transport, lock: locks.lock });
    const peers = [];
    const login = async uid => {
      const entry = await manager.begin(); await manager.signIn(entry, uid);
      await entry.client.auth.getSession(); await manager.settled(); return entry;
    };
    const bytes = async entry => (await store.snapshot()).generations[entry.handle.id].values;
    const preserve = async (entry, before) => {
      await manager.settled(); await manager.synchronize();
      equal(await bytes(entry), before, 'B credential bytes changed');
      equal((await store.snapshot()).active, entry.handle.id, 'B lost durable active generation');
      equal(manager.view?.id, entry.handle.id, 'Obsolete callback changed B UI generation');
      equal((await entry.client.auth.getSession()).data.session?.user.id, entry.uid, 'B SDK session changed');
    };
    try {
      await fn({ engine, store, api, locks, manager, peers, login, bytes, preserve });
      await manager.settled(); equal(manager.errors, [], 'Unexpected Auth reconciliation error');
      for (const peer of peers) { await peer.settled(); equal(peer.errors, [], 'Unexpected peer reconciliation error'); }
      count++; log(`PASS ${count}: ${name}`);
    } finally {
      await manager.close(); for (const peer of peers) await peer.close(); engine.close();
    }
  }
  await check('storage contract: exact namespaces and forged ownership rejection', async ({ store }) => {
    const a = await store.create(), b = await store.create(); assert(a.namespace !== b.namespace);
    const aa = store.adapter(a), bb = store.adapter(b);
    await aa.setItem(a.namespace, JSON.stringify(payload('A'))); await store.bind(a, 'A');
    await bb.setItem(b.namespace, JSON.stringify(payload('B'))); await store.bind(b, 'B');
    const before = await store.snapshot();
    await rejects(() => store.retireGeneration(a, 'B'), /owner mismatch/);
    await rejects(() => store.adapter({ ...a, namespace: b.namespace }).getItem(b.namespace), /capability/);
    await rejects(() => aa.setItem(a.namespace, JSON.stringify(payload('B'))), /change account/);
    equal(await store.snapshot(), before);
  });
  await check('storage contract: transaction rollback after writes and explicit abort', async ({ engine, store }) => {
    const before = await store.snapshot();
    await rejects(() => engine.transact(state => { state.active = 'bad'; throw new Error('rollback'); }), /rollback/);
    equal(await store.snapshot(), before);
    engine.faults.abortNext = true; await rejects(() => store.create(), /abort/i);
    equal(await store.snapshot(), before);
    await rejects(() => engine.transact(() => Promise.resolve()), /async work/);
    equal(await store.snapshot(), before);
  });
  await check('storage contract: retirement/write ordering cannot resurrect credentials', async ({ store, login, bytes }) => {
    const a = await login('A'), raw = JSON.stringify(payload('A', 'late'));
    const write = a.storage.setItem(a.handle.namespace, raw);
    const retire = store.retireGeneration(a.handle, 'A');
    await Promise.all([write, retire]); equal(await bytes(a), {});
    await rejects(() => a.storage.setItem(a.handle.namespace, raw), /retired/i);
    equal(await a.storage.getItem(a.handle.namespace), null);
    await rejects(() => store.activate(a.handle), /retired/i);
  });
  await check('storage contract: stale activation intent loses to newer tab', async ({ store, login, preserve }) => {
    const stale = await store.create(); const b = await login('B');
    const before = (await store.snapshot()).generations[b.handle.id].values;
    const adapter = store.adapter(stale); await adapter.setItem(stale.namespace, JSON.stringify(payload('A'))); await store.bind(stale, 'A');
    await rejects(() => store.activate(stale), /Stale activation/); await preserve(b, before);
  });
  await check('SDK: separate clients preserve B after retirement and late write/read attempts', async ({ login, bytes, preserve, manager }) => {
    const a = await login('A'), b = await login('B'), before = await bytes(b);
    assert(a.client !== b.client); await manager.retire(a);
    equal(await bytes(a), {}); equal(await a.storage.getItem(a.handle.namespace), null);
    await rejects(() => a.storage.setItem(a.handle.namespace, JSON.stringify(payload('A'))), /retired/i);
    manager.signal(); await preserve(b, before);
  });
  for (const timing of ['queued', 'in-flight']) {
    await check(`SDK: obsolete A logout ${timing}, B exact bytes/active/UI preserved`, async ({ login, api, locks, manager, bytes, preserve }) => {
      const a = await login('A');
      const gate = timing === 'queued' ? locks.hold(a.handle.namespace) : api.hold('logout', 'A');
      const pending = a.client.auth.signOut({ scope: 'local' }); await gate.reached.promise;
      const b = await login('B'), before = await bytes(b);
      if (timing === 'queued') gate.release.resolve(); else gate.response.resolve(new Response(null, { status: 204 }));
      equal((await pending).error, null); await manager.retire(a); await preserve(b, before);
      assert(manager.events.some(e => e.generation === a.handle.id && e.event === 'SIGNED_OUT'));
      equal(api.calls.filter(c => c.kind === 'logout').map(c => [c.uid, c.scope]), [['A', 'local']]);
    });
  }
  for (const retired of [false, true]) {
    for (const outcome of ['success', 'terminal failure']) {
      await check(`SDK: late A refresh ${outcome}, retired=${retired}`, async ({ login, api, manager, bytes, preserve }) => {
        const a = await login('A'), gate = api.hold('refresh', 'A');
        const pending = a.client.auth.refreshSession();
        // Also observe genuine storage failures rather than losing rejection.
        const settled = pending.then(value => ({ value }), error => ({ error }));
        await gate.reached.promise; const b = await login('B'), before = await bytes(b);
        if (retired) await manager.retire(a);
        gate.response.resolve(outcome === 'success' ? json(payload('A', 'renewed')) : rejectedRefresh());
        const result = await settled;
        if (retired && outcome === 'success') {
          equal(result.value.error, null); // SDK payload is NOT application authority.
          equal(manager.discardedWrites, 1, 'Retired SDK write must be discarded');
        } else if (outcome === 'terminal failure') assert(result.value.error);
        else equal(result.value.error, null);
        await preserve(b, before);
        assert(manager.events.some(e => e.generation === a.handle.id && e.event === (outcome === 'success' ? 'TOKEN_REFRESHED' : 'SIGNED_OUT')));
        if (retired) equal(await bytes(a), {});
      });
    }
  }
  await check('SDK: A sign-in notification after B activation cannot select A', async ({ manager, login, api, bytes, preserve }) => {
    const a = await manager.begin(), gate = api.hold('signin', 'A');
    const pending = manager.signIn(a, 'A').then(() => null, error => error);
    await gate.reached.promise; const b = await login('B'), before = await bytes(b);
    gate.response.resolve(json(payload('A'))); assert((await pending)?.message.includes('Stale activation'));
    await preserve(b, before);
    assert(manager.events.some(e => e.generation === a.handle.id && e.event === 'SIGNED_IN'));
  });
  await check('SDK: confirmed deletion retires only A, including A -> B -> new A', async ({ login, manager, store, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'), before = await bytes(b), a2 = await login('A');
    assert(a2.handle.id !== a.handle.id); await manager.retire(a, { account: true });
    equal(await bytes(a), {}); equal(await bytes(a2), {}); equal(manager.view, null);
    equal(await bytes(b), before); await rejects(() => a2.storage.setItem(a2.handle.namespace, JSON.stringify(payload('A'))), /retired/i);
    const freshB = await login('B'); await preserve(freshB, await bytes(freshB));
    const newA = await manager.begin(); await rejects(() => manager.signIn(newA, 'A'), /Retired/i);
    equal((await store.snapshot()).active, freshB.handle.id);
  });
  await check('SDK: retiring one same-UID generation preserves another', async ({ login, manager, bytes, preserve }) => {
    const old = await login('A'), current = await login('A'), before = await bytes(current);
    await manager.retire(old); await preserve(current, before);
  });
  await check('SDK: confirmed A deletion while B stays active; unbound A candidate also erased', async ({ login, manager, store, bytes, preserve }) => {
    const a = await login('A'), pendingA = await manager.begin();
    await pendingA.client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' });
    const b = await login('B'), before = await bytes(b);
    await manager.retire(a, { account: true }); await preserve(b, before);
    equal(await bytes(pendingA), {}); equal(await store.bind(pendingA.handle, 'A'), false);
  });
  await check('SDK: B sign-in while A local cleanup has not committed', async ({ login, engine, manager, bytes, preserve }) => {
    const a = await login('A'), release = deferred(), reached = deferred();
    const original = manager.store.retireGeneration.bind(manager.store);
    manager.store.retireGeneration = async (...args) => { reached.resolve(); await release.promise; return original(...args); };
    const pending = manager.retire(a); await reached.promise;
    // The gate is BEFORE the short storage transaction, never inside one.
    const b = await login('B'), before = await bytes(b); release.resolve(); await pending;
    await preserve(b, before); assert(!engine.faults.deny);
  });
  await check('SDK: old data request remains A-authenticated, obsolete response discarded', async ({ login, api, manager, bytes, preserve }) => {
    const a = await login('A'), gate = api.hold('words', 'A');
    const pending = manager.words(a); await gate.reached.promise;
    const b = await login('B'), before = await bytes(b);
    const bResult = await manager.words(b); equal(bResult.rows[0].user_id, 'B');
    gate.response.resolve(json([{ id: 'late-A', user_id: 'A' }])); equal(await pending, { discarded: true });
    equal(manager.dataView.rows[0].user_id, 'B'); await preserve(b, before);
    equal(api.calls.filter(c => c.kind === 'words').map(c => c.uid), ['A', 'B']);
    await rejects(() => manager.words(a), /Obsolete/); // No additional HTTP request.
    equal(api.calls.filter(c => c.kind === 'words').length, 2);
  });
  await check('model/IDB: old asynchronous view snapshot cannot overwrite newer B view', async ({ login, manager, store, bytes, preserve }) => {
    await login('A'); const held = deferred(), reached = deferred(), original = store.snapshot.bind(store);
    let holdOnce = true;
    store.snapshot = async () => { const snapshot = await original(); if (holdOnce) { holdOnce = false; reached.resolve(); await held.promise; } return snapshot; };
    const old = manager.synchronize(); await reached.promise;
    const b = await login('B'), before = await bytes(b); held.resolve(); await old; await preserve(b, before);
  });
  await check('model/IDB: peer signal is only a hint; reload restores only active B', async ({ login, manager, store, api, peers, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'), before = await bytes(b);
    await manager.retire(a);
    const peer = new GenerationManager(store, { transport: api.transport }); peers.push(peer);
    await peer.restore(); equal(peer.view?.id, b.handle.id);
    const calls = api.calls.length; await peer.synchronize({ account: 'B', delete: true });
    equal(api.calls.length, calls); await preserve(b, before);
    equal(await peer.store.adapter(a.handle).getItem(a.handle.namespace), null);
    await rejects(() => peer.store.activate(a.handle), /Retired/);
  });
  await check('model/IDB: denied transactions report failure, never claim erasure', async ({ login, manager, engine, bytes, store }) => {
    const a = await login('A'), before = await bytes(a);
    engine.faults.deny = true; await rejects(() => manager.retire(a), /denied/);
    equal(manager.view, null); await rejects(() => a.storage.setItem(a.handle.namespace, JSON.stringify(payload('A'))), /retired/i);
    engine.faults.deny = false; equal(await bytes(a), before); // Residual bytes honestly remain.
    await manager.retire(a); equal(await bytes(a), {});
    equal((await store.snapshot()).generations[a.handle.id].retired, true);
  });
  await check('model/IDB: partial retirement abort preserves entire prior state and B bytes', async ({ login, manager, engine, store, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'), beforeB = await bytes(b), before = await store.snapshot();
    engine.faults.abortNext = true;
    await rejects(() => manager.retire(a, { account: true }), /abort/i);
    equal(await store.snapshot(), before); await preserve(b, beforeB);
    await manager.retire(a, { account: true }); equal(await bytes(a), {}); await preserve(b, beforeB);
  });
  await check('model/IDB: inaccessible storage blocks data access and UI publication without HTTP', async ({ login, manager, engine, api, bytes }) => {
    const b = await login('B'), before = await bytes(b), calls = api.calls.length;
    engine.faults.deny = true;
    await rejects(() => manager.synchronize(), /denied/); equal(manager.view, null);
    await rejects(() => manager.words(b), /denied/); equal(api.calls.length, calls);
    await rejects(() => b.storage.getItem(b.handle.namespace), /denied/);
    await rejects(() => b.storage.setItem(b.handle.namespace, JSON.stringify(payload('B','denied'))), /denied/);
    engine.faults.deny = false; equal(await bytes(b), before);
    await manager.synchronize(); equal(manager.view.id, b.handle.id);
  });
  await check('model/IDB: retirement submitted first rejects a concurrently queued write', async ({ login, store, bytes }) => {
    const a = await login('A');
    const retirement = store.retireGeneration(a.handle, 'A');
    const write = rejects(() => a.storage.setItem(a.handle.namespace, JSON.stringify(payload('A','late'))), /Retired/);
    await Promise.all([retirement, write]); equal(await bytes(a), {});
  });
  await check('model/IDB: delayed response-admission snapshot cannot publish A over newer B data', async ({ login, store, manager, bytes, preserve }) => {
    const a = await login('A'), original = store.current.bind(store), gate = deferred(), reached = deferred();
    let reads = 0;
    store.current = async handle => {
      const current = await original(handle);
      if (handle.id === a.handle.id && ++reads === 2) { reached.resolve(); await gate.promise; }
      return current;
    };
    const pending = manager.words(a); await reached.promise;
    const b = await login('B'), before = await bytes(b); await manager.words(b);
    gate.resolve(); equal(await pending, { discarded: true });
    equal(manager.dataView.rows[0].user_id, 'B'); await preserve(b, before);
  });
  return count;
}
