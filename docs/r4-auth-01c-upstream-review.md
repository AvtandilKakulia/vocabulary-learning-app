# R4-AUTH-01C — Upstream Auth fix preparation and security review

Date: 2026-10-24. Application base: `dd411f192bc9fd38e0c776bd1e9bbaeb9fa9ef87` (merged #54). Scope: new isolated experiments and this report only.

**Decision: UPSTREAM-READY for independent maintainer review of the terminal patch and the #2742 supplement. R4-AUTH-02 remains BLOCKED.** These are unpublished source proposals, not released fixes, accepted upstream contributions, or an authorized application dependency change. No initialization propagation patch is proposed.

## Evidence reviewed and current upstream state

Reviewed [SEC-10](r4-sec-10-auth-session-retirement-review.md), [SEC-11](r4-sec-11-auth-generation-poc.md), [SEC-12](r4-sec-12-production-auth-migration-plan.md), [AUTH-01](r4-auth-01-sdk-storage-compatibility.md), [AUTH-01B](r4-auth-01b-sdk-storage-resolution.md) and their complete generation/storage/SDK fixtures, assertions, builders, native runners and prior provenance. Their security boundaries remain requirements: immutable account/generation namespaces, transactional write denial and retirement, exact preservation of B, callback/data fencing, and distinct local erasure versus server revocation/JWT acceptance. Previous experimental success is not authorization to adopt a dependency.

Public GitHub/source/release/changelog inspection on 2026-10-24:

| Reference | Verified status | Revision |
|---|---|---|
| [Latest release v2.118.0](https://github.com/supabase/supabase-js/releases/tag/v2.118.0) | Published 2026-10-15; still latest | `6ede0cbfc8801bee14f61043578d2f3acf7fa831` |
| [master](https://github.com/supabase/supabase-js/tree/51816da3805daf2aed7393870e34d7e3374edb69) | Chosen independent patch base | `51816da3805daf2aed7393870e34d7e3374edb69` |
| [Issue #2708](https://github.com/supabase/supabase-js/issues/2708) | Open | Initial subscription load rejection |
| [PR #2709](https://github.com/supabase/supabase-js/pull/2709), @dasjideepak | Open, unmerged | `2ba54f13607a8fd86aebbde81fefe980830ab9ef` |
| [PR #2742](https://github.com/supabase/supabase-js/pull/2742), @hemanshuwadile | Open, unmerged | `b72048731964c7213b47ffb0fe9cd3cfd3e95c01` |
| [PR #2627](https://github.com/supabase/supabase-js/pull/2627) | Merged | Head `f87fc1c8751ebb851247e36d3d52222014b9752f`, merge `ff9909e6c813662144ff6d92a010f74627c6262a` |

The pinned [Auth changelog](https://github.com/supabase/supabase-js/blob/51816da3805daf2aed7393870e34d7e3374edb69/packages/core/auth-js/CHANGELOG.md) identifies 2.118.0 as an Auth version alignment, with no Auth code change. The release-to-master GoTrueClient difference consists of five documentation wording edits; the relevant runtime branches are unchanged. Source patches were rebased onto the exact master revision, not onto a guessed future release. The preserved #2709/#2742 hunks apply exactly without fuzzy matching. PR bases, heads, source/patch checksums and duplicate search results are in [provenance.json](../experiments/r4-auth-01c/provenance.json).

Public duplicate searches covered `refreshingDeferred`, `cleanup refresh`, `storage pending`, and `orphan` within supabase/supabase-js. No equivalent catch-time settlement fix was identified in the inspected results. Related work remains separate:

- [#2767](https://github.com/supabase/supabase-js/issues/2767)/[#2769](https://github.com/supabase/supabase-js/pull/2769): public retry after transient failure/cooldown on resume.
- [#2568](https://github.com/supabase/supabase-js/pull/2568): browser offline/reconnect behavior.
- [#2715](https://github.com/supabase/supabase-js/issues/2715): expired sessions removed on 429/408; this proposal does not reclassify those responses.
- [#2759](https://github.com/supabase/supabase-js/pull/2759): writes racing a refresh; nearby source changes require rebase/retest if merged.
- [#2756](https://github.com/supabase/supabase-js/pull/2756): SupabaseClient session-error propagation rather than anonymous fallback. A future application admission gate must not assume this is already released.

Search is evidence against an obvious duplicate, not proof none exists. Recheck before any future submission. No issue, PR, comment, branch or fork was created or modified upstream.

## F-AUTH01-1: initial subscription loading

The released `_emitInitialSession` catches errors **inside** the callback passed to `_useSession`. A rejected storage getter or a thrown session-shape error occurs before that callback begins. The SDK-owned subscription IIFE consequently rejects without an owner. `initialize()` can separately return `{ error: null }` because `_recoverAndRefresh` logs and swallows a recovery error. Neither a null initial event nor a null public initialization error proves storage health or authorizes an account.

| Variant | Rejected session read | Throwing user callback | Legacy lock |
|---|---|---|---|
| Official 2.118.0 | Can escape and omit initial event | Can escape; healthy callback may be invoked again with null | Initial emission not awaited |
| #2709 | Outward catch emits null | Still lacks ownership of the async subscription task | Await gap remains |
| #2742 | Outward catch emits null; task catch owns exception | Exception owned, but a healthy listener is still invoked twice | Await fixed |
| #2742 + supplement | Same genuine load-error notification | Exactly one delivery; exception belongs to the task | Await retained |

**New deterministic reproduction:** on #2742, initialize healthy storage, then register a listener which records its arguments and throws. The new upstream Jest test gets `INITIAL_SESSION(A)` followed by `INITIAL_SESSION(null)`, failing the exact one-call assertion. This is not another orphan or a storage failure; it is misclassification of a listener exception as a load exception.

[initial-supplement.patch](../experiments/r4-auth-01c/initial-supplement.patch) catches only the session-loading work, retains the loaded session/null result, and calls the subscriber once outside that catch. #2742's task catch then owns a callback exception. Existing warn/error/debug categories, unsubscribed-listener lookup and awaited legacy lock remain. A genuinely failed read still emits null once. The diagnostic can precede the callback for a load error; a throwing callback no longer causes a fabricated second event. These are the deliberate compatibility differences.

This is a focused review supplement for #2742, with attribution; no competing initial-session PR is proposed. Node strict-mode processes and native Chrome both observe zero unexpected unhandled rejections for the proposal.

## Initialization error semantics: broad propagation rejected

The earlier experimental `_recoverAndRefresh(true)` is **not included** in either proposal. It changes the cached public initialization result for any exception escaping the outer recovery try, without reliably identifying storage as the origin. A custom adapter may reject with `Error`, `TypeError`, a DOM exception, or even an `AuthRetryableFetchError`. Classification by exception name/class is insufficient; the operation boundary identifies a storage failure.

The independent tests sharpen the compatibility analysis:

- Getter failure, successful-preflight-then-failure, and one-shot getter failure still return no initialization error on current master/#2742. The broad flag changes these results. Since `initializePromise` is reused, a later healthy read does not rewrite that initialization outcome.
- A storage write can fail inside the nested user-recovery `_getUser`/`_saveSession` catch. That catch still consumes the failure **even with the broad flag**. The supported health boundary observes the original error while public initialization returns no error. Thus the flag is neither a complete storage-health API nor an adequate replacement for the boundary.
- Ordinary offline/503 refresh errors are returned by `_callRefreshToken` and handled in recovery, not thrown out of the outer try. Both current and propagation variants retain the bytes, return error-tolerant initialization, return the genuine retryable error from a session read, respect the same-token cooldown, and recover after the existing cooldown expires. The tests use controlled clock advancement to exhaust retry/cooldown budgets, not real sleeps or SDK-private field changes. **A blanket claim that the flag makes every offline startup permanently fatal would be incorrect.**
- Empty unauthenticated startup, invalid-envelope cleanup, expired-session refresh and malformed shapes retain their observed behavior. Existing upstream synthetic PKCE callback success/error/flow-id tests and public sign-out/lock tests also pass with the proposal. No real OAuth provider or hosted callback is claimed as tested.
- Existing automatic refresh/foreground behavior is exercised separately with native visibility changes and actual 30-second SDK intervals. The supplement does not alter those schedules or Auth/network error classification.

Comparative run: adding only the old propagation hunks to the proposal produces **4 changed public-result assertions / 13 passes** in the 17 initial tests. The nested-write, offline and 503 tests still pass, demonstrating both incomplete coverage and the absence of the overbroad offline claim. The flag is a diagnostic comparison state in `prepare.mjs`, not an exported third patch or a recommended API change.

### Supported application-level contract

After SDK subscription ownership and terminal settlement are fixed, a supported custom storage adapter can record **and rethrow** every real get/set/remove exception for its own admission attempt. This includes separate user storage if configured. Do not fabricate null, silently substitute memory, swallow a retired-write denial, or clear the record merely because a later operation succeeds.

Protected admission must check public initialization and session errors, storage health, valid nonempty token/identity/expiry fields, expected account binding, and authoritative generation/retirement state. Storage bytes and Auth notifications are not authentication authority. Publication must still recheck the generation after asynchronous work. The complete generation/retirement invariants remain necessary; the small health fixture does not replace the SEC-12 application design.

The tests prove failure after a successful preflight is detected, a one-shot error remains recorded after a later healthy read, and nested recovery writes are visible at the boundary. They also distinguish transport failure from storage failure without permanently poisoning an ordinary offline retry. A failed storage admission needs an explicit, controlled retry/revalidation; an old generation cannot be revived or an unrelated B attempt invalidated by A's health record. That full application integration is future authorized work, not implemented here.

Rejected alternatives: preflight-only checks; `INITIAL_SESSION` as an authorization signal; global unhandled-rejection suppression; blanket swallowed errors; automatic memory fallback; a global fatal flag for all accounts; private application-side mutation of SDK initialization/deferred fields; deprecated locks as a fix. The application contract alone cannot settle today's SDK-owned orphaned waiters and does not make the released artifacts pass the existing gates.

## F-AUTH01-2: independent terminal cleanup settlement

On a terminal Auth response, `_callRefreshToken` enters its catch and awaits the current storage read and possibly `_removeSession`. If either throws, execution skips the shared deferred's resolution and also skips the outer catch's non-Auth rejection statement. `finally` then clears the field. Joined callers still hold the old unresolved promise. A later successful refresh uses a new promise; it cannot rescue them.

[terminal-refresh.patch](../experiments/r4-auth-01c/terminal-refresh.patch) adds an inner try/catch around **only** the existing Auth-error handling branch. A catch-time exception rejects the same deferred and is rethrown unchanged. The successful path, healthy terminal result, proactive-preservation decision, cache assignment, removal order, notification and final field cleanup remain in place. It has no dependency on #2742 or initialization propagation.

The upstream regression uses deferred HTTP/removal barriers, observes all joined callers before releasing the response, and spies on the exact deferred's resolve/reject methods. This is isolated upstream test instrumentation, not an application workaround. The base's ten failures are missing `reject` calls, not elapsed-time guesses about a slow request. A task boundary drains promise reactions before checking public results. No arbitrary sleep, global timeout or automatic destructive retry is added.

| Outcome | Shared settlement | Main credential key | Notification before explicit later retry |
|---|---|---|---|
| Successful refresh | Resolve once; all succeed | Renewed | One `TOKEN_REFRESHED` |
| Healthy terminal error, expired session | Resolve once; same Auth error | Removed once | One `SIGNED_OUT` |
| Terminal error, access token still valid | Resolve once; same Auth error | Preserved | No `SIGNED_OUT` |
| Cleanup getter rejects | Reject once; original storage error | Retained; no remove attempted | No `SIGNED_OUT` |
| Remove abort/quota/rejection | Reject once; original storage error | Retained in the fixture; one attempted remove | No `SIGNED_OUT` |
| Removal commits but acknowledgement is lost | Reject once; original acknowledgement error | Absent in fixture, **caller outcome uncertain** | No `SIGNED_OUT` |
| Delayed acknowledgement | All pending until acknowledgement; then one resolution | Already absent while ack is held | One `SIGNED_OUT` after completion |

Every scenario runs with two and four callers. Tests require exact identity of the relevant error, primary removal count, event count, HTTP count, residual state and later success. Healthy terminal cooldown returns the same error without another HTTP call or notification; different-token recovery and success clear the prior cooldown. If an expired session remained after a storage failure, public `refreshSession` first recovers that stored session and then refreshes its explicit argument; the tests preserve and explicitly count those existing sequential requests rather than mislabel them as a concurrency duplicate.

Storage cleanup is not made atomic. A subscriber error during later cleanup notification, partially removed auxiliary keys, browser shutdown, remote revocation and cross-tab shared-slot races still need their existing boundaries. An injected lost acknowledgement is not proof of erasure; no credential-erasure or JWT-invalidation guarantee is added.

## Executed verification

Environment: Windows, Node **24.22.0**, application pnpm **10.34.6**, upstream pnpm **11.1.2**, Nx **23.1.0**, Jest **30.4.2**, ts-jest **29.4.9**, upstream TypeScript **5.8.3**, Prettier **3.8.3**, native **Chrome 155.0.8059.85**. Upstream frozen-lock filtered install succeeded with scripts disabled in a disposable checkout outside the app. No credentials were supplied. Docker was not available; **the complete local Auth-server integration suite was not run**.

| Check | Actual result |
|---|---|
| Unpatched terminal tests | **10 expected failures, 8 passes**; exact missing deferred rejection |
| #2742 initial tests before supplement | **1 expected failure, 16 passes** in the final 17-case run; the earlier 15-case run had the same one failure |
| Terminal-only patch + existing refresh rejection test | **19 passed** |
| Initial supplement without terminal patch | **17 passed** |
| Combined proposal + existing refresh, PKCE browser/Node, sign-out, lock-warning suites | **53 passed / 7 suites** |
| Broad propagation comparison | **4 expected compatibility differences, 13 passes** |
| Upstream Auth build / test-config typecheck | Passed, no TypeScript diagnostics |
| Upstream source Prettier / diff checks | Passed; both standard Git-applied patches reproduce recorded hashes |
| New proposal: fresh Node repetitions | **10/10**, each 21 blocker cases + 25 lifecycle cases + 16 generation groups + 2 unsafe controls |
| New proposal: fresh native Chrome profiles | **3/3**, each 21 blocker cases + 25 lifecycle cases + 16 actual IndexedDB generation groups + 2 unsafe controls + 11 additional native scenarios |
| Unchanged AUTH-01B matrix rerun | **126 blocker observations + 50 lifecycle cases + 96 generation groups + 12 unsafe controls**, diagnostic exit 2 as intended |

Node totals across the required ten runs: **210 + 250 + 160 + 20**. Native totals across three profiles: **63 + 75 + 48 + 6 + 33**. The proposal has no unexpected unhandled rejections. The two unsafe shared-slot controls still fail by design; neither is weakened. The unchanged old six-variant run still reproduces its expected released-SDK failures and orphan cases. Old full native six-variant repetitions are prior evidence, not claimed as rerun here; the new three-profile matrix tests the changed proposal.

Native additional coverage includes two-tab queued/in-flight logout, refresh success/failure, BroadcastChannel hints, forged hints, stale activation, retirement/write transaction races, actual Web Locks exclusivity, page reload, graceful whole-browser restart, foreground recovery and real SDK intervals (30,003.7 ms, 30,008.2 ms and 30,017.9 ms). Permission/quota/ack faults are injected at the supported storage boundary; actual OS quota exhaustion, power loss, mobile browsers and real backend Auth are not certified.

### Application validation and honest intermittent results

Production files and configuration are unchanged. TypeScript passed. The first lint attempt inspected four disposable upstream source copies under ignored `tmp/` and reported eight upstream `no-empty-object-type` errors. Those copies were relocated out of the application's input glob; no rule/configuration was changed. A restricted pnpm attempt also lacked the local package-manager store lock permission; the authorized normal execution uses the required process/store permissions.

The first full frontend run had **801 passed / 2 timed out** (803 present, 37 files): `History.pagination.test.tsx` loading 2,001 records and date-ascending sorting of 2,001 records. A separate History-only repeat had **110 passed / 1 timed out**, this time date-descending sorting of 2,001 records. The second full default-worker run again had **801 passed / 2 timed out**, loading 2,000 and 2,001 records. These are recorded as unresolved intermittent History timing failures; they were not skipped, weakened, attributed conclusively to a cause, or fixed by this task.

The independent complete `pnpm exec vitest run --maxWorkers=1` diagnostic passed **803/803 tests, 37/37 files** in 244.26 seconds. This is a per-command diagnostic, not a global worker/configuration change or proof the default-mode timing issue is fixed. `pnpm exec tsc -b` and the final `pnpm lint` passed without diagnostics; `pnpm build` passed with the existing 525.45 kB chunk-size advisory. All new JavaScript files pass `node --check`; staged `git diff --check` passes. GitHub Actions results for the final commit are linked in the PR/final report; existing CI continues to run its normal default-worker command and unchanged 200 + 30 PostgreSQL checks.

Upstream harness development also exposed fixture-specific expectations: subscription before initialization observes `SIGNED_IN`, and retained-expired recovery can issue an additional sequential refresh. The fixtures now register after initialization where required and count the real requests exactly. No production behavior was changed to accommodate a test. The Nx “flaky task” advisory followed intentional red/green source changes; focused failures described above are deterministic source comparisons, not dismissed as flakes. Upstream's existing force-exit and NO_COLOR/FORCE_COLOR advisories remain tool output.

## Reproduction, artifacts and distribution decision

Exact commands and setup: [experiment README](../experiments/r4-auth-01c/README.md). Copy-ready, **unpublished** English review note, terminal issue and terminal PR description: [maintainer drafts](../experiments/r4-auth-01c/maintainer-drafts.md). No speculative initialization API proposal is included. Source/patch hashes are [recorded separately](../experiments/r4-auth-01c/provenance.json); no upstream acceptance is implied by a bundled SDK passing.

Changed files are all new:

- This report.
- `experiments/r4-auth-01c/README.md`, `maintainer-drafts.md`, `provenance.json`.
- `terminal-refresh.patch`, `initial-supplement.patch`.
- `GoTrueClient.terminalStorage.test.ts.txt`, `GoTrueClient.initialStorage.test.ts.txt`.
- `prepare.mjs`, `sdk.mjs`, `expectations.mjs`, `probe.mjs`, `run.mjs`, `browser.mjs`, `native.mjs`.

| Distribution option | Assessment |
|---|---|
| Wait for reviewed official fixes/releases | Safest default; verify actual published artifacts and all acceptance gates again. No promise of maintainer acceptance or release timing. |
| Collaborate with #2742 and submit independent terminal fix | Recommended next action **after separate submission authorization**. Avoids a competing initial PR and provides portable, upstream-toolchain regressions. |
| Temporary custom SDK distribution | Requires explicit owner approval, pinned source/patch/dependency provenance, reproducible builds, integrity checks, ongoing rebase/security maintenance and a tested rollback policy. Not an application dependency here. |
| Supported application health/admission contract | Necessary application boundary after SDK fixes; insufficient alone for current orphaned promises. Must preserve generations and avoid anonymous request fallback; full integration remains future work. |

A dependency rollback before any storage migration differs from rollback after generation storage is activated. Later rollback must retain tombstones, namespace readers and retired-write denial; it must not reopen the old shared credential slot or revive a deleted account. No storage migration or application integration happened here.

**Recommendation:** review these independent artifacts, then separately authorize owner-approved upstream communication. Await reviewed release/support decisions and rerun candidate acceptance before R4-AUTH-02. Do not start that migration now.

Production application code and dependency versions were not changed.

Nothing was submitted to the upstream Supabase repository.
