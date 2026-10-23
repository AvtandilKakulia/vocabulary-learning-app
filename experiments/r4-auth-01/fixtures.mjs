export { deferred, equal, assert, rejects, payload, json, rejectedRefresh } from '../r4-sec-11/fixtures.mjs';
import { deferred, payload, json, fakeApi } from '../r4-sec-11/fixtures.mjs';

export function apiFixture() {
  const base = fakeApi();
  const api = { ...base, refreshResponse: null, clientHeaders: [], transport: async (url, init) => {
    api.clientHeaders.push(new Headers(init?.headers).get('X-Client-Info'));
    if (String(url) === 'https://generation-poc.invalid/auth/v1/signup') {
      const uid = JSON.parse(init.body).email.split('@')[0];
      base.calls.push({ kind: 'signup', uid });
      return json(uid === 'unconfirmed' ? { user: payload(uid).user } : payload(uid));
    }
    const response = await base.transport(url, init);
    return String(url).includes('grant_type=refresh_token') && api.refreshResponse ? api.refreshResponse() : response;
  } };
  return api;
}
export const observe = promise => {
  const result = { state: 'pending' };
  result.done = promise.then(value => {
    result.state = value?.error ? 'returned-error' : 'success'; result.value = value;
    result.error = value?.error;
  }, error => { result.state = 'rejected'; result.error = error; });
  return result;
};
// A task boundary drains queued promise reactions; this is not a timed success wait.
export const nextTurn = () => new Promise(resolve => {
  if (typeof setImmediate === 'function') setImmediate(resolve);
  else { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); c.port2.close(); resolve(); }; c.port2.postMessage(null); }
});
export function storageFixture(key) {
  const bytes = new Map(), calls = [], waiters = [];
  let fault = null;
  const hit = async (method, k, value, mutate) => {
    calls.push({ method, key: k });
    for (const waiter of waiters) if (calls.filter(c => c.method === waiter.method && c.key === key).length >= waiter.count) waiter.resolve();
    if (fault?.method === method && (fault.key === undefined || fault.key === k)) {
      const rule = fault;
      if (rule.once) fault = null;
      if (rule.commit) mutate();
      rule.reached?.resolve();
      if (rule.release) await rule.release.promise;
      if (rule.error) throw rule.error;
      if (rule.commit) return;
    }
    return mutate();
  };
  return { key, bytes, calls, arm: rule => { fault = rule; }, clear: () => { fault = null; },
    waitFor(method, count) {
      if (calls.filter(c => c.method === method && c.key === key).length >= count) return Promise.resolve();
      return new Promise(resolve => waiters.push({ method, count, resolve }));
    },
    storage: {
      getItem: k => hit('get', k, null, () => bytes.get(k) ?? null),
      setItem: (k, v) => hit('set', k, v, () => { bytes.set(k, v); }),
      removeItem: k => hit('remove', k, null, () => { bytes.delete(k); }),
    },
    gate(method, commit = false) {
      const rule = { method, key, commit, reached: deferred(), release: deferred(), once: true };
      fault = rule; return rule;
    },
  };
}
export async function stop(client) {
  if (typeof client.auth.dispose === 'function') await client.auth.dispose();
  else await client.auth.stopAutoRefresh();
}
export function makeClient(createClient, store, api, extra = {}) {
  return createClient('https://generation-poc.invalid', 'synthetic-public-key', {
    auth: { storageKey: store.key, storage: store.storage, persistSession: true,
      autoRefreshToken: false, detectSessionInUrl: false, ...extra }, global: { fetch: api.transport },
  });
}
