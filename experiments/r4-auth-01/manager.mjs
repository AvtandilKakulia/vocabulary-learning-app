// Compatibility fixture, NOT the production manager proposed by R4-SEC-12.
// Reuse unchanged publication/activation logic; inject the exact installed SDK.
import { GenerationManager } from '../r4-sec-11/manager.mjs';
import { RetiredWrite } from '../r4-sec-11/storage.mjs';
export class CompatibilityManager extends GenerationManager {
  constructor(store, options) { super(store, options); this.createClient = options.createClient; }
  attach(handle, uid = null) {
    if (this.clients.has(handle.id)) return this.clients.get(handle.id);
    const storage = this.store.adapter(handle, () => this.blockedHandle(handle));
    const sdkStorage = {
      getItem: key => storage.getItem(key), removeItem: key => storage.removeItem(key),
      setItem: async (key, value) => {
        try { await storage.setItem(key, value); }
        catch (error) {
          // Same narrow retired-write boundary as SEC-11. Raw throwing adapters
          // and genuine persistence failures are tested separately; never swallow them.
          if (!(error instanceof RetiredWrite)) throw error;
          this.discardedWrites++;
        }
      },
    };
    const client = this.createClient('https://generation-poc.invalid', 'synthetic-public-key', {
      auth: { storage: sdkStorage, storageKey: handle.namespace, persistSession: true,
        autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: this.transport },
    });
    const entry = { handle: Object.freeze({ ...handle }), uid, client, storage, subscription: null };
    this.clients.set(handle.id, entry);
    entry.subscription = client.auth.onAuthStateChange(event => {
      this.events.push({ generation: handle.id, event }); this.signal();
    }).data.subscription;
    return entry;
  }
  async retire(entry, { account = false } = {}) {
    if (!entry.uid) throw new Error('Cannot retire an unbound operation');
    this.blocked.add(entry.handle.id);
    if (account) this.retiredUids.add(entry.uid);
    this.signalSequence++;
    if (this.view?.id === entry.handle.id || (account && this.view?.uid === entry.uid)) { this.view = null; this.dataView = null; }
    // No SDK await before durable denial. This fixture ordering is explicit;
    // the old PoC remains unchanged and no application implementation is added.
    if (account) await this.store.confirmedDeletion(entry.handle, entry.uid);
    else await this.store.retireGeneration(entry.handle, entry.uid);
    await this.synchronize(); this.notify();
    await entry.client.auth.stopAutoRefresh();
  }
  async close() {
    for (const entry of this.clients.values()) {
      entry.subscription.unsubscribe();
      if (typeof entry.client.auth.dispose === 'function') await entry.client.auth.dispose();
      else await entry.client.auth.stopAutoRefresh();
    }
    await this.settled();
  }
}
