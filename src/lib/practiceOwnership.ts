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
  cancelHandoff(): void;
}
export type PracticeOwnershipState =
  | { status: 'checking' | 'passive' | 'waiting' | 'unavailable' }
  | { status: 'active'; owner: PracticeOwner; handoffRequested: boolean };

export function ownsPractice(access: PracticeWriteAccess | undefined, userId: string) {
  return access?.userId === userId && access.canWrite();
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
  let handoffRequested = false;
  let channel: BroadcastChannel | undefined;
  let requestDone: Promise<unknown> = Promise.resolve();
  const locks = navigator.locks;
  const emit = (state: PracticeOwnershipState) => { if (!disposed) changed(state); };
  const post = (message: object) => { try { channel?.postMessage(message); } catch { /* Closing the other tab remains safe. */ } };

  try {
    channel = new BroadcastChannel(practiceLockName(userId));
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!data || typeof data !== 'object' || disposed) return;
      const message = data as { type?: string; token?: string };
      if (message.type === 'probe' && owner?.canWrite()) post({ type: 'owner', token: ownerToken });
      if (message.type === 'owner' && waiting && typeof message.token === 'string') {
        post({ type: 'yield', token: message.token });
      }
      if (message.type === 'yield' && message.token === ownerToken && owner?.canWrite() && !handoffRequested) {
        handoffRequested = true;
        // React commits/persists its latest state before calling owner.release().
        emit({ status: 'active', owner, handoffRequested: true });
      }
    };
  } catch { /* Without messaging, Continue waits for the owner to close/leave. */ }

  const acquire = (wait: boolean) => {
    if (disposed || owner?.canWrite() || pending) return;
    if (!locks?.request) { emit({ status: 'unavailable' }); return; }
    const request = ++generation;
    const controller = new AbortController();
    pending = controller;
    waiting = wait;
    emit({ status: wait ? 'waiting' : 'checking' });
    try {
      const launch = () => locks.request(practiceLockName(userId), wait
        ? { mode: 'exclusive', signal: controller.signal }
        : { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (disposed || request !== generation) return;
        pending = undefined;
        waiting = false;
        if (!lock) { emit({ status: 'passive' }); return; }
        let held = true;
        let unlock!: () => void;
        const released = new Promise<void>(resolve => { unlock = resolve; });
        const acquired: PracticeOwner = {
          userId,
          canWrite: () => held && !disposed,
          cancelHandoff: () => {
            handoffRequested = false;
            emit({ status: 'active', owner: acquired, handoffRequested: false });
          },
          release: () => {
            if (!held) return;
            held = false; // Revoke synchronously, before React unmounts or the lock is released.
            owner = undefined;
            ownerToken = undefined;
            handoffRequested = false;
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
        if (error?.name !== 'AbortError') emit({ status: 'unavailable' });
      });
      if (wait) post({ type: 'probe' });
    } catch {
      pending = undefined;
      waiting = false;
      emit({ status: 'unavailable' });
    }
  };

  acquire(false);
  return {
    continueHere: () => acquire(true),
    cancel: () => {
      generation += 1;
      pending?.abort();
      pending = undefined;
      waiting = false;
      emit({ status: 'passive' });
    },
    stop: () => {
      disposed = true;
      generation += 1;
      pending?.abort();
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
      if (!lock) return;
      let held = true;
      try { action({ userId, canWrite: () => held }); } finally { held = false; }
    });
  } catch { /* Keep the recoverable checkpoint if access is unavailable. */ }
}
