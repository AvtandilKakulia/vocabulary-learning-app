import { supabase } from './supabase';
import { matchesCompletedTest, type CompletedTestResult } from './pendingTestResults';
import { practiceSessionKey, removePracticeSession, type PracticeResult } from './practiceSessions';
import { ownsPractice, practiceSaveLockName, withAvailablePracticeAccess, type PracticeWriteAccess } from './practiceOwnership';

type SaveOutcome = { status: 'saved' } | { status: 'error'; error: unknown };
export interface PracticeSave {
  status: 'saving' | 'saved' | 'error';
  done: Promise<SaveOutcome>;
  savedCopy: string;
}

// Lives outside React: navigation and keyed account remounts join the same request.
// Settled entries also prevent resubmission if browser-copy cleanup failed.
const saves = new Map<string, PracticeSave>();
const key = (result: PracticeResult) => JSON.stringify([result.user_id, result.id]);

export function findPracticeSave(result: PracticeResult): PracticeSave | undefined {
  return result.id ? saves.get(key(result)) : undefined;
}

export function savePracticeResult(result: CompletedTestResult, savedCopy: string, access: PracticeWriteAccess): PracticeSave {
  if (!ownsPractice(access, result.user_id) || !navigator.locks?.request) {
    throw new Error('Practice ownership is required to save this result.');
  }
  const existing = findPracticeSave(result);
  if (existing && existing.status !== 'error') return existing;
  const operation: PracticeSave = {
    status: 'saving',
    savedCopy,
    done: Promise.resolve().then(async (): Promise<SaveOutcome> => {
      try {
        await navigator.locks.request(practiceSaveLockName(result.user_id, result.id), { mode: 'exclusive' }, async () => {
          // A queued request can outlive its editor. Check again under the result
          // lock before initiating any insert, without generating another result ID.
          if (!ownsPractice(access, result.user_id) || localStorage.getItem(practiceSessionKey(result.user_id)) !== savedCopy) {
            throw new Error('Practice moved to another tab. Restore its latest result before retrying.');
          }
          const { error } = await supabase.from('test_history').insert(result);
          if (error) {
            if (error.code !== '23505') throw error;
            // An earlier request may have committed before its response was lost.
            // Never overwrite History or assume an arbitrary conflict is this result.
            const { data, error: lookupError } = await supabase.from('test_history')
              .select('id,user_id,test_date,test_direction,total_words,correct_count,mistakes')
              .eq('id', result.id).eq('user_id', result.user_id);
            if (lookupError) throw lookupError;
            if (!Array.isArray(data) || data.length !== 1 || !matchesCompletedTest(data[0], result)) {
              throw new Error('Could not confirm the existing History record. Your Practice result has been kept.');
            }
          }
          // Only remove the exact account-owned checkpoint sent with this request.
          if (ownsPractice(access, result.user_id)) removePracticeSession(result.user_id, access, savedCopy);
          else await withAvailablePracticeAccess(result.user_id, cleanupAccess => {
            removePracticeSession(result.user_id, cleanupAccess, savedCopy);
          });
        });
        operation.status = 'saved';
        return { status: 'saved' };
      } catch (error) {
        operation.status = 'error';
        return { status: 'error', error };
      }
    }),
  };
  saves.set(key(result), operation);
  return operation;
}
