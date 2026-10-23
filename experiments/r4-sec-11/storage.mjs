// EXPERIMENT ONLY. Both engines expose the same short, synchronous transaction.
export const emptyState = () => ({ schema: 1, selection: 0, active: null, generations: {}, retiredUids: [] });
export const copy = value => structuredClone(value);
export class RetiredWrite extends Error {}
function mutate(state, fn) {
  if (state.schema !== 1) throw new Error('Unsupported experiment schema');
  const result = fn(state);
  if (result && typeof result.then === 'function') throw new Error('Network/async work inside transaction is forbidden');
  return copy(result);
}

// Deterministic model, NOT a browser durability implementation.
export function modelEngine() {
  let state = emptyState(), tail = Promise.resolve();
  const faults = { deny: false, abortNext: false };
  return {
    category: 'deterministic transactional model', faults,
    transact(fn) {
      const job = tail.then(() => {
        if (faults.deny) throw new Error('Transaction denied');
        const candidate = copy(state), result = mutate(candidate, fn);
        if (faults.abortNext) { faults.abortNext = false; throw new Error('Injected transaction abort'); }
        state = candidate;
        return result;
      });
      tail = job.catch(() => {});
      return job;
    },
    close() {},
  };
}

// The entire small PoC state is one record. This intentionally favors a simple
// serializable boundary over scalability; a production schema needs its own review.
export async function indexedEngine(name) {
  if (!name.startsWith('r4-sec-11-')) throw new Error('Experiment database names only');
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Experiment upgrade blocked'));
  });
  db.onversionchange = () => db.close();
  const faults = { deny: false, abortNext: false };
  return {
    category: 'native IndexedDB', faults,
    transact(fn) {
      if (faults.deny) return Promise.reject(new Error('Transaction denied'));
      return new Promise((resolve, reject) => {
        let result, failure;
        const tx = db.transaction('state', 'readwrite');
        const store = tx.objectStore('state');
        tx.oncomplete = () => resolve(result); // Never report success before commit.
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('Transaction aborted'));
        tx.onerror = () => {}; // onabort owns rejection; no errors are suppressed.
        const request = store.get('root');
        request.onsuccess = () => {
          try {
            const state = request.result ?? emptyState();
            result = mutate(state, fn); // No await, network or UI callback in this transaction.
            store.put(state, 'root');
            if (faults.abortNext) {
              faults.abortNext = false;
              failure = new Error('Injected transaction abort');
              tx.abort();
            }
          } catch (error) { failure = error; tx.abort(); }
        };
      });
    },
    close() { db.close(); },
  };
}

const sessionUid = raw => {
  const session = JSON.parse(raw);
  if (typeof session?.user?.id !== 'string' || !session.user.id || typeof session.access_token !== 'string') {
    throw new Error('Invalid session envelope');
  }
  return session.user.id;
};
function generation(state, handle) {
  const g = state.generations[handle.id];
  if (!g || g.namespace !== handle.namespace) throw new Error('Invalid generation capability');
  return g;
}
function live(state, handle) {
  const g = generation(state, handle);
  if (g.retired || state.retiredUids.includes(g.uid ?? g.candidateUid)) throw new RetiredWrite('Retired generation');
  return g;
}
function retire(state, g) {
  g.retired = true;
  g.values = {}; // Our own compartment; opaque SDK keys are never guessed/deleted globally.
  if (state.active === g.id) { state.active = null; state.selection++; }
}

export class GenerationStore {
  constructor(engine) { this.engine = engine; }
  snapshot() { return this.engine.transact(state => state); }
  create(id = crypto.randomUUID()) {
    return this.engine.transact(state => {
      if (!/^[a-zA-Z0-9-]+$/.test(id) || Object.hasOwn(state.generations, id)) throw new Error('Invalid/reused generation ID');
      const namespace = `r4-sec-11:auth:${id}`;
      state.generations[id] = { id, namespace, uid: null, candidateUid: null, retired: false, values: {} };
      return { id, namespace, expectedSelection: state.selection };
    });
  }
  adapter(handle, blocked = () => false) {
    const validKey = key => { if (typeof key !== 'string' || !key) throw new Error('Invalid opaque storage key'); };
    return {
      getItem: key => {
        validKey(key);
        if (blocked()) return Promise.resolve(null);
        return this.engine.transact(state => {
          const g = generation(state, handle);
          if (g.retired || state.retiredUids.includes(g.uid ?? g.candidateUid)) return null;
          return Object.hasOwn(g.values, key) ? g.values[key] : null;
        });
      },
      setItem: (key, value) => {
        validKey(key);
        if (blocked()) return Promise.reject(new RetiredWrite('Locally retired generation'));
        return this.engine.transact(state => {
          const g = live(state, handle);
          if (typeof value !== 'string') throw new Error('String storage values only');
          if (key === handle.namespace) {
            const uid = sessionUid(value); // Ownership consistency, NOT server authorization.
            if (state.retiredUids.includes(uid)) throw new RetiredWrite('Retired account');
            if ((g.uid ?? g.candidateUid) && (g.uid ?? g.candidateUid) !== uid) throw new Error('Generation cannot change account');
            g.candidateUid = uid;
          }
          Object.defineProperty(g.values, key, { value, enumerable: true, configurable: true, writable: true });
        });
      },
      removeItem: key => {
        validKey(key);
        return this.engine.transact(state => { delete generation(state, handle).values[key]; });
      },
    };
  }
  bind(handle, uid) {
    return this.engine.transact(state => {
      const g = generation(state, handle);
      if (g.retired || state.retiredUids.includes(uid)) { retire(state, g); return false; }
      if (!uid || g.candidateUid !== uid || (g.uid && g.uid !== uid)) throw new Error('Session owner mismatch');
      if (sessionUid(g.values[g.namespace]) !== uid) throw new Error('Stored owner mismatch');
      g.uid = uid;
      return true;
    });
  }
  activate(handle) {
    return this.engine.transact(state => {
      const g = live(state, handle);
      if (!g.uid || !g.values[g.namespace]) throw new Error('Unbound generation');
      if (state.selection !== handle.expectedSelection) throw new Error('Stale activation intent');
      state.active = g.id;
      state.selection++;
      return state.selection;
    });
  }
  retireGeneration(handle, uid) {
    return this.engine.transact(state => {
      const g = generation(state, handle);
      if (g.uid !== uid) throw new Error('Retirement owner mismatch');
      retire(state, g);
    });
  }
  confirmedDeletion(handle, uid) {
    return this.engine.transact(state => {
      if (generation(state, handle).uid !== uid) throw new Error('Deletion owner mismatch');
      if (!state.retiredUids.includes(uid)) state.retiredUids.push(uid);
      for (const g of Object.values(state.generations)) {
        if ((g.uid ?? g.candidateUid) === uid) retire(state, g);
      }
    });
  }
  current(handle) {
    return this.engine.transact(state => {
      const g = live(state, handle);
      if (state.active !== g.id || !g.uid) throw new Error('Obsolete generation');
      const raw = g.values[g.namespace];
      if (!raw || sessionUid(raw) !== g.uid) throw new Error('Missing current session');
      return { id: g.id, uid: g.uid, selection: state.selection, raw };
    });
  }
}
