# R4-SEC-06 — Account deletion privilege and security audit

Date: 2026-10-21. Audited base: [`aad0d7131450550bf1efbf7b21e7acf936a17409`](https://github.com/AvtandilKakulia/vocabulary-learning-app/commit/aad0d7131450550bf1efbf7b21e7acf936a17409), latest `main` after PR #45.

**Recommendation: retain the restricted `SECURITY DEFINER` RPC; harden the frontend deletion lifecycle in a separately approved implementation.** No anonymous or cross-account SQL deletion bypass was found in the reviewed definition and isolated tests. Advisor `0029_authenticated_security_definer_function_executable` identifies an intentional privilege boundary, not proof of an exploitable function. However, the complete deletion workflow is not ready for unconditional risk acceptance: account-bound confirmation and asynchronous completion have reproducible defects described below.

**Audit only.** This PR adds this document only. It does not change application behavior, tests, dependencies, CI, migrations, function privileges, ownership, schemas, RLS or configuration. No hosted Supabase connection, credentials, Production data, real account deletion, deployment, merge, advisor suppression or migration-ledger repair was used. Synthetic SQL changes below occurred only inside newly created disposable local clusters. Approval of this report does not authorize remediation or Production execution.

## Evidence boundaries

| Evidence | Established | Not established |
| --- | --- | --- |
| Owner-supplied Production inspection | PG 17.11; zero-argument, postgres-owned, PL/pgSQL `SECURITY DEFINER` RPC; empty search path; authenticated EXECUTE, no anon EXECUTE; `auth.uid()` identity, NULL rejection, matching deletes; app-table RLS/ownership policies; `pg_graphql` already removed by the owner | Fresh live metadata, managed Auth dependencies, gateway/session settings or permission to inspect them |
| Repository migration chain and application/SDK source | Exact SQL, grants, policies, FK contracts, frontend callbacks and installed SDK behavior described below | Proof that every hosted object or external client matches the repository |
| PostgreSQL 17.11, Windows x64; unchanged authorization and word-version runners | Real SQL privilege enforcement, RLS, transactional rollback, row locks and unchanged migration behavior on synthetic schemas | JWT signature verification, GoTrue, managed `auth.sessions`/identities/refresh tokens, Storage, hooks, rate limits or Production role capability parity |
| Six extra React/jsdom audit probes, with real App/modal and repository network-blocking setup | Deterministic component state/callback behavior using synthetic A/B accounts and deferred promises | A hosted account switch, actual HTTP deletion, browser Auth BroadcastChannel delivery or real SDK sign-out completion |

The fixture's `auth.users` is intentionally minimal; its administrative `postgres` is the local bootstrap superuser. Application SQL probes connect as a separate non-superuser, non-BYPASSRLS gateway and switch only to `anon`/`authenticated`. This proves the application authorization boundary under the fixture, not that a managed Production `postgres` has identical powers. The owner reports no trusted Production migration-history ledger; nothing in this audit adopts or repairs one.

## Current architecture and authorization model

Primary sources: [account deletion modal](../src/components/UserProfile.tsx), [App callbacks](../src/App.tsx), [AuthProvider](../src/contexts/AuthProvider.tsx), [initial schema](../supabase/migrations/20240619000000_initial_app_schema.sql), [final account-deletion definition and grant reconciliation](../supabase/migrations/20261007234000_security_schema_reconciliation.sql), [authorization cases](../supabase/tests/authorization/cases.mjs), and the later word-version/search-path migrations. All eight historical migrations were reviewed and applied unchanged to disposable fixtures.

1. `App` keeps `showDeleteModal` in component state. `DeleteAccountModal` reads `useAuth().user` and enables its button only for the exact text `DELETE`, while `deleting` is false.
2. `handleDelete()` checks a user and the literal confirmation, then calls `supabase.rpc('delete_user_account')` with no victim ID. The actual request is authenticated with the Supabase client's access token, independently of the React user object.
3. The database captures `auth.uid()` once as a UUID. NULL raises SQLSTATE `42501`; an invalid UUID raises `22P02` before deletion. The function executes four fully qualified DELETE statements, in this order: `public.profiles.id`, `public.words.user_id`, `public.test_history.user_id`, `auth.users.id`, each equal to the captured UUID.
4. The function has no dynamic SQL, parameters, exception-swallowing block, external calls or internal commits. Its configuration is `search_path=""`. It returns `void`, so success does not distinguish an account actually removed from a repeated/nonexistent-subject no-op.
5. On RPC success, the modal invokes `onDeleted()` without awaiting it. App's async handler awaits `signOut()`, which calls `supabase.auth.signOut()` against the client's then-current session. The modal's `finally` clears `deleting` immediately after invoking that callback.

The repository grants `authenticated` EXECUTE on this RPC, denies it to `PUBLIC`/`anon`, and has no alternate overload. `service_role` remains a trusted administrative principal, outside the ordinary user boundary. Public-schema CREATE is unavailable to application roles; neither application role can replace the function, SET ROLE to an administrator, disable RLS, or delete `auth.users` directly. The exact effective-privilege tests also inspect inherited and column privileges, not only direct ACL entries.

The three application tables have owner-scoped policies and validated, non-deferrable FKs to `auth.users(id)` with `ON DELETE CASCADE`. However, **RLS is not the protection inside this privileged function**: its effective owner can bypass the application-table policies. The explicit `auth.uid()` predicates are the essential safety boundary. RLS does not cause cascades; FKs do. The modal's comment attributing deletion to “RLS and CASCADE” is imprecise and should be corrected only in a future implementation PR.

Authenticated clients lack DELETE on `profiles` and `auth.users`. A disposable counterfactual changing this function to `SECURITY INVOKER` failed at `profiles` with `42501`, preserving every row; direct `auth.users` deletion is also denied by the existing suite. An authenticated EXECUTE revocation also prevented the feature. Some deliberate server-side privilege is necessary; granting broad `auth.users` DELETE to browsers is not an acceptable substitute. The current all-or-nothing SQL transaction is a useful property to preserve.

## Threat model and database conclusions

Assume an attacker can call public HTTP endpoints, hold their own ordinary access token, edit their own allowed metadata, supply arbitrary RPC bodies/headers, repeat requests, and have multiple tabs. A stolen valid victim token, compromised trusted gateway/signing key, service-role secret, arbitrary privileged SQL connection or XSS already operating as the victim is a stronger threat; the current function has no extra step-up authorization against it.

| Scenario | Observed result / assessment |
| --- | --- |
| Anonymous execution, even with a fixture subject populated | `42501`; effective EXECUTE denied. No deletion. |
| A token/subject plus a victim UUID argument | Only `delete_user_account()` exists; extra UUID argument fails `42883`. Actual PostgREST error formatting/overload routing was not exercised. |
| A attempts to target B through app rows or SQL-role escalation | Existing 200 groups reject cross-account DML and administrative access. Account-deletion probes compare B's exact users/profiles/words/history snapshot after deleting A, and vice versa. |
| Missing/NULL or malformed identity | NULL rejected; malformed UUID rejected. All original rows preserved. A syntactically valid but nonexistent UUID produces a no-op, preserving both accounts. |
| B's ID or a privileged role inserted into nested metadata | Supplemental committed probe with top-level A subject and B IDs in `user_metadata`/`app_metadata` removed A only; B's complete snapshot was unchanged. These metadata values are not read by this function. |
| Forged top-level JWT `sub`/`role` | SQL fixtures do **not** authenticate JWTs. A trusted SQL session that sets the subject to B is impersonating B by design. PostgREST must verify the signed token and establish the role/claims; no remotely callable arbitrary SQL or `set_config` wrapper was found in the repository RPC inventory. This audit did not prove hosted signature/audience enforcement. |
| Caller `search_path` or temporary tables shadow `profiles`, `words`, `test_history` | Existing committed probes use temp shadows and hostile caller paths; the qualified real tables are affected correctly and the other account remains identical. Empty function path and qualified `auth.uid()` avoid caller-controlled object resolution. |
| Error at the final `auth.users` delete | Both a synthetic BEFORE DELETE exception and a synthetic restrictive FK at this last step rolled back all three preceding app-table deletes. Exact four-table snapshots remained identical. |
| Repeated or concurrent deletion with the same subject | Existing repeat call succeeds harmlessly. Two additional real gateway connections were forced to overlap: the second demonstrably blocked via `pg_blocking_pids`, then both committed; A was absent and B unchanged. No automatic destructive network retry was added. |
| Old A subject after successful deletion | Existing probes return no A rows; inserts into all three app tables fail FKs; repeat deletion is a no-op. This is data isolation, not immediate access-token revocation. |

PostgREST's [authentication documentation](https://docs.postgrest.org/en/stable/references/auth.html) describes signature verification and role/claim establishment. The fixture deliberately models only the SQL side of that boundary. UUID validation or a `role` string in locally supplied JSON must never be reported as cryptographic JWT verification. PostgreSQL's [transaction guarantee](https://www.postgresql.org/docs/17/tutorial-transactions.html) and the late-failure probes support atomic database rollback; they do not make network delivery or later sign-out atomic with the transaction.

## Confirmed frontend findings and separate hardening concerns

### F1 — Confirmation is not bound to the account (high-priority data-loss risk)

At `UserProfile.tsx`'s `DeleteAccountModal` and App's unkeyed modal rendering, a non-null A → B user change keeps the same modal component and its `confirmText='DELETE'`. A deterministic probe using the actual App typed DELETE for A, rerendered with B, observed the still-enabled button and clicked it; the RPC spy observed B as the current account.

This does **not** show A's token deleting B. It shows A's human confirmation being reused for a request authenticated as B. The user must still click the button after the switch; no automatic deletion on switch was observed. An Auth event from another tab or replacement session is a plausible source of such a change, but native cross-tab Auth delivery was not exercised. Even if ordinary UI sign-out briefly unmounts the modal, that does not protect a direct non-null session replacement. The confirmation also does not display an immutable target account identity.

### F2 — Late completion acts on the current account and outlives the dialog (confirmed lifecycle defect)

With A's RPC deferred, switching the actual App to B and resolving A's success invoked `signOut()` when B was current. The installed `@supabase/auth-js` 2.83.0 `GoTrueClient._signOut()` reads the current stored session; its default scope is global. Thus the callback can sign out B, including B's other sessions, instead of merely cleaning up the already deleted A session. The mocked probe proves the incorrect callback target; hosted global revocation itself was not executed.

Cancel remains enabled during the request. A separate probe closed the dialog with Cancel, then resolved the request and observed the completion callback anyway. Closing a dialog cannot undo an already dispatched SQL transaction. A late failure from A was also rendered in B's modal in another deferred probe. These are UI intent/account-lifecycle issues, not SQL cross-account deletion.

### F3 — Post-deletion sign-out is neither awaited nor handled by the modal (confirmed lifecycle defect)

`onDeleted` is typed as returning `void`, although App supplies an async callback. A deferred callback probe observed the Delete button become enabled again before that callback settled. By JavaScript promise semantics, a later sign-out rejection is outside the RPC try/catch and can become unhandled; the probe did not deliberately inject an unhandled rejection. The `deleting` state disables ordinary subsequent clicks after render, but the handler has no synchronous in-flight guard and does not check `deleting` itself. Duplicate stale callbacks are therefore an additional source-inspection concern, not a separately reproduced HTTP duplicate.

The installed SDK ignores sign-out Auth API 401/403/404 failures and then removes its auth-session keys, which helps after a deleted user. Other failures can return before that cleanup. Its `_removeSession()` clears its session/user/PKCE keys and emits SIGNED_OUT, not arbitrary app-owned localStorage. See installed SDK source at `node_modules/.pnpm/@supabase+auth-js@2.83.0/node_modules/@supabase/auth-js/src/GoTrueClient.ts` (`_signOut`, `_removeSession`) and the pinned [lockfile](../pnpm-lock.yaml). The provider throws returned SDK errors; the modal currently does not await that promise.

### F4 — Account deletion does not erase app-owned recovery copies (confirmed code/cache gap)

The deletion path contains no cleanup for account-scoped Practice checkpoints, active Test snapshots or pending Test results. A synthetic valid checkpoint under `practiceSessionKey('user-a')` remained byte-for-byte intact after the modal's success callback. That component probe stubs cleanup; source inspection of App, AuthProvider and the installed SDK establishes the absence of app-cache cleanup in the real chain.

Relevant sources are [practiceSessions](../src/lib/practiceSessions.ts), [activeTestSessions](../src/lib/activeTestSessions.ts) and [pendingTestResults](../src/lib/pendingTestResults.ts). Keys include `vocab_practice_session_state_v2:<encoded UID>`, `vocab_active_test:<encoded UID>:<session ID>` and `vocab_pending_test:<encoded UID>:<result ID>`; an older Practice key also requires owner validation. These copies can retain prompts, definitions, mistakes and descriptions. Existing account validators prevent their ordinary restoration as B; this is a local privacy/erasure gap, not evidence of a B restore or a database leak. Other tabs/in-flight save helpers can retain memory and write again; deletion currently has no coordinated app-wide termination protocol.

### Defense in depth and uncertain outcomes

- Frontend DELETE text is accidental-action protection, not authentication. A caller with a valid authenticated bearer token can invoke the zero-argument RPC directly. No fresh password, OTP/MFA proof, session-age check or server-enforced deletion challenge is required. Decide explicitly whether that bearer-token authority is acceptable for this product. A frontend-only reauthentication prompt would remain bypassable; token `iat` alone is not proof of recent human reauthentication.
- A lost response can leave the server deletion committed while the UI reports an error. Conversely, a database error rolls everything back. Current feedback does not distinguish “deletion failed,” “outcome unknown” and “deletion succeeded but local sign-out failed.” No production lost-response experiment was made. A repeat call for the **same** subject is safe in SQL, but an unbound UI retry after an account change is not equivalent.
- A peer tab may still hold a signed token, rendered data or local recovery copies. Pending History writes after deletion should fail the ownership FK rather than recreate the deleted user; the existing SQL suite proves the FK boundary, not every browser scheduling permutation. Do not equate closing/signing out one tab with verified remote erasure everywhere.

Supabase documents that [deleting a user does not immediately invalidate an already issued JWT](https://supabase.com/docs/guides/auth/managing-user-data). Its [sign-out reference](https://supabase.com/docs/reference/javascript/auth-signout) describes global sign-out and refresh-token revocation while access tokens remain valid until expiration. [Session documentation](https://supabase.com/docs/guides/auth/sessions) describes checking a JWT's `session_id` against the live session when immediate session validity matters. This RPC does not perform such a lookup. Actual managed Auth cascades and refresh-token revocation from this direct SQL deletion were **not** verified in the minimal fixture.

## Advisor assessment and alternatives

The official [0029 advisor guidance](https://supabase.com/docs/guides/observability/advisors?lint=0029_authenticated_security_definer_function_executable) flags authenticated access to privileged functions and requires review of their authorization checks. It also recognizes deliberately restricted per-user privileged operations. Removing GraphQL does not remove this application's PostgREST RPC surface or the rationale for this finding. The warning remains; this audit does not suppress or automatically accept it.

| Option | Security / functionality | Complexity, cost and maintainability | Deployment risk and suitability |
| --- | --- | --- | --- |
| A. Retain this RPC with documented owner risk acceptance | Preserves exact self-only predicates, empty path, deny-anon ACL and atomic deletion. Does not remedy F1–F4 or add step-up auth. | No new service/dependency or invocation cost beyond existing database/API use; small function remains auditable with existing CI. | Best database-level choice given current evidence. Acceptance must cover the explicit token/session assumptions and cannot label the whole UI workflow safe. |
| B. Targeted hardening | First fix account-bound UI intent, completion and cache lifecycle. Add server-enforced step-up/session checks only if the owner requires them; no demonstrated SQL predicate bypass calls for a speculative function rewrite. | Small frontend follow-up is less costly than an architecture change; erasure coordination needs focused cross-tab/pending-save tests. Step-up policy has additional auth/recovery complexity. | Recommended next implementation scope. Do not change grants, RLS or schemas simply to quiet the advisor. More restrictive auth can lock legitimate users out if poorly designed. |
| C. Authenticated server/Edge deletion workflow | Could verify a current user and step-up proof, derive the target solely from verified auth, and call the Auth Admin deletion API with a server-only secret. Never trust a body-supplied victim ID. | Introduces service-secret handling, endpoint protection, logging/redaction, deployment/monitoring, latency and usage-dependent function invocations. Multiple external steps lose the current single SQL transaction unless carefully designed. | Justified if fresh reauth, managed Auth orchestration or separately approved Storage cleanup is required. Not justified solely by 0029. A new endpoint must replace/restrict the old callable RPC at a reviewed cutover or the new policy is bypassable. |
| D. SECURITY INVOKER or revoke authenticated EXECUTE | Counterfactual tests prove the existing feature fails. Broadening table/auth grants to compensate would weaken security. | Superficially small SQL change, but breaks the API or requires another privileged backend. | Reject as a warning-removal-only fix. Revocation is appropriate only with an approved replacement or explicit feature retirement. |

The [Auth Admin deleteUser reference](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) requires a server-side service-role key and documents hard deletion as the default. If C is approved, validate the caller with a trusted Auth verification flow, keep the admin client separate from the user client and never expose its secret. [Edge Function authentication guidance](https://supabase.com/docs/guides/functions/auth) provides authenticated handler patterns; an unauthenticated endpoint with only a claimed user ID is not an alternative. No new paid service is currently demonstrated to be necessary; exact plan pricing was not part of this audit.

## Concrete follow-up plan (not implemented)

1. Bind a deletion intent to the initiating UID and display that account. Reset/close confirmation on identity changes. Check both the intent and current authenticated context immediately before dispatch; account for the SDK token changing independently of a React render. Preserve the zero-victim-argument contract unless a separately reviewed server check is required; merely adding a user ID parameter would not solve authorization.
2. Use a synchronous single-flight guard and an operation identity. Define in-flight Cancel as either unavailable or explicitly “close without cancelling.” Ignore stale UI results for another account or unmounted dialog. A late A completion must never invoke global B sign-out.
3. Make completion an awaited, error-handled promise, separating confirmed server deletion from local cleanup failure. Keep the operation busy until its own cleanup settles. Unknown network outcome must remain explicit; no automatic destructive retry and no retry silently rebound to another UID.
4. Define erasure for the deleted UID's Practice/Test recovery copies and in-memory work, including peer tabs and pending saves. Preserve B's bytes and all unrelated keys. Use existing ownership/snapshot safeguards; never use blanket `localStorage.clear()` or delete an unvalidated legacy checkpoint. Prevent an old writer from recreating an erased checkpoint. This coordination may warrant a second small implementation PR rather than coupling it to the confirmation fix.
5. Add permanent focused tests for F1–F4: A→B before dispatch, A success/failure after B, sign-out delay/failure, duplicate callbacks, cancel/unmount, reconnect with unknown outcome, exact targeted cache cleanup, peer-tab writers and pending result identity. Keep existing R2/R3 account and save-once coverage unchanged.
6. Obtain a product decision on recent reauthentication/MFA, stale-session acceptance and local erasure scope. If stronger server enforcement is required, design and test it separately; do not treat SDK `reauthenticate()` or a renewed access token as a generic deletion authorization proof without a validated server contract.

## Coverage and executed validation

The unchanged [authorization suite](../supabase/tests/authorization/cases.mjs) covers exact function inventory/signature/owner/definer/configuration, effective ACLs, role/schema/table/column privileges, all ten policies, three FKs, owner/cross-account/anonymous mutations, temporary-schema shadows, committed own-account deletion, repeated calls, post-deletion FK rejection, unchanged foreign-account snapshots and negative controls that prove the assertions detect unsafe changes. Its 200 groups contain multiple assertions each.

The existing [AuthContext tests](../src/contexts/AuthContext.test.tsx) cover initial-session/auth-event ordering and unmount cleanup. [UserProfile tests](../src/components/UserProfile.test.tsx) exercise profile editing, and [App tests](../src/App.test.tsx) exercise profile/display-name behavior. No focused deletion modal/pending-sign-out/account-confirmation test was found in the 704-test baseline. Passing that baseline alone would not detect F1–F4.

| Command / experiment | Actual local result |
| --- | --- |
| `node supabase/tests/authorization/run.mjs --pg-bin tmp/r3-a01-pg/pgsql/bin` | **200/200 groups passed**, unchanged runner/coverage, first run |
| `node supabase/tests/word-version/run.mjs --pg-bin tmp/r3-a01-pg/pgsql/bin` | **30/30 groups passed**, unchanged runner/coverage, first run |
| Supplemental disposable PostgreSQL audit, appendix below | **8/8 groups passed**: one complete migration-chain group plus seven audit groups; includes two real overlapping connections, no hosted URL accepted |
| Six temporary React audit probes, appendix below | **6/6 passed** against unchanged source; final run 2.29 s, including a valid actual Practice storage key. Earlier version also passed 6/6; its generic cache-key probe was replaced before the final run. These intentionally assert observed defects, not repaired behavior. |
| `pnpm exec tsc -b` | Exit 0, no TypeScript errors |
| `pnpm lint` | Exit 0, no ESLint errors or warnings |
| `pnpm test` | **704/704 tests, 33/33 files**, 63.25 s; no failed, skipped or retried cases |
| `pnpm build` | Exit 0; Vite 6.2.6, 1,603 modules, 6.21 s; existing 517.01 kB minified chunk / >500 kB warning, not suppressed |
| `git diff --check`, staged diff check and final scope review | Passed; only this Markdown report is included in the PR |

Local runtime: Windows x64, Node 24.22.0, pnpm 10.34.6, React 18.3.1, Vitest 4.1.11, PostgreSQL 17.11. All disposable PG clusters were stopped and removed by their runners. Temporary probe/config/log files stay in ignored `tmp/r4-sec-06`; none changes the regular suite or CI count contracts. No global timeout/worker changes were used. The PR description records the actual GitHub Actions run URL and results for **quality** and **PostgreSQL integration** after publication; those remote results are separate from the local table.

## Production prerequisites, verification and recovery

There is no deployment in this PR. Before any later implementation or privileged change, obtain separate owner approval and record the deployed code version, current function body/hash/identity/owner/search path/effective ACLs and overload inventory, RLS/ownership/FKs, dependent triggers, gateway JWT settings and Auth/Storage dependencies. The prepared [metadata-only script](../supabase/tests/authorization/production-metadata-readonly.sql) is a starting point for an authorized owner, not permission for this agent to connect; it does not validate JWTs, all managed Auth relationships or local browser caches.

Use an isolated full Supabase environment with expendable accounts for the remaining end-to-end gates: genuine anonymous/forged/expired tokens; valid A token plus victim B bodies; two authenticated tabs; delayed/lost RPC responses; Auth sign-out failure; sessions/identities/refresh-token invalidation; access JWT behavior until expiry; deletion while Practice/Test saves are pending; and exact account-scoped cache erasure. Supabase's [user-data guidance](https://supabase.com/docs/guides/auth/managing-user-data) notes that owning Storage objects can prevent user deletion. A synthetic restrictive FK confirmed rollback mechanics, not the actual hosted Storage behavior. Do not automatically remove Storage objects or bypass its protections.

The four DELETEs and cascades can acquire row locks and take longer for large accounts or contend with concurrent writes. Our two-connection probe establishes serialization for its small fixture only; it is not a Production latency, deadlock, statement-timeout, hook or webhook benchmark. External side effects, backups, logs, exports, other devices and data retained by third parties are outside the atomic SQL erasure guarantee. Deletion's generic UI promise should not be read as proof of erasure from every such store.

Rollback of this documentation means reverting the report; no database action is involved. A future frontend release can be reverted without changing SQL, but that cannot undelete an account or restore local data already erased. Any future database change needs its own reviewed forward/rollback plan; never disable RLS, broaden auth-table grants or run a migration push/reset to recover. Real deletion recovery requires an owner-controlled, tested backup/PITR process with Auth identity/session and application consistency checks in an isolated restore first; it is not a routine UI retry or a whole-Production overwrite. Do not promise recovery absent that capability.

**Independent-review decision:** accept that this specific RPC needs a constrained privilege escalation, retain the warning pending explicit owner risk acceptance, and prioritize separate fixes for F1–F3 plus a defined F4 erasure policy. There is no evidence-based reason to move to an Edge Function merely to eliminate 0029. Hosted JWT/Auth/session/Storage assumptions and native multi-tab behavior remain unverified, and the confirmed frontend findings remain unfixed by design in this audit-only PR.

## Reproducing the additional isolated probes

Run the unchanged standard commands above from the repository root with a local PostgreSQL 17 binary directory. The runner accepts no remote connection string, strips inherited PG variables, initializes a fresh random-port loopback cluster and checks its temporary path before cleanup. Never substitute a hosted connection or real account.

The following appendices preserve the exact extra probe sources as documentation. Copy them to the indicated ignored `tmp/r4-sec-06` paths; they are not committed runnable tests and are not added to CI. In particular, the six frontend probes assert the **current defective behavior** for audit reproduction and must be reversed/expanded as regression tests when that behavior is corrected.

### Temporary React probe configuration and source

Create `tmp/r4-sec-06/frontend-audit.config.mjs` with:

```js
import base from '../../vitest.config.ts';
export default { ...base, test: { ...base.test, include: ['tmp/r4-sec-06/frontend-audit.test.jsx'] } };
```

Create `tmp/r4-sec-06/frontend-audit.test.jsx` from the source below and run `pnpm exec vitest run --config tmp/r4-sec-06/frontend-audit.config.mjs`. It reuses the existing blocked-network setup and module-boundary mocks; no Supabase client can connect.

```js
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { authMock, supabaseMock, deferred, query } from '../../src/test/mocks';
import App from '../../src/App';
import { DeleteAccountModal } from '../../src/components/UserProfile';
import { practiceSessionKey } from '../../src/lib/practiceSessions';

vi.mock('@/components/WordManagement', () => ({ default: () => <div>Words fixture</div> }));
vi.mock('@/components/AuthPage', () => ({ default: () => <div>Signed out fixture</div> }));
let signedOut;
beforeEach(() => {
  signedOut = [];
  authMock.user = { id: 'user-a', email: 'a@example.com' };
  authMock.signOut = vi.fn(async () => { signedOut.push(authMock.user?.id); });
  supabaseMock.from.mockImplementation(() => query({ data: null, error: null }));
  localStorage.setItem('vocab-app-theme', 'light');
});
async function open() {
  const mounted = render(<App />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'a@example.com' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  return mounted;
}
function confirm() { fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } }); }

it('baseline: only exact DELETE enables the button', async () => {
  await open();
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'delete' } });
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeDisabled();
  confirm();
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeEnabled();
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
});
it('reproduces confirmation carrying from A to B in the actual App', async () => {
  const sent = [];
  supabaseMock.rpc.mockImplementation(async name => { sent.push([name, authMock.user.id]); return { error: null }; });
  const mounted = await open(); confirm();
  authMock.user = { id: 'user-b', email: 'b@example.com' };
  await act(async () => mounted.rerender(<App />));
  expect(screen.getByPlaceholderText('DELETE')).toHaveValue('DELETE');
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeEnabled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete Account' })));
  expect(sent).toEqual([['delete_user_account', 'user-b']]);
});
it('reproduces A late success invoking current B signOut', async () => {
  const pending = deferred(); supabaseMock.rpc.mockReturnValue(pending.promise);
  const mounted = await open(); confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  expect(supabaseMock.rpc).toHaveBeenCalledExactlyOnceWith('delete_user_account');
  authMock.user = { id: 'user-b', email: 'b@example.com' };
  await act(async () => mounted.rerender(<App />));
  await act(async () => pending.resolve({ error: null }));
  expect(signedOut).toEqual(['user-b']);
});
it('reproduces Cancel closing a pending modal without cancelling completion', async () => {
  const pending = deferred(); supabaseMock.rpc.mockReturnValue(pending.promise);
  await open(); confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByPlaceholderText('DELETE')).not.toBeInTheDocument();
  await act(async () => pending.resolve({ error: null }));
  expect(signedOut).toEqual(['user-a']);
});
it('reproduces completion promise not awaited and no account-cache cleanup', async () => {
  const signout = deferred();
  const done = vi.fn(() => signout.promise);
  supabaseMock.rpc.mockResolvedValue({ error: null });
  const checkpoint = JSON.stringify({ userId: 'user-a', queueIds: ['word-a'], direction: 'en-to-geo', orderMode: 'db-order', allowReguess: false, correctCount: 0, totalAttempts: 1, mistakes: [{ english_word: 'Private word', user_answer: 'wrong', correct_definitions: ['private definition'] }] });
  localStorage.setItem(practiceSessionKey('user-a'), checkpoint);
  render(<DeleteAccountModal onClose={vi.fn()} onDeleted={done} />); confirm();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete Account' })));
  expect(done).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Delete Account' })).toBeEnabled();
  expect(localStorage.getItem(practiceSessionKey('user-a'))).toBe(checkpoint);
  await act(async () => signout.resolve());
});
it('late A error is shown on B but does not call signOut', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const pending = deferred(); supabaseMock.rpc.mockReturnValue(pending.promise);
  const mounted = await open(); confirm();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Account' }));
  authMock.user = { id: 'user-b', email: 'b@example.com' };
  await act(async () => mounted.rerender(<App />));
  await act(async () => pending.resolve({ error: { message: 'Synthetic A failure' } }));
  expect(screen.getByText('Synthetic A failure')).toBeInTheDocument();
  expect(signedOut).toEqual([]);
});
```

### Temporary PostgreSQL probes

Create `tmp/r4-sec-06/audit-cases.mjs` from this source. The late-failure trigger, restrictive FK and counterfactual privilege changes are confined to cloned synthetic databases inside a newly initialized local cluster. The polling deadline below bounds a real lock observation; it does not substitute a sleep for concurrency synchronization.

```js
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

export async function auditAccountDeletion({ admin, probe, clone, check, succeeded, executable, psqlArgs, env }) {
  const A = '00000000-0000-0000-0000-000000000001';
  const B = '00000000-0000-0000-0000-000000000002';
  admin('authorization_fixture', `
    INSERT INTO auth.users(id) VALUES ('${A}'),('${B}');
    INSERT INTO public.words(user_id,english_word,georgian_definitions,description)
      VALUES ('${A}','Alpha','["ა"]','private A'),('${B}','Beta','["ბ"]','private B');
    INSERT INTO public.test_history(user_id,test_direction,total_words,correct_count,mistakes)
      VALUES ('${A}','en-to-geo',2,1,'[]'),('${B}','en-to-geo',3,2,'[]');
  `);
  const snapshot = (db, owner) => admin(db, `SELECT jsonb_build_object(
    'users',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM auth.users x ${owner ? `WHERE id='${owner}'` : ''}),
    'profiles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.profiles x ${owner ? `WHERE id='${owner}'` : ''}),
    'words',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.words x ${owner ? `WHERE user_id='${owner}'` : ''}),
    'history',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.test_history x ${owner ? `WHERE user_id='${owner}'` : ''}))`);
  const denied = (result, code) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`ERROR:  ${code}:`));
  };
  check('late auth.users trigger failure rolls back all three preceding application deletes', () => {
    const db = clone();
    admin(db, `CREATE FUNCTION public.audit_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit-only late failure'; END; $$;
      CREATE TRIGGER audit_block_delete BEFORE DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.audit_block_delete()`);
    const before = snapshot(db);
    denied(probe(db, { sub: A }, 'SELECT public.delete_user_account()', true), 'P0001');
    assert.equal(snapshot(db), before);
  });
  check('unmodeled dependent-object FK failure also rolls back the complete deletion', () => {
    const db = clone();
    admin(db, `CREATE TABLE public.audit_dependency(owner uuid REFERENCES auth.users(id)); INSERT INTO public.audit_dependency VALUES ('${A}')`);
    const before = snapshot(db);
    denied(probe(db, { sub: A }, 'SELECT public.delete_user_account()', true), '23503');
    assert.equal(snapshot(db), before);
    assert.equal(admin(db, 'SELECT count(*) FROM public.audit_dependency'), '1');
  });
  check('victim IDs and service role in nested metadata cannot override trusted top-level A subject', () => {
    const db = clone();
    const beforeB = snapshot(db, B);
    succeeded(probe(db, { sub: A, claims: { user_metadata: { sub: B, user_id: B, role: 'service_role' }, app_metadata: { sub: B } } }, 'SELECT public.delete_user_account()', true));
    assert.equal(admin(db, `SELECT count(*) FROM auth.users WHERE id='${A}'`), '0');
    assert.equal(snapshot(db, B), beforeB);
  });
  check('valid but nonexistent trusted subject is an idempotent no-op, not proof an account was deleted', () => {
    const db = clone();
    const before = snapshot(db);
    succeeded(probe(db, { sub: '00000000-0000-0000-0000-000000000099' }, 'SELECT public.delete_user_account()', true));
    assert.equal(snapshot(db), before);
  });
  check('SECURITY INVOKER counterfactual breaks deletion without leaking partial changes', () => {
    const db = clone();
    const before = snapshot(db);
    admin(db, 'ALTER FUNCTION public.delete_user_account() SECURITY INVOKER');
    const result = probe(db, { sub: A }, 'SELECT public.delete_user_account()', true);
    denied(result, '42501');
    assert.match(result.stderr, /permission denied for table profiles/);
    assert.equal(snapshot(db), before);
  });
  check('revoking authenticated EXECUTE counterfactual prevents the feature without changing data', () => {
    const db = clone();
    const before = snapshot(db);
    admin(db, 'REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM authenticated');
    denied(probe(db, { sub: A }, 'SELECT public.delete_user_account()', true), '42501');
    assert.equal(snapshot(db), before);
  });

  const db = clone();
  const beforeB = snapshot(db, B);
  const context = `BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='10s'; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims='{"sub":"${A}","role":"authenticated"}';`;
  function session() {
    const child = spawn(executable('psql'), [...psqlArgs(db, 'authorization_gateway'), '-f', '-'], { env, windowsHide: true, stdio: 'pipe' });
    let out = '', err = '';
    let mark;
    const held = new Promise(resolve => { mark = resolve; });
    child.stdout.on('data', chunk => { out += chunk; if (out.includes('AUDIT_HELD')) mark(); });
    child.stderr.on('data', chunk => { err += chunk; });
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => { mark(); resolve({ status: code, stdout: out, stderr: err }); });
    });
    return { child, held, done };
  }
  const first = session();
  first.child.stdin.write(`${context} SELECT public.delete_user_account(); SELECT 'AUDIT_HELD';\n`);
  await first.held;
  const second = session();
  second.child.stdin.end(`${context} SET LOCAL application_name='r4-sec-06-second'; SELECT public.delete_user_account(); COMMIT;\n`);
  try {
    let blocking = '0';
    const deadline = Date.now() + 5000;
    do {
      blocking = admin(db, "SELECT count(*) FROM pg_stat_activity WHERE application_name='r4-sec-06-second' AND cardinality(pg_blocking_pids(pid)) > 0");
    } while (blocking === '0' && Date.now() < deadline);
    assert.equal(blocking, '1', 'Second real connection must demonstrably block behind first deletion');
  } finally {
    first.child.stdin.end('COMMIT;\n');
  }
  succeeded(await first.done);
  succeeded(await second.done);
  check('concurrent same-account deletions serialize on real row locks and preserve exact other-account data', () => {
    assert.equal(admin(db, `SELECT count(*) FROM auth.users WHERE id='${A}'`), '0');
    assert.equal(snapshot(db, B), beforeB);
    assert.equal(snapshot(db, A), '{"users": null, "words": null, "history": null, "profiles": null}');
  });
}
```

Create `tmp/r4-sec-06/generate-audit-runner.mjs` from this source. It derives a temporary runner from the audited baseline's isolation code without editing the original. It omits that runner's separate hardening-migration probes only in this supplemental copy; the unchanged full 200-group suite was independently run above.

```js
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const source = path.resolve('supabase/tests/authorization');
let script = readFileSync(path.join(source, 'run.mjs'), 'utf8');
script = script.replace("import { verifyAuthorization } from './cases.mjs';", "import { auditAccountDeletion } from './audit-cases.mjs';");
script = script.replace("import { verifySearchPathMigration } from './search-path.mjs';", '');
script = script.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = fileURLToPath(${JSON.stringify(pathToFileURL(source).href)});`);
script = script.replace(/      if \(name === '20261020175702_harden_trigger_function_search_paths.sql'\) \{[\s\S]*?      \}\r?\n/, '');
script = script.replace(/  check\('owner-approved metadata script[\s\S]*?\r?\n  \}\);/, '');
script = script.replace('verifyAuthorization({ admin, probe, clone, check, succeeded });', 'await auditAccountDeletion({ admin, probe, clone, check, succeeded, executable, psqlArgs, env });');
script = script.replaceAll('r4-sec-01-pg-', 'r4-sec-06-pg-');
script = script.replace('authorization checks; all application probes used non-bypassing roles.', 'audit groups (1 migration-chain + 7 supplemental groups); only disposable local fixtures.');
writeFileSync('tmp/r4-sec-06/pg-audit.mjs', script);
```

Run `node tmp/r4-sec-06/generate-audit-runner.mjs`, then `node tmp/r4-sec-06/pg-audit.mjs --pg-bin /path/to/local/postgresql-17/bin` (Windows audit used `tmp/r3-a01-pg/pgsql/bin`). Expected terminal summary: `PASS: 8 audit groups (1 migration-chain + 7 supplemental groups); only disposable local fixtures.` The two real concurrent sessions connect as `authorization_gateway`, switch only to `authenticated`, and have bounded database timeouts; the runner always attempts cluster shutdown.
