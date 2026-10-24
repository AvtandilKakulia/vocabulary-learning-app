import { verify } from '../r4-auth-01b/expectations.mjs';
import { equal, assert } from '../r4-auth-01/fixtures.mjs';
export function verifyProposal(result) {
  if (result.name !== 'initial-callback-throws') return verify(result);
  equal({ initialized:result.initialized, get:result.get, getError:result.getError, admitted:result.admitted,
    actionable:result.actionable, residual:result.residual, rawUnchanged:result.rawUnchanged,
    refreshCalls:result.refreshCalls, events:result.events },
  { initialized:null, get:'success', getError:null, admitted:'A', actionable:null, residual:true,
    rawUnchanged:true, refreshCalls:0, events:[{event:'INITIAL_SESSION',uid:'A'}] });
  equal(result.logs.length,1); assert(result.logs[0].message.includes('INJECTED_initial-callback-throws'));
}
// These labels select old assertion semantics, not a different artifact. Source is always the hashed proposal.
export const profileFor = name => name.startsWith('terminal-') || name.startsWith('refresh-') ? 'patched' : 'pr2742';
