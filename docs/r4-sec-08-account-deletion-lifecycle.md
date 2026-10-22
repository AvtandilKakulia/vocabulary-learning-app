# R4-SEC-08 — Account deletion completion (F2 + F3)

Base: `786d24a47dfea7b5b827fcaa692ec444d92c46de`, after merged PR #47.
Prepared for independent review. No hosted Supabase access, real deletion,
schema/grant/RLS/migration changes, dependency changes or manual deployment.

## Findings and SDK evidence

F2: the old zero-argument `onDeleted()` invoked App's shared `signOut()` after
any successful RPC, including A's late response after switching to B. F3: the
callback was typed `void` and not awaited; its rejected promise escaped handling,
and the modal cleared its busy state before cleanup settled.

Installed supabase-js, auth-js and postgrest-js are **2.83.0**, unchanged.
Reviewed `GoTrueClient.signOut`, `_signOut`, `_acquireLock`, `_removeSession`,
`signInWithPassword`, `getSession`, Auth event delivery, and PostgREST transport.
The relevant sources are in the corresponding `node_modules/.pnpm` packages.

- `signOut` waits for initialization and its SDK session lock, then reads the
  session. It defaults to `global`. `local` changes the server logout scope,
  **not** which account's local storage is removed.
- After awaiting the logout request, `_signOut` calls `_removeSession` without
  comparing the stored UID to the UID it read earlier. The public API has no
  expected-UID/compare-and-remove parameter.
- `getSession()` releases its own lock before a later `signOut()` acquires one.
  Also, this installed `signInWithPassword` implementation saves the replacement
  session without acquiring that lock. Wrapping the application in another lock
  would not cover other tabs/SDK callers and would be an authentication redesign.
- The synchronous Auth callback used by F1 remains synchronous; no Auth method
  is awaited inside it. It invalidates A → B → A even when React batches renders.
- F1's request-specific Authorization header is retained. The shared client's
  later session lookup cannot retarget the deletion RPC to B.

The real SDK tests use public `createClient`, a configured in-memory storage
adapter, a controllable public `lock` option, `signInWithPassword`, `getSession`
and `signOut`, with injected synthetic HTTP responses. No private SDK methods or
private storage keys are read/written. Two counterexamples demonstrate that a
checked `local` sign-out can remove B: replacement while lock acquisition is
queued, and replacement while A's logout response is pending. The latter logs
out A remotely but removes B locally; the former sends B's token to logout.

Official references reviewed:

