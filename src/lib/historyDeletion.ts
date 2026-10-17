// Share the in-flight boundary across History remounts in this browser runtime.
// A departed view stops its batches, but its already-sent request must settle
// before another view for the same account can start deleting.
interface DeletionState { busy: boolean; version: number }
const idle: DeletionState = { busy: false, version: 0 };
const accounts = new Map<string, DeletionState>();
const listeners = new Set<() => void>();

export const getHistoryDeletionState = (userId?: string): DeletionState =>
  userId ? accounts.get(userId) ?? idle : idle;

export function subscribeHistoryDeletion(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function beginHistoryDeletion(userId: string): ((refresh?: boolean) => void) | null {
  const previous = getHistoryDeletionState(userId);
  if (previous.busy) return null;
  const current = { busy: true, version: previous.version };
  accounts.set(userId, current);
  listeners.forEach(listener => listener());
  return (refresh = true) => {
    if (accounts.get(userId) !== current) return;
    // Bulk workflows always invalidate reads, including failed/uncertain ones.
    // Single-delete errors retain their existing record/confirmation behavior.
    accounts.set(userId, { busy: false, version: current.version + (refresh ? 1 : 0) });
    listeners.forEach(listener => listener());
  };
}
