import { legacyPracticeKey, ownsRecoveryKey, recoveryStore, retirementKey } from './recoveryStorage';
import { parsePracticeSession } from './practiceSessions';

export interface RecoveryErasure {
  durable: boolean;
  verified: boolean;
  legacyUnclassified: boolean;
}

// Called only with the immutable UID of a confirmed successful deletion RPC.
// Never wait for the long-lived Practice editor lock or replay a deletion RPC.
export async function eraseAccountRecovery(uid: string): Promise<RecoveryErasure> {
  const durable = recoveryStore.retire(uid);
  let verified = durable;
  let legacyUnclassified = false;
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key === null) verified = false;
      if (key && ownsRecoveryKey(uid, key)) keys.push(key);
    }
    for (const key of keys) {
      try { storage.removeItem(key); } catch { verified = false; }
    }
    try {
      const legacy = storage.getItem(legacyPracticeKey);
      if (legacy !== null) {
        const candidate: unknown = JSON.parse(legacy);
        const owner = candidate && typeof candidate === 'object' && 'userId' in candidate ? candidate.userId : null;
        if (typeof owner !== 'string' || !owner || !parsePracticeSession(legacy, owner)) {
          legacyUnclassified = true;
        } else if (owner === uid) {
          // App writers never create legacy records. Preserve a changed value.
          if (storage.getItem(legacyPracticeKey) !== legacy) verified = false;
          else storage.removeItem(legacyPracticeKey);
        }
      }
    } catch { legacyUnclassified = true; verified = false; }
    // Verification is a bounded observation, not a claim of atomic cross-tab erasure.
    const remaining = storage.length;
    for (let index = 0; index < remaining; index += 1) {
      const key = storage.key(index);
      if (key === null) verified = false;
      if (key && ownsRecoveryKey(uid, key)) verified = false;
    }
    const legacy = storage.getItem(legacyPracticeKey);
    if (legacy !== null && parsePracticeSession(legacy, uid)) verified = false;
    if (storage.getItem(retirementKey(uid)) !== '1') verified = false;
  } catch { verified = false; }
  return { durable, verified: verified && !legacyUnclassified, legacyUnclassified };
}
