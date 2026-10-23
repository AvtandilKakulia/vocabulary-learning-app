export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const payload = (uid, revision = 'original') => ({
  access_token: `synthetic-access:${uid}:${revision}`, refresh_token: `synthetic-refresh:${uid}:${revision}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: uid, email: `${uid}@poc.invalid`, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
});
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
export const rejectedRefresh = () => json({ message: 'Synthetic refresh rejection', code: 'refresh_token_not_found' }, 400);

export function fakeApi() {
  const gates = new Map(), calls = [];
  const hold = (kind, uid) => {
    const gate = { reached: deferred(), response: deferred() };
    const key = `${kind}:${uid}`, queue = gates.get(key) ?? [];
    queue.push(gate); gates.set(key, queue);
    return gate;
  };
  const transport = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://generation-poc.invalid') throw new Error('External network forbidden');
    const authorization = new Headers(init?.headers).get('Authorization');
    const body = init?.body ? JSON.parse(init.body) : null;
    let kind, uid, result;
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      kind = 'signin'; uid = body.email.split('@')[0]; result = json(payload(uid));
    } else if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      kind = 'refresh'; uid = body.refresh_token.split(':')[1]; result = json(payload(uid, 'renewed'));
    } else if (url.pathname === '/auth/v1/logout') {
      kind = 'logout'; uid = authorization?.split(':')[1]; result = new Response(null, { status: 204 });
    } else if (url.pathname === '/rest/v1/words') {
      kind = 'words'; uid = authorization?.split(':')[1];
      if (url.searchParams.get('user_id') !== `eq.${uid}`) throw new Error('Synthetic data request owner mismatch');
      result = json([{ id: `word-${uid}`, user_id: uid }]);
    } else throw new Error('Unexpected synthetic endpoint');
    calls.push({ kind, uid, authorization, scope: url.searchParams.get('scope') });
    const gate = gates.get(`${kind}:${uid}`)?.shift();
    if (gate) { gate.reached.resolve(); return gate.response.promise; }
    return result;
  };
  return { calls, hold, transport };
}

// A deterministic exclusive-lock model. Native runs can leave this unset and
// exercise the installed SDK's real navigator.locks implementation instead.
export function controlledLocks() {
  const tails = new Map(), gates = new Map();
  return {
    hold(namespace) {
      const gate = { reached: deferred(), release: deferred() };
      gates.set(`lock:${namespace}`, gate); return gate;
    },
    lock(name, _timeout, fn) {
      const job = (tails.get(name) ?? Promise.resolve()).then(async () => {
        const gate = gates.get(name);
        if (gate) { gates.delete(name); gate.reached.resolve(); await gate.release.promise; }
        return fn();
      });
      tails.set(name, job.catch(() => {}));
      return job;
    },
  };
}

export function assert(value, message = 'Assertion failed') { if (!value) throw new Error(message); }
export function equal(actual, expected, message = 'Exact equality failed') {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}
export async function rejects(fn, pattern = /./) {
  let caught;
  try { await fn(); } catch (error) { caught = error; }
  assert(caught && pattern.test(caught.message), 'Expected rejection was not observed');
}