- [Signing out: global/local/others and token lifetime](https://supabase.com/docs/guides/auth/signout)
- [JavaScript signOut](https://supabase.com/docs/reference/javascript/auth-signout)
- [Session storage and refresh](https://supabase.com/docs/reference/javascript/auth-getsession)
- [Session replacement](https://supabase.com/docs/reference/javascript/auth-setsession)
- [Auth callback restrictions](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
- [Session lifetime](https://supabase.com/docs/guides/auth/sessions)

Sign-out revokes refresh capability, not already issued access JWTs immediately.
Deleting the account is likewise not proof that all issued JWTs have expired.
No token is displayed, logged or added to the operation registry.

## Deliberately non-destructive fallback

**There is no automatic shared SDK sign-out after deletion.** A getSession
precheck plus local signOut would be best effort and is not used. No direct
storage manipulation, service-role key, admin call, new auth client in production,
backend service or forced session replacement is introduced.

Every confirmed successful operation invokes the awaited completion callback,
even when its original dialog is obsolete. The still-mounted owning App checks
the operation's registry identity and confirmed `completing` phase, then records
its initiating UID in `deletedAccounts`. If that UID is active, its protected UI
is replaced with the existing sign-in screen and an explicit success message:
its saved sign-in was not removed automatically. If B is active when A succeeds,
B continues normally; a later return to A in the same App also shows the retired
UI. Failure and unknown outcomes do not record a deleted UID. This is app UI
retirement, **not a claim of SDK sign-out or session erasure**. Regular manual
sign-out behavior is unchanged and is never invoked by this completion path.

The callback receives the operation (including immutable accountId) and an
`isCurrent` guard for **dialog-local UI only**. Account retirement is deliberately
independent of that guard. App's fallback performs no asynchronous SDK operation:
its mount/registry/phase checks and UID-scoped state update execute synchronously.
The modal awaits the returned promise, handles both returned errors and rejection,
and checks `isCurrent()` before later modal UI updates. An obsolete dialog cannot
change B's new dialog or its draft. A new dialog for already-deleted A disappears
because App retires A, not because an obsolete dialog calls `onClose`. Completion
after the whole App unmounts cannot update that App or a replacement App instance.
Future asynchronous completion implementations must keep account-level recording
separate from guarded dialog effects and must not reintroduce shared sign-out.

## Operation outcomes, cancellation and retry

An App-owned map retains credential-free per-UID operations across dialog
remounts. A new operation object is reserved synchronously before RPC dispatch;
the modal also retains its synchronous single-flight guard. This blocks repeat
dispatch during RPC/cleanup, after confirmed success or cleanup failure, and
after uncertain outcomes in the same App lifetime.

| Outcome | UI and behavior |
| --- | --- |
| Successful HTTP RPC response | Database completion confirmed; always await UID-scoped completion, even if the dialog is obsolete. Retire that UID in the owning App. No second deletion submission. |
| Cleanup returns an error or rejects | Say deletion was confirmed but local cleanup failed. Do not present it as database failure or allow deletion again. |
| Explicit PostgreSQL/PostgREST error response | Say the database rejected deletion. Close/reopen and freshly type DELETE to retry, with all F1 checks again. |
| Rejected transport, status 0, gateway/malformed response | Say outcome is unknown and the account may be deleted. No automatic or same-App replay. Verify account status before any later attempt. |

Cancel is available during session preflight. Once the RPC is dispatched, Cancel
is natively disabled and its stale handler is guarded through completion.
Messaging explains that the request cannot be cancelled. Auth changes and actual
unmount still invalidate the UI; they cannot roll back an already-sent request.
After an error/terminal outcome, Close remains usable. If a fresh dialog observes
an older pending operation, it cannot start another; close/reopen to inspect the
eventual recorded outcome after failure/uncertainty. The old operation does not
mutate that new dialog; confirmed success instead retires its own UID at App level.

## Regression coverage and reproduction

```powershell
pnpm exec vitest run src/components/DeleteAccountLifecycle.test.tsx src/components/DeleteAccountModal.test.tsx src/components/UserProfile.test.tsx src/App.test.tsx src/contexts/AuthContext.test.tsx
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

The 23 F1 cases remain. Their successful deletion expectation now requires no
shared signOut plus explicit confirmed completion/sign-in UI; pinned token and
exactly-one zero-argument RPC assertions remain. The query mock gains HTTP status
and error-code metadata to distinguish a server rejection from uncertainty.

24 new cases cover actual App transitions (A → B, signed out, A → B → A,
A → null → B), both delayed RPC outcomes, new dialogs, stale/duplicate handlers,
Cancel and unmount, delayed/rejected/returned-error cleanup, missing cleanup
session, confirmed-failure fresh retry, four unknown outcomes, independent A/B
operations and pinned tokens. Installed-SDK probes verify B's actual stored
session bytes and resulting getSession identity, not only signOut call counts.
All operations are synthetic; real network is blocked by the existing setup.

Baseline comparison temporarily uses the unchanged main App/modal with the new
tests, restoring the fixed files afterward. Selected tests fail on late A
sign-out, enabled in-flight Cancel and premature cleanup completion; the corrected
implementation passes. The PR records final full-suite counts and CI run links.

Initial implementation validation at `c8d8e57427e41bfa3cd73517ae4b09474fed6c99`
(Windows, Node 24.22.0, pnpm 10.34.6):

- Focused five-file suite: **67/67** (23 F1, 14 App lifecycle, 5 completion
  contract, 5 real-SDK boundary, 20 existing App/Profile/Auth cases).
- Final complete suite: **751/751 in 35 files**, 66.29 s, unchanged default
  configuration (727 existing + 24 new).
- TypeScript and ESLint: passed, zero errors/warnings. Production build: passed,
  5.16 s; existing >500 kB chunk warning remains (520.62 kB main JS). Diff check
  passed. No dependency, configuration, timeout or worker changes.
- The first full run had **6 five-second timeouts** in the unchanged
  `History.pagination.test.tsx` (745 passed). Its isolated rerun passed **111/111**,
  then the complete run above passed. The intermittent History timing cause is
  not established or claimed fixed; no assertions were weakened or tests skipped.

### Follow-up: late success after A → B → A

Review found that both the modal and App gated completion on the old dialog's
`isCurrent()` result. After A → B → A, the operation became `deleted` but App's
`deletedAccounts` set never received A. The old transition test incorrectly
expected A's protected workspace to remain unchanged after its confirmed deletion.
That assertion now requires retirement for A success and still requires identical
UI for another account, failure or uncertainty.

Five permanent tests were added: three StrictMode A → B → A cases (success,
confirmed failure, unknown), an awaited completion contract with an obsolete A
dialog and a new B draft, and an installed-SDK case preserving B's exact session
object/storage bytes/new dialog before returning to deleted A. Existing App
unmount tests also verify a replacement App is unaffected. The 751 existing tests
remain, including F1 token pinning and single-flight protections.

Before the production correction, a targeted six-case run against the reviewed
head failed **four cases**: the corrected existing A → B → A success expectation,
the new success case without another dialog, the obsolete-dialog completion
contract, and the SDK case's later return to A. Failure/unknown cases passed.
This demonstrates the application defect independently of the test changes.

Follow-up validation (same Windows environment, unchanged default settings):

- Focused five-file suite: **72/72** (23 F1, 17 App lifecycle, 6 completion
  contract, 6 installed-SDK boundary, 20 existing App/Profile/Auth cases).
- Complete suite: **756/756 in 35 files**, 78.95 s, first full follow-up run
  (751 existing + 5 added). No intermittent failure occurred in this run.
- `pnpm exec tsc -b` and `pnpm lint`: passed, zero errors/warnings.
- `pnpm build`: passed, 9.12 s; existing >500 kB chunk warning remains
  (520.74 kB main JS). `git diff --check`: passed.
- No dependency, configuration, timeout, worker or F4 recovery-data changes.
  The PR contains the final commit's GitHub Actions results and run link.

## Remaining boundaries and manual review

- This fallback intentionally leaves SDK session storage untouched. A's token
  may remain until normal SDK expiry/refresh/replacement or separately initiated
  sign-out. It does not guarantee immediate JWT revocation or erase recovery data.
- Operation records/UI retirement are in-memory and scoped to one App instance.
  Full reloads, separate tabs and other clients do not share this registry; the
  existing zero-argument RPC has no durable request-status/idempotency protocol.
  Reload is not evidence that an uncertain deletion failed. Verify first.
- An already-sent A deletion may succeed after switching away, including when
  A later returns. Confirmed success retires A in the same App even if its original
  dialog is obsolete. B's SDK session, storage, workspace and dialog are untouched.
- F4 (Practice/Test/local recovery erasure and old writers) remains separate.
  Auth configuration, session expiry, RLS and the RPC are unchanged. This is not
  a claim that the entire account-deletion lifecycle is safe.
- Native cross-tab hosted Auth and actual production deletion are not tested.
  The SDK races use deterministic locks/storage/transport in Vitest.

Safe manual Preview checks: verify account identity and exact DELETE text;
switch/sign out before submitting and verify the dialog closes, with a fresh
empty confirmation on reopening. **Do not submit real deletion in hosted Preview.**
Review success, delayed completion and failure UI with the isolated tests above
or a separately approved disposable Auth environment. No Production operation
is needed to review this PR. Leave open for independent review; do not merge or
deploy as part of this task.
