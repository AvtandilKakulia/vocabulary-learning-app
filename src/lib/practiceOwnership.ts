import { recoveryStore } from './recoveryStorage';

// Web Locks are the exclusion mechanism. Messages only request a cooperative
// handoff; they never grant ownership, and no localStorage CAS/lease is assumed.
export const practiceLockName = (userId: string) => `vocab:practice:editor:${encodeURIComponent(userId)}`;
export const practiceSaveLockName = (userId: string, resultId: string) =>
  `vocab:practice:save:${encodeURIComponent(userId)}:${resultId}`;

export interface PracticeWriteAccess {
  readonly userId: string;
  canWrite(): boolean;
}
export interface PracticeOwner extends PracticeWriteAccess {
  release(): void;
  finishHandoff(): void;
  cancelHandoff(): void;
}
export type PracticeOwnershipState =
  | { status: 'checking' | 'passive' | 'unavailable' }
  | { status: 'waiting'; cancel(): void }
  | { status: 'active'; owner: PracticeOwner; handoffRequested: boolean };

export function ownsPractice(access: PracticeWriteAccess | undefined, userId: string) {
  return access?.userId === userId && recoveryStore.state(userId) !== 'retired' && access.canWrite();
}

// StrictMode can start a replacement effect before the browser has delivered
// the cancelled initial lock callback. Await our own cleanup, not another tab.
const localReleases = new Map<string, Promise<unknown>>();

export function coordinatePractice(userId: string, changed: (state: PracticeOwnershipState) => void) {
  let disposed = false;
  let generation = 0;
  let pending: AbortController | undefined;
  let owner: PracticeOwner | undefined;
  let ownerToken: string | undefined;
  let waiting = false;
  let waitingId: string | undefined;
  let handoffRequested = false;
  const handoffRequests = new Set<string>();
  let channel: BroadcastChannel | undefined;
  let requestDone: Promise<unknown> = Promise.resolve();
  const locks = navigator.locks;
  const emit = (state: PracticeOwnershipState) => { if (!disposed) changed(state); };
  const post = (message: object) => { try { channel?.postMessage(message); } catch { /* Closing the other tab remains safe. */ } };
  const withdraw = () => {
    if (waitingId) post({ type: 'cancel', requestId: waitingId });
    waitingId = undefined;
  };
  const cancel = (request = generation) => {
    // Acquisition is the commit point, independent of React rendering. A stale
    // waiting button must never hide an editor whose lock has already been granted.
    if (disposed || request !== generation || owner?.canWrite() || !waiting || !pending) return;
    generation += 1;
    pending.abort();
    pending = undefined;
    waiting = false;
    withdraw();
    emit({ status: 'passive' });
  };

  try {
    channel = new BroadcastChannel(practiceLockName(userId));
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!data || typeof data !== 'object' || disposed) return;
      const message = data as { type?: string; token?: string; requestId?: string };
      if (message.type === 'probe' && owner?.canWrite()) post({ type: 'owner', token: ownerToken });
      if (message.type === 'owner' && waiting && typeof message.token === 'string') {
        post({ type: 'yield', token: message.token, requestId: waitingId });
      }
      if (message.type === 'yield' && message.token === ownerToken && owner?.canWrite() && typeof message.requestId === 'string') {
        handoffRequests.add(message.requestId);
        if (!handoffRequested) {
          handoffRequested = true;
          // React checkpoints before finishHandoff rechecks the live requests.
          emit({ status: 'active', owner, handoffRequested: true });
        }
      }
      if (message.type === 'cancel' && typeof message.requestId === 'string' && handoffRequests.delete(message.requestId) &&
        handoffRequests.size === 0 && owner?.canWrite()) {
        handoffRequested = false;
        emit({ status: 'active', owner, handoffRequested: false });
      }
    };
  } catch { /* Without messaging, Continue waits for the owner to close/leave. */ }

  const acquire = (wait: boolean) => {
    if (disposed || recoveryStore.state(userId) === 'retired' || owner?.canWrite() || pending) return;
    if (!locks?.request) { emit({ status: 'unavailable' }); return; }
    const request = ++generation;
    const controller = new AbortController();
    pending = controller;
    waiting = wait;
    waitingId = wait ? crypto.randomUUID() : undefined;
    emit(wait ? { status: 'waiting', cancel: () => cancel(request) } : { status: 'checking' });
    try {
      const launch = () => locks.request(practiceLockName(userId), wait
        ? { mode: 'exclusive', signal: controller.signal }
        : { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (disposed || request !== generation || recoveryStore.state(userId) === 'retired') return;
        pending = undefined;
        waiting = false;
        waitingId = undefined;
        if (!lock) { emit({ status: 'passive' }); return; }
        let held = true;
        let unlock!: () => void;
        const released = new Promise<void>(resolve => { unlock = resolve; });
        const acquired: PracticeOwner = {
          userId,
          canWrite: () => held && !disposed && recoveryStore.state(userId) !== 'retired',
          finishHandoff: () => {
            // Cancellation may arrive while React prepares the checkpoint.
            // A delayed completion must not release an otherwise usable editor.
            if (acquired.canWrite() && handoffRequests.size > 0) acquired.release();
          },
          cancelHandoff: () => {
            if (!acquired.canWrite()) return;
            handoffRequests.clear();
            handoffRequested = false;
            emit({ status: 'active', owner: acquired, handoffRequested: false });
          },
          release: () => {
            if (!held) return;
            held = false; // Revoke synchronously, before React unmounts or the lock is released.
            owner = undefined;
            ownerToken = undefined;
            handoffRequested = false;
            handoffRequests.clear();
            unlock();
            emit({ status: 'passive' });
          },
        };
        owner = acquired;
        ownerToken = crypto.randomUUID();
        emit({ status: 'active', owner: acquired, handoffRequested: false });
        post({ type: 'owner', token: ownerToken });
        await released;
      });
      requestDone = (localReleases.get(userId) ?? Promise.resolve()).then(() => {
        if (disposed || request !== generation) return;
        return launch();
      }).catch(error => {
        if (disposed || request !== generation) return;
        pending = undefined;
        waiting = false;
        withdraw();
        if (error?.name !== 'AbortError') emit({ status: 'unavailable' });
      });
      if (wait) post({ type: 'probe' });
    } catch {
      pending = undefined;
      waiting = false;
      withdraw();
      emit({ status: 'unavailable' });
    }
  };

  acquire(false);
  return {
    continueHere: () => acquire(true),
    cancel: () => cancel(),
    stop: () => {
      disposed = true;
      generation += 1;
      pending?.abort();
      withdraw();
      owner?.release();
      channel?.close();
      const released = requestDone;
      localReleases.set(userId, released);
      void released.finally(() => { if (localReleases.get(userId) === released) localReleases.delete(userId); });
    },
  };
}

// An older History response can clean up only under an editor lock, and only
// when its exact checkpoint still exists. Never wait behind a new active editor.
export async function withAvailablePracticeAccess(userId: string, action: (access: PracticeWriteAccess) => void) {
  if (!navigator.locks?.request) return;
  try {
    await navigator.locks.request(practiceLockName(userId), { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock || recoveryStore.state(userId) === 'retired') return;
      let held = true;
      try { action({ userId, canWrite: () => held }); } finally { held = false; }
    });
  } catch { /* Keep the recoverable checkpoint if access is unavailable. */ }
}
