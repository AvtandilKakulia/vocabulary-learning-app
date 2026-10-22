// Only these namespaces contain app-owned Practice/Test recovery records.
export const legacyPracticeKey = 'vocab_practice_session_state_v2';
export const practiceSessionKey = (uid: string) => `${legacyPracticeKey}:${encodeURIComponent(uid)}`;
export const activeTestPrefix = (uid: string) => `vocab_active_test:${encodeURIComponent(uid)}:`;
export const pendingTestPrefix = (uid: string) => `vocab_pending_test:${encodeURIComponent(uid)}:`;
export const retirementKey = (uid: string) => `vocab_recovery_retired_v1:${encodeURIComponent(uid)}`;
export const ownsRecoveryKey = (uid: string, key: string) => key === practiceSessionKey(uid)
  || key.startsWith(activeTestPrefix(uid)) || key.startsWith(pendingTestPrefix(uid));

type RecoveryState = 'active' | 'retired' | 'unavailable';

// One instance per JS realm. The factory also permits isolated browser fixtures.
export function createRecoveryStore(storage = () => window.localStorage, events: EventTarget = window) {
  const retired = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const state = (uid: string): RecoveryState => {
    if (retired.has(uid)) return 'retired';
    try {
      const marker = storage().getItem(retirementKey(uid));
      if (marker === '1') { retired.add(uid); return 'retired'; }
      // An unknown marker format must not allow writes/recovery over it.
      return marker === null ? 'active' : 'unavailable';
    } catch { return 'unavailable'; }
  };
  return {
    state,
    retire(uid: string): boolean {
      retired.add(uid); // Synchronously stop this realm's writers even on quota/access failure.
      let durable = false;
      try {
        const target = storage();
        target.setItem(retirementKey(uid), '1');
        durable = target.getItem(retirementKey(uid)) === '1';
      } catch { /* Report failure; never forget the confirmed deletion in this realm. */ }
      for (const listener of listeners.get(uid) ?? []) listener();
      return durable;
    },
    subscribe(uid: string, listener: () => void): () => void {
      const subscribed = listeners.get(uid) ?? new Set();
      subscribed.add(listener);
      listeners.set(uid, subscribed);
      const refresh = () => { if (state(uid) === 'retired') listener(); };
      const onStorage = (event: Event) => {
        const change = event as StorageEvent;
        // The event payload is only a hint. Re-read our own exact marker;
        // never accept a message's UID/value as permission to erase data.
        if (change.key === retirementKey(uid) || change.key === null) refresh();
      };
      events.addEventListener('storage', onStorage);
      events.addEventListener('focus', refresh);
      events.addEventListener('pageshow', refresh);
      refresh(); // Cover a marker installed between render and subscription.
      return () => {
        subscribed.delete(listener);
        if (!subscribed.size) listeners.delete(uid);
        events.removeEventListener('storage', onStorage);
        events.removeEventListener('focus', refresh);
        events.removeEventListener('pageshow', refresh);
      };
    },
    write(uid: string, key: string, value: string): boolean {
      if (!ownsRecoveryKey(uid, key) || state(uid) !== 'active') return false;
      try {
        const target = storage();
        target.setItem(key, value);
        // Another tab may retire this UID between the check and setItem.
        // No localStorage CAS/transaction is assumed. Revoke this write too.
        if (state(uid) !== 'active') {
          if (state(uid) === 'retired') target.removeItem(key);
          return false;
        }
        return true;
      } catch { return false; }
    },
  };
}

export const recoveryStore = createRecoveryStore();
