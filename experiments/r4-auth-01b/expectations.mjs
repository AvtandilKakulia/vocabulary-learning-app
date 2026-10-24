import { equal, assert } from '../r4-auth-01/fixtures.mjs';
import { initialCases, upstreamPatch, isPatched } from './cases.mjs';
export function crashExpected(which, name) {
  if (which === 'baseline' && name.startsWith('terminal-get')) return true;
  if (name === 'initial-callback-throws') return !['pr2742', 'patched'].includes(which);
  return !upstreamPatch(which) && ['initial-get', 'initial-denied', 'preflight-denied',
    'initial-missing-refresh', 'initial-malformed-user', 'late-subscription-get'].includes(name);
}
export function errorMarker(name) {
  if (name === 'initial-missing-refresh') return 'AuthSessionMissingError';
  if (name === 'initial-malformed-user') return 'Cannot create proxy';
  return `INJECTED_${name}`;
}
export function browserErrorCount(which, name) {
  if (!crashExpected(which, name)) return 0;
  return name.startsWith('initial-') && name !== 'initial-callback-throws' || name === 'preflight-denied' ? 2 : 1;
}
export function verify(r) {
  const { which, name } = r, patched = isPatched(which), baseline = which === 'baseline';
  if (initialCases.includes(name)) {
    const persistence = ['initial-get','initial-denied','preflight-denied','initial-transient'].includes(name);
    const failedRead = ['initial-get','initial-denied','preflight-denied','late-subscription-get'].includes(name);
    const shapeFailure = ['initial-missing-refresh','initial-malformed-user'].includes(name);
    const error = name.includes('denied') ? 'SecurityError' : name === 'initial-missing-refresh' ? 'AuthSessionMissingError'
      : name === 'initial-malformed-user' ? 'TypeError' : 'Error';
    const initialized = persistence && patched ? 'AuthUnknownError' : null;
    const get = failedRead || shapeFailure ? 'rejected' : 'success';
    const admitted = ['initial-expired','initial-callback-throws'].includes(name) ? 'A' : null;
    const actionable = initialized ?? (persistence || failedRead || shapeFailure ? error : null);
    let events = [{ event: 'INITIAL_SESSION', uid: ['initial-expired','initial-transient','initial-callback-throws'].includes(name) ? 'A' : null }];
    if ((failedRead || shapeFailure) && !upstreamPatch(which)) events = [];
    if (name === 'initial-callback-throws') events.push({ event: 'INITIAL_SESSION', uid: null });
    equal({ initialized:r.initialized, get:r.get, getError:r.getError, admitted:r.admitted, actionable:r.actionable,
      residual:r.residual, rawUnchanged:r.rawUnchanged, refreshCalls:r.refreshCalls, events:r.events },
    { initialized, get, getError:get === 'rejected' ? error : null, admitted, actionable,
      residual:!['initial-empty','initial-invalid-envelope'].includes(name),
      rawUnchanged:!['initial-empty','initial-invalid-envelope','initial-expired'].includes(name),
      refreshCalls:name === 'initial-expired' ? 1 : 0, events }, `${which}/${name}: initial state mismatch`);
    const expectedLogs = name === 'initial-transient' ? patched ? 0 : 1
      : ['initial-get','initial-denied','preflight-denied'].includes(name) ? upstreamPatch(which) ? patched ? 2 : 3 : 1
      : name === 'late-subscription-get' ? upstreamPatch(which) ? 1 : 0
      : shapeFailure ? upstreamPatch(which) ? 2 : 0
      : name === 'initial-callback-throws' ? ['pr2742','patched'].includes(which) ? 1 : 0 : 0;
    equal(r.logs.length, expectedLogs, `${which}/${name}: unexpected logs`);
    for (const log of r.logs) assert(log.message.includes(errorMarker(name)), 'Unrelated diagnostic log');
    return;
  }
  const count = name.endsWith('-2') ? 2 : 4;
  const success = name === 'refresh-success-4', clean = ['terminal-success-4','terminal-delayed-4'].includes(name);
  const read = name.includes('-get-');
  let state = success ? 'success' : clean ? 'returned-error' : 'rejected';
  let error = success ? null : clean ? 'AuthApiError' : name.includes('abort') ? 'AbortError' : name.includes('quota') ? 'QuotaExceededError' : 'Error';
  const callers = Array.from({length:count}, (_, i) => {
    if (baseline && read && i === 0) return {state:'returned-error',error:'AuthApiError',message:'Synthetic refresh rejection'};
    if (!baseline && !patched && !success && !clean && i > 0) return {state:'pending',error:null,message:null};
    return {state,error,message:success ? null : clean ? 'Synthetic refresh rejection' : `INJECTED_${name}`};
  });
  const events = ['INITIAL_SESSION'];
  if (success || clean) events.push(...Array(baseline ? count : 1).fill(success ? 'TOKEN_REFRESHED' : 'SIGNED_OUT'));
  if (baseline && read) events.push('SIGNED_OUT');
  equal({callers:r.callers,afterRetry:r.afterRetry,later:r.later,residual:r.residual,removals:r.removals,events:r.events,refreshCalls:r.refreshCalls,logs:r.logs},
    {callers,afterRetry:callers.map(c=>c.state),later:'success',residual:success || (!clean && !name.includes('lost-ack') && !(baseline && read)),
      removals:success ? 0 : read ? baseline ? 1 : 0 : baseline ? count : 1,
      events,refreshCalls:baseline ? read ? 1 : count : 1,logs:[]}, `${which}/${name}: refresh state mismatch`);
  if (patched) assert(r.afterRetry.every(s => s !== 'pending'), 'Patched SDK orphaned a caller');
}
