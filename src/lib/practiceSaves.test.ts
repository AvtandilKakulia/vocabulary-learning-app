import { describe, expect, it, vi } from 'vitest';
import { deferred, query, supabaseMock, type QueryResult } from '@/test/mocks';
import { persistPracticeSession, practiceSessionKey, type StoredPracticeSession } from './practiceSessions';
import { savePracticeResult } from './practiceSaves';

function checkpoint() {
  const result = { id: crypto.randomUUID(), user_id: 'user-a', test_date: '2030-01-01T00:00:00.000Z',
    test_direction: 'en-to-geo' as const, total_words: 1, correct_count: 1, mistakes: [] };
  const session: StoredPracticeSession = { userId: result.user_id, queueIds: [], direction: result.test_direction,
    orderMode: 'db-order', allowReguess: false, totalAttempts: 1, correctCount: 1, mistakes: [],
    completed: true, completedResult: result };
  return { result, session, raw: persistPracticeSession(session, true)! };
}

describe('Practice save coordination and idempotency', () => {
  it('shares one request per account/result and preserves a newer account checkpoint on success', async () => {
    const { result, session, raw } = checkpoint();
    const pending = deferred<QueryResult>();
    const insert = query(pending.promise);
    supabaseMock.from.mockReturnValue(insert);
    const first = savePracticeResult(result, raw);
    const second = savePracticeResult(structuredClone(result), raw);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(insert.insert).toHaveBeenCalledExactlyOnceWith(result);
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
    await Promise.resolve();
    // Simulate a reload losing the coordinator while the server already committed.
    vi.resetModules();
    const fresh = await import('./practiceSaves');
    const insert = query({ error: { message: 'duplicate key', code: '23505' } } as QueryResult);
    const lookup = query({ data: [{ ...result, test_date: '2030-01-01T00:00:00+00:00' }], error: null });
    supabaseMock.from.mockReturnValueOnce(insert).mockReturnValueOnce(lookup);
    expect(await fresh.savePracticeResult(result, raw).done).toEqual({ status: 'saved' });
    expect(insert.insert).toHaveBeenCalledExactlyOnceWith(firstInsert.insert.mock.calls[0][0]);
    expect(lookup.eq).toHaveBeenCalledWith('id', result.id);
    expect(lookup.eq).toHaveBeenCalledWith('user_id', result.user_id);
    expect(insert.update).not.toHaveBeenCalled();
    expect(insert.upsert).not.toHaveBeenCalled();
    expect(localStorage.getItem(practiceSessionKey('user-a'))).toBeNull();
    pending.resolve({ error: null });
    await original.done;
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
