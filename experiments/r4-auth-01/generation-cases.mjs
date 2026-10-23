import { GenerationStore } from '../r4-sec-11/storage.mjs';
import { CompatibilityManager } from './manager.mjs';
import { apiFixture, equal, assert, rejects, deferred, observe, json, payload, rejectedRefresh, storageFixture, makeClient, stop } from './fixtures.mjs';

export async function generationChecks(createClient, version, engineFactory, log = console.log) {
  let checks = 0;
  async function check(name, fn) {
    const engine = await engineFactory(), store = new GenerationStore(engine), api = apiFixture();
    const manager = new CompatibilityManager(store, { createClient, transport: api.transport });
    const login = async uid => {
      const entry = await manager.begin(); await manager.signIn(entry, uid);
      await entry.client.auth.getSession(); await manager.settled(); return entry;
    };
    const bytes = async entry => (await store.snapshot()).generations[entry.handle.id].values;
    const preserve = async (b, before) => {
      await manager.settled(); await manager.synchronize();
      equal(await bytes(b), before, 'B exact credential bytes changed');
      equal((await store.snapshot()).active, b.handle.id, 'B active generation changed');
      equal(manager.view?.id, b.handle.id, 'B application view changed');
      equal((await b.client.auth.getSession()).data.session?.user.id, b.uid, 'B SDK identity changed');
    };
    try {
      await fn({ engine, store, api, manager, login, bytes, preserve });
      await manager.settled(); equal(manager.errors, [], 'Unexpected manager error');
      checks++; log(`GENERATION ${checks} ${version}: ${name}`);
    } finally { await manager.close(); engine.close(); }
  }
  await check('A -> B; distinct clients and exact B identity', async ({ login, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'); assert(a.client !== b.client); await preserve(b, await bytes(b));
  });
  for (const timing of ['queued', 'in-flight']) for (const scope of ['local', 'global']) {
    await check(`A logout ${timing}/${scope}, B activation`, async ({ login, api, bytes, preserve, manager }) => {
      const a = await login('A');
      let release;
      const reached = deferred();
      if (timing === 'queued') {
        const read = a.storage.getItem.bind(a.storage), gate = deferred(); let first = true;
        a.storage.getItem = async key => { if (first) { first = false; reached.resolve(); await gate.promise; } return read(key); };
        release = () => gate.resolve();
      } else {
        const gate = api.hold('logout', 'A');
        gate.reached.promise.then(() => reached.resolve()); release = () => gate.response.resolve(new Response(null, { status: 204 }));
      }
      const operation = observe(a.client.auth.signOut({ scope })); await reached.promise;
      const b = await login('B'), before = await bytes(b); release(); await operation.done;
      equal(operation.state, 'success'); await manager.retire(a); await preserve(b, before);
      equal(api.calls.filter(c => c.kind === 'logout').map(c => [c.uid, c.scope]), [['A', scope]]);
    });
  }
  for (const retired of [false, true]) for (const outcome of ['success', 'terminal']) {
    await check(`pending A refresh ${outcome}, retirement=${retired}`, async ({ login, api, manager, bytes, preserve }) => {
      const a = await login('A'), gate = api.hold('refresh', 'A');
      const operation = observe(a.client.auth.refreshSession()); await gate.reached.promise;
      const b = await login('B'), before = await bytes(b);
      if (retired) await manager.retire(a);
      gate.response.resolve(outcome === 'success' ? json(payload('A', 'renewed')) : rejectedRefresh());
      await operation.done;
      const expected = outcome === 'terminal' || (retired && version === '2.112.4') ? 'returned-error' : 'success';
      equal(operation.state, expected);
      if (retired && outcome === 'success' && version === '2.112.4') equal(operation.error.name, 'AuthRefreshDiscardedError');
      if (retired) equal(await bytes(a), {});
      await preserve(b, before);
      if (!retired && outcome === 'success') assert(manager.events.some(e => e.generation === a.handle.id && e.event === 'TOKEN_REFRESHED'));
    });
  }
  await check('A -> B -> A: account retirement denies all A generations', async ({ login, manager, store, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'), before = await bytes(b), a2 = await login('A');
    await manager.retire(a, { account: true }); equal(await bytes(a), {}); equal(await bytes(a2), {});
    equal(manager.view, null); equal(await bytes(b), before);
    await rejects(() => store.activate(a2.handle), /Retired/);
    const b2 = await login('B'); await preserve(b2, await bytes(b2));
    const late = await manager.begin(); await rejects(() => manager.signIn(late, 'A'), /Retired/);
    await preserve(b2, await bytes(b2));
  });
  await check('single generation retirement preserves newer same-UID session', async ({ login, manager, bytes, preserve }) => {
    const old = await login('A'), newer = await login('A'), before = await bytes(newer);
    await manager.retire(old); await preserve(newer, before);
  });
  await check('unbound A candidate erased, no persistent late writes', async ({ login, manager, store, bytes, preserve }) => {
    const a = await login('A'), candidate = await manager.begin();
    await candidate.client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' });
    const b = await login('B'), before = await bytes(b);
    await manager.retire(a, { account: true }); equal(await bytes(candidate), {});
    equal(await store.bind(candidate.handle, 'A'), false);
    await rejects(() => a.storage.setItem(a.handle.namespace, JSON.stringify(payload('A'))), /Retired/i);
    await preserve(b, before);
  });
  await check('late A sign-in notification cannot override B', async ({ login, manager, api, bytes, preserve }) => {
    const a = await manager.begin(), gate = api.hold('signin', 'A');
    const operation = observe(manager.signIn(a, 'A')); await gate.reached.promise;
    const b = await login('B'), before = await bytes(b); gate.response.resolve(json(payload('A'))); await operation.done;
    equal(operation.state, 'rejected'); assert(/Stale activation/.test(operation.error.message)); await preserve(b, before);
  });
  await check('transaction abort reports residual credentials without touching B', async ({ login, manager, engine, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'), beforeA = await bytes(a), beforeB = await bytes(b);
    engine.faults.abortNext = true; await rejects(() => manager.retire(a), /abort/i);
    equal(await bytes(a), beforeA); await preserve(b, beforeB);
    await manager.retire(a); equal(await bytes(a), {}); await preserve(b, beforeB);
  });
  await check('durable retirement precedes delayed SDK cleanup', async ({ login, manager, bytes, preserve }) => {
    const a = await login('A'), b = await login('B'), before = await bytes(b), reached = deferred(), release = deferred();
    const original = a.client.auth.stopAutoRefresh.bind(a.client.auth);
    a.client.auth.stopAutoRefresh = async () => { reached.resolve(); await release.promise; await original(); };
    const operation = manager.retire(a); await reached.promise;
    equal(await bytes(a), {}); await preserve(b, before); release.resolve(); await operation;
  });
  await check('data response and restoration remain generation-bound', async ({ login, manager, store, api, bytes, preserve }) => {
    const a = await login('A'), gate = api.hold('words', 'A'), pending = manager.words(a);
    await gate.reached.promise; const b = await login('B'), before = await bytes(b);
    await manager.words(b); gate.response.resolve(json([{ user_id: 'A' }])); equal(await pending, { discarded: true });
    await manager.retire(a); const peer = new CompatibilityManager(store, { createClient, transport: api.transport });
    try { await peer.restore(); equal(peer.view.id, b.handle.id); equal(manager.dataView.rows[0].user_id, 'B'); }
    finally { await peer.close(); }
    await preserve(b, before);
  });
  return checks;
}

// These controls intentionally use the shared-slot design, not the manager.
export async function unsafeControls(createClient, version) {
  for (const scenario of ['logout', 'refresh-save-window']) {
    const api = apiFixture(), store = storageFixture(`unsafe-${crypto.randomUUID()}`), client = makeClient(createClient, store, api);
    await client.auth.initialize();
    const login = uid => client.auth.signInWithPassword({ email: `${uid}@poc.invalid`, password: 'synthetic-only' });
    try {
      await login('A'); await client.auth.getSession();
      let release;
      if (scenario === 'logout') {
        const gate = api.hold('logout', 'A');
        const pending = client.auth.signOut({ scope: 'local' }); await gate.reached.promise;
        await login('B'); release = () => gate.response.resolve(new Response(null, { status: 204 }));
        const before = store.bytes.get(store.key); release(); await pending;
        assert(store.bytes.get(store.key) !== before); equal(store.bytes.get(store.key), undefined);
      } else {
        const gate = store.gate('set');
        const pending = client.auth.refreshSession(); await gate.reached.promise;
        await login('B'); const before = store.bytes.get(store.key); gate.release.resolve(); await pending;
        assert(store.bytes.get(store.key) !== before); equal(JSON.parse(store.bytes.get(store.key)).user.id, 'A');
      }
      console.log(`REPRODUCED FAILURE ${version}: shared-slot ${scenario} loses B`);
    } finally { await stop(client); }
  }
  return 2;
}
