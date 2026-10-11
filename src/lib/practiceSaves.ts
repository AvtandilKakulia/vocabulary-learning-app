import { supabase } from './supabase';
import { matchesCompletedTest, type CompletedTestResult } from './pendingTestResults';
import { removePracticeSession, type PracticeResult } from './practiceSessions';

type SaveOutcome = { status: 'saved' } | { status: 'error'; error: unknown };
export interface PracticeSave {
  status: 'saving' | 'saved' | 'error';
  done: Promise<SaveOutcome>;
}

// Lives outside React: navigation and keyed account remounts join the same request.
// Settled entries also prevent resubmission if browser-copy cleanup failed.
const saves = new Map<string, PracticeSave>();
const key = (result: PracticeResult) => JSON.stringify([result.user_id, result.id]);

export function findPracticeSave(result: PracticeResult): PracticeSave | undefined {
  return result.id ? saves.get(key(result)) : undefined;
}

export function savePracticeResult(result: CompletedTestResult, savedCopy: string): PracticeSave {
  const existing = findPracticeSave(result);
  if (existing && existing.status !== 'error') return existing;
  const operation: PracticeSave = {
    status: 'saving',
    done: Promise.resolve().then(async (): Promise<SaveOutcome> => {
      try {
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
        removePracticeSession(result.user_id, savedCopy);
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
