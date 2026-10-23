import { equal, assert } from './fixtures.mjs';
// These are observed compatibility contracts, including explicitly FAILED gates.
// Matching a known failure is never labeled a successful compatibility gate.
export function expectedCrash(version, name) {
  return name === 'initialize-read' || (version === '2.83.0' && [
    'refresh-set', 'refresh-quota', 'refresh-abort', 'refresh-denied', 'refresh-retired',
    'refresh-lost-ack', 'concurrent-set', 'terminal-read', 'auto-set',
  ].includes(name));
}
export function verifyProbe(r) {
  const { version: v, name: n } = r, newer = v === '2.112.4';
  equal(r.disposal, newer);
  let state = 'rejected', stored = 'A', renewed = false, events = ['INITIAL_SESSION'], refreshCalls = 0;
  let error = 'Error', waiter = null, waiterError = null, loggedErrors = 0, retry = null, scopes = [];
  if (n.startsWith('refresh') || n.startsWith('concurrent') || n.startsWith('terminal') || n === 'dispose-pending' || n === 'auto-set' || n === 'expiry-recovery' || n === 'initialize-expired') refreshCalls = 1;
  if (['initialize-read', 'signup-success', 'signup-no-session', 'refresh-delayed-ack', 'concurrent-success', 'logout-local', 'logout-global', 'dispose-pending', 'expiry-recovery', 'initialize-expired'].includes(n)) { state = 'success'; error = null; }
  if (n === 'auto-set') { state = 'scheduled'; error = null; loggedErrors = 1; }
  if (n === 'initialize-read') { events = []; loggedErrors = 1; }
  if (n === 'initialize-expired') { events = []; renewed = true; }
  if (n.startsWith('signup') || n === 'signin-set') { events = []; stored = null; }
  if (n === 'signup-success') stored = 'A';
  if (n === 'refresh-quota') error = 'QuotaExceededError';
  if (n === 'refresh-abort') error = 'AbortError';
  if (n === 'refresh-denied') error = 'SecurityError';
  if (n === 'refresh-read' && !newer) { state = 'success'; error = null; renewed = true; events.push('TOKEN_REFRESHED'); }
  if (n === 'refresh-lost-ack') renewed = true;
  if (['refresh-delayed-ack', 'dispose-pending', 'expiry-recovery', 'concurrent-success'].includes(n)) {
    renewed = true;
    if (!(n === 'dispose-pending' && newer)) events.push('TOKEN_REFRESHED');
  }
  if (n === 'concurrent-success') {
    waiter = 'success'; if (!newer) { refreshCalls = 2; events.push('TOKEN_REFRESHED'); }
  }
  if (n === 'concurrent-set') { waiter = 'rejected'; waiterError = 'Error'; refreshCalls = newer ? 1 : 2; }
  if (['terminal-valid', 'terminal-expired'].includes(n)) {
    state = 'returned-error'; error = 'AuthApiError';
    if (!newer || n === 'terminal-expired') { stored = null; events.push('SIGNED_OUT'); }
  }
  if (['terminal-remove', 'terminal-read'].includes(n)) {
    waiter = newer ? 'pending' : 'rejected'; waiterError = newer ? null : 'Error'; refreshCalls = newer ? 3 : 2;
    if (newer) { renewed = true; events.push('TOKEN_REFRESHED', 'TOKEN_REFRESHED'); retry = { public: 'success', originalWaiter: 'pending' }; }
    else if (n === 'terminal-read') { state = 'returned-error'; error = 'AuthApiError'; stored = null; refreshCalls = 1; events.push('SIGNED_OUT'); }
  }
  if (n.startsWith('logout')) {
    scopes = [n === 'logout-global' ? 'global' : 'local'];
    if (n !== 'logout-remove' && (n !== 'logout-error' || newer)) { stored = null; events.push('SIGNED_OUT'); }
    if (n === 'logout-error') { state = 'returned-error'; error = newer ? 'AuthRetryableFetchError' : 'AuthApiError'; }
  }
  equal({ public: r.public, error: r.error, stored: r.stored, renewed: r.renewed,
    events: r.events, refreshCalls: r.refreshCalls, waiter: r.waiter, waiterError: r.waiterError,
    loggedErrors: r.loggedErrors, retry: r.retry, scopes: r.logoutScopes },
  { public: state, error, stored, renewed, events, refreshCalls, waiter, waiterError, loggedErrors, retry, scopes }, `${v} ${n} changed`);
  if (r.public === 'rejected') equal(r.message, `INJECTED_${n}`);
  if (n === 'concurrent-set' && newer) assert(r.waiter === 'rejected', 'Fix must preserve the waiter rejection');
}
