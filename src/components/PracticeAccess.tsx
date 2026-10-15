import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { coordinatePractice, type PracticeOwner, type PracticeOwnershipState } from '../lib/practiceOwnership';
import { legacyPracticeKey, practiceSessionKey, readPracticeSession } from '../lib/practiceSessions';

export function PracticeAccess({ userId, children }: {
  userId: string;
  children: (owner: PracticeOwner, handoffRequested: boolean) => ReactNode;
}) {
  const [state, setState] = useState<PracticeOwnershipState>({ status: 'checking' });
  const [confirm, setConfirm] = useState(false);
  const [snapshot, setSnapshot] = useState(() => readPracticeSession(userId).session);
  const coordination = useRef<ReturnType<typeof coordinatePractice>>();
  useLayoutEffect(() => {
    const current = coordinatePractice(userId, next => {
      if (next.status === 'active' && next.handoffRequested) {
        // A channel message is outside React. Commit any pending answer update
        // before the editor's handoff effect checkpoints and releases ownership.
        flushSync(() => setState(next));
      } else setState(next);
    });
    coordination.current = current;
    return () => current.stop();
  }, [userId]);

  useEffect(() => {
    if (state.status === 'active') return;
    const refresh = () => setSnapshot(readPracticeSession(userId).session);
    const onStorage = (event: StorageEvent) => {
      if (event.key === practiceSessionKey(userId) || event.key === legacyPracticeKey || event.key === null) refresh();
    };
    refresh();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [state.status, userId]);

  if (state.status === 'active') return children(state.owner, state.handoffRequested);
  if (state.status === 'checking') return <p role="status" className="p-8 text-center">Loading your words...</p>;
  return <section className="max-w-2xl mx-auto p-8 space-y-4 text-gray-900 dark:text-gray-100" aria-label="Practice access">
    <h1 className="text-2xl font-bold">Vocabulary Practice</h1>
    <p role="status">{state.status === 'unavailable'
      ? 'This browser cannot safely coordinate Practice across tabs. Practice editing is unavailable. Use an up-to-date browser with Web Locks support over HTTPS.'
      : state.status === 'waiting'
        ? 'Waiting for the other tab to release Practice. If it cannot respond, close it or leave Practice there, then keep this tab open.'
        : 'Practice is active in another tab, or this tab has released it. Continue here to restore the latest saved progress.'}</p>
    {snapshot && <p>Last saved progress: {snapshot.correctCount} / {snapshot.totalAttempts} correct{snapshot.completed ? ' — completed' : ''}.</p>}
    {state.status === 'passive' && <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" onClick={() => setConfirm(true)}>Continue in this tab</button>}
    {state.status === 'waiting' && <button className="px-4 py-2 rounded-lg border" onClick={() => coordination.current?.cancel()}>Cancel request</button>}
    {confirm && <div role="alertdialog" aria-modal="true" aria-labelledby="practice-takeover-title" className="border rounded-xl p-6 space-y-4">
      <h2 id="practice-takeover-title" className="text-xl font-bold">Continue Practice here?</h2>
      <p>The other tab will stop editing before this tab restores the latest saved progress. Unchecked answer text in the other tab is not saved and will be lost. A pending History result remains recoverable.</p>
      <div className="flex gap-3">
        <button autoFocus className="px-4 py-2 rounded-lg border" onClick={() => setConfirm(false)}>Cancel</button>
        <button className="px-4 py-2 rounded-lg bg-blue-600 text-white" onClick={() => { setConfirm(false); coordination.current?.continueHere(); }}>Continue here</button>
      </div>
    </div>}
  </section>;
}
