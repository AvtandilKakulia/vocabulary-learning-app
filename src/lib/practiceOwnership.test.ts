import { afterEach, describe, expect, it, vi } from 'vitest';
import { coordinatePractice, practiceLockName, withAvailablePracticeAccess, type PracticeOwner, type PracticeOwnershipState } from './practiceOwnership';
import { legacyPracticeKey, persistPracticeSession, practiceSessionKey, readPracticeSession, removePracticeSession, type StoredPracticeSession } from './practiceSessions';

const participants: ReturnType<typeof coordinatePractice>[] = [];
function tab(userId = 'a') {
  let state: PracticeOwnershipState = { status: 'checking' };
  const controller = coordinatePractice(userId, next => { state = next; });
  participants.push(controller);
  return { controller, state: () => state, owner: () => {
    if (state.status !== 'active') throw new Error('Not active');
    return state.owner;
  } };
}
const active = (participant: ReturnType<typeof tab>) => vi.waitFor(() => expect(participant.state().status).toBe('active'));
const passive = (participant: ReturnType<typeof tab>) => vi.waitFor(() => expect(participant.state().status).toBe('passive'));
const snapshot = (userId = 'a'): StoredPracticeSession => ({ userId, queueIds: ['one', 'two'], orderMode: 'db-order',
  direction: 'en-to-geo', allowReguess: true, correctCount: 1, totalAttempts: 2, mistakes: [],
  attemptedWordIds: ['one'], unresolvedWordIds: ['one'], hasChecked: false });
afterEach(() => { participants.splice(0).forEach(item => item.stop()); });

