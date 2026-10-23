import { createClient } from '@supabase/supabase-js';
import { RetiredWrite } from './storage.mjs';

// A prototype capability boundary, not a production AuthProvider replacement.
export class GenerationManager {
  constructor(store, { transport, lock, notify = () => {} } = {}) {
    if (!transport) throw new Error('Injected synthetic transport required');
    this.store = store;
    this.transport = transport;
    this.lock = lock;
    this.notify = notify;
    this.clients = new Map();
    this.blocked = new Set();
    this.retiredUids = new Set();
    this.signalSequence = 0;
    this.view = null;
    this.dataView = null;
    this.signals = [];
    this.errors = [];
    this.events = []; // Diagnostic boundaries only; no session/token payloads.
    this.discardedWrites = 0;
  }
  blockedHandle(handle) {
    const entry = this.clients.get(handle.id);
    return this.blocked.has(handle.id) || (entry?.uid && this.retiredUids.has(entry.uid));
  }
  attach(handle, uid = null) {
    if (this.clients.has(handle.id)) return this.clients.get(handle.id);
    const storage = this.store.adapter(handle, () => this.blockedHandle(handle));
    // auth-js 2.83's refresh deferred rejects without a consumer if a storage
    // setter throws. A known retired write is deliberately discarded at this
    // SDK boundary; real storage errors still fail. SDK success is not admission
    // or activation: bind/current and the authoritative snapshot decide those.
    const sdkStorage = { ...storage, setItem: async (key, value) => {
      try { await storage.setItem(key, value); }
      catch (error) { if (!(error instanceof RetiredWrite)) throw error; this.discardedWrites++; }
    } };
    const client = createClient('https://generation-poc.invalid', 'synthetic-public-key', {
      auth: { storage: sdkStorage, storageKey: handle.namespace, persistSession: true, autoRefreshToken: false,
        detectSessionInUrl: false, ...(this.lock ? { lock: this.lock } : {}) },
      global: { fetch: this.transport },
    });
    const entry = { handle: Object.freeze({ ...handle }), uid, client, storage, subscription: null };
    this.clients.set(handle.id, entry);
    entry.subscription = client.auth.onAuthStateChange(event => {
      // No SDK call or awaited operation in an Auth listener. Event payloads are
      // never authority for activation, removal or UI identity.
      this.events.push({ generation: handle.id, event });
      this.signal();
    }).data.subscription;
    return entry;
  }
  signal() {
    const pending = this.synchronize().catch(error => { this.errors.push(error.message); });
    this.signals.push(pending);
  }
  async settled() {
    while (this.signals.length) await Promise.all(this.signals.splice(0));
  }
  async synchronize() {
    const sequence = ++this.signalSequence;
    try {
      const state = await this.store.snapshot();
      if (sequence !== this.signalSequence) return;
      const g = state.active && state.generations[state.active];
      const usable = g && !g.retired && !state.retiredUids.includes(g.uid)
        && !this.blocked.has(g.id) && !this.retiredUids.has(g.uid) && g.values[g.namespace];
      this.view = usable ? { id: g.id, uid: g.uid, selection: state.selection } : null;
      if (this.dataView && (this.dataView.id !== this.view?.id || this.dataView.selection !== this.view?.selection)) this.dataView = null;
    } catch (error) {
      if (sequence === this.signalSequence) { this.view = null; this.dataView = null; }
      throw error;
    }
  }
  async begin() {
    const handle = await this.store.create();
    const entry = this.attach(handle);
    await entry.client.auth.initialize();
    return entry;
  }
  async signIn(entry, uid) {
    const result = await entry.client.auth.signInWithPassword({ email: `${uid}@poc.invalid`, password: 'synthetic-only' });
    if (result.error) throw result.error;
    const returnedUid = result.data.user.id;
    if (!(await this.store.bind(entry.handle, returnedUid))) throw new Error('Retired sign-in result');
    entry.uid = returnedUid;
    await this.store.activate(entry.handle); // Captured start-intent version, never refreshed on completion.
    await this.synchronize();
    this.notify();
    return entry;
  }
  async restore() {
    await this.synchronize();
    if (!this.view) return null;
    const selected = this.view;
    const state = await this.store.snapshot();
    if (state.active !== selected.id || state.selection !== selected.selection) { await this.synchronize(); return null; }
    const g = state.generations[selected.id];
    const entry = this.attach({ id: g.id, namespace: g.namespace, expectedSelection: -1 }, g.uid);
    await entry.client.auth.initialize();
    await this.synchronize(); // Reload never re-activates a saved generation.
    return this.view?.id === entry.handle.id ? entry : null;
  }
  async retire(entry, { account = false } = {}) {
    if (!entry.uid) throw new Error('Cannot retire an unbound operation');
    this.blocked.add(entry.handle.id); // Fail closed in this manager even if storage fails.
    if (account) this.retiredUids.add(entry.uid);
    this.signalSequence++;
    if (this.view?.id === entry.handle.id || (account && this.view?.uid === entry.uid)) { this.view = null; this.dataView = null; }
    await entry.client.auth.stopAutoRefresh(); // Does not claim to cancel pending work.
    if (account) await this.store.confirmedDeletion(entry.handle, entry.uid);
    else await this.store.retireGeneration(entry.handle, entry.uid);
    await this.synchronize();
    this.notify(); // Signal only; peers re-read the transactionally committed state.
  }
  async words(entry) {
    if (this.blockedHandle(entry.handle)) throw new Error('Locally retired generation');
    const start = await this.store.current(entry.handle);
    const stillSelected = () => !this.blockedHandle(entry.handle)
      && this.view?.id === start.id && this.view.selection === start.selection;
    if (!stillSelected()) throw new Error('Obsolete generation');
    const session = JSON.parse(start.raw);
    const result = await entry.client.from('words').select('*').eq('user_id', start.uid)
      .setHeader('Authorization', `Bearer ${session.access_token}`);
    if (result.error) throw result.error;
    try {
      const now = await this.store.current(entry.handle);
      // The IDB callback itself may arrive after a newer local UI selection.
      // Check both the durable snapshot and the current synchronous view.
      if (!stillSelected() || now.selection !== start.selection) return { discarded: true };
      this.dataView = { id: start.id, selection: start.selection, rows: result.data };
      return { discarded: false, rows: result.data };
    } catch { return { discarded: true }; }
  }
  async close() {
    for (const entry of this.clients.values()) {
      entry.subscription.unsubscribe();
      await entry.client.auth.stopAutoRefresh();
    }
    await this.settled();
    // auth-js 2.83 has no public dispose. Namespace isolation contains its
    // remaining SDK-internal listeners/channels; full reclamation needs review.
  }
}
