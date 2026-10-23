# R4-SEC-12 — Production Auth migration and implementation plan

Status: proposed architecture and release gates, for independent review. This is
not an implementation approval or a deployment record. Reviewed on 2026-10-23
against main `63a6f239bc7d35f39e5db878e16c48692c6a8d48` (PRs #47–#51 merged).

**Production Auth implementation was not changed.** Only this document is added.
No hosted Supabase connection, credentials, SQL, Auth settings, deployment or
real account deletion was used. Product choices below are recommendations
requiring the owner's decisions, not silently approved requirements.

## 1. Decision and evidence boundaries

Recommend immutable Auth generations backed by transactional, account-bound
IndexedDB compartments, with one authoritative active generation per app
origin/project. Every Auth operation and authenticated data request must carry
an immutable capability; React and SDK notifications cannot select an account
by themselves. Confirmed account deletion permanently retires that UID locally;
ordinary logout retires the selected generation without forbidding future login.

Do not copy the PoC into production. The first implementation milestone is an
isolated SDK/storage compatibility test, followed by a separately reviewed SDK
decision. Complete application routing, legacy migration, full Auth acceptance
and rollback rehearsal are release prerequisites.

Evidence reviewed:

| Source | Established evidence and constraint |
| --- | --- |
| [R4-SEC-06](r4-sec-06-account-deletion-security-review.md) | Account deletion/security boundary and supplemental local SQL probes; a minimal PostgreSQL fixture is not a full Auth service. |
| [R4-SEC-08](r4-sec-08-account-deletion-lifecycle.md) | Initiating-account completion survives obsolete dialogs; success, failure and unknown outcomes differ; shared SDK logout is deliberately avoided. |
| [R4-SEC-09](r4-sec-09-local-recovery-erasure.md) | Awaited account-specific recovery erasure, retired-account markers and guarded writers; localStorage operations are not transactional. |
| [R4-SEC-10](r4-sec-10-auth-session-retirement-review.md) | Shared-storage logout/refresh hazards; browser credential erasure, remote revocation and access-JWT acceptance are different properties. |
| [R4-SEC-11](r4-sec-11-auth-generation-poc.md) and all eight files in `experiments/r4-sec-11/` | Prior executed evidence: 24 model groups, four unsafe controls, one expected failing-design reproduction; 24 native IndexedDB groups and eight multi-page/reload/restart scenarios, each in three final repetitions. These are prior results, not new executions for this document. |

The PoC demonstrates transactional admission/retirement, immutable namespaces,
activation fencing, native Web Locks/BroadcastChannel coordination, restoration
and rejection of a stale response even after an asynchronous snapshot read. It
also demonstrates a real SDK storage-error blocker. Its Auth service is synthetic,
automatic refresh is disabled, URL-session discovery is disabled, and it routes
only a sample words request. It does not establish production sign-up/email
callbacks, actual background refresh, managed Auth revocation, quota/eviction,
crash durability, old-application coexistence or complete application coverage.

The security boundary is cooperative application code in one browser origin.
Compartmentalization is not protection against XSS, malicious extensions or
arbitrary same-origin script access, and does not encrypt stored tokens. RLS and
server authorization remain authoritative; none is changed by this plan.

## 2. Actual production inventory

Repository searches covered `supabase`, `createClient`, `SupabaseClient`,
`useAuth`, Auth providers, `fetch`, WebSocket, XMLHttpRequest and service-worker
registration. Tests, experiments and scripts were inspected separately from
runtime consumers. There is one production client factory and eight files that
directly use the runtime singleton. No second production network client or
registered service worker was found. An already loaded old bundle or HTTP cache
still matters even without a service worker.

| Current file and operations | Required future capability integration / preserved contract |
| --- | --- |
| `src/lib/supabase.ts` | Replace runtime singleton construction only at the final bootstrap boundary; no legacy client initialization before migration admission. Preserve `Word`, `TestHistory` and other type imports/re-exports. Do not expose a mutable globally selected client as the replacement API. |
| `src/contexts/AuthProvider.tsx` | Initial `getSession`, Auth subscription, password sign-in, sign-up, ordinary `signOut`, exported `deleteAccount` and email-update wrappers. Route through the manager; only validated generation snapshots publish identity. The currently unused raw deletion wrapper must not become a bypass of the confirmed operation service. |
| `src/App.tsx` | Display-name profile read; logout menu; deletion-completion callback; retired-account workspace gate. Capture a profile-read capability and await account-bound logout outcomes. Keep recovery cleanup running despite UI unmount. |
| `src/components/UserProfile.tsx` | Profile read/update, direct email update, deletion dialog's synchronous Auth listener, session check and pinned-Authorization `delete_user_account` RPC. Fence profile and email stages separately; preserve partial failure reporting. Preserve exact confirmation, invalidation and completion behavior described below. |
| `src/components/words/useWords.ts` | Search and count RPCs, non-search page/count query, individual/bulk delete, normalized duplicate lookup, insert, optimistic update. Bind owner, credentials and each continuation; retain full records, sort-before-pagination, `search_words_count`, exact affected-row checks and unmodified microsecond version strings. |
| `src/components/FreeMode.tsx` | Full-vocabulary count/ranged reads and indirect result saving. Add generation fencing alongside account, request and Practice ownership checks on every batch; preserve progress/retry/order/reset state and ownership handoff. |
| `src/lib/practiceSaves.ts` | History insert and exact-result reconciliation after `23505`, including deferred work under a save Web Lock. Capture capability at initiation, recheck after lock admission and before reconciliation. Keep result identity and the UID/result single-flight registry across remounts. |
| `src/components/TestMode.tsx` | Count/ranged vocabulary loading; stable-ID History insert and collision reconciliation. Preserve frozen questions/options, zero-answer/draft restoration without dictionary refetch, save retry and persisted-copy-aware discard. |
| `src/components/History.tsx` | Complete count/ranged reads, scoped single delete, sequential confirmed bulk batches and authoritative refresh. Capture one initiating capability/scope; stop additional batches on invalidation. Keep incomplete/uncertain outcomes, explicit retry and exact remaining-ID confirmation. |

The factory is not counted among the eight consumers. No runtime request is
hidden merely because a React component no longer imports the singleton.
The following indirect interfaces also need explicit review and tests:

| Interface / files | Integration obligation |
| --- | --- |
| `src/contexts/AuthContext.ts`, `authState.ts` (which defines `useAuth`); `src/components/AuthPage.tsx`; `src/main.tsx` | Preserve compatibility exports and existing sign-in/sign-up completion semantics. A sign-up response without a session must not activate a generation. Provide explicit initialization/storage-error states; never briefly construct the legacy singleton while the new driver initializes. |
| `WordManagement.tsx`; `words/modals/WordModal.tsx`, `DeleteWordModal.tsx`, `BulkDeleteModal.tsx`, `DuplicateWordModal.tsx`, `ViewWordModal.tsx` | Callback chains retain their originating capability through save, refresh and modal completion. Preserve optimistic-concurrency conflicts and save/cancel protections. Type-only consumers such as `WordTable.tsx` and `history/HistoryRows.tsx` need no Auth behavior rewrite. |
| `src/hooks/useLatestRequest.ts` | Include generation/activation identity in operation contexts, retaining existing account, navigation, query and component-lifetime fences. A fresh generation for the same UID must invalidate old callbacks. |
| `practiceSessions.ts`, `activeTestSessions.ts`, `pendingTestResults.ts` | Recovery belongs to UID/result identity, not a reusable Auth token. Do not delete drafts on ordinary account switches, refresh events or generation replacement. Explicit new operations may bind a fresh capability to the same account-owned result. |
| `practiceOwnership.ts`, `historyDeletion.ts` | Keep editor/handoff/save Web Locks and account-scoped deletion registries. Auth coordination does not replace these locks. Invalidate queued work and stop future batches; an already dispatched request is not presumed cancelled. |
| `accountDeletion.ts`, `eraseAccountRecovery.ts`, `recoveryStorage.ts`, `src/hooks/useRetiredAccount.ts` | Central completion, retired-UID admission and exact recovery erasure must consume the new retirement outcome without dropping F1–F4. Check both stores during startup and before recovery admission. |
| Auth/data mocks and existing regression suites | Adapt to capability injection without weakening request identity, checkpoint, score, version, ownership or deletion assertions. Theme, Words and History preference storage are not Auth credentials or deletion recovery targets. |

The current context exports `user`, `loading`, `signIn`, `signUp`, `signOut`,
`deleteAccount` and `updateUserEmail`. Preserve public imports and compatible
promise signatures where possible. Additional status/capability APIs must be
explicit. Review the unused deletion wrapper's removal or safe delegation; do
not retain an alternate zero-confirmation destructive path just for convenience.

## 3. SDK/storage blocker: resolution must precede migration

`package.json` allows `^2.83.0`; `pnpm-lock.yaml` and installed `supabase-js` /
`auth-js` resolve to **2.83.0**. Installed `GoTrueClient._callRefreshToken`
creates an internal deferred, awaits `_saveSession`, and on a non-Auth exception
both rejects that deferred and throws to the public caller. With no concurrent
refresh waiter, the deferred has no rejection consumer. Catching the public
`refreshSession()` rejection therefore does not prevent the internal unhandled
rejection. R4-SEC-11's subprocess proves this; it is not a hypothetical warning.

The PoC adapter deliberately discards only its typed, already-retired write at
the SDK boundary. Real storage errors still propagate and expose the blocker.
That narrow discard does not prove quota/permission errors safe, and an SDK
success notification never establishes durable activation or credential erasure.

### New upstream evidence, not yet a compatibility result

Official release history identifies **2.112.4** as including the refresh deferred
fix. Earlier releases also changed default locking and sign-out failure behavior;
this cannot be treated as an isolated one-line dependency bump.
See the [official SDK changelog](https://github.com/supabase/supabase-js/blob/master/CHANGELOG.md).

[Upstream PR #2627](https://github.com/supabase/supabase-js/pull/2627) handles the
internally owned deferred while preserving rejection for public callers and
concurrent waiters. The change is present in
[tagged 2.112.4 Auth source](https://raw.githubusercontent.com/supabase/supabase-js/v2.112.4/packages/core/auth-js/src/GoTrueClient.ts).
This is source/release verification, **not an executed compatibility test**.
No package was installed or changed for this plan. 2.112.4 is a bounded candidate,
not a claim about the latest or universally safest release.

Since 2.107.0, upstream documents default lockless refresh coordination, storage
commit guards and deprecation of custom locks. These checks do not replace our
transactional retired-generation write denial.
See [the upstream migration note](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md).

| Option | Assessment and decision gate |
| --- | --- |
| Keep 2.83.0 plus a narrow retired-write adapter | Useful experimental control, not currently releasable: genuine setter failures still escape internally. Returning success on arbitrary errors or silently falling back to volatile persistence is unacceptable. Proceed only if an independently tested, supported strategy eliminates the failure while exposing durability failure truthfully. No such strategy has been demonstrated. |
| Validate an explicitly pinned newer SDK | Preferred path. Test 2.112.4 first because its tagged source contains the relevant fix. A later release is a separate recorded candidate, not an automatic broad upgrade. Execute the exact installed-version tests before updating the application's lockfile; review refresh, custom locks, callbacks, logout and storage side effects. |
| Different public lifecycle arrangement | `stopAutoRefresh` and newer `dispose` reduce future work but cannot cure a storage exception in an already-running refresh. Delaying client construction until admission is valuable; replacing refresh with private SDK internals or custom token handling is a larger unapproved redesign. |

The newer public [`auth.dispose()`](https://supabase.com/docs/reference/javascript/auth-dispose)
cleans up background resources; in-flight operations can still complete and write.
2.83.0 has no equivalent public disposal method. Validate the selected version's
actual public lifecycle rather than assuming the latest docs describe 2.83.0.

**Blocking task R4-AUTH-01:** an isolated harness must reproduce the existing
failure, then prove the candidate propagates real storage failures to callers
without unhandled rejection, resurrection or incorrect success. Exercise one
and multiple refresh callers, automatic refresh, initialize, sign-in, sign-out,
getter/setter/removal failures, quota, retired writes and disposal while requests
are pending. Observe process/browser unhandled errors without suppressing them.
Use a separate temporary dependency installation and synthetic transport first;
do not edit the application dependency graph in that task. Retain the old
negative control and distinguish SDK-specific results from architectural safety.

## 4. Target architecture and invariants

### Storage, identity and activation

- Store a versioned origin/project protocol record, active generation ID,
  activation revision, login-intent revision, immutable generation records and
  retired-account markers in IndexedDB. Exact schema/key names are a future
  reviewed contract. Unknown schema/project/protocol versions fail closed;
  migration must never erase an unknown store to make initialization pass.
- Each generation has an unpredictable immutable ID and its own SDK storage
  namespace, initially a candidate. Bind its UID once from a successful SDK
  Auth result; never infer account ownership solely from a storage key or an
  unverified decoded token. Session and auxiliary PKCE/SDK keys stay within that
  compartment. Rebinding A's client to B is forbidden.
- In a short transaction, validate candidate, UID, retirement state and captured
  login intent before activating. Network/SDK awaits do not occur inside the
  transaction. Restore only the already active committed generation; reload
  cannot manufacture a new activation from a residual token.
- Separate a user login intent from unrelated storage changes. The PoC's single
  selection counter can reject B if retirement of A commits between B's begin
  and activation. Specify and test both orderings: retirement must not activate
  B on its behalf or silently retry stale intent; an older A completion cannot
  defeat a later explicit B intent. Use distinct revisions or a documented
  conservative stale-login result with explicit user retry.
- Every SDK storage write rechecks generation/UID retirement in the same
  transaction as the write. A retired handle cannot recreate itself. Reads and
  removals are also namespace-bound; no blanket localStorage/IndexedDB clear.
  A failed/aborted transaction is not durable retirement.

One selected account across tabs preserves the current shared-login model.
Independent active accounts per tab would be a separate product change. Clients
and subscriptions belong to a realm-level manager, not a React effect whose
StrictMode cleanup permanently retires a session. Reference release/unmount,
account deactivation, ordinary logout and confirmed account deletion are distinct
operations with separate tests.

### Auth publication and authenticated data capabilities

Consumers receive an opaque capability representing UID, generation, activation
revision and initiating operation. Tokens remain inside the service boundary.
Capture at user intent or admission of a new background operation, not after an
unrelated await. Before dispatch, validate the capability and obtain credentials
only from that generation; pin the request's Authorization/owner. A token refresh
within A's generation may supply a newer A token, never B's token.

Use generation-bound public Auth methods; do not rely on changing a shared
client's default headers. Data services retain explicit `user_id` predicates,
original version predicates and confirmed ID sets. Revalidate before every page,
delete batch, post-lock insert and conflict-resolution query. No automatic retry
of a destructive or uncertain operation under a newly active capability.

After an await, recheck durable generation state and the current synchronous
UI generation/revision, plus existing request/navigation/unmount guards. The
second check matters: the PoC exposed a stale publication window after an
asynchronous snapshot read. Reads cannot publish A data into B; mutation
completion may update A's operation registry but not B's UI. Retirement cannot
recall a request already dispatched, so never claim server cancellation.

Auth callbacks are synchronous, lightweight signals. Do not await SDK methods
inside them or trust event session payloads as activation authority. Reconcile
from the store with sequence fencing, then publish a validated view. Explicit
identity transitions synchronously invalidate deletion intents before React can
batch A → B → A into one render. A same-account token refresh is not a new
Practice question or a reason to clear a draft.

The current client enables SDK URL-session detection by default; the PoC does
not. Before adopting it, specify how sign-up/email-confirmation callbacks locate
their pending generation/PKCE state and how unexpected or stale callback URLs are
rejected. No callback may implicitly override a newer B selection. Use supported
SDK flows and validate the returned UID; do not introduce custom token parsing
or accidentally remove confirmation behavior while isolating storage.

Pending Practice/Test saves retain UID/result identity across remounts. A new
generation for A may explicitly retry A's same result only after the existing
single-flight operation settles. Generation changes must not create a second
result ID or bypass result/save locks. A stale A continuation cannot acquire a
new B capability. Preserve exact payload comparisons after duplicate-ID errors.

### Tabs, reload, errors and session lifetime

BroadcastChannel, storage events, focus, visibility and `pageshow` are hints to
reread authority, not commands to switch accounts. Missed or forged messages
must not admit a retired generation. Guard actions even before notification
delivery. Cross-tab UI convergence is eventual; instantaneous removal of pixels
in a suspended tab is not promised. Transactional admission/write denial must
hold despite delayed notifications.

Before creating a client or resuming recovery on startup, validate store version,
active identity, retirement records in both Auth and recovery stores, and
migration state. Validate the restored SDK session's UID against its immutable
binding. Do not resurrect a retired UID because one store still contains a token.
Existing non-expired remembered sessions can follow supported SDK semantics;
expired sessions require successful refresh or sign-in. Offline refresh failure
must not silently become a different account or claim server validation.

Expose initialization, active, needs-sign-in, storage-unavailable, retired and
migration-blocked states distinctly. Recovery snapshots remain intact on ordinary
sign-out/account change. Storage failure denies new protected operations and
shows a retryable error; no implicit memory-only fallback. Eviction can destroy
local proof, including tombstones: require fresh sign-in with no legacy fallback,
and rely on server authorization for remote deletion. Power-loss durability and
browser persistence guarantees need separate empirical tests and limitations.

## 5. Retirement order and F1–F4 completion

For confirmed deletion of A, the completion service is independent of the dialog
or App mount and records A even when B or a newer A generation is active:

1. Verify the initiating operation identity and confirmed server success. Mark A
   unavailable in local memory immediately, invalidate its capabilities/UI, and
   deny all known A generations and pending candidates subsequently bound to A.
   Never invalidate B.
2. Commit the Auth retirement transaction: tombstone A, remove A's stored SDK
   credentials/auxiliary keys, deny future writes, clear the active pointer only
   if it names A, and preserve B's bytes and selection. Verify the committed
   outcome. **No `stopAutoRefresh`, disposal or network await precedes this
   transaction.** If it fails, retain local denial and report lack of durability.
3. Run/await existing F4 retirement-marker and exact recovery-erasure work even
   if Auth storage fails. Attempt both independently and collect both outcomes;
   a single rejected promise must not skip the other cleanup domain.
4. Notify peers after committed changes. Start resource cleanup on A clients
   using the selected SDK's supported APIs. A slow, failed or hung cleanup must
   not delay the durable transaction or B's usability. Track cleanup separately;
   late requests still face transactional write denial and publication fences.
5. Report the verified local outcomes, residuals and remote limitations. Retry
   only idempotent, scoped local cleanup after partial failure; never replay the
   deletion RPC. Do not restore credentials to undo a cleanup error.

This reverses the PoC's problematic `await stopAutoRefresh()`-before-transaction
ordering. Tests must pause/reject that SDK call and prove durable denial commits
first. SDK disposal is neither credential erasure nor cancellation of all HTTP
requests. Already completed remote actions cannot be rolled back by UI fencing.

Preserve these existing safeguards without reinterpretation:

| Safeguard | Required invariant |
| --- | --- |
| F1 intent | Immutable initiating UID/email and exact `DELETE`; synchronous single-flight; permanent invalidation when identity changes, including A → B → A. Recheck before/after session retrieval. |
| Deletion request | Zero-argument RPC, initiating session's pinned Authorization, no rebinding to a replacement client. A new dialog cannot inherit an old operation's authority. |
| F2/F3 outcomes | Confirmed success retires A even with obsolete/unmounted UI. Confirmed failure does not retire A. Lost/ambiguous responses remain unknown and cannot trigger automatic destructive replay or credential erasure. |
| Completion | Await account-scoped local completion; preserve operation/result identity and B's exact SDK/recovery storage. No shared SDK `signOut`. App rendering is subordinate to retired-account admission, including return to A. |
| F4 cleanup | Retire guarded writers and erase only A's validated Practice/active-Test/pending-Test recovery keys. Preserve ambiguous legacy recovery and report it; never clear unrelated preferences or B. |

Current operation registries are realm-local. A credential-free durable completion
journal is a proposed part of the future deletion integration, not an existing
guarantee: it may record initiating UID, operation ID and verified outcome, never
tokens. On reload, unknown operations must stay non-replayable. If that journal
cannot be written, explicitly report that cross-reload knowledge is unavailable;
server reconciliation of an unknown deletion is a separate design requirement.

### Two stores are not one transaction

| Auth retirement | F4 recovery outcome | Required behavior and truthful status |
| --- | --- | --- |
| Verified | Verified | A is locally denied; both new-store credentials and scoped recovery are removed. Check legacy residuals separately before any broader erasure claim. B is unchanged. |
| Verified | Failed/incomplete | Auth tombstone blocks A admission and new recovery writers. Report remaining recovery; retry F4 locally. Do not call this complete local cleanup. |
| Failed | Verified | Recovery marker must block A restoration before any Auth client starts, despite residual Auth credentials. Keep in-memory denial; report Auth residual and retry its transaction. No claim of credential erasure. |
| Failed | Failed | In-memory denial only in the initiating realm unless another durable marker was actually verified. Report both failures and the reload/other-tab gap; do not claim durable retirement or attempt unsafe broad clearing. |
| Commit acknowledgement uncertain | Either | Read authoritative scoped state and verify before claiming success. Until verified, preserve the uncertain outcome; do not rerun the remote deletion. |

Cross-checking both stores narrows crash gaps but cannot make their writes atomic.
Test interruption before/between/after each commit, removal failure, blocked reads
and reload. An unreadable authoritative store is not proof that no retirement
exists. No automatic fallback into a legacy session is permitted.

## 6. Ordinary sign-out is a separate account-bound operation

The current `auth.signOut()` has implicit **global** scope. Recommend preserving
that cross-device scope pending the owner's explicit decision; local-only logout
is a valid alternative with a different product promise. Make the scope visible
and intentional. This is not the account-deletion completion pathway.

Capture UID, generation, operation and an explicit request token at click time;
join/deny duplicate clicks synchronously. Immediately deny that generation,
commit its scoped local retirement, then perform any remote revocation with the
captured identity. A new B session cannot be selected from storage at dispatch.
Do not permanently tombstone A's UID for ordinary logout; intentional A login is
allowed afterward. Preserve recovery snapshots unless a separate product action
explicitly discards them.

Validate a supported explicit-token remote logout API in the selected SDK and
full disposable Auth environment. R4-SEC-10 investigated the public
`auth.admin.signOut(jwt, scope)` surface; its name is not authorization to put an
admin/service-role secret in a browser. Verify end-user-token behavior and absence
of shared local removal. If no supported account-bound remote path passes, stop
that implementation rather than using private SDK methods or current-user logout.

| Ordering / outcome | Required behavior |
| --- | --- |
| Queued A logout, B selected before dispatch | Only the captured A operation can retire/revoke A; it cannot fetch B's token or clear B. A stale UI callback with no admitted operation does nothing. |
| In-flight A logout, then B login | B's exact compartment and UI remain intact regardless of response ordering. |
| A returns as a new generation | Local retirement targets the old generation. Global remote scope can affect other/new A sessions as a product consequence; test/document this instead of confusing it with cross-UID isolation. |
| Remote failure, timeout or lost response | Report local retirement and remote failure/uncertainty separately. Never restore A's token as rollback or claim global logout succeeded. Explicit remote retry may use only an available captured A credential; do not persist a new token copy just to retry. |
| Local persistence failure | Deny the initiating generation in memory and report residual credentials/reload risk; do not claim a completed local logout. B remains usable where its own valid storage is available. |

Global logout revokes refresh sessions but does not imply immediate invalidation
of all issued access tokens. Supported scopes and that limitation are described
in [Supabase sign-out guidance](https://supabase.com/docs/guides/auth/signout).

## 7. Legacy migration and rollback contract

### Recommended cutover

Preserve remembered login after migration through the new persisted compartments.
Recommend a **one-time explicit fresh sign-in** at cutover, subject to owner
approval. Automatically importing a live shared slot while old writers exist is
not proven safe. Do not parse/copy legacy credentials into a new active generation
just to avoid a sign-in prompt. Account-scoped Practice/Test recovery must survive
this prompt and remain available to its matching account afterward.

1. Before any SDK client is constructed, inspect an explicitly configured legacy
   storage-key contract and the new migration protocol. The current singleton
   relies on the SDK default key; document the exact project-specific key and
   auxiliary-key ownership using isolated configuration, not production secrets
   or broad `sb-*` enumeration/deletion. A legacy key indicates possible residual
   credentials, not authority to activate its embedded UID.
2. If the new store is valid and migrated, restore only its admitted active
   generation. Never silently fall back to the legacy slot after error, missing
   selection, logout or retirement. A new namespace alone does not erase it.
3. If migration is needed, show the approved transition/fresh-login state before
   refresh can start on the old client. Preserve recovery/preferences. An expired
   legacy session receives the same explicit sign-in path; offline users retain
   their data and get a retryable offline state, not invented authentication.
4. Create a candidate in the new compartment; successful authentication, immutable
   UID binding and transactional admission establish the new session. Persist
   migration progress without credentials. On lost acknowledgement, reconcile
   the committed state instead of blindly repeating sign-in or activation.
5. Clean known legacy Auth keys only under the approved old-tab policy and
   ownership checks. Compare the expected owned value immediately before removal
   and verify afterward, but acknowledge that localStorage comparison/removal is
   not atomic against an unaware writer. If another account occupies that slot,
   preserve it and report residuals; do not remove B to finish A's cleanup.
6. Record migration complete separately from verified legacy erasure. If
   cleanup fails, the new session can only proceed under an explicitly approved
   residual-credential policy. Preserve denial markers, offer scoped cleanup retry
   and state precisely what remains. Never use shared `signOut` as a cleanup trick.

### Old tabs and cached code are a release decision

A newly introduced BroadcastChannel protocol cannot compel an already loaded
old bundle to stop refreshing or writing. A prior bridge release can make future
cooperative tabs quiesce, but cannot retroactively control older uninstrumented
tabs. Heartbeats or acknowledgements are not proof that every suspended tab is
gone. An old cached build can also ignore migration markers after reload.

Recommend a staged compatibility/upgrade gate and explicit close/reload guidance,
with migration blocked where safe legacy cleanup cannot be established. The
owner must choose between a clearly bounded residual-credential transition and
a stricter cutover requirement that may need a separate enforceable deployment/
backend design. **No complete erasure guarantee is possible while an unaware old
writer may still run.** If zero residual exposure is required, this is a release
blocker, not something the client-only PoC solved. Do not invent a new origin,
backend or Auth policy within an implementation PR to bypass that decision.

### Migration failure and rollback cases

| Case | Recovery / rollback rule |
| --- | --- |
| IndexedDB blocked, quota exceeded or schema invalid | Do not activate a volatile substitute or initialize the legacy SDK. Preserve data, display the exact recoverable condition and permit explicit retry after the condition changes. |
| Candidate persisted, authentication/activation fails | Candidate cannot become active implicitly; clean only that candidate's compartment through an idempotent scoped path. Never adopt a newer selection or erase another account. |
| Crash before activation / after activation / during legacy cleanup | Reconcile committed protocol and selection state; leave uncertain legacy erasure visible. Test every boundary with fresh tabs/restarts. |
| All new state evicted while legacy bytes remain | Missing new state is not permission to resurrect legacy login. Fresh sign-in and the approved legacy-transition policy apply; no guarantee survives deletion of all local retirement evidence. |
| New version encounters unsupported newer schema | Stop protected admission with an upgrade/recovery message. Do not downgrade, clear or reinterpret records. |
| Rollout stopped before any user migrates | Reverting inert code/SDK selection can be considered after compatibility checks; no new persisted contract has been created. |
| Rollout stopped after users migrate | Roll forward to a compatible safe-shell/recovery build that honors the same protocol and tombstones. Disable new migration, not existing write denial. Reverting to the pre-generation application is unsafe. |

No rollback may copy erased credentials back, discard retirement markers, clear
the entire site or destroy B's recovery to make A's migration succeed. A build
switch alone cannot stop old code already running; rollback rehearsal must include
mixed versions, suspended tabs and cached reloads.

## 8. Remote security boundary

| Property | What this architecture provides / separate work |
| --- | --- |
| A. Local browser credential erasure | Transactional removal/write denial for admitted compartments, plus separately verified legacy cleanup. Limited by storage failures, eviction, old writers, browser behavior and same-origin compromise. |
| B. Remote refresh-session revocation | A generation tombstone does not revoke a server session. Ordinary scoped logout can request supported revocation; deletion cascades and post-deletion refresh behavior need full Auth validation. Stronger guarantees after lost responses/offline deletion may require a separate backend/Auth-policy project. |
| C. Immediate rejection of issued access JWTs | Neither local deletion nor a successful logout proves this. A server-enforced live-user/session check or other reviewed policy may be needed if immediate rejection is required. JWT expiry/lifetime choices are owner/security decisions; no changes are authorized here. |

The [Supabase session model](https://supabase.com/docs/guides/auth/sessions)
describes token/session lifetimes; it does not convert client retirement into
server authorization. Test access and refresh tokens separately against a full
disposable Auth service. Existing PostgreSQL fixtures cannot demonstrate managed
Auth session cascades, refresh rotation or gateway/JWT behavior. No privileged
key belongs in the frontend, and this plan introduces no Edge Function, SQL,
RLS change or Auth configuration.

## 9. Measurable acceptance gates

All gates must be recorded against exact dependency versions and commits. Use
explicit deferred responses, lock/transaction barriers and event acknowledgements,
not arbitrary sleeps or increased test timeouts. A listener that observes an
unhandled error must fail the run, not prevent its default handling. Deterministic
race cases require at least ten fresh-process repetitions; native multi-page
matrices require at least three fresh-profile runs plus supported-browser coverage
approved by the owner. Counts supplement assertion quality, not replace it.

| Gate | Required passing evidence | Environment |
| --- | --- | --- |
| G1 SDK storage failures | Existing 2.83 failure reproduced; candidate's caller/waiter errors remain observable; zero unhandled rejections, false durability success or retired writes across initialize, refresh, logout and disposal. | Installed SDK, synthetic transport, real browser storage failures |
| G2 Identity/activation | A → B → A, competing logins, same-UID generations, both B-activation/A-retirement orderings, stale candidates and late Auth events cannot select an obsolete identity. B's stored bytes, SDK identity and UI remain exact. | Deterministic model and native IndexedDB |
| G3 Retirement | Durable denial commits before paused/rejected SDK cleanup; in-flight writes, retries and queued operations cannot restore A. Confirmed deletion retires all A generations; ordinary logout permits later A login. | Native transactions, deferred SDK calls |
| G4 Complete routing | Inventory above has no mutable-singleton escape. Every Auth method and data path has captured UID/generation, pre-dispatch and post-response checks; verify credentials, query owner, batch IDs and no partial publication. | Full component/service regression tests, negative controls |
| G5 Refresh/logout | Real scheduled refresh, duplicate callers, lost responses, global/local scopes, A logout queued or in flight while B signs in; callback reentrancy and disposal tested. No public API error hidden. | Synthetic deterministic races plus full disposable Auth |
| G6 Publication/lifecycle | Delayed snapshot and notification after newer selection, batched A → B → A, StrictMode mount/unmount, pending saves and navigation cannot publish stale UI or clear unrelated drafts. | React and native browser |
| G7 Persistence/tabs | Delayed/missed/forged hints, suspended tab resume, reload and full browser restart reject retired sessions. Graceful restart and forced termination are reported separately. | Multi-page real browsers; native Web Locks/BroadcastChannel |
| G8 Storage failures | Blocked open/read/write/remove, transaction abort, quota and eviction never become silent volatile login, cross-UID removal or claimed cleanup. Crash gaps between Auth and F4 stores reported correctly. | Native failure injection plus actual browser quota/denial/eviction where reproducible |
| G9 Legacy/rollback | Remembered login, expired/offline legacy state, two accounts, unaware/cooperative old tabs, cached bundles, partial migration, newer schema and compatible rollback preserve B and tombstones. Residual claims match bytes. | Versioned native fixtures and Preview on approved policy |
| G10 Deletion F1–F4 | Exact confirmation, permanent invalidation, pinned Authorization, synchronous single-flight, late success/failure/unknown, obsolete/new dialogs, unmount, awaited cleanup and exact B storage all preserved. Unknown RPC is never replayed. | Existing 803-test baseline plus new deterministic/native tests |
| G11 Remote boundaries | Disposable A/B accounts; refresh rotation, deletion cascade, remote logout, old-token requests and lost responses establish exactly which A/B/C guarantees hold. No production accounts. | Full isolated local Supabase Auth stack, or separately authorized disposable nonproduction project |
| G12 Regression/release | Existing 803 frontend tests, 200 authorization checks and 30 word-version groups remain present; typecheck/lint/build and CI pass. Legitimate additions explain counts. Rollout/rollback and credential-free diagnostics reviewed. | Existing CI plus explicitly executed native/full-Auth jobs |

A local PostgreSQL cluster alone satisfies neither G5's real Auth portion nor
G11. If a full isolated service or required browser is unavailable, mark those
gates unexecuted and block release; Production is never the fallback. Preview
builds must use isolated fixtures or an approved disposable service, not copied
Production environment secrets.

## 10. Owner decisions required before activation

| Decision | Recommended default | Alternatives and security/UX consequences | Blocks |
| --- | --- | --- | --- |
| Remembered login after migration | Preserve persisted login in admitted generations. | Session-only login reduces persistence but changes current UX; private-mode behavior still needs explicit handling. | Storage/UX contract |
| One-time fresh sign-in | Require once; preserve account recovery. | Import legacy credentials only after a separately proven ownership/quiescence protocol; avoids prompt but increases migration risk. | Legacy implementation |
| Old-tab policy | Staged compatible release, reload guidance, block unsafe transition. | Accept explicit temporary residuals, or require enforceable quiescence in a separate design. Client hints alone cannot prove all old tabs stopped. | Cutover |
| Local/global ordinary logout | Retain current global scope, make its meaning explicit. | Local scope preserves other devices but changes the existing cross-device promise. | Logout implementation |
| Storage unavailable | Fail closed with retry and preserved recovery; no silent fallback. | Explicit nonpersistent mode is a separate product/security feature with weaker restart guarantees. | Admission/error UX |
| Residual legacy credentials | Do not claim erasure; block a guarantee of complete erasure until verified. | A bounded, clearly disclosed transition may be acceptable; owner must define duration/exit conditions. | Deployment and success wording |
| Remote revocation after deletion | Validate existing behavior first; do not equate local cleanup with revocation. | Require guaranteed revocation/reconciliation through a separate backend project. | Remote-security acceptance |
| Issued JWT lifetime / immediate rejection | Keep current policy during client work and disclose limits. | Immediate server rejection or shorter lifetime needs separate policy review/testing; no silent setting change. | Security promise/release if mandatory |
| Multiple tabs' active account | One active origin/project account, matching current model. | Independent per-tab accounts require separate UX and capability/storage design. | Manager contract |
| Supported browsers/storage persistence | Validate currently supported desktop/mobile browsers before activation; document storage/eviction limits. | Narrowing support is a product decision, not an unannounced IndexedDB assumption. | Browser release matrix |
| Full-Auth acceptance environment | Disposable local stack; otherwise separately authorized isolated nonproduction service. | No environment means unexecuted gates and no release. Never Production. | G5/G11 |
| Rollback artifact | Maintain a forward-compatible safe-shell build before enabling migration. | Pre-migration rollback only before any durable cutover; cannot reopen old credential storage afterward. | Deployment |

These decisions need not block R4-AUTH-01's isolated compatibility work. They must
be resolved before dependent implementation starts; this document does not answer
them on behalf of the owner.

## 11. Ordered, independently reviewable implementation tasks

All file names below are proposed future scope, not changes in this PR. Execute
serially. Each PR must preserve the accepted contract and pass existing checks;
no dependent implementation proceeds while its security decisions are unresolved.
New inert modules must have no import-time SDK/storage side effects. The final
driver is selected once at bootstrap, never component by component.

### R4-AUTH-01 — Prove SDK storage-error compatibility

- **Objective/scope:** smallest useful milestone: reproduce 2.83.0 and test a
  pinned 2.112.4 candidate in new `experiments/r4-auth-01/` plus its evidence doc.
  Reuse synthetic fixtures without editing R4-SEC-11 or application dependencies.
- **Prerequisites:** this plan accepted for investigation; public release/source
  evidence recorded. No production product decisions needed yet.
- **Acceptance/tests:** G1, focused G3/G5; public error preserved, zero unexpected
  rejection; ten fresh-process repetitions and three native runs. Include failing
  storage, multiple waiters, real auto-refresh and in-flight disposal controls.
- **Risk/rollback:** newer lockless/logout behavior may invalidate assumptions;
  record a failed candidate honestly. Remove isolated harness if abandoned;
  production remains unchanged.
- **Behavior/deployment/manual/model:** no production change/deploy; native
  verification required. **6 astra / xhigh**. If no candidate passes, stop here.

### R4-AUTH-02 — Adopt only the verified SDK candidate

- **Objective/scope:** `package.json`, `pnpm-lock.yaml`, narrowly relevant SDK
  compatibility tests and decision doc; explicit chosen version, no mass upgrade.
- **Prerequisites:** R4-AUTH-01 passes with a reviewed release-difference matrix.
- **Acceptance/tests:** all existing tests and G1/G5 against the application
  install; compare current singleton sign-in/up, refresh, callbacks and logout;
  full disposable Auth smoke before release. No generation migration yet.
- **Risk/rollback:** dependency behavior changes, especially locks and sign-out
  failures. Revert this isolated upgrade before any new storage contract exists
  if regressions appear; do not proceed to integration on a failing candidate.
- **Behavior/deployment/manual/model:** runtime dependency changes; independent
  Preview/manual Auth checks and explicit deployment approval required.
  **6 astra / xhigh**.

### R4-AUTH-03 — Transactional generation storage contract

- **Objective/scope:** new inert `src/lib/auth/generationStore.ts`, SDK storage
  adapter, scoped tests and protocol doc; no provider/bootstrap wiring.
- **Prerequisites:** verified SDK and approved persistence/storage-failure choices.
- **Acceptance/tests:** immutable namespace/UID, activation-intent revisions,
  retirement/write denial, idempotent cleanup, unknown-schema rejection; G2/G3/G8
  with model and native transaction barriers, quota/abort/read failures.
- **Risk/rollback:** transaction atomicity does not imply power-loss or cross-store
  atomicity. Revert unused modules; leave any test fixtures isolated. No real
  credentials may be imported while testing.
- **Behavior/deployment/manual/model:** no active production behavior change;
  native storage tests, no deployment needed. **6 astra / xhigh**.

### R4-AUTH-04 — Manager, capabilities and publication lifecycle

- **Objective/scope:** new inert manager/capability/publication modules under
  `src/lib/auth/`, a tested provider-driver interface and dedicated tests.
- **Prerequisites:** R4-AUTH-03, approved active-tab and lifecycle semantics.
- **Acceptance/tests:** G2/G3/G6/G7; durable retirement before SDK cleanup; synchronous
  post-read publication fence; sign-in/up/restore and same-UID replacement; real
  scheduled refresh and StrictMode without permanent retirement on unmount.
- **Risk/rollback:** event reentrancy and accidental reactivation; old/new client
  creation must remain exclusive. Revert unused driver, preserving old runtime.
- **Behavior/deployment/manual/model:** inactive only; native multi-page tests
  required, no production deployment required. **6 astra / xhigh**.

### R4-AUTH-05 — Prepare capability-bound data adapters

- **Objective/scope:** inert `src/lib/authenticatedData/` adapters and contract
  tests for profiles, words/search, Practice/Test saves and History; exact query
  and payload equivalents to the inventory. Do not wire some consumers early.
- **Prerequisites:** immutable capability API frozen and security-reviewed.
- **Acceptance/tests:** G4; each query's UID/token, full pagination, versions,
  counts, confirmed IDs, stable result identity and post-lock checks. Existing
  data/selection/scoring tests remain strict; all eight consumer paths mapped.
- **Risk/rollback:** wrapper extraction could change query semantics; compare
  emitted operations exactly. Revert unused adapters with no storage migration.
- **Behavior/deployment/manual/model:** no active behavior change/deploy; bounded
  contract tests. **6.1 sol / high**, with **6 astra / xhigh** security review of
  capability boundaries before wiring. No parallel design decisions delegated.

### R4-AUTH-06 — Account-bound ordinary logout service

- **Objective/scope:** inert `src/lib/auth/signOut.ts`, manager integration tests
  and logout UX contract; no account-deletion behavior folded into logout.
- **Prerequisites:** owner scope decision; explicit-token public API verified on
  the selected SDK and a full disposable Auth service.
- **Acceptance/tests:** all ordinary-logout cases in section 6, G5; exact B
  session/storage preserved on queueing, pending response and rejection; local
  retirement distinct from remote outcome, same-UID future login allowed.
- **Risk/rollback:** global scope intentionally affects other A sessions; a
  local transaction cannot undo server revocation. Revert inactive wiring only;
  never restore credentials to compensate for a failed logout.
- **Behavior/deployment/manual/model:** inactive until cutover; disposable-account
  manual tests required, no production deploy. **6 astra / xhigh**.

### R4-AUTH-07 — Integrate deletion completion and recovery retirement

- **Objective/scope:** prepare completion service under `src/lib/auth/` and tests
  alongside `accountDeletion.ts`, `eraseAccountRecovery.ts`, `recoveryStorage.ts`;
  design credential-free outcome journal and two-store reconciliation. Keep the
  existing active path unchanged until atomic wiring.
- **Prerequisites:** R4-AUTH-03/04/06; approved partial-failure/residual wording.
- **Acceptance/tests:** every F1–F4 invariant and section 5 matrix, G10; late A
  success/failure/unknown, unmount, B exact bytes, all crash boundaries, no RPC
  replay. Both cleanup domains attempted even when one fails.
- **Risk/rollback:** falsely durable unknown/completion records and cross-store
  gaps. Revert unused service; once enabled, rollback must retain all tombstones
  and journal interpretation. Do not clear recovery to repair Auth storage.
- **Behavior/deployment/manual/model:** prepared/inactive; full disposable Auth
  and native failure tests required. **6 astra / xhigh**.

### R4-AUTH-08 — Legacy gate and complete application wiring

- **Objective/scope:** approved migration module, `src/main.tsx`, client factory,
  Auth context/provider, App, UserProfile, words hook, FreeMode, practiceSaves,
  TestMode, History and necessary callback/request guards from the inventory.
  Connect one complete driver behind an explicit bootstrap selection, initially
  inactive in production. No per-component split between old/new credentials.
- **Prerequisites:** all prior tasks; owner legacy/old-tab/residual choices;
  transitional release design and safe-shell rollback artifact reviewed.
- **Acceptance/tests:** G4/G6/G9/G10; complete repository search finds no runtime
  bypass. Both boot modes are tested; the new mode never constructs the legacy
  singleton, the old mode never starts generation migration. URL/email callbacks,
  signup without session and API-compatible imports are covered.
- **Risk/rollback:** this is the necessary atomic integration boundary, not an
  excuse for unrelated refactoring. Disable before migration; afterward only
  roll forward compatibly. Unknown old tabs can still block release.
- **Behavior/deployment/manual/model:** new behavior in isolated Preview only;
  production activation forbidden in this PR. Manual full-flow testing required.
  **6 astra / xhigh**.

### R4-AUTH-09 — Full application acceptance and rollback rehearsal

- **Objective/scope:** bounded native/disposable-Auth harness scripts, fixtures,
  documented results; no new production architecture or weakened assertions.
- **Prerequisites:** accepted contracts and complete Preview wiring; approved
  disposable environment and supported-browser matrix.
- **Acceptance/tests:** execute G1–G12, repeat all races, inject storage/crash
  failures, compare exact B bytes, exercise every screen and mixed-version
  migration; prove compatible rollback does not resurrect A. Record actual
  browser/service versions and every unexecuted case as a blocker.
- **Risk/rollback:** synthetic transport can miss server behavior; report full
  Auth separately. Revert test tooling only; a failure returns to its prerequisite
  implementation PR rather than changing the test promise.
- **Behavior/deployment/manual/model:** no production changes; native and manual
  disposable-account checks required. **6.1 sol / high** for bounded matrix
  execution; **6 astra / xhigh** reviews security failures and release evidence.

### R4-AUTH-10 — Owner-approved compatible rollout

- **Objective/scope:** release decision, activation/compatibility configuration,
  runbook and narrowly required final UX wording; no opportunistic feature work.
- **Prerequisites:** all gates pass, owner table resolved, independent review,
  tested rollback artifact, environment separation and explicit deploy approval.
- **Acceptance/tests:** fresh-login migration, remembered-login restart, every
  screen, ordinary logout and non-destructive smoke checks pass; no secret-bearing
  logs; migration and old-tab stop conditions actionable.
- **Risk/rollback:** mixed versions and irreversible local erasure. Stop new
  admissions, preserve existing compartments/tombstones and deploy only a
  compatible safe shell. Never restore old tokens or pre-generation fallback.
- **Behavior/deployment/manual/model:** this changes production behavior and
  requires separate owner-authorized deployment plus manual verification. No
  production deletion is part of smoke testing. **6 astra / xhigh**.

## 12. Release procedure, stopping and recovery

1. Complete isolated SDK/storage tasks and full checks before wiring. Record exact
   tested versions; retain negative controls and original regression assertions.
2. In Preview, use synthetic/disposable Auth only. Exercise sign-in/up, email
   update/confirmation, ordinary logout, session expiration, all data modes and
   pending results, then multi-tab/reload/rollback. Do not inherit Production
   secrets merely because Preview normally uses the same Vercel project.
3. In a full disposable Auth service, create only synthetic A/B accounts and
   verify remote A/B/C boundaries and deletion. Owner approval is required for
   any hosted disposable environment; it is never the existing Production
   project. No SQL or service-role key is added to the frontend.
4. Before Production approval: resolve the owner table, publish measured gate
   evidence, approve legacy residual/old-tab policy, test the compatible rollback
   build, and confirm previous clients cannot be falsely reported erased. If
   this cannot be guaranteed to the chosen standard, do not activate migration.
5. After a separately authorized deployment, perform non-destructive smoke tests
   with approved test accounts: fresh/remembered login, account switch, profile
   read, Words/Practice/Test/History reads and logout. Verify existing saved drafts
   are preserved. Production account deletion is not authorized by this plan.
6. Stop rollout on any B mutation, retired credential resurrection, unknown
   deletion replay, singleton bypass, unhandled storage error, false cleanup
   success, unexpected migration fallback or failing baseline regression.
7. Disable new migration/admission using the pretested compatible path. Already
   migrated sessions retain the same tombstone/storage reader and write denial.
   A safe shell can deny protected work while preserving recoverable data. Do
   not switch these users back to the old shared-slot implementation.
8. Repair forward, verify scoped durable state and permit explicit retries of
   local cleanup or safe sign-in. Remote side effects and erased secrets cannot
   be undone by reverting a commit. Capture diagnostic reason codes/operation
   stages without tokens, passwords, recovery answers or raw session dumps.

No automatic rollout or future implementation task is authorized by this planning
PR. Independent review and explicit owner decisions are the next step.

## 13. Validation of this documentation-only change

Local environment: Windows, Node 24.22.0, pnpm 10.34.6; installed SDK 2.83.0.
The following existing commands ran without production credentials or hosted
database access:

| Command / review | Actual result |
| --- | --- |
| `pnpm exec tsc -b` | Passed; zero TypeScript errors. |
| `pnpm lint` | Passed; zero ESLint errors/warnings. |
| `pnpm test` | **803/803 passed**, 37/37 files, 73.32 seconds; no intermittent failure observed in this run. |
| `pnpm build` | Passed, Vite 7.85 seconds; existing 525.45 kB JS / 140.82 kB gzip bundle and existing >500 kB chunk warning. No bundle configuration changed. |
| Scope and whitespace | `git diff --check` and `git diff --cached --check` passed; staged file review contains only this new Markdown document. |

No candidate SDK, new native migration harness or full Auth service was executed
in this planning task. R4-SEC-11 counts above explicitly refer to prior evidence.
The existing CI's disposable PostgreSQL suites remain 200 authorization checks
and 30 word-version groups; actual CI run/results will be linked in the PR after
creation. No workflow, exact-count contract, dependency or test was changed.
Existing History timing intermittences are not claimed fixed by a plan.

**Release decision: ready for review of this plan; not ready for production Auth
migration.** SDK compatibility, owner decisions, full application routing,
legacy-writer policy, full Auth acceptance and compatible rollback remain gates.