describe('independent Practice ownership participants', () => {
  it('grants exactly one editor at simultaneous startup and performs no storage initialization', async () => {
    const raw = JSON.stringify(snapshot());
    localStorage.setItem(practiceSessionKey('a'), raw);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const a = tab();
    const b = tab();
    await active(a);
    await passive(b);
    expect(writes).not.toHaveBeenCalled();
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(raw);
  });

  it('only grants a requested takeover after the previous owner explicitly releases', async () => {
    const a = tab();
    const b = tab();
    await active(a);
    await passive(b);
    const stale = a.owner();
    b.controller.continueHere();
    await vi.waitFor(() => expect(a.state()).toMatchObject({ handoffRequested: true }));
    expect(b.state().status).toBe('waiting');
    persistPracticeSession(snapshot(), stale);
    stale.release();
    expect(stale.canWrite()).toBe(false);
    await active(b);
    const latest = { ...snapshot(), totalAttempts: 3, correctCount: 2 };
    expect(persistPracticeSession(latest, b.owner())).not.toBeNull();
    expect(persistPracticeSession(snapshot(), stale)).toBeNull();
    expect(removePracticeSession('a', stale)).toBe(false);
    expect(readPracticeSession('a').session).toEqual(latest);
  });

  it('ignores focus/visibility changes and unrelated handoff messages', async () => {
    const a = tab();
    const b = tab();
    await active(a);
    await passive(b);
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    const channel = new BroadcastChannel(practiceLockName('a'));
    channel.postMessage({ type: 'yield', token: 'old-or-unknown-owner' });
    await Promise.resolve();
    channel.close();
    expect(a.state()).toMatchObject({ status: 'active', handoffRequested: false });
    expect(b.state().status).toBe('passive');
  });

  it('releases on closure and reads the latest checkpoint on explicit reacquisition', async () => {
    const a = tab();
    const b = tab();
    await active(a);
    await passive(b);
    persistPracticeSession(snapshot(), a.owner());
    a.controller.stop();
    a.controller.stop();
    b.controller.continueHere();
    await active(b);
    expect(readPracticeSession('a', b.owner()).session).toEqual(snapshot());
  });

  it('does not activate a cancelled queued request or leave a lock after rapid StrictMode-like cleanup', async () => {
    tab().controller.stop();
    tab().controller.stop();
    const a = tab();
    await active(a);
    const b = tab();
    await passive(b);
    b.controller.continueHere();
    b.controller.cancel();
    a.controller.stop();
    await passive(b);
    const c = tab();
    await active(c);
    expect(b.state().status).toBe('passive');
  });

  it('supports independent account locks and rejects a wrong-account write permit', async () => {
    const a = tab('a');
    const b = tab('b');
    await active(a);
    await active(b);
    expect(persistPracticeSession(snapshot('a'), b.owner())).toBeNull();
    persistPracticeSession(snapshot('a'), a.owner());
    persistPracticeSession(snapshot('b'), b.owner());
    expect(removePracticeSession('a', b.owner())).toBe(false);
    expect(readPracticeSession('a').session).toEqual(snapshot('a'));
    expect(readPracticeSession('b').session).toEqual(snapshot('b'));
  });

  it('allows passive legacy reads without migrating or deleting their source', async () => {
    const raw = JSON.stringify(snapshot());
    localStorage.setItem(legacyPracticeKey, raw);
    expect(readPracticeSession('a').session).toEqual(snapshot());
    expect(localStorage.getItem(practiceSessionKey('a'))).toBeNull();
    expect(localStorage.getItem(legacyPracticeKey)).toBe(raw);
    const a = tab();
    await active(a);
    expect(readPracticeSession('a', a.owner()).session).toEqual(snapshot());
    expect(localStorage.getItem(legacyPracticeKey)).toBeNull();
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(raw);
  });

  it.each(['{bad json', JSON.stringify(snapshot('another-account'))])('refuses to replace incompatible stored data even with an owner: %s', async raw => {
    localStorage.setItem(practiceSessionKey('a'), raw);
    const a = tab();
    await active(a);
    expect(persistPracticeSession(snapshot(), a.owner())).toBeNull();
    expect(removePracticeSession('a', a.owner())).toBe(false);
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(raw);
  });

  it('never cleans an old response under another active editor or a newer exact copy', async () => {
    const a = tab();
    await active(a);
    const old = persistPracticeSession(snapshot(), a.owner())!;
    const cleanup = vi.fn();
    await withAvailablePracticeAccess('a', cleanup);
    expect(cleanup).not.toHaveBeenCalled();
    const newer = persistPracticeSession({ ...snapshot(), totalAttempts: 9 }, a.owner());
    a.controller.stop();
    await vi.waitFor(async () => expect((await navigator.locks.query()).held).toHaveLength(0));
    const remove = vi.fn();
    await withAvailablePracticeAccess('a', permit => {
      remove();
      expect(removePracticeSession('a', permit, old)).toBe(false);
    });
    expect(remove).toHaveBeenCalledOnce();
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(newer);
  });

  it('fails closed without Web Locks instead of claiming localStorage CAS safety', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    const a = tab();
    expect(a.state().status).toBe('unavailable');
    a.controller.continueHere();
    expect(a.state().status).toBe('unavailable');
    const action = vi.fn();
    await withAvailablePracticeAccess('a', action);
    expect(action).not.toHaveBeenCalled();
  });

  it('keeps exclusion without BroadcastChannel and continues only after the owner leaves', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const a = tab();
    const b = tab();
    await active(a);
    await passive(b);
    b.controller.continueHere();
    await Promise.resolve();
    expect(b.state().status).toBe('waiting');
    expect(a.state()).toMatchObject({ handoffRequested: false });
    a.controller.stop();
    await active(b);
  });

  it('handles a rejected browser lock request conservatively', async () => {
    vi.spyOn(navigator.locks, 'request').mockRejectedValue(new Error('blocked'));
    const a = tab();
    await vi.waitFor(() => expect(a.state().status).toBe('unavailable'));
  });

  it('revokes cleanup permits as soon as their synchronous lock callback returns', async () => {
    let stale: PracticeOwner | undefined;
    await withAvailablePracticeAccess('a', permit => { stale = permit as PracticeOwner; });
    expect(stale?.canWrite()).toBe(false);
    expect(persistPracticeSession(snapshot(), stale!)).toBeNull();
  });
});
