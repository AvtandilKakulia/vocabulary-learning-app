# R4-SEC-10 — Auth session retirement security review

Date: 2026-10-23. Audited latest `main`:
`e33ff5036924f5456b2c02e6b20f2d16a6f1d4f8` (PRs #47–#49 merged).
Baseline: 803 frontend tests, 200 authorization checks, 30 word-version checks.

**Decision recommendation:** retain the current account-specific UI/recovery
retirement as the immediate fallback. Do not append automatic shared-client
`signOut`, including `scope: 'local'`, to deletion completion. The installed SDK
has no expected-UID/session-generation conditional sign-out API. If removal of
persisted Auth credentials is mandatory, approve a separate design and staged
implementation of immutable Auth client/storage generations (option C), rather
than a check-then-signOut patch. That design needs additional validation; this
review does not certify an unimplemented architecture.

Local credential removal and remote refresh-session revocation are different
outcomes. Neither implies immediate invalidation of issued access JWTs. A new
backend and a change to `delete_user_account()` are **not necessary merely to
solve local storage ownership**. Stronger server-side session invalidation or
fresh-authentication requirements would be a separate decision and review.

This PR changes only this report. Production application code, dependencies,
tests, CI, SQL, grants, RLS, Auth configuration and real user data are unchanged.
There was no hosted Supabase connection, credential access, real user deletion,
deployment or merge. The appendix uses synthetic SDK sessions and fake HTTP only.

## Evidence categories

| Label | Meaning in this report |
| --- | --- |
| **CONFIRMED FACT (F)** | Read directly from the audited repository/installed SDK, or explicitly attributed to current official documentation. |
| **REPRODUCED BEHAVIOR (P)** | Observed with assertions against the real installed SDK and controlled synthetic inputs; not a hosted Auth result. |
| **REASONED RISK (R)** | Consequence inferred from those mechanisms; no claim about its Production frequency. |
| **UNVERIFIED ASSUMPTION (U)** | Requires a disposable full Supabase/Auth environment or separate owner inspection; not used as an unconditional security guarantee. |

Windows x64, Node 24.22.0, pnpm 10.34.6. SDK probes use Node plus jsdom for
browser interfaces, injected storage/locks/transport and a controlled channel
delivery queue. These are not native multi-process Chrome measurements. No
cryptographically valid JWT, real password, refresh token or project key is used.
No SQL is needed for these probes. Existing PostgreSQL CI uses disposable local
clusters, not a hosted database.

## Current architecture and all Auth entry points (F)

| Source / path | Actual behavior |
| --- | --- |
| `src/lib/supabase.ts:15` | One shared `createClient(url, anonKey)` with default Auth options. The lockfile and installed packages resolve both `@supabase/supabase-js` and `@supabase/auth-js` to **2.83.0**. Package.json's caret is not the executed version. |
| `src/contexts/AuthProvider.tsx:16` | Initial `getSession()` plus synchronous `onAuthStateChange`; a newer event invalidates the initial read. The provider stores `session.user`, not an account-bound Auth client capability. |
| `src/contexts/AuthContext.ts`, `src/contexts/authState.ts` | Public compatibility exports and context shape; no additional session coordination. |
| `src/components/AuthPage.tsx:20` → provider `signIn` / `signUp` | Email/password sign-in and sign-up. Sign-up can also publish a session if the Auth server returns one. The retired-account screen uses this same form/client to sign in as B. |
| `src/App.tsx:254` → provider `signOut` | Ordinary user-menu sign-out calls SDK default **global** sign-out. It is separate from deletion completion and is not changed here. The menu does not provide an account/generation guard or awaited error UI. |
| `src/components/UserProfile.tsx:83` | Direct SDK `updateUser({email})`; it is another session-mutating caller a future coordinator must include. Provider `updateUserEmail` is exported but has no production consumer. |
| `UserProfile.tsx:201` (`DeleteAccountModal`) | Captured UID + exact DELETE, permanent invalidation on Auth identity change, synchronous reservation, checked session, pinned Authorization on the zero-argument RPC. Success always awaits App completion even if the old dialog is obsolete. Failure and unknown outcome do not retire the account. |
| `src/lib/accountDeletion.ts` | Distinguishes deleting, completing, deleted, cleanup-failed, failed and unknown. The per-App operation registry prevents replay of pending/confirmed/unknown requests in that App instance. |
| `src/App.tsx:112`, `src/lib/eraseAccountRecovery.ts`, `src/lib/recoveryStorage.ts` | Confirmed success retires the initiating UID and erases only its supported recovery data. The durable marker is `vocab_recovery_retired_v1:<encoded UID>`. No SDK signOut or Auth-storage removal. B's completion/UI and bytes remain independent. |
| Provider `deleteAccount` (`AuthProvider.tsx:65`) | **Unused duplicate API:** raw unpinned RPC wrapper, still exported in the context. The actual modal does not call it. Reusing it would bypass F1–F4 orchestration; deprecation/removal should be separately scoped, not silently performed in this audit. |
| SDK initialization / URL detection / visibility / API access | Defaults enable persistence, refresh and implicit URL session detection. There is no application call to `setSession`, `refreshSession`, `startAutoRefresh` or `stopAutoRefresh`. SDK initialization, foreground ticks, visibility recovery and `getSession()` can refresh internally; Supabase's API fetch obtains a token through `getSession()`. |

Repository-wide searches found no additional production Auth sign-in/out or
deletion caller. There is no app OAuth/password-reset UI, but default URL session
detection is still a writer to consider. Test mocks are not production entry
points. The App's display-name effect runs independently of its retired-screen
render branch; retirement is not a universal network/authentication shutdown.

The previous [F1–F3 lifecycle review](r4-sec-08-account-deletion-lifecycle.md) and
[F4 erasure design](r4-sec-09-local-recovery-erasure.md) remain applicable. F4
extends the older report's in-memory-only retirement with a durable marker when
storage works; it does not extend retirement to SDK tokens or remote sessions.
The [database audit](r4-sec-06-account-deletion-security-review.md) established
the scoped RPC's SQL boundary, not managed Auth refresh-token cascades.

## Installed SDK evidence (F unless marked P)

Local source root after frozen installation:
`node_modules/.pnpm/@supabase+auth-js@2.83.0/node_modules/@supabase/auth-js/src/`.
`GoTrueClient.ts` SHA-256:
`18bbbbc0155a875cf2816184073c4793e376de6e6854d14d24d9770f8a3dcb93`.
Line references below are to that exact installed file, not today's latest SDK.

| Mechanism | Verified source and consequence |
| --- | --- |
| Storage defaults | Constructor lines 317–399 and supabase-js `SupabaseClient.ts:126` use a project-derived storage key, localStorage when supported, otherwise memory. A and B replace the same Auth slot. A storage key is a project/client namespace, not a UID assertion. |
| Scope | `signOut` / `_signOut`, lines 2114–2153; `lib/types.ts:1341` accepts only scope, no expected UID or version. Default global revokes the user's sessions; local targets the session represented by the selected JWT; others leaves the current session and emits no local SIGNED_OUT. Scope is not a compare-and-remove guard. |
| Timing | `signOut` awaits initialization and `_acquireLock`; only then `_useSession` chooses the token. After awaited `/logout`, `_removeSession` does not compare the stored UID/session with the initiating value. A prior `getSession` is a different locked operation. |
| Removal | `_removeSession`, lines 2783–2794, removes the configured main key and SDK-managed verifier/user companions (plus configured userStorage), then notifies SIGNED_OUT. It does **not** call `localStorage.clear()` or erase arbitrary app recovery keys. This source detail qualifies the broad wording in the public signOut reference. We never delete these private/default keys ourselves. |
| Network errors | `_signOut` treats Auth API 401/403/404 as locally removable; other errors return before cleanup. Thrown storage errors can reject the promise after a remote success. A lost response cannot establish whether remote revocation happened. P8–P13 reproduce these branches. |
| Replacement | `signInWithPassword`, lines 667–723, performs HTTP, `_saveSession`, notification without `_acquireLock`. `signUp` likewise saves a returned session. Therefore the SDK signOut lock does not exclude B's password sign-in. `setSession` uses the lock but has no expected-current-identity condition and may refresh; putting A's captured credentials back into the shared client is unsafe. |
| Lock coverage | `_acquireLock`, lines 1473–1538, serializes participating calls by storage key. Constructor selects custom `lock`, browser Navigator Locks when available, otherwise no-op; process-local promise queues are not cross-tab locks. Acquiring the same SDK lock externally and calling a lock-taking API can deadlock. A separate app mutex protects only cooperating callers. |
| Refresh | `__loadSession` (1611–1688), `_recoverAndRefresh` (2530–2649), `_callRefreshToken` (2651–2700). Refresh success saves its session; a terminal Auth error removes the current slot; retryable fetch errors are treated differently. Neither branch has a replacement-UID guard. P15/P16 show A refresh replacing/removing B. Explicit public refresh reaches the same helper used internally. |
| Auto-refresh | Foreground/visibility machinery, lines 2810–3036. `stopAutoRefresh()` stops scheduling and removes its visibility callback; it does not cancel already-dispatched refresh/logout promises. `autoRefreshToken: false` is not enough to disable refresh caused by an expired `getSession()`. |
| BroadcastChannel | Constructor 381–395 creates a channel keyed by storageKey. Receiver forwards the event/session to subscribers without checking current stored identity. `_notifyAllSubscribers` (2703–2741) broadcasts before awaiting callbacks. A stale SIGNED_OUT can report null even while storage holds B (P19); it does not itself delete B's storage. |
| Auth events | `onAuthStateChange` (2160–2225) also delivers INITIAL_SESSION under the lock. Async callbacks are deprecated for deadlock risk. They are notifications, not an authorization check, atomic barrier, cancellation hook or monotonic generation protocol. Current app callbacks are synchronous; the provider's initial-read guard does not filter a later stale peer event. |
| Explicit-token remote operation | `GoTrueAdminApi.ts:94–118`: public `auth.admin.signOut(jwt, scope)` sends `/logout` with the explicit token and does not access client storage or emit SIGNED_OUT. P18 proves client behavior only. Despite being in the admin namespace, this method's transport takes a user JWT; this observation does not authorize adding privileged keys to the browser or prove hosted acceptance after user deletion. |
| Lifecycle API version | Current online reference navigation includes newer APIs; no public `dispose` was found in installed auth-js 2.83.0. Do not design this project's teardown around an uninstalled method or private `_removeSession`/channel fields. |

### Official documentation consulted

- [Signing out and scopes](https://supabase.com/docs/guides/auth/signout): remote
  scope distinctions and surviving access tokens. Local is not local-storage-only.
- [JavaScript signOut](https://supabase.com/docs/reference/javascript/auth-signout)
  and [explicit-token admin signOut](https://supabase.com/docs/reference/javascript/auth-admin-signout):
  public API boundary; installed source above resolves timing/storage details.
- [getSession](https://supabase.com/docs/reference/javascript/auth-getsession),
  [refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession),
  [setSession](https://supabase.com/docs/reference/javascript/auth-setsession),
  [auto-refresh](https://supabase.com/docs/reference/javascript/auth-startautorefresh)
  and [Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).
- [Auth storage overview](https://supabase.com/docs/reference/javascript/auth)
  and [client options](https://supabase.com/docs/reference/javascript/initializing):
  custom storage/transport are supported extension points, not a supplied
  account-conditional transaction protocol.
- [User sessions](https://supabase.com/docs/guides/auth/sessions): access/refresh
  distinction, `session_id`, and server session validation for stronger guarantees.
  Configurable time-box/inactivity/single-session limits are Pro-plan features;
  they are not a free-tier fix for the browser race.
- [Deleting users](https://supabase.com/docs/guides/auth/managing-user-data):
  deleting `auth.users` does not automatically sign the browser out or invalidate
  an unexpired JWT. The exact hosted Auth schema/cascades were not inspected.
- [Authenticated Edge Functions](https://supabase.com/docs/guides/functions/auth)
  and [function pricing](https://supabase.com/docs/guides/functions/pricing):
  backend authentication and operational costs if option D is later justified.
  Free currently includes 500,000 invocations; available project quota was not checked.
- [Auth changelog](https://supabase.com/changelog?tags=auth) checked for applicable
  breaking changes. The `.md` endpoint was unavailable to the browsing tool;
  the HTML index was used. Its TLS/SAML changes do not supply a conditional
  sign-out API to the installed 2.83.0. No dependency upgrade is proposed.

Documentation was accessed on the audit date. It can describe newer SDKs;
claims about executed client behavior above come from the locked installation.

## Authorization boundary after deletion

**F:** the repository RPC derives the target from `auth.uid()`, rejects NULL and
atomically deletes that subject's profiles, words, test_history and auth.users
row. It does not call the Auth HTTP logout API. Existing SQL checks cover
self-only predicates, RLS, rollback and foreign keys, including post-deletion
orphan-write rejection. Browser retirement is not part of server authorization.

**F (documentation):** an issued access JWT can remain valid until `exp`, after
sign-out or user deletion. Deleting local bytes cannot retract a copied token.
**R:** a surviving A token may still be accepted by a stateless API validator;
`auth.uid()` ownership predicates still restrict it to A, not B. Removed rows and
FKs prevent the tested app data from being recreated without its parent, but
this is not universal denial across every project endpoint.

**U:** the hosted Auth version, managed session/refresh-token cascades, actual
JWT lifetime, hooks and handling of a deleted subject at `/logout`, `/user` and
refresh were not verified. Normal Auth should reject refresh when its required
user/session is gone; neither fake HTTP nor the minimal SQL fixture proves that
for this project's direct SQL deletion. A disposable full Auth environment is
the proper next gate. Do not add manual Auth-table deletes to compensate for an
unverified assumption. Backend validation of a live session/user, if required on
every sensitive request, is separate from local retirement.

## Threat model: UI, stored session and authorization

In this table, “retired A” means **confirmed** deletion and a known marker or live
memory retirement. A missing/unreadable durable marker cannot guarantee retirement
after a reload. “Token boundary” means the JWT/RLS limitations immediately above.

| Scenario | UI and storage consequence | Authorization / evidence |
| --- | --- | --- |
| A. A stays active | App shows retirement/sign-in screen, recovery erased/verified or honestly incomplete; SDK A credentials remain. | F; token boundary, not server logout. |
| B. A succeeds while B active | Completion records only A; B's workspace, SDK session and exact storage survive the completion. | Existing real-SDK React tests + P14. Independent refresh/peer races remain, not an F4 cleanup mutation. |
| C. A → B → A pending | Late confirmed A success retires A even with obsolete dialog; failed/unknown does not. | Existing lifecycle regressions. A cannot regain the workspace merely through another Auth event once retirement is known. |
| D. A independently signs out first | Completion still marks A; no extra shared logout. The independent default-global logout has its own replacement race. | Existing SDK missing-session test; P4–P7. Remote scope may affect A's other sessions, not a reason to invoke it again. |
| E. A credentials remain stored | UI restriction is not erasure: tokens are still available to SDK/same-origin script; auto-refresh may run. | F. XSS/local access to origin storage remains a threat; tombstones are not tamper-proof authorization. |
| F. Page refresh | Readable marker blocks A workspace/recovery; SDK initializes independently and can recover/refresh A. Unknown operation registry is lost. | F/R. Refresh is not evidence of failed deletion or credential removal. |
| G. Same-origin tabs | They share a project Auth slot, not truly independent A/B stores. Their UI timelines can differ. F4 marker informs peers; Auth notifications can arrive late. | P19 proves notification/storage mismatch with controlled delivery, not native Chrome timing. A peer SDK lock does not exclude password sign-in. |
| H. B sign-in during A cleanup | Current recovery cleanup is UID-scoped. Adding shared logout would endanger B. A refresh already running can also clobber B independently. | Existing F4 tests, P6/P7/P15/P16; no claim current fallback solves all SDK races. |
| I. B while logout queued | Logout reads B after acquiring the lock; local/global request uses B's token, then removes B. | P4/P5. Global potentially revokes B on other devices; synthetic test verifies requested subject/scope, not real revocation. |
| J. B while logout in flight | Remote request uses A, but completion removes local B and emits SIGNED_OUT. | P6/P7. A remote action and B local damage are distinct. |
| K. Network/cleanup failure | Lost/500 logout outcome retains B in probes; 401/403/404 still trigger unsafe local removal. Storage throw can leave credentials after remote success. | P8–P13. No automatic destructive retry or “fully signed out” assertion. |
| L. Refresh concurrent with deletion | Late A success can replace B; terminal refresh failure can erase B. Retired A UI still blocked if marker readable, but B can lose its SDK session. | P15/P16. Shared refresh lifecycle must be included in a future fix. |
| M. Unknown deletion outcome | No success marker or erasure; the account may actually be deleted. UI preserves uncertainty and blocks replay within current operation registry. | F. Full reload lacks durable request-status resolution; do not infer from sign-out errors. |
| N. Unavailable/partly failing storage | F4 retains memory retirement, reports incomplete cleanup; durable peer/reload guarantee may fail. SDK may choose memory at construction or error later. | F + P13 for removal failure. A successful Auth response is not proof of persisted/erased bytes. |
| O. Browser restart | Marker survives if browser retains origin data; stored SDK session can survive too. Memory operation registry and any failed marker do not. | R based on persistence. Backups, other profiles/origins/devices not erased. |
| P. JWT before expiry | Hiding UI/removing local tokens/revoking refresh sessions does not invalidate an already issued access JWT. | Official docs. Live server session checks would be a distinct policy change. |
| Q. B signs in from retired screen | Same password form writes B into the shared slot; B marker unaffected, workspace allowed. Old A refresh/peer callbacks may still race. | F + P15/P16/P19; form must not initiate A shared signOut as a prerequisite. |

## Deterministic experiment results

The appendix is the complete probe source, not a pointer to an ignored local
copy. It exercises **public SDK APIs only**; no private SDK mutation. Lock and
HTTP gates wait for exact boundaries, with no sleeps, timeout increases or
requests to a real host. Each fixture uses synthetic users A/B and fresh storage.

| Groups | Reproduced result |
| --- | --- |
| P1–P3 | A-only global/local clear the Auth slot and notify; others keeps it. Exact outgoing scope and token subject asserted. |
| P4–P7 | Prior getSession(A) plus local/global signOut fails both queued and in-flight replacement cases. B's slot is removed; exact selected request subject is asserted. |
| P8–P11 | A logout returning 401/403/404 after B login still removes B; 500 returns an error and preserves exact B bytes. |
| P12–P13 | Lost logout response retains B locally with an error; injected storage removal denial rejects after fake remote 204 and leaves original bytes. |
| P14 | No shared logout preserves exact B session and storage. This probe models the retirement decision only; permanent React/F4 tests exercise actual App completion. |
| P15–P16 | Delayed explicit A refresh followed by B password login: success stores renewed A; terminal rejection removes B. This uses the real shared internal refresh helper. |
| P17 | Separately configured immutable storage keys isolate A local logout from exact B bytes/session. This demonstrates namespace isolation, not a complete migration/retirement protocol. |
| P18 | Public explicit-token admin logout targets A and leaves B's exact session/storage and callbacks intact. Fake success proves no local side effect, not hosted permission or remote revocation. |
| P19 | Two logical peers share a storage key; a real SDK-generated SIGNED_OUT delivery is held until B signs in. B subscriber receives null while getSession still returns B. No forged event content is used. |
| P20 | A separate cooperating queue delays B sign-in until A logout finishes. This proves a narrow same-realm fence works, not that SDK-internal refresh, URL callbacks, other tabs or old clients obey it. |

P19 deliberately uses two SDK instances in one jsdom realm to control two logical
peers; SDK emits its documented multiple-client warning. It is not a recommended
production setup or proof of native browser delivery frequency. P12 prints the
expected synthetic fetch error. Neither output contains real credentials.
An initial probe assertion accidentally inspected the last request (B's login)
instead of the logout request during the in-flight case; it was corrected to
select the exact `/logout` call. The published source includes that correction.

## Alternatives and guarantees

| Option | Local removal / remote revocation | Risk to B, races, cross-tab and reload behavior |
| --- | --- | --- |
| **A. Keep current UI/recovery retirement** | No Auth-byte removal and no explicit remote logout. Confirmed UID is barred from supported UI/recovery. | Lowest new regression risk; preserves B during deletion completion. Marker survives reload when storage works. Does not fix independent old-refresh or stale peer notification races, expire copied tokens, or reach other devices. |
| **B. Supported signOut plus synchronization** | SDK can remove its own slot and request chosen remote scope if the selected session stays stable. | Only safe if **every** session writer and observer obeys one complete protocol, including refresh, URL callbacks, all tabs/versions and initial reads. P20's app queue is insufficient; P4–P7 bypass the SDK lock through password login. Freezing a React button or rechecking UID after logout cannot undo B loss. No unconditional supported expected-UID API found. |
| **C. Client-owned lifecycle/storage with immutable generations** | Supported custom storage can isolate local Auth envelopes by immutable client generation bound to UID. Separate explicit-token/session-bound logout can handle remote revocation if required. | Strongest candidate for account-specific local erasure while preserving B. A stale A callback may affect only its own envelope and must not publish into B's active generation. Needs transactional tombstone/write admission and cross-tab generation coordination, not merely renaming a shared key. Reload restores only a validated, non-retired generation. Not implemented/proven end-to-end here. |
| **D. Authenticated backend/Edge retirement** | Can orchestrate remote session revocation/deletion and live authorization checks. Cannot erase browser storage or stop a stale browser callback by itself. | Must derive immutable UID/session from verified Auth, never a supplied victim UID. Shared browser-slot races persist without B/C/E. After deletion the initiating JWT may be rejected by Auth; order/idempotency/unknown outcomes need explicit design. A stale Set-Cookie/response can also damage a replacement browser session in a naive backend-for-frontend design. |
| **E. Nonpersistent, generation-isolated clients** | `persistSession: false` avoids creating new durable SDK credentials; `autoRefreshToken: false` plus lifecycle handling does not cancel already pending work. Optional captured-token remote operation remains separate. | Public supported options reduce future persistence; per-generation isolation is still needed for same-realm races. Reload/restart requires sign-in. Does not erase pre-existing default persisted credentials or remote sessions and cannot simply be toggled on as legacy cleanup. Tabs cease sharing a durable SDK slot, changing UX. |

| Option | Architecture / backend / free-tier fit | Migration, rollback, operations and required regression gates |
| --- | --- | --- |
| A | Existing static frontend and RPC; no new service or plan. Low operational complexity. | Keep F1–F4 tests and explicit residual-risk text. Rollback report only. Monitor separate refresh/event finding through a future approved task. |
| B | Medium-to-high: one Auth mutation coordinator and cooperating cross-tab protocol; SDK participation gaps may require lifecycle redesign approaching C. No backend inherently needed. | Must gate all existing and future writers, handle lock rejection/hung tab/offline storage, and support mixed-client rollout. Test queued/in-flight signIn, signup, updateUser, URL, refresh and notifications; fallback to A if exclusivity cannot be established. Revert coordinator without reverting F1–F4. |
| C | High frontend change: client capability/generation manager, supported storage adapter, active-generation source, callback fencing and transactional persistence. No backend needed for local identity isolation; browser APIs need no paid Supabase feature. | Requires verified ownership of every app-managed Auth namespace, schema versioning, failed-write/crash tests, no stale generation resurrection, same-account new session vs old session, and coordinated legacy cutover. Revert consumers to a compatibility reader that respects retirement; never restore erased tokens or roll back to unguarded old storage. |
| D | New authenticated endpoint, logging redaction, key custody if privileged APIs required, monitoring, failure/availability and ordering contract. Free invocation quota can fit a small app but is not unlimited or operationally free. | Validate with full disposable Auth; test A/B authorization, lost responses, duplicate requests, post-deletion token rejection and local cleanup independently. If replacing deletion with stronger server policy, old callable RPC must not bypass it; that is a separate approved cutover. Rollback must not revive accounts/credentials. |
| E | Medium lifecycle change, no backend/paid plan; repeated sign-in and independent tabs are product trade-offs. A fresh isolated client per generation is essential, not just persistence=false on the shared mutable client. | Require explicit acceptance of no remembered login, migration plan for old persisted state, expiry/refresh/reload/browser restart/multi-tab tests. Re-enabling persistence is a new forward migration of app-owned data, never restoration of retired credentials. |

**Rejected shortcuts:** unconditional/global or checked-local signOut; restoring
A's token into the shared client; copying B's tokens aside and writing them back;
manual deletion of undocumented SDK keys; a second client with the same default
storage key; `localStorage.clear`; treating `others` as local cleanup; relying on
a BroadcastChannel acknowledgement as an atomic barrier; accepting any delayed
SIGNED_OUT as current; assuming an Edge Function can clean the browser. Each
either endangers B, leaves the target outcome unsolved, or lacks the required
atomicity. Do not use service-role/admin secrets in the frontend.

## Recommended later scope and owner decisions

**Immediate recommendation: A, with this report's explicit limitations.** No
supported operation on the current shared mutable client supplies strong
expected-UID atomic cleanup. Keep the truthful retirement screen and F4 marker;
do not describe that as complete sign-out/session erasure. A remote-only call
such as P18 does not finish the local lifecycle and is not recommended as an
unnecessary request after confirmed SQL deletion.

If the owner requires reliable local Auth removal, the preferred next architecture
is **C**, using supported SDK configuration rather than private methods. Its
first implementation must be separately approved and bounded as follows:

1. Model each signed-in client as an immutable `(UID, generation)` capability.
   Use a fresh isolated namespace for an unbound sign-in, bind it to the returned
   Auth identity before activation, and never reuse A's client/storage for B.
   Include a generation as well as UID so a stale A operation cannot affect a
   later A session. Do not use client-decoded claims as server authorization.
2. Own the storage adapter and namespace contract explicitly. Use an actual
   transactional store (for example an [IndexedDB transaction](https://w3c.github.io/IndexedDB/#transaction-concept)) for retirement,
   generation activation and write admission if persistent erasure is required.
   A pre/post localStorage UID check is not a cross-tab compare-and-delete;
   the [Web Storage standard](https://html.spec.whatwg.org/multipage/webstorage.html#introduction-16)
   explicitly advises assuming no cross-agent locking.
   Fail closed and report incomplete removal on denied transactions; reject late
   writes rather than silently making SDK persistence appear successful.
3. Route Auth **and authenticated data clients** through the capability manager.
   Fence every event/initial-read/refresh completion by generation; unsubscribe
   owned listeners and stop refresh scheduling for retired clients. Stopping
   scheduling alone cannot cancel promises. No callbacks from an old generation
   may select or clear B, even if the old SDK notifies SIGNED_OUT. Include email
   update, signup and SDK URL handling, not just signIn/signOut wrappers.
4. On confirmed A deletion, retain F1–F4 and atomically reject future A-owned
   persistence, remove only owned A envelopes and verify absence. B's active
   generation and exact bytes remain unchanged. Keep remote revocation status
   separate; do not prolong deletion or replay the RPC because Auth logout fails.
5. Design the cross-tab/reload and **legacy default-slot migration before rollout**.
   Reading a session through public getSession is not proof all old writers are
   stopped. A new adapter does not gain ownership of arbitrary historical SDK
   keys. Require a reviewed quiescent cutover/re-authentication strategy or retain
   the explicit legacy residual until one exists. Never claim existing tokens
   were erased merely because new clients use another key. Old tabs must not be
   able to repopulate a retired generation; include mixed-version refusal rules.
6. Turn P4–P7/P15/P16/P19 into permanent regressions requiring B preservation,
   and add the acceptance tests below. Preserve all 803 existing tests and their assertions.
   First prove the proposed manager/storage independently; do not ship a partial
   “safe logout” facade around the singleton while later steps are missing.

This is materially larger than a deletion callback edit. Approving the report
does not approve that refactor. Before implementation, the owner must decide:

- Is explicit residual SDK persistence acceptable for now, or is credential
  erasure a release requirement? Which browser/origin/device scope is promised?
- Must remembered login and cross-tab shared sign-in remain, or is option E's
  reauthentication cost acceptable? Is a coordinated old-client cutover possible?
- Is remote revocation of one session or all A sessions required independently
  of user deletion? Is immediate rejection of already-issued JWTs required?
- May a disposable full Supabase stack be used to verify managed Auth behavior?
  No hosted Production fallback is authorized by this document.
- Should the unused raw deletion wrapper be removed/deprecated in a separately
  scoped API cleanup, and should the ordinary menu sign-out race be included in
  the future Auth coordinator's scope?

**Backend/RPC answer:** leave the existing RPC unchanged for the local-only
work. An Edge Function is not required to isolate browser session storage.
If the owner requires step-up authentication, durable unknown-outcome resolution,
or live session validity on every sensitive server operation, design that policy
separately. A server-only check that leaves a bypassing old RPC callable would
not enforce the new policy. Do not infer that database migrations are necessary
from the frontend race alone.

## Expected UI and acceptance tests for a later implementation

The current retirement message must continue separating confirmed database
deletion, verified/incomplete recovery erasure and retained Auth credentials.
No new UI is implemented here. A future accepted design should show A a retired
screen, leave active B untouched, allow fresh B sign-in without an A shared
logout prerequisite, and never label unknown deletion as success. A local erasure
failure should offer only a separately bound local-cleanup retry, not replay SQL.
Remote logout failure/unknown status must not be conflated with local bytes.

Required future regressions, with exact session/token-envelope byte comparisons:

- A-only, A→B, A→B→A, independent sign-out, old/new dialogs and unmount under
  StrictMode; success, failure and unknown deletion remain distinct.
- Queued/in-flight logout and refresh success/terminal/retryable outcomes; B
  sign-in before/after every await; signup and email-update completions; ordinary
  menu sign-out. No automatic global signOut introduced.
- Two/three native browser pages, real Web Locks/channel delivery, hidden/frozen
  peers, stale INITIAL_SESSION/SIGNED_IN/SIGNED_OUT/TOKEN_REFRESHED notifications,
  failed lock acquisition and old-generation cleanup after B activation.
- Storage unavailable/throwing/silently failing, partial transaction failure,
  killed writer, restart/reload, corrupted/unowned legacy data, old deployed
  clients, same UID with a new generation, no resurrection or B mutation.
- Existing active Test/Practice recovery, pending History saves, result identity,
  cancellation and F1–F4 suites unchanged; a new signed-in UID must never inherit
  a retired UID's workspace or session capability.
- In a **disposable full Auth stack** only: actual refresh after direct user
  deletion, logout with deleted/expired tokens, revocation scope, copied JWT use
  until expiration, server live-session policy if proposed. Fake HTTP cannot
  certify these outcomes.

## Rollback and remaining risks

This audit rolls back by reverting one Markdown file. No deployment is needed.
A later C/E change needs a versioned, compatible storage rollout and a reversible
feature path that preserves tombstones. On failure, stop automatic cleanup and
retain A-style UI retirement with honest residual reporting; do not replay
account deletion, restore erased credentials, overwrite B, clear origin storage,
revoke grants, disable RLS or downgrade to a reader that ignores retirement.
Local rollback cannot undelete an account or revoke a copied JWT.

Remaining risks are explicit: storage failures/marker loss, uncooperative old
clients, unavailable native multi-process evidence, retained Auth credentials,
SDK refresh/notification races, unknown deletion across reload, forensic/browser
backups, other origins/devices, XSS and hosted Auth behavior not observed here.
The existing fallback is safer than adding an unsafe cleanup call; it is not
complete Auth session retirement. The desired stronger architecture is a design
candidate with acceptance gates, not an already-proven guarantee.

## Validation and reproducible probe appendix

Local check results are below; final-commit GitHub Actions links/status are recorded in the PR.
The regular suite/configuration/assertions remain unchanged. Only this report is
committed; extracted probes and logs stay under ignored `tmp/r4-sec-10`.

| Check | Actual result |
| --- | --- |
| `pnpm exec tsc -b` | Passed, exit 0; no TypeScript errors. |
| `pnpm lint` | Passed, exit 0; no ESLint errors/warnings. |
| `pnpm test`, first complete run | **800 passed / 3 failed, 803 total**, 100.91 s. Three existing History pagination sort tests exceeded 5,000 ms; details below. |
| History pagination file, two fresh isolated runs | **111/111** each, 56.44 s and 57.00 s, unchanged assertions/default limits. |
| `pnpm test`, complete repeat without concurrent build/lint | **803/803, 37/37 files**, 78.73 s. No skipped tests or configuration changes. |
| Published SDK source, reconstructed from this Markdown | **20/20 audit groups in each of five fresh Node processes** (100 group executions). These are supplemental probes, not additions to the 803-test suite. |
| `pnpm build` | Passed; Vite 6.2.6, 1,607 modules, 9.47 s. Existing 525.45 kB main chunk / 140.82 kB gzip and >500 kB warning remain. |
| `git diff --check` and final scope review | Passed; only this report is included. Application, existing tests, dependencies, migrations and configuration remain byte-for-byte unchanged from the base. |

The initial timeouts were in `History.pagination.test.tsx:312`, all for 2,001
records: date descending, score ascending and score descending (5,348 / 5,640 /
5,315 ms). Typecheck/lint and part of the build overlapped that first full run.
Both isolated History runs and the later full run passed. This is consistent
with scheduling/load sensitivity but **does not conclusively establish its root
cause or fix the intermittent failure**. No assertion, timeout or worker setting
was changed and no failed result was hidden. History remediation is outside this
Auth audit. Full logs remain in ignored `tmp/r4-sec-10` during this work session.

No local PostgreSQL rerun was needed for this documentation-only change. The
unchanged `PostgreSQL integration` Actions job separately checks 200 authorization
groups and 30 word-version groups; its actual final-commit result is in the PR.
These SQL checks do not test hosted GoTrue session revocation.

Run from the repository root after the pinned dependencies are available:

```powershell
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

The following command extracts the **published** single `js` fence into the
ignored probe file. It fails if the source fence is missing/ambiguous; it does
not rely on any old local copy. Run the probe in a fresh Node process. A run
finishes with exactly `PASS: 20 isolated SDK audit groups; no external network.`

```powershell
New-Item -ItemType Directory -Force tmp/r4-sec-10 | Out-Null
node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; const text=readFileSync("docs/r4-sec-10-auth-session-retirement-review.md","utf8"); const sources=[...text.matchAll(/^```js\r?\n([\s\S]*?)^```\s*$/gm)]; if(sources.length!==1) throw new Error("Expected exactly one SDK probe source"); writeFileSync("tmp/r4-sec-10/sdk-probes.mjs",sources[0][1]);'
if ($LASTEXITCODE -ne 0) { throw 'Probe extraction failed' }
node tmp/r4-sec-10/sdk-probes.mjs
if ($LASTEXITCODE -ne 0) { throw 'SDK audit probe failed' }
```

The source below deliberately asserts unsafe SDK outcomes to prove the audit
findings. It is not a production workaround or a replacement for preservation
regressions. It imports neither the app singleton nor environment configuration.

```js
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';

// No .env, app singleton, hosted server, real token or browser profile is used.
globalThis.fetch = () => { throw new Error('External network is forbidden'); };
const dom = new JSDOM('', { url: 'https://audit.invalid' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
const channels = [];
const deliveries = [];
class Channel {
  constructor(name) { this.name = name; this.listeners = []; channels.push(this); }
  addEventListener(_, listener) { this.listeners.push(listener); }
  postMessage(data) {
    for (const peer of channels) {
      if (peer !== this && peer.name === this.name) {
        deliveries.push(() => Promise.all(peer.listeners.map(fn => fn({ data: structuredClone(data) }))));
      }
    }
  }
  close() { this.listeners = []; }
}
globalThis.BroadcastChannel = Channel;
const { createClient } = await import('@supabase/supabase-js');
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const payload = (id, suffix = '') => ({
  access_token: `synthetic-access-${id}${suffix}`, refresh_token: `synthetic-refresh-${id}${suffix}`,
  token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id, email: `${id}@audit.invalid`, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = status => json({ message: 'Synthetic rejection', code: 'refresh_token_not_found' }, status);
let total = 0;
const clients = [];
async function check(name, fn) { await fn(); total++; console.log(`PASS ${total}: ${name}`); }
async function fixture({ map = new Map(), key = `audit-${randomUUID()}` } = {}) {
  const logout = deferred(), refresh = deferred(), logoutReached = deferred(), refreshReached = deferred();
  const lockReached = deferred(), lockRelease = deferred();
  let queue = false, failRemoval = false;
  const calls = [], events = [];
  const storage = {
    getItem: k => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: k => { if (failRemoval) throw new Error('Synthetic storage denial'); map.delete(k); },
  };
  const client = createClient('https://sdk-audit.invalid', 'synthetic-public-key', {
    auth: { storage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      lock: async (_name, _timeout, fn) => {
        if (queue) { queue = false; lockReached.resolve(); await lockRelease.promise; }
        return fn();
      },
    },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://sdk-audit.invalid');
      const call = { path: url.pathname, scope: url.searchParams.get('scope'), authorization: new Headers(init?.headers).get('Authorization') };
      calls.push(call);
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
        return json(payload(JSON.parse(init.body).email.split('@')[0]));
      }
      if (url.pathname === '/auth/v1/logout') { logoutReached.resolve(); return logout.promise; }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        refreshReached.resolve(); return refresh.promise;
      }
      throw new Error('Unexpected synthetic endpoint');
    } },
  });
  clients.push(client);
  await client.auth.initialize();
  const initial = deferred();
  client.auth.onAuthStateChange((event, session) => {
    events.push({ event, uid: session?.user.id ?? null });
    if (event === 'INITIAL_SESSION') initial.resolve();
  });
  await initial.promise;
  const signIn = async id => {
    assert.equal((await client.auth.signInWithPassword({ email: `${id}@audit.invalid`, password: 'synthetic' })).error, null);
  };
  const session = async () => (await client.auth.getSession()).data.session;
  const snapshot = () => [...map.entries()];
  return { client, key, map, calls, events, logout, refresh, logoutReached, refreshReached, lockReached, lockRelease,
    queue: () => { queue = true; }, denyRemoval: () => { failRemoval = true; }, signIn, session, snapshot };
}

for (const scope of ['global', 'local', 'others']) {
  await check(`A-only scope=${scope}`, async () => {
    const f = await fixture(); await f.signIn('A'); const before = f.snapshot();
    const pending = scope === 'global' ? f.client.auth.signOut() : f.client.auth.signOut({ scope });
    await f.logoutReached.promise; f.logout.resolve(new Response(null, { status: 204 }));
    assert.equal((await pending).error, null);
    assert.equal(f.calls.at(-1).scope, scope);
    assert.equal(f.calls.at(-1).authorization, 'Bearer synthetic-access-A');
    if (scope === 'others') { assert.deepEqual(f.snapshot(), before); assert.equal(f.events.some(e => e.event === 'SIGNED_OUT'), false); }
    else { assert.equal(await f.session(), null); assert.equal(f.events.at(-1).event, 'SIGNED_OUT'); }
  });
}
for (const timing of ['queued', 'in-flight']) {
  for (const scope of ['local', 'global']) {
    await check(`unsafe ${scope} logout ${timing}: B removed`, async () => {
      const f = await fixture(); await f.signIn('A'); assert.equal((await f.session()).user.id, 'A');
      if (timing === 'queued') f.queue();
      const pending = f.client.auth.signOut({ scope });
      await (timing === 'queued' ? f.lockReached.promise : f.logoutReached.promise);
      await f.signIn('B'); const b = f.map.get(f.key); assert.equal(JSON.parse(b).user.id, 'B');
      if (timing === 'queued') { f.lockRelease.resolve(); await f.logoutReached.promise; }
      f.logout.resolve(new Response(null, { status: 204 })); assert.equal((await pending).error, null);
      assert.equal(f.calls.find(c => c.path.endsWith('/logout')).authorization, `Bearer synthetic-access-${timing === 'queued' ? 'B' : 'A'}`);
      assert.notEqual(f.map.get(f.key), b); assert.equal(await f.session(), null);
    });
  }
}
for (const status of [401, 403, 404, 500]) {
  await check(`logout response ${status} after B replacement`, async () => {
    const f = await fixture(); await f.signIn('A');
    const pending = f.client.auth.signOut({ scope: 'local' }); await f.logoutReached.promise;
    await f.signIn('B'); const before = f.snapshot(); f.logout.resolve(apiError(status));
    const result = await pending;
    if (status === 500) { assert.ok(result.error); assert.deepEqual(f.snapshot(), before); }
    else { assert.equal(result.error, null); assert.equal(await f.session(), null); }
  });
}
await check('lost logout response retains B but cannot prove remote outcome', async () => {
  const f = await fixture(); await f.signIn('A');
  const pending = f.client.auth.signOut({ scope: 'local' }); await f.logoutReached.promise;
  await f.signIn('B'); const before = f.snapshot();
  f.logout.resolve(Promise.reject(new TypeError('Synthetic lost response')));
  assert.ok((await pending).error); assert.deepEqual(f.snapshot(), before);
});
await check('storage removal failure propagates; not local-erasure success', async () => {
  const f = await fixture(); await f.signIn('A'); const before = f.snapshot();
  const pending = f.client.auth.signOut({ scope: 'local' }); await f.logoutReached.promise;
  f.denyRemoval(); f.logout.resolve(new Response(null, { status: 204 }));
  await assert.rejects(pending, /Synthetic storage denial/); assert.deepEqual(f.snapshot(), before);
});
await check('no automatic signOut preserves exact B session and storage', async () => {
  const f = await fixture(); await f.signIn('A'); await f.signIn('B');
  const before = f.snapshot(), session = await f.session();
  const retired = new Set(['A']); // Isolated model; permanent tests cover real F4.
  assert.equal(retired.has('B'), false);
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(await f.session(), session);
  assert.equal(f.calls.filter(c => c.path.endsWith('/logout')).length, 0);
});
for (const outcome of ['success', 'terminal-failure']) {
  await check(`late A refresh ${outcome} after B sign-in`, async () => {
    const f = await fixture(); await f.signIn('A');
    const pending = f.client.auth.refreshSession(); await f.refreshReached.promise;
    await f.signIn('B'); const b = f.map.get(f.key);
    f.refresh.resolve(outcome === 'success' ? json(payload('A', '-renewed')) : apiError(400));
    const result = await pending;
    if (outcome === 'success') { assert.equal(result.error, null); assert.equal((await f.session()).user.id, 'A'); }
    else { assert.ok(result.error); assert.equal(await f.session(), null); }
    assert.notEqual(f.map.get(f.key), b);
  });
}
await check('separate immutable storage keys isolate delayed A logout from B', async () => {
  const map = new Map(); const a = await fixture({ map }), b = await fixture({ map });
  await a.signIn('A'); await b.signIn('B'); const before = b.map.get(b.key), session = await b.session();
  const pending = a.client.auth.signOut({ scope: 'local' }); await a.logoutReached.promise;
  a.logout.resolve(new Response(null, { status: 204 })); assert.equal((await pending).error, null);
  assert.equal(await a.session(), null); assert.equal(b.map.get(b.key), before); assert.deepEqual(await b.session(), session);
  assert.equal(a.calls.at(-1).authorization, 'Bearer synthetic-access-A');
});
await check('explicit-token admin logout is remote-only; exact B storage preserved', async () => {
  const f = await fixture(); await f.signIn('B'); const before = f.snapshot(), session = await f.session();
  const pending = f.client.auth.admin.signOut('synthetic-access-A', 'local'); await f.logoutReached.promise;
  f.logout.resolve(new Response(null, { status: 204 })); assert.equal((await pending).error, null);
  assert.equal(f.calls.at(-1).authorization, 'Bearer synthetic-access-A');
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(await f.session(), session);
  assert.equal(f.events.some(e => e.event === 'SIGNED_OUT'), false);
});
await check('delayed peer SIGNED_OUT changes observer while stored B survives', async () => {
  const a = await fixture(); await a.signIn('A');
  const b = await fixture({ map: a.map, key: a.key });
  deliveries.length = 0;
  const pending = a.client.auth.signOut({ scope: 'local' }); await a.logoutReached.promise;
  a.logout.resolve(new Response(null, { status: 204 })); await pending;
  assert.equal(deliveries.length, 1); const delayed = deliveries.shift();
  await b.signIn('B'); const before = b.snapshot(); assert.equal(b.events.at(-1).uid, 'B');
  await delayed(); assert.deepEqual(b.events.at(-1), { event: 'SIGNED_OUT', uid: null });
  assert.deepEqual(b.snapshot(), before); assert.equal((await b.session()).user.id, 'B');
});
await check('cooperating external queue delays B sign-in until A logout finishes', async () => {
  const f = await fixture(); await f.signIn('A');
  let tail = Promise.resolve(); const run = fn => { const next = tail.then(fn); tail = next.catch(() => {}); return next; };
  const cleanup = run(async () => {
    assert.equal((await f.session()).user.id, 'A'); return f.client.auth.signOut({ scope: 'local' });
  });
  await f.logoutReached.promise; const b = run(() => f.signIn('B'));
  assert.equal(f.calls.filter(c => c.path.endsWith('/token')).length, 1);
  f.logout.resolve(new Response(null, { status: 204 })); assert.equal((await cleanup).error, null); await b;
  assert.equal((await f.session()).user.id, 'B');
});
for (const client of clients) await client.auth.stopAutoRefresh();
for (const channel of channels) channel.close();
dom.window.close();
assert.equal(total, 20);
console.log(`PASS: ${total} isolated SDK audit groups; no external network.`);
```
