import { describe, expect, it, vi } from 'vitest';
import { legacyPracticeKey, practiceSessionKey, readPracticeSession, persistPracticeSession,
  removePracticeSession, type StoredPracticeSession } from './practiceSessions';

const session = (userId = 'a'): StoredPracticeSession => ({
  userId, queueIds: ['remaining'], direction: 'geo-to-en', orderMode: 'db-order',
  allowReguess: true, correctCount: 2, totalAttempts: 3,
  mistakes: [{ english_word: 'yield', user_answer: 'wrong', correct_definitions: ['yield'] }],
  attemptedWordIds: ['done'], hasChecked: false,
});

describe('Practice storage ownership and migration', () => {
  it('encodes the authenticated ID and independently persists both accounts', () => {
    expect(practiceSessionKey('a:b /')).toBe(`${legacyPracticeKey}:a%3Ab%20%2F`);
    persistPracticeSession(session('a'));
    persistPracticeSession(session('b'));
    expect(readPracticeSession('a').session).toEqual(session('a'));
    expect(readPracticeSession('b').session).toEqual(session('b'));
    localStorage.setItem('vocab-app-theme', 'dark');
    expect(removePracticeSession('b')).toBe(true);
    expect(localStorage.getItem(practiceSessionKey('b'))).toBeNull();
    expect(readPracticeSession('a').session).toEqual(session('a'));
    expect(localStorage.getItem('vocab-app-theme')).toBe('dark');
  });

  it('leaves A legacy data untouched when B signs in first, then verifies A copy before deleting legacy', () => {
    const raw = JSON.stringify(session('a'));
    localStorage.setItem(legacyPracticeKey, raw);
    expect(readPracticeSession('b').session).toBeNull();
    persistPracticeSession(session('b'));
    removePracticeSession('b');
    expect(localStorage.getItem(legacyPracticeKey)).toBe(raw);
    const removed = vi.spyOn(Storage.prototype, 'removeItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    expect(readPracticeSession('a')).toEqual({ session: session('a'), writable: true, warning: '' });
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(raw);
    expect(localStorage.getItem(legacyPracticeKey)).toBeNull();
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(removed.mock.invocationCallOrder[0]);
    expect(readPracticeSession('a').session).toEqual(session('a'));
    expect(set).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledOnce();
  });

  it('prefers an existing scoped session without overwriting it from legacy', () => {
    const scoped = { ...session(), totalAttempts: 8 };
    persistPracticeSession(scoped);
    localStorage.setItem(legacyPracticeKey, JSON.stringify(session()));
    const before = localStorage.getItem(practiceSessionKey('a'));
    expect(readPracticeSession('a').session).toEqual(scoped);
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(before);
    // Explicit owner cleanup must not leave a legacy copy that can resurrect later.
    removePracticeSession('a');
    expect(readPracticeSession('a').session).toBeNull();
  });

  it.each(['write throws', 'verification mismatch', 'verification throws', 'remove throws'] as const)('preserves legacy if migration %s', failure => {
    const raw = JSON.stringify(session());
    localStorage.setItem(legacyPracticeKey, raw);
    const get = Storage.prototype.getItem;
    if (failure === 'write throws') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    if (failure.startsWith('verification')) {
      let reads = 0;
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
        if (key === practiceSessionKey('a') && ++reads === 2) {
          if (failure === 'verification throws') throw new Error('blocked');
          return 'different copy';
        }
        return get.call(this, key);
      });
    }
    if (failure === 'remove throws') vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const result = readPracticeSession('a');
    expect(result.session).toEqual(session());
    expect(result.writable).toBe(false);
    expect(result.warning).not.toBe('');
    expect(get.call(localStorage, legacyPracticeKey)).toBe(raw);
  });

  it.each(['{bad json', JSON.stringify({ ...session(), queueIds: 'invalid' }), JSON.stringify(session('b'))])('does not restore or destroy malformed/incompatible/wrong-owner data: %s', raw => {
    localStorage.setItem(legacyPracticeKey, raw);
    expect(readPracticeSession('a').session).toBeNull();
    expect(localStorage.getItem(legacyPracticeKey)).toBe(raw);
    localStorage.setItem(practiceSessionKey('a'), raw);
    expect(readPracticeSession('a')).toMatchObject({ session: null, writable: false });
    expect(removePracticeSession('a')).toBe(false);
    expect(localStorage.getItem(practiceSessionKey('a'))).toBe(raw);
  });

  it('handles unavailable storage without throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPracticeSession('a')).toMatchObject({ session: null, writable: false });
  });

  it('does not remove a newer saved session when an older save finishes', () => {
    const oldCopy = persistPracticeSession(session())!;
    const newer = { ...session(), totalAttempts: 4 };
    persistPracticeSession(newer);
    expect(removePracticeSession('a', oldCopy)).toBe(false);
    expect(readPracticeSession('a').session).toEqual(newer);
  });
});
