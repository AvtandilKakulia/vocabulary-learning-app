import { apiFixture, storageFixture, makeClient, stop, observe, nextTurn, payload, json, rejectedRefresh, equal, assert } from './fixtures.mjs';
import { RetiredWrite } from '../r4-sec-11/storage.mjs';

export const probeNames = [
  'initialize-read', 'getSession-read', 'signin-set', 'signup-set', 'signup-success', 'signup-no-session',
  'refresh-set', 'refresh-quota', 'refresh-abort', 'refresh-denied', 'refresh-retired',
  'refresh-read', 'refresh-lost-ack', 'refresh-delayed-ack', 'concurrent-success', 'concurrent-set',
  'terminal-valid', 'terminal-expired', 'terminal-remove', 'terminal-read',
  'logout-local', 'logout-global', 'logout-error', 'logout-remove', 'dispose-pending',
  'auto-set', 'expiry-recovery', 'initialize-expired',
];

export async function probe(createClient, version, name) {
  assert(probeNames.includes(name), 'Unknown probe');
  const api = apiFixture(), store = storageFixture(`auth01-${crypto.randomUUID()}`);
  const logs = [], events = [];
  const originalError = console.error;
  console.error = (...args) => { logs.push(args.map(a => a?.name ?? String(a)).join(' ')); originalError(...args); };
  const failure = new Error(`INJECTED_${name}`);
  if (name.includes('quota')) failure.name = 'QuotaExceededError';
  if (name.includes('abort')) failure.name = 'AbortError';
  if (name.includes('denied')) failure.name = 'SecurityError';
  const fault = error => ({ key: store.key, error });
  if (name === 'initialize-read') {
    store.bytes.set(store.key, JSON.stringify(payload('A')));
    store.arm({ method: 'get', ...fault(failure) });
  }
  if (name === 'initialize-expired') store.bytes.set(store.key, JSON.stringify({ ...payload('A'), expires_at: 1 }));
  let tickEnd;
  const tick = new Promise(resolve => { tickEnd = resolve; });
  const client = makeClient(createClient, store, api, { autoRefreshToken: name === 'initialize-expired',
    debug: (...args) => { if (args.includes('#_autoRefreshTokenTick()') && args.includes('end')) tickEnd(); } });
  let subscription, result, concurrent, retry = null;
  try {
    const initialized = await client.auth.initialize();
    if (name.startsWith('initialize-')) {
      result = { state: initialized.error ? 'returned-error' : 'success', error: initialized.error };
      if (name === 'initialize-read') await store.waitFor('get', 2);
    } else {
      equal(initialized.error, null);
      if (name.startsWith('signup') || name === 'signin-set') {
        if (!['signup-no-session', 'signup-success'].includes(name)) store.arm({ method: 'set', ...fault(failure) });
        result = observe(name.startsWith('signup')
          ? client.auth.signUp({ email: name === 'signup-no-session' ? 'unconfirmed@poc.invalid' : 'A@poc.invalid', password: 'synthetic-only' })
          : client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' }));
        await result.done;
        if (name === 'signup-no-session') equal(result.value.data.session, null);
        if (name === 'signup-success') equal(result.value.data.session.user.id, 'A');
      } else {
        equal((await client.auth.signInWithPassword({ email: 'A@poc.invalid', password: 'synthetic-only' })).error, null);
        const initial = new Promise(resolve => {
          subscription = client.auth.onAuthStateChange(event => { events.push(event); if (event === 'INITIAL_SESSION') resolve(); }).data.subscription;
        });
        await initial;
        if (name === 'auto-set') {
          const gate = api.hold('refresh', 'A');
          store.bytes.set(store.key, JSON.stringify({ ...payload('A'), expires_at: Math.floor(Date.now() / 1000) + 30 }));
          await client.auth.startAutoRefresh(); await gate.reached.promise;
          store.arm({ method: 'set', ...fault(failure) }); gate.response.resolve(json(payload('A', 'renewed')));
          await tick; await client.auth.stopAutoRefresh(); result = { state: 'scheduled', error: null };
        } else if (name === 'expiry-recovery') {
          store.bytes.set(store.key, JSON.stringify({ ...payload('A'), expires_at: 1 }));
          result = observe(client.auth.getSession()); await result.done;
          equal(result.value.data.session.user.id, 'A');
        } else if (name === 'getSession-read') {
          store.arm({ method: 'get', ...fault(failure) }); result = observe(client.auth.getSession()); await result.done;
        } else if (name.startsWith('logout')) {
          const gate = api.hold('logout', 'A');
          if (name === 'logout-remove') store.arm({ method: 'remove', ...fault(failure) });
          result = observe(client.auth.signOut({ scope: name === 'logout-global' ? 'global' : 'local' }));
          await gate.reached.promise;
          gate.response.resolve(name === 'logout-error' ? json({ message: 'synthetic logout rejection' }, 500) : new Response(null, { status: 204 }));
          await result.done;
        } else {
          const terminal = name.startsWith('terminal');
          const gate = api.hold('refresh', 'A');
          result = observe(client.auth.refreshSession({ refresh_token: payload('A').refresh_token }));
          await gate.reached.promise;
          if (name.startsWith('concurrent') || name === 'terminal-remove' || name === 'terminal-read') {
            concurrent = observe(client.auth.refreshSession({ refresh_token: payload('A').refresh_token }));
            await nextTurn(); // public call has run its queued microtasks before releasing HTTP.
          }
          if (terminal) {
            api.refreshResponse = rejectedRefresh;
            if (name !== 'terminal-valid') store.bytes.set(store.key, JSON.stringify({ ...payload('A'), expires_at: 1 }));
          }
          if (name === 'dispose-pending') await stop(client);
          else if (name === 'refresh-delayed-ack') {
            const ack = store.gate('set', true);
            gate.response.resolve(json(payload('A', 'renewed')));
            await ack.reached.promise; equal(result.state, 'pending');
            assert(store.bytes.get(store.key).includes('renewed'));
            ack.release.resolve(); await result.done;
          } else if (name === 'terminal-remove') store.arm({ method: 'remove', ...fault(failure) });
          else if (name === 'terminal-read' || name === 'refresh-read') store.arm({ method: 'get', ...fault(failure) });
          else if (name !== 'concurrent-success' && !terminal) store.arm({ method: 'set', commit: name === 'refresh-lost-ack',
            ...fault(name === 'refresh-retired' ? new RetiredWrite(`INJECTED_${name}`) : failure) });
          if (name !== 'refresh-delayed-ack') {
            gate.response.resolve(terminal ? rejectedRefresh() : json(payload('A', 'renewed')));
            await result.done;
            console.log('PUBLIC ' + JSON.stringify({ name, state: result.state, error: result.error?.name ?? null, message: result.error?.message ?? null }));
          }
          // The terminal-error branch can throw before settling the shared deferred.
          // Drain all reactions after the originating call settles; record a pending
          // waiter as a failure, never wait a random duration and call it success.
          if (concurrent) {
            if (version === '2.112.4' && ['terminal-remove', 'terminal-read'].includes(name)) await nextTurn();
            else await concurrent.done;
          }
          if (concurrent?.state === 'pending') {
            store.clear(); api.refreshResponse = null;
            const later = observe(client.auth.refreshSession({ refresh_token: payload('A').refresh_token }));
            await later.done; await nextTurn();
            retry = { public: later.state, originalWaiter: concurrent.state };
          }
        }
      }
    }
    const raw = store.bytes.get(store.key);
    assert(api.clientHeaders.every(header => header?.includes(version)), 'Unexpected SDK version on HTTP boundary');
    return { name, version, public: result.state, error: result.error?.name ?? null,
      message: result.error?.message ?? null, waiter: concurrent?.state ?? null,
      waiterError: concurrent?.error?.name ?? null, stored: raw ? JSON.parse(raw).user.id : null,
      renewed: !!raw?.includes('renewed'), refreshCalls: api.calls.filter(c => c.kind === 'refresh').length,
      logoutScopes: api.calls.filter(c => c.kind === 'logout').map(c => c.scope), events, loggedErrors: logs.length,
      disposal: typeof client.auth.dispose === 'function', retry };
  } finally {
    store.clear(); subscription?.unsubscribe(); await stop(client); console.error = originalError;
  }
}
