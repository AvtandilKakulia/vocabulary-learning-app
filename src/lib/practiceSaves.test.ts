import { describe, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { persistPracticeSession as persist, practiceSessionKey, type StoredPracticeSession } from './practiceSessions';
import { savePracticeResult as save } from './practiceSaves';
import { coordinatePractice, practiceSaveLockName, type PracticeOwner } from './practiceOwnership';

const access = (userId: string) => ({ userId, canWrite: () => true });
const persistPracticeSession = (session: StoredPracticeSession, verify = false) => persist(session, access(session.userId), verify);
const savePracticeResult = (result: Parameters<typeof save>[0], raw: string) => save(result, raw, access(result.user_id));

function checkpoint() {
  const result = { id: crypto.randomUUID(), user_id: 'user-a', test_date: '2030-01-01T00:00:00.000Z',
    test_direction: 'en-to-geo' as const, total_words: 1, correct_count: 1, mistakes: [] };
  const session: StoredPracticeSession = { userId: result.user_id, queueIds: [], direction: result.test_direction,
    orderMode: 'db-order', allowReguess: false, totalAttempts: 1, correctCount: 1, mistakes: [],
    completed: true, completedResult: result };
  return { result, session, raw: persistPracticeSession(session, true)! };
}

describe('Practice save coordination and idempotency', () => {
  it.each(['revoked ownership', 'replaced checkpoint'] as const)('rejects a queued insert after %s', async kind => {
    const { result, session, raw } = checkpoint();
    const release = deferred<void>();
    const acquired = deferred<void>();
    const original = navigator.locks.request(practiceSaveLockName(result.user_id, result.id), async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    let held = true;
    const operation = save(result, raw, { userId: result.user_id, canWrite: () => held });
    await Promise.resolve();
    if (kind === 'revoked ownership') held = false;
    else persistPracticeSession({ ...session, completedResult: { ...result, id: crypto.randomUUID() } });
    const latest = localStorage.getItem(practiceSessionKey(result.user_id));
    release.resolve();
    await original;
    expect(await operation.done).toMatchObject({ status: 'error' });
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(localStorage.getItem(practiceSessionKey(result.user_id))).toBe(latest);
  });

  it('leaves cleanup to the new editor when an old response succeeds after ownership changes', async () => {
    const { result, raw } = checkpoint();
    const pending = deferred<QueryResult>();
    const insert = query(pending.promise);
    supabaseMock.from.mockReturnValue(insert);
    let a: PracticeOwner | undefined;
    let b: PracticeOwner | undefined;
    const first = coordinatePractice(result.user_id, state => { if (state.status === 'active') a = state.owner; });
    await vi.waitFor(() => expect(a).toBeDefined());
    const operation = save(result, raw, a!);
    await vi.waitFor(() => expect(insert.insert).toHaveBeenCalledOnce());
    first.stop();
    const second = coordinatePractice(result.user_id, state => { if (state.status === 'active') b = state.owner; });
    try {
      await vi.waitFor(() => expect(b).toBeDefined());
      pending.resolve({ error: null });
      expect(await operation.done).toEqual({ status: 'saved' });
      expect(localStorage.getItem(practiceSessionKey(result.user_id))).toBe(raw);
    } finally { second.stop(); }
  });

  it('shares one request per account/result and preserves a newer account checkpoint on success', async () => {
    const { result, session, raw } = checkpoint();
    const pending = deferred<QueryResult>();
    const insert = query(pending.promise);
    supabaseMock.from.mockReturnValue(insert);
    const first = savePracticeResult(result, raw);
    const second = savePracticeResult(structuredClone(result), raw);
    expect(second).toBe(first);
    await vi.waitFor(() => expect(insert.insert).toHaveBeenCalledExactlyOnceWith(result));
    const newer = persistPracticeSession({ ...session, completedResult: { ...result, id: crypto.randomUUID() } });
    localStorage.setItem(practiceSessionKey('user-b'), 'B recovery');
    pending.resolve({ error: null });
    expect(await first.done).toEqual({ status: 'saved' });
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(newer);
    expect(localStorage.getItem(practiceSessionKey('user-b'))).toBe('B recovery');
    expect(savePracticeResult(result, raw)).toBe(first);
    expect(insert.insert).toHaveBeenCalledOnce();
  });

  it('confirms a committed result after losing runtime state without generating a new ID or updating History', async () => {
    const { result, raw } = checkpoint();
    const pending = deferred<QueryResult>();
    const firstInsert = query(pending.promise);
    supabaseMock.from.mockReturnValue(firstInsert);
    const original = savePracticeResult(result, raw);
    await vi.waitFor(() => expect(firstInsert.insert).toHaveBeenCalledOnce());
    // Simulate a reload losing the coordinator while the server already committed.
    vi.resetModules();
    const fresh = await import('./practiceSaves');
    const insert = query({ error: { message: 'duplicate key', code: '23505' } } as QueryResult);
    const lookup = query({ data: [{ ...result, test_date: '2030-01-01T00:00:00+00:00' }], error: null });
    supabaseMock.from.mockReturnValueOnce(insert).mockReturnValueOnce(lookup);
    const recovered = fresh.savePracticeResult(result, raw, access(result.user_id));
    // A separate runtime must wait for the original request's result lock.
    await Promise.resolve();
    expect(insert.insert).not.toHaveBeenCalled();
    pending.resolve({ error: { message: 'response lost' } });
    await original.done;
    expect(await recovered.done).toEqual({ status: 'saved' });
    expect(insert.insert).toHaveBeenCalledExactlyOnceWith(firstInsert.insert.mock.calls[0][0]);
    expect(lookup.eq).toHaveBeenCalledWith('id', result.id);
    expect(lookup.eq).toHaveBeenCalledWith('user_id', result.user_id);
    expect(insert.update).not.toHaveBeenCalled();
    expect(insert.upsert).not.toHaveBeenCalled();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
  });

  it.each(['wrong owner', 'wrong result', 'missing row', 'lookup error'] as const)('retains recovery when a conflict lookup has %s', async kind => {
    const { result, raw } = checkpoint();
    const conflict = query({ error: { message: 'duplicate key', code: '23505' } } as QueryResult);
    const lookup = query({
      data: kind === 'missing row' ? [] : [{ ...result,
        ...(kind === 'wrong owner' ? { user_id: 'user-b' } : {}),
        ...(kind === 'wrong result' ? { test_direction: 'geo-to-en' } : {}),
      }], error: kind === 'lookup error' ? { message: 'offline' } : null,
    });
    supabaseMock.from.mockReturnValueOnce(conflict).mockReturnValueOnce(lookup);
    expect(await savePracticeResult(result, raw).done).toMatchObject({ status: 'error' });
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(raw);
  });
});
