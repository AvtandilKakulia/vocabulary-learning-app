# R4-SEC-09 — Account-scoped local recovery erasure (F4)

Base: `0d86edb746965f81e9517058f27721e6770bbb92` (merged PR #48), 756 frontend
tests. This is a frontend follow-up prepared for independent review. No hosted
Supabase connection, real account deletion, migration, privilege, RLS, Auth
configuration, dependency or deployment change was performed.

## Root cause and supported scope

PR #48 retires a confirmed-deleted UID in its App instance but deliberately does
not call shared SDK signOut. Neither path removes app-owned recovery copies.
Practice effects, migration and Test checkpoints can subsequently write those
copies again; merely removing keys would leave this resurrection window open.

This change erases the supported account-qualified browser recovery records,
installs a durable retirement marker, and prevents cooperating current-version
Practice/Test writers and readers from using the retired account. **It is not an
atomic, unconditional erasure guarantee across every browser process or old app
version.** The browser/crash/legacy limitations below are part of the contract.

## Keys and exact ownership

`encoded UID` always means `encodeURIComponent(initiatingUid)` using the immutable
UID reserved before the pinned deletion RPC. There is no decoding, substring
match, currently-active-account substitution or origin-wide clear.

| Key | Treatment after confirmed deletion of A |
| --- | --- |
| `vocab_practice_session_state_v2:<encoded UID>` | Remove only the exact A key. |
| `vocab_active_test:<encoded UID>:<session ID>` | Remove every key beginning with A's exact colon-terminated prefix, including active and completed checkpoint envelopes. |
| `vocab_pending_test:<encoded UID>:<result ID>` | Remove every key beginning with A's exact colon-terminated prefix. |
| `vocab_practice_session_state_v2` | Remove only a parseable, valid Practice snapshot whose owner is A, using the existing full session validator (including completed-result ownership). Re-read before removal and preserve a changed value. |
| `vocab_recovery_retired_v1:<encoded UID>` | Retain minimal value `1`. The key identifies the UID; the value has no words, questions, mistakes, credentials or timestamp. |

Scoped keys establish ownership even if their payload is malformed. Empty or
non-UUID suffixes under a supported account-qualified Test prefix are likewise
owned recovery entries. A Practice key with an additional suffix is unknown and
is preserved. Overlapping UIDs, colons, percent signs, spaces and Unicode are
tested. All other keys, B's exact serialized data, theme/Words/History preferences
and Supabase SDK session/token storage remain untouched.

Valid B-owned legacy data is preserved. Malformed, unreadable, incompatible or
owner-inconsistent legacy data is preserved **and reported as unclassified
residual data**, so cleanup cannot claim verified complete erasure. We never
guess ownership from a partial JSON substring. The original Practice validator
and restore defaults are unchanged; its parser is exported for reuse.

## Lifecycle inventory and changes

| Path | Protection |
| --- | --- |
| `practiceSessions.readPracticeSession` | Checks retirement before/after restoration; a retired UID cannot recover legacy or scoped work. |
| Legacy Practice migration | Keeps owner/Web Lock checks; copies through the guarded writer, verifies the copy and preserves original migration-failure behavior. |
| `persistPracticeSession` | Retains ownership, malformed-copy and optional verification checks; adds account retirement and guarded storage write. |
| `removePracticeSession` | Retains expected-snapshot/owner validation; retired owners cannot execute delayed ordinary cleanup. Dedicated confirmed-deletion erasure may remove malformed A-scoped copies. |
| FreeMode state persistence, handoff checkpoint, Finish/Retry, post-save reset | Continue using the same helpers and owner capability. `canWrite` now revokes immediately when A is retired, before React has unmounted its editor. FreeMode itself needs no edits. |
| `practiceSaves` | Checks ownership under the result lock as before. Retirement after insert prevents a duplicate-confirmation lookup or stale checkpoint cleanup; its settled old operation cannot start another save. Already-dispatched inserts cannot be cancelled. |
| `persistActiveTest`, `checkpointCompletedTest`, `persistPendingTest` | All use the common guarded writer, including completed-checkpoint fallback after a failed pending-key allocation. |
| `readTestRecovery`, `readPendingTests` | Reject retired/unverifiable recovery before reading and recheck before returning snapshots. |
| TestMode draft/progress, Start, Finish/Retry and async vocabulary/History boundaries | Check retirement synchronously and after responses, stopping stale writes, later requests and result publication. |
| Test active/pending removal helpers | Still remove only the exact captured user/result keys; they create no records and never touch another UID or legacy key. |
| App completion | Records confirmed A, awaits account-specific erasure, and reports verified versus incomplete cleanup independently of stale modal UI. |

The existing F1 exact confirmation, invalidated intent, pinned Authorization,
zero-argument RPC, synchronous single-flight and F2/F3 awaited/error-handled
completion remain intact. Explicit RPC rejection and unknown transport/server
outcome do **not** install a marker or erase any recovery data.

Late A success after A → B or A → B → A always performs account-level erasure.
B's current UI, SDK session, storage and dialog remain unchanged. Erasure also
survives an obsolete dialog or whole-App unmount while the JS realm is alive;
only App state updates are mount-bound. A replacement App observes the marker
instead of reviving A. This intentionally extends PR #48's in-memory limitation.

## Retirement, stale writes and peer tabs

1. On confirmed deletion, mark A retired synchronously in this JS realm, then
   write and verify A's durable marker **before** removing recovery records.
2. A persistence call checks both key ownership and retirement before `setItem`.
   It checks retirement again after `setItem`. If another tab retired A during
   that gap, the writer removes its own account-qualified entry and reports a
   failed write. No retirement check relies on a positive cached “active” value.
3. Collect matching keys without deleting while enumerating, remove each
   independently, then perform a bounded second scan and marker/legacy checks.
   Thrown access/removal errors, incomplete enumeration, silent removal failures
   and unclassified legacy data all produce an incomplete result. There is no
   unbounded retry loop.
4. `useRetiredAccount` subscribes via `useSyncExternalStore`. Same-realm callbacks
   notify immediately. Other same-origin tabs use `storage` events, with
   `focus`/`pageshow` checks covering resumed pages. Subscriptions are removed on
   unmount/account changes and work under StrictMode.
5. Notifications are **signals only**: re-read the exact marker from this
   origin's localStorage. Event `newValue`/claimed identities never authorize
   removal; subscription handlers perform no erasure. A forged signal without
   a marker has no effect. The marker is an app coordination convention, not
   server authorization or a new security boundary against same-origin script.
6. Retired Practice/Test editors unmount. Practice cleanup releases its existing
   editor lock and aborts pending takeover requests. Its capability guard blocks
   stale handlers even before React commits. Erasure never waits for another
   tab's long-lived Practice lock, steals a lock, or substitutes a storage lease.

Existing Web Locks/BroadcastChannel handoff and result-save exclusion remain the
ownership mechanisms. A separate BroadcastChannel is unnecessary: the durable
storage marker is already the information peers must re-read. A fresh mount or
reload sees the marker without needing an event and refuses A recovery. B's
marker, listeners and owner capability are independent.

## Failure and user feedback

The App keeps A retired regardless of local erasure failure. The deletion RPC is
not repeated. An error is returned through the existing awaited completion
contract; the retired-account screen explicitly says residual recovery data may
remain and full local erasure has not been verified. Success text is emitted
only after the sweep and absence checks pass. The marker deliberately stores no
“all erased forever” flag: a remount can know retirement, but cannot claim a
past erasure check proves current physical absence.

If quota/access prevents the marker, cleanup still attempts exact A-key removal
where possible and reports failure. This realm remembers retirement and stops
its writers. Other tabs or reloads **cannot be guaranteed** to learn it without a
readable durable marker. If checking a marker fails or its format is unknown,
recovery reads/writes fail closed, while existing storage-error UX is preserved.
Repeated explicit calls to the local erasure helper are idempotent and never
dispatch SQL/RPC. There is no automatic destructive network retry or blanket
browser-storage cleanup instruction.

## Browser limits and residual risks

- Web Storage has no multi-operation transaction or compare-and-remove API.
  The [HTML specification](https://html.spec.whatwg.org/multipage/webstorage.html#introduction-16)
  advises assuming no cross-agent locking. A second scan is an observation, not
  an atomic barrier against a suspended/crashed process.
- Cooperating writers that complete their post-write check revoke an interleaved
  write. A process killed/suspended between `setItem` and that check, an older
  deployed app without these guards, or a removal failure can still leave
  physical bytes. The durable marker prevents this version from restoring them,
  but it does not erase browser backups or prove immediate physical absence in
  every process. Stronger guarantees require a separately reviewed transactional
  persistence/mutation protocol and coordinated client rollout, not an unsafe
  claim that localStorage is atomic.
- Supported current code never writes the unscoped legacy key; it only migrates
  or removes it. The recheck protects observed replacement by B, but cannot provide
  atomic compare-and-remove against an unsupported external/old writer that
  replaces that shared key inside the final check/remove gap. Such mixed-version
  writers must be closed/upgraded before relying on complete legacy erasure.
- [Storage events](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event)
  reach other same-origin contexts, not the initiating window. Frozen/offline
  tabs may process them later. Markers do not reach other origins, devices,
  profiles or partitions. Deleting markers externally removes reload protection;
  already-informed live realms keep retirement in memory.
- In-flight server requests and their promise closures cannot be forcibly
  cancelled or securely zeroed. They may retain temporary in-memory snapshots
  until settlement/GC. Settled Practice save caches from earlier work may retain
  bytes in memory until the realm exits; retirement prevents their reuse. This
  PR targets recovery persistence and UI access, not forensic heap erasure.
- Native multi-process Chrome and actual hosted Auth deletion were not exercised
  for this PR. Tests use real React lifecycle/Storage event interfaces with
  independent synthetic stores and controlled Web Locks, not real accounts.

These limitations mean F4 is addressed for the supported cooperating client and
available storage, **not unconditionally resolved for every mixed-version,
crash, storage-denial or forensic scenario**. Independent review must retain
these boundaries rather than equating retired UI with universal erasure.

## Supabase Auth boundary

SDK session/token storage is intentionally preserved. There is no automatic
shared signOut, private SDK key removal, service-role/admin credential, new
production Auth client, RPC change, or claim of immediate JWT invalidation.
The race-safe expected-UID sign-out gap documented in R4-SEC-08 remains a separate
follow-up. Any future solution must preserve replacement-account sessions and
be reviewed as an Auth/session design; do not add a getSession-then-signOut race
to this erasure path.

## Regression evidence and reproduction

```powershell
pnpm exec vitest run src/lib/eraseAccountRecovery.test.ts src/components/AccountRecoveryErasure.test.tsx src/components/DeleteAccountLifecycle.test.tsx src/components/DeleteAccountModal.test.tsx
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

New deterministic cases cover all exact scoped records, malformed payloads,
encoded/overlapping UIDs, B and unrelated byte preservation, validated/foreign/
malformed/unreadable/replaced legacy data, idempotence, removal/enumeration/marker
failures, every writer interleaved after a retirement sweep, independent realm
reload, spoofed/foreign/real peer signals, subscription cleanup, queued/pending
Practice saves, active/waiting Practice ownership, active Test drafts, delayed
Test vocabulary/History responses, A → B → A completion and explicit/unknown
deletion outcomes. No live network or real user data is used.

All original 756 tests remain. Existing lifecycle expectations now allow exactly
A's additional marker, continue checking SDK/B bytes unchanged, and expect a
replacement App to honor confirmed durable retirement. The success/failure loop
runs failure first because a fresh App intentionally cannot revive a retired UID.
The test setup gives each test a fresh retirement-store realm using the real
implementation, including its memory-only failure behavior; no timeouts, worker
settings, skips or failure suppression are added.

Final local validation (Windows, Node 24.22.0, pnpm 10.34.6):

- **803/803 tests in 37 files**, 65.36 s, default configuration: all 756 existing
  tests plus 47 new (29 storage/save cases and 18 React lifecycle cases).
- Focused storage/React/TestMode run: **95/95**, 15.17 s.
- TypeScript and ESLint: passed with zero errors/warnings. `git diff --check` passed.
- `pnpm build`: passed, 6.30 s. The existing >500 kB main-chunk warning remains
  (525.45 kB minified / 140.82 kB gzip); no warning suppression was introduced.
- The first full run had 801 passing tests and one existing TestMode failure:
  the unavailable-storage warning had changed. The production warning was fixed,
  preserving the original assertion. One handoff regression was then added.
  The final full run above had no intermittent failure, skipped case or retry.
- During test development, a new StrictMode fixture initially expected one
  vocabulary read; the editor's existing replay issues two. Its exact expectation
  was corrected to two, with both delayed responses covered.

Build details and the final commit's GitHub Actions links are recorded in the PR.

## Changed files

| File | Purpose |
| --- | --- |
| `src/App.tsx` | Await UID-scoped cleanup, retain retirement and report verification status. |
| `src/components/PracticeAccess.tsx` | Observe retirement and release/unmount ownership. |
| `src/components/TestMode.tsx` | Retire active Test UI and guard asynchronous session work. |
| `src/hooks/useRetiredAccount.ts` | Account-scoped React subscription. |
| `src/lib/recoveryStorage.ts` | Exact keys, marker, peer events and guarded writes. |
| `src/lib/eraseAccountRecovery.ts` | Bounded scoped erasure, legacy validation and verification. |
| `src/lib/practiceSessions.ts` | Guard read/migration/write and reuse the existing parser. |
| `src/lib/practiceOwnership.ts` | Revoke retired capabilities and queued acquisition. |
| `src/lib/practiceSaves.ts` | Stop obsolete post-response save work. |
| `src/lib/activeTestSessions.ts` | Guard active/completed Test persistence and restore. |
| `src/lib/pendingTestResults.ts` | Guard pending result persistence and restore. |
| `src/components/AccountRecoveryErasure.test.tsx` | 18 new React/peer/save regression cases. |
| `src/lib/eraseAccountRecovery.test.ts` | 29 new erasure/storage/save regression cases. |
| `src/components/DeleteAccountLifecycle.test.tsx` | Preserve existing cases with durable-retirement expectations. |
| `src/test/setup.ts` | Isolate real retirement-store lifetimes between tests. |
| `docs/r4-sec-09-local-recovery-erasure.md` | Design, limitations, evidence and review instructions. |

Safe manual review uses these isolated fixtures. Do not submit real account
deletion in a hosted Preview; no Production operation is required to review this
change. Leave the PR open and do not merge or deploy as part of this task.
