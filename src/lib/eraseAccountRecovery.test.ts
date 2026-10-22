import { describe, expect, it, vi } from 'vitest';
import { eraseAccountRecovery } from './eraseAccountRecovery';
import { createRecoveryStore, legacyPracticeKey, practiceSessionKey, activeTestPrefix, pendingTestPrefix,
  retirementKey, recoveryStore } from './recoveryStorage';
import { persistPracticeSession, readPracticeSession, type StoredPracticeSession } from './practiceSessions';
import { activeTestKey, persistActiveTest, checkpointCompletedTest, readTestRecovery, type ActiveTestSession } from './activeTestSessions';
import { pendingTestKey, persistPendingTest, readPendingTests, type CompletedTestResult } from './pendingTestResults';
import { deferred, query, supabaseMock, type QueryResult } from '../test/mocks';
import { savePracticeResult } from './practiceSaves';
import { practiceSaveLockName } from './practiceOwnership';

const access = (userId: string) => ({ userId, canWrite: () => true });
const practice = (userId = 'a'): StoredPracticeSession => ({ userId, queueIds: ['word'], direction: 'en-to-geo',
  orderMode: 'db-order', allowReguess: true, correctCount: 0, totalAttempts: 0, mistakes: [] });
const result = (user_id = 'a'): CompletedTestResult => ({ id: crypto.randomUUID(), user_id, test_date: '2030-01-01T00:00:00.000Z',
  test_direction: 'en-to-geo', total_words: 1, correct_count: 1, mistakes: [] });
const active = (userId = 'a'): ActiveTestSession => ({ id: crypto.randomUUID(), userId, startedAt: '2030-01-01T00:00:00.000Z',
  direction: 'en-to-geo', inputType: 'text', wordCount: 1, customCount: '', currentQuestion: 0, draftAnswer: 'draft',
  questions: [{ id: 'word', english_word: 'word', georgian_definitions: ['meaning'], description: 'private description',
    userAnswer: '', isCorrect: false, options: [] }] });

