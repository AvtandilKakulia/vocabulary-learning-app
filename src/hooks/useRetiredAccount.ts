import { useCallback, useSyncExternalStore } from 'react';
import { recoveryStore } from '../lib/recoveryStorage';

export function useRetiredAccount(uid: string | undefined): boolean {
  const subscribe = useCallback((changed: () => void) => uid ? recoveryStore.subscribe(uid, changed) : () => {}, [uid]);
  const snapshot = useCallback(() => !!uid && recoveryStore.state(uid) === 'retired', [uid]);
  return useSyncExternalStore(subscribe, snapshot);
}