describe('account-scoped recovery erasure', () => {
  it.each(['a', 'a:b /%☃'])('erases all exact scoped keys including malformed payloads for %s, preserving other bytes', async uid => {
    const owned = [practiceSessionKey(uid), `${activeTestPrefix(uid)}1`, `${activeTestPrefix(uid)}2`,
      `${pendingTestPrefix(uid)}1`, `${pendingTestPrefix(uid)}2`];
    for (const key of owned) localStorage.setItem(key, '{malformed private data');
    const kept = [practiceSessionKey(`${uid}b`), practiceSessionKey('b'), `${activeTestPrefix('b')}1`,
      `${pendingTestPrefix('b')}1`, `${activeTestPrefix(`${uid}:other`)}1`, `${pendingTestPrefix(`${uid}%`)}1`,
      `${practiceSessionKey(uid)}:unknown`, `vocab_active_test:${encodeURIComponent(uid)}`, 'sb-project-auth-token',
      'vocab-app-theme', 'unrelated'];
    kept.forEach((key, i) => localStorage.setItem(key, `unchanged bytes ${i}`));
    const bytes = kept.map(key => [key, localStorage.getItem(key)]);
    const clear = vi.spyOn(Storage.prototype, 'clear');
    expect(await eraseAccountRecovery(uid)).toEqual({ durable: true, verified: true, legacyUnclassified: false });
    owned.forEach(key => expect(localStorage.getItem(key)).toBeNull());
    expect(kept.map(key => [key, localStorage.getItem(key)])).toEqual(bytes);
    expect(localStorage.getItem(retirementKey(uid))).toBe('1');
    expect(clear).not.toHaveBeenCalled();
  });

  it('erases validated A legacy progress and is idempotent', async () => {
    localStorage.setItem(legacyPracticeKey, JSON.stringify(practice()));
    const first = await eraseAccountRecovery('a');
    expect(first.verified).toBe(true);
    expect(localStorage.getItem(legacyPracticeKey)).toBeNull();
    const bytes = { ...localStorage };
    expect(await eraseAccountRecovery('a')).toEqual(first);
    expect({ ...localStorage }).toEqual(bytes);
  });

  it.each([JSON.stringify(practice('b')), '{bad', JSON.stringify({ userId: 'a', queueIds: 42 }),
    JSON.stringify({ userId: 'a', queueIds: [], completedResult: result('b') })])('preserves foreign/unverifiable legacy: %s', async raw => {
    localStorage.setItem(legacyPracticeKey, raw);
    const erased = await eraseAccountRecovery('a');
    expect(localStorage.getItem(legacyPracticeKey)).toBe(raw);
    const foreign = raw === JSON.stringify(practice('b'));
    expect(erased.legacyUnclassified).toBe(!foreign);
    expect(erased.verified).toBe(foreign);
  });

  it('preserves a legacy copy replaced by B during cleanup', async () => {
    const a = JSON.stringify(practice()); const b = JSON.stringify(practice('b'));
    localStorage.setItem(legacyPracticeKey, a);
    const get = Storage.prototype.getItem; let reads = 0;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === legacyPracticeKey && ++reads === 2) localStorage.setItem(key, b);
      return get.call(this, key);
    });
    expect((await eraseAccountRecovery('a')).verified).toBe(false);
    expect(localStorage.getItem(legacyPracticeKey)).toBe(b);
  });

  it.each(['remove throws', 'remove silently fails', 'enumeration fails', 'enumeration incomplete', 'marker write fails', 'marker verification fails', 'storage unavailable'] as const)(
    'reports partial/unverified erasure when %s and keeps retirement in memory', async kind => {
      localStorage.setItem(practiceSessionKey('a'), 'A');
      localStorage.setItem(`${activeTestPrefix('a')}1`, 'A active');
      localStorage.setItem(practiceSessionKey('b'), 'B exact');
      const get = Storage.prototype.getItem; const remove = Storage.prototype.removeItem; const set = Storage.prototype.setItem;
      if (kind.startsWith('remove')) vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
        if (key === practiceSessionKey('a')) { if (kind === 'remove throws') throw new Error('blocked'); return; }
        remove.call(this, key);
      });
      if (kind === 'enumeration fails') vi.spyOn(Storage.prototype, 'key').mockImplementation(() => { throw new Error('blocked'); });
      if (kind === 'enumeration incomplete') vi.spyOn(Storage.prototype, 'key').mockReturnValue(null);
      if (kind === 'marker write fails') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === retirementKey('a')) throw new Error('quota');
        set.call(this, key, value);
      });
      if (kind === 'marker verification fails') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
        return key === retirementKey('a') ? null : get.call(this, key);
      });
      if (kind === 'storage unavailable') vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
      const erased = await eraseAccountRecovery('a');
      expect(erased.verified).toBe(false);
      expect(recoveryStore.state('a')).toBe('retired');
      expect(persistPracticeSession(practice(), access('a'))).toBeNull();
      vi.restoreAllMocks();
      expect(localStorage.getItem(practiceSessionKey('b'))).toBe('B exact');
      if (kind.startsWith('remove')) {
        expect(localStorage.getItem(`${activeTestPrefix('a')}1`)).toBeNull();
        expect(localStorage.getItem(practiceSessionKey('a'))).toBe('A');
      }
      expect((await eraseAccountRecovery('a')).verified).toBe(true);
    });

  it('preserves an unreadable legacy record and reports residual classification failure', async () => {
    localStorage.setItem(legacyPracticeKey, JSON.stringify(practice()));
    const get = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === legacyPracticeKey) throw new Error('blocked');
      return get.call(this, key);
    });
    expect(await eraseAccountRecovery('a')).toMatchObject({ verified: false, legacyUnclassified: true });
    expect(get.call(localStorage, legacyPracticeKey)).toBe(JSON.stringify(practice()));
  });

  it('blocks every stale writer and recovery reader, while B remains writable', async () => {
    const a = active(); const completed = result();
    await eraseAccountRecovery('a');
    expect(persistPracticeSession(practice(), access('a'))).toBeNull();
    expect(persistActiveTest(a)).toBe(false);
    expect(checkpointCompletedTest(completed)).toBe(false);
    expect(persistPendingTest(completed)).toBe(false);
    // A legacy/older client may leave bytes, but this client must never recover them.
    localStorage.setItem(practiceSessionKey('a'), JSON.stringify(practice()));
    expect(readPracticeSession('a', access('a')).session).toBeNull();
    expect(readTestRecovery('a').sessions).toEqual([]);
    expect(readPendingTests('a').results).toEqual([]);
    expect(persistPracticeSession(practice('b'), access('b'))).not.toBeNull();
    expect(persistActiveTest(active('b'))).toBe(true);
    expect(persistPendingTest(result('b'))).toBe(true);
  });

  it.each(['practice', 'active', 'completed', 'pending', 'legacy migration'] as const)(
    'revokes a %s write interleaved after deletion, before the storage event arrives', async kind => {
      const a = active(); const completed = result();
      if (kind === 'legacy migration') localStorage.setItem(legacyPracticeKey, JSON.stringify(practice()));
      const target = kind === 'practice' || kind === 'legacy migration' ? practiceSessionKey('a')
        : kind === 'active' ? activeTestKey('a', a.id) : kind === 'completed' ? activeTestKey('a', completed.id) : pendingTestKey(completed);
      const set = Storage.prototype.setItem;
      let deletion: Promise<unknown> | undefined;
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
        if (key === target && !deletion) deletion = eraseAccountRecovery('a');
        set.call(this, key, value); // Old tab's setItem resumes after the deletion sweep.
      });
      if (kind === 'practice') expect(persistPracticeSession(practice(), access('a'))).toBeNull();
      if (kind === 'active') expect(persistActiveTest(a)).toBe(false);
      if (kind === 'completed') expect(checkpointCompletedTest(completed)).toBe(false);
      if (kind === 'pending') expect(persistPendingTest(completed)).toBe(false);
      if (kind === 'legacy migration') expect(readPracticeSession('a', access('a')).session).toBeNull();
      await deletion;
      expect(deletion).toBeDefined();
      expect(localStorage.getItem(target)).toBeNull();
    });

  it('fresh browser realms obey the durable marker without a notification', async () => {
    await eraseAccountRecovery('a');
    const reload = createRecoveryStore();
    expect(reload.state('a')).toBe('retired');
    expect(reload.write('a', practiceSessionKey('a'), 'stale')).toBe(false);
    expect(reload.state('b')).toBe('active');
  });

  it('fails closed for an unknown retirement marker and a temporarily unreadable marker', () => {
    localStorage.setItem(retirementKey('a'), 'unknown version');
    expect(recoveryStore.state('a')).toBe('unavailable');
    expect(persistActiveTest(active())).toBe(false);
    expect(readTestRecovery('a').sessions).toEqual([]);
    expect(localStorage.getItem(retirementKey('a'))).toBe('unknown version');
    const get = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key === retirementKey('b')) throw new Error('blocked');
      return get.call(this, key);
    });
    expect(persistPracticeSession(practice('b'), access('b'))).toBeNull();
  });

  it('treats peer events as hints, rechecks storage, ignores B, and unsubscribes', async () => {
    const events = new EventTarget();
    const peer = createRecoveryStore(() => localStorage, events);
    const changed = vi.fn(); const stop = peer.subscribe('a', changed);
    events.dispatchEvent(new StorageEvent('storage', { key: retirementKey('a'), newValue: '1' }));
    expect(changed).not.toHaveBeenCalled();
    await eraseAccountRecovery('b');
    events.dispatchEvent(new StorageEvent('storage', { key: retirementKey('b'), newValue: '1' }));
    expect(changed).not.toHaveBeenCalled();
    await eraseAccountRecovery('a');
    events.dispatchEvent(new StorageEvent('storage', { key: retirementKey('a'), newValue: 'untrusted' }));
    expect(changed).toHaveBeenCalledOnce();
    expect(peer.write('a', practiceSessionKey('a'), 'old state')).toBe(false);
    stop(); events.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledOnce();
  });

  it.each(['success', 'failure', 'duplicate'] as const)('pending Practice save %s cannot resurrect erased data or start another lookup', async outcome => {
    const completed = result(); const state = { ...practice(), completed: true, completedResult: completed };
    const raw = persistPracticeSession(state, access('a'))!;
    localStorage.setItem(practiceSessionKey('b'), 'B exact');
    const pending = deferred<QueryResult>(); const insert = query(pending.promise);
    supabaseMock.from.mockReturnValue(insert);
    const save = savePracticeResult(completed, raw, access('a'));
    await vi.waitFor(() => expect(insert.insert).toHaveBeenCalledOnce());
    await eraseAccountRecovery('a');
    pending.resolve({ error: outcome === 'success' ? null : { message: 'late', code: outcome === 'duplicate' ? '23505' : '42501' } });
    expect((await save.done).status).toBe(outcome === 'success' ? 'saved' : 'error');
    expect(localStorage.getItem(practiceSessionKey('a'))).toBeNull();
    expect(localStorage.getItem(practiceSessionKey('b'))).toBe('B exact');
    expect(supabaseMock.from).toHaveBeenCalledOnce();
    expect(() => savePracticeResult(completed, raw, access('a'))).toThrow();
  });

  it('rejects a queued Practice save after retirement without waiting for the editor lock', async () => {
    const completed = result(); const raw = persistPracticeSession({ ...practice(), completedResult: completed }, access('a'))!;
    const held = deferred<void>(); const release = deferred<void>();
    const blocker = navigator.locks.request(practiceSaveLockName('a', completed.id), async () => { held.resolve(); await release.promise; });
    await held.promise;
    const operation = savePracticeResult(completed, raw, access('a'));
    expect((await eraseAccountRecovery('a')).verified).toBe(true);
    release.resolve(); await blocker;
    expect((await operation.done).status).toBe('error');
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});
