# R4-AUTH-01B — SDK storage-failure resolution experiment

Date: 2026-10-24 (Asia/Tbilisi). Base: `9cac7902caf67b47fc24c7272e03cd287072d523`, merged PR #53.

## Decision: CONDITIONAL GO

An isolated source patch demonstrates a resolution for both blockers. **No tested official release passes both gates.** This is evidence for upstream review and a future acceptance run, not permission to upgrade or begin R4-AUTH-02.

Production application code and dependency versions were not changed.

Only `experiments/r4-auth-01b/` and this report are added. Existing SEC-11/AUTH-01 experiments and assertions, application tests, SDK 2.83.0, lockfile, CI, SQL, Auth configuration and deployment configuration remain unchanged. No hosted Supabase connection, real credentials, account deletion, deployment, merge, or upstream issue/PR submission was performed.

## Upstream status and exact artifacts

Public GitHub release/PR APIs, npm metadata, tagged source and changelogs were checked on 2026-10-23 UTC / October 24 locally. [v2.118.0](https://github.com/supabase/supabase-js/releases/tag/v2.118.0) is still the latest official release: GitHub `2026-10-15T12:55:27Z`, npm `2026-10-15T12:57:17.683Z`. Its tag resolves to `6ede0cbfc8801bee14f61043578d2f3acf7fa831`.

| Reference | Verified status | Relevance |
| --- | --- | --- |
| [Issue #2708](https://github.com/supabase/supabase-js/issues/2708) | Open; updated 2026-09-25T22:37:28Z | Initial subscription rejection for expired empty-refresh-token / non-object-user sessions |
| [PR #2709](https://github.com/supabase/supabase-js/pull/2709) | Open, unmerged; head `2ba54f13607a8fd86aebbde81fefe980830ab9ef` | Moves the initial-session catch outside `_useSession`; tested with arbitrary rejecting storage, not just the issue's shapes |
| [PR #2742](https://github.com/supabase/supabase-js/pull/2742) | Open, unmerged; head `b72048731964c7213b47ffb0fe9cd3cfd3e95c01` | Also awaits the legacy lock callback and catches the subscription-owned asynchronous task, including a throwing listener |
| [PR #2627](https://github.com/supabase/supabase-js/pull/2627) | Merged 2026-08-24T10:17:11Z; head `f87fc1c8751ebb851247e36d3d52222014b9752f` | Deferred rejection handling shipped in 2.112.4; does not settle the terminal-cleanup exception path |

The [Auth changelog at the exact tag](https://github.com/supabase/supabase-js/blob/v2.118.0/packages/core/auth-js/CHANGELOG.md) lists changes since 2.112.4 including discarded-initial-refresh handling (#2668), cross-tab stored-session recovery (#2698), MFA/passkey APIs and failed-factor cleanup. The 2.118.0 release itself lists PostgREST/storage/CI changes. Neither open initial-session PR is in the released source; the terminal cleanup gap remains. No released resolution for both blockers was identified in this review. This is not a claim to have tested every historical release.

### Dependency graph and integrity

| Artifact | Exact resolved runtime dependency graph |
| --- | --- |
| Application baseline | `@supabase/{supabase-js,auth-js,functions-js,postgrest-js,realtime-js,storage-js}` **2.83.0**; `@types/node` 22.14.1, `@types/phoenix` 1.6.6, `@types/ws` 8.18.1, `tslib` 2.8.1, `undici-types` 6.21.0, `ws` 8.18.3 |
| Previous isolated candidate | The same six Supabase packages **2.112.4**; `@supabase/phoenix` 0.4.5, `iceberg-js` 0.8.1, `tslib` 2.8.1 |
| New official candidate and three source variants | The same six packages **2.118.0**; `@supabase/phoenix` 0.4.5, `iceberg-js` 0.8.1, `tslib` 2.8.1 |

The baseline uses the unchanged pnpm lock; the previous candidate uses the unchanged AUTH-01 `candidate-lock.json`. The new `official-lock.json` pins all nine packages with npm archive URLs and SHA-512 integrity. `npm ci` installs candidates only under ignored `tmp/`, verifies archive integrity, and uses `--ignore-scripts`. `sdk.mjs --inventory` checks installed versions against that metadata and prints the resolved graph. No candidate package is installed into the application's dependency tree.

SHA-256 of `auth-js/src/GoTrueClient.ts`:

| Variant | Hash |
| --- | --- |
| 2.83.0 | `18bbbbc0155a875cf2816184073c4793e376de6e6854d14d24d9770f8a3dcb93` |
| 2.112.4 | `b673c2a3900877241f96860d602173f7459b4250f95cca44174c6245fd07805c` |
| Official 2.118.0 (identical to tagged source) | `7552500e375665e28acf23fb552ccbf1ef11379afab15859b2f670f1ae9aee9f` |
| 2.118.0 + #2709 source hunks | `e225efeef0c142ba14e277fe39159dbde901ad3679f71c9755c292a0e08e3bb0` |
| 2.118.0 + #2742 source hunks | `9add228451a99b5c64e7844e950cb36ca0891d505347d1894037d183a0719dbc` |
| 2.118.0 + #2742 + local settlement patch | `a49ee37b6e6f8fe6d9127ebe453a6a29cff482a7048bed24e0b9138f8dfe8321` |

`provenance.json` records PR bases/heads, patch hashes and resulting source hashes. Patch hashes use LF line endings; empty context lines use Git's `--suppress-blank-empty` format. Standard `git apply` was also verified against disposable copies. The builder checks patch integrity, the official base and each reconstructed source hash and applies exact, unique hunks; it cannot fuzzily patch another revision. It copies source to ignored experiment-owned directories and bundles through the existing esbuild, aliasing only Auth to the copied source. Official installations are left intact. Supabase-js 2.118.0 uses `dist/index.{cjs,mjs}` rather than the earlier `dist/{main,module}` layout; entry points are taken from package metadata.

## F-AUTH01-1: initialization and initial subscription

`initialize()` awaits `_recoverAndRefresh()`. That helper catches a custom storage getter rejection and logs it without rethrowing. Consequently `_initialize()` returns `{ error: null }`. Independently, SupabaseClient registers its own Auth listener. `onAuthStateChange()` starts an asynchronous initial-session read. The released `_emitInitialSession()` catch is **inside** `_useSession`'s callback, so a failure loading storage before that callback escapes. Catching the public initialization or `getSession()` promise cannot catch this separate SDK-owned rejection.

Exact observed sequence: rejected storage read → public initialization with no error → independently unhandled initial read. Under Node strict rejection policy the child exits 1 with the injected error, not a watchdog. Chrome reports the corresponding native `unhandledrejection`. Registering another listener after healthy initialization also reproduces the gap.

The #2709 and #2742 source patches both contain arbitrary storage read rejection and emit `INITIAL_SESSION(null)`. Neither alone changes the false successful initialization result. #2709 also leaves an exception from the fallback callback unowned; #2742 owns that asynchronous subscription task. These are SDK-local catches with retained diagnostics, not a global rejection suppressor.

The complete experimental patch uses #2742 and calls `_recoverAndRefresh(true)` only from initialization. Its new optional flag rethrows recovery exceptions there, allowing the existing `_initialize()` public result to report `AuthUnknownError` rather than null. Other recovery entry points retain their existing behavior. This can also make other initialization recovery exceptions observable; it needs upstream API review, not an unreviewed production transplant.

The executable admission boundary uses a documented custom storage adapter to record and **rethrow** actual read/write/remove exceptions. Admission requires an error-free public initialization result, error-free `getSession()`, intact storage health, and a structurally valid session. A one-shot failed initial read can be followed by `INITIAL_SESSION(A)` when storage recovers; the sticky failed health state still denies admission. Notifications are not authority. No null-session fabrication, old-slot fallback or memory-only persistence is used. This boundary is a compatibility experiment, not a complete application Auth manager.

Healthy empty storage remains anonymous. Expired valid sessions refresh normally. An empty refresh token on an expired session and a non-object user fail visibly; an invalid session envelope is removed according to existing SDK behavior. Callback exceptions are separately tested: a throwing application listener is not mislabeled as a storage failure.

## F-AUTH01-2: lost deferred during terminal cleanup

Lockless `_callRefreshToken()` shares `refreshingDeferred` with concurrent callers. After a terminal Auth error, its catch branch reads storage to distinguish proactive failure from expired-session failure, then may await `_removeSession()`. If this getter or removal throws, the exception originates **inside the catch body**. It bypasses the later deferred `resolve/reject`; `finally` clears the only SDK reference. The initiating caller rejects while joined callers remain pending. A subsequent successful refresh creates a new deferred and cannot settle the old one. #2627's rejection observer is not settlement.

The local patch wraps that Auth-error handling branch in a nested try/catch. A cleanup exception rejects the same shared deferred before rethrowing the same exception to the initiating caller. The original `finally`, normal Auth-error results, proactive-session preservation and failure cooldown remain intact. No retry, extra cleanup, new lock or timeout is introduced.

With the patch, 2- and 4-caller failure cases all reject with the same error class/message. Getter failure performs no removal; a failing removal is attempted once. Healthy four-caller refresh performs one HTTP request and one notification. Healthy terminal cleanup returns the Auth error to every caller after one removal and one `SIGNED_OUT` notification. Delayed acknowledgement keeps every caller pending until the acknowledgement arrives. Lost acknowledgement after an actual removal is reported as failure with no residual main-slot bytes; it is not falsely called rollback or successful sign-out.

## Official versus experimental results

| Artifact | Initial storage failure | Terminal-cleanup waiter settlement | Gate |
| --- | --- | --- | --- |
| 2.83.0 | Null initialization error + unhandled rejection | Legacy serialized operations; also fails read/error and duplicate-cleanup expectations | NO-GO |
| 2.112.4 | Null initialization error + unhandled rejection | Initiator rejects; joined waiters orphaned | NO-GO |
| 2.118.0 | Same confirmed failure | Same confirmed orphaned waiters | NO-GO |
| 2.118.0 + #2709 | Storage initial rejection contained; initialization still reports success; throwing callback still escapes | Still orphaned | NO-GO |
| 2.118.0 + #2742 | Initial task owned; initialization still reports success | Still orphaned | NO-GO |
| 2.118.0 + #2742 + local patch + checked admission boundary | Actionable initialization failure, no unhandled rejection, no admission after storage failure | Every admitted caller settles; no duplicate cleanup | Experimental gates pass; **CONDITIONAL GO** |

### Supported public API alternatives (Path B)

- A custom adapter can detect persistence failure before protected admission and retain the original exception. The passing-preflight-then-failure case proves that checking availability once is insufficient.
- Awaiting public `initialize()` / `getSession()` and registering `onAuthStateChange()` cannot own the separate internal initial-subscription rejection on the released artifacts. SupabaseClient registers an internal subscription even without an application listener.
- [`stopAutoRefresh()`](https://supabase.com/docs/reference/javascript/auth-stopautorefresh) controls scheduling, not initial reads or already admitted refresh promises. Explicit refresh tests reproduce the blocker with automatic refresh disabled.
- [`dispose()`](https://supabase.com/docs/reference/javascript/auth-dispose) does not abort admitted operations or erase their storage effects. Teardown cannot repair the lost shared deferred. Recreating a client creates new work, not settlement for prior callers.
- Serializing every application refresh call would not account for SDK-owned refresh entry points and would not cure initialization. Private deferred mutation, global rejection suppression, synthetic null reads, volatile fallback, and blanket timeouts were rejected.

**Path B alone is rejected for the official releases tested.** The adapter boundary contributes truthful admission/error reporting but cannot repair an SDK-owned orphan or unhandled task. The source patch remains necessary for the demonstrated solution.

## Executed matrix and semantics

Environment: Windows, Node **24.22.0**, npm **11.19.1**, pnpm **10.34.6**, Chrome **155.0.8059.85** headless, real loopback browser/CDP. Only synthetic credentials and injected Auth HTTP are used. Node fixtures forbid external `fetch`; browser fixtures set CSP `connect-src 'none'`. Browser API calls use native IndexedDB, BroadcastChannel, Web Locks and page visibility. No jsdom timing is used as browser evidence.

Each new run compares six artifacts. Each artifact has **21** blocker cases: 11 initialization/subscription/shape cases and 10 refresh/cleanup cases. Explicit HTTP/storage deferred barriers, task boundaries and actual events establish ordering. Failure watchdogs only fail hung harnesses; no timeout manufactures a successful API result or declares a race safe.

The test distinguishes public promise rejection, returned SDK error, internal unhandled rejection, pending/orphaned caller, durable removal, aborted transaction, residual credentials, notification and protected admission. In particular a diagnostic reproducing a failure is **not** a compatibility pass.

| Evidence per complete run | Count / result |
| --- | --- |
| New blocker observations | 126 (6 × 21), exact expected-state assertions |
| Strict Node child failures among these | 24 expected unhandled-rejection exits; 102 completed observations. Zero expected child crashes for #2742 or the complete patch |
| Orphan reproductions | 28 case observations across 2.112.4, 2.118.0 and the two upstream-only variants; none for the complete patch |
| Native unhandled errors | 39 expected: baseline 14, previous 12, official 12, #2709 1, #2742 0, complete patch 0 |
| Preserved AUTH-01 lifecycle cases | 50: 25 unchanged assertions each on official 2.118.0 and the complete patch |
| Generation isolation | 96 groups: 16 per artifact; transactional model in Node, actual IndexedDB in Chrome |
| Unsafe shared-slot negative controls | 12 failures correctly reproduced, 2 per artifact; improved SDK settlement does not make a shared-slot architecture safe |
| Additional browser scenarios | 66 per profile: real two-page handoff/races, locks, forged hints, reload, full graceful restart, visibility recovery, and six actual scheduled refresh intervals |

The 25 preserved lifecycle cases exclude only the three old blocker probes replaced by the stricter new initial/terminal tests; the original runner is also executed unchanged. The reused legacy helper's `2.112.4` argument selects its lockless **expectation profile**, not a claimed installed version. Actual candidate version/header/source/graph are recorded separately. Existing unsafe controls and strict byte/identity assertions are preserved.

Generation coverage includes A → B, A → B → A, queued/in-flight local logout, late refresh success/failure with/without retirement, same UID/new generation, account-wide confirmed retirement, late notifications, unbound candidate retirement, obsolete data publication rejection, aborted retirement transactions, delayed cleanup and restoration. Every B-preservation assertion checks exact stored bytes and active generation. Native runs additionally exercise concurrent IDB transactions, real cross-tab signals, queued application Web Locks, page reload and full browser-process restart.

The blocker fault adapter is deterministic asynchronous in-memory storage in **both** environments; it is not mislabeled as a browser permission-denial reproduction. Separate generation/native cases exercise actual IndexedDB transaction abort and durable persistence. Quota/security/ack failures are injected at the public adapter boundary; actual OS quota exhaustion and forced browser crash/power loss are not tested. Browser restart is graceful. Long-lived platform coverage beyond Chrome is still required before migration.

### Repetitions and project validation

- **10/10 fresh Node matrix runs** completed with the exact expected summaries and diagnostic exit 2: 1,260 blocker observations, 500 preserved lifecycle cases, 960 generation groups, 120 unsafe controls. This includes 240 expected strict child failures and 280 reproduced orphan-case observations. The complete patch passes all 21 new cases in each run; the official candidates still fail their compatibility gates.
- **3/3 fresh final Chrome profiles** completed, each with 126 blocker observations, 50 preserved lifecycle cases, 96 native generation groups, 12 unsafe controls and 66 additional native scenarios. Totals: 378 + 150 + 288 + 36 + 198 respectively. All 117 expected unhandled events belonged to the deliberately failing comparison artifacts; none belonged to the complete patch. All 18 actual interval refreshes completed, measured **30,303.6–30,840.6 ms**. Exploratory pilot runs are excluded from these repetition totals.
- The original SEC-11 runner passed **24** generation groups, **4** unsafe controls and **1** expected failing-design reproduction. The unchanged AUTH-01 runner reproduced its original NO-GO: **56** storage/lifecycle observations, **32** generation groups and **4** unsafe controls, exit 2.
- Both isolated candidate `npm ci` installs succeeded (nine packages each); exact patches rebuilt to their recorded hashes. All new `.mjs` files passed `node --check`. All three reconstructed Auth source variants additionally passed strict TypeScript 5.6 checking with ES2022/DOM libraries and bundler module resolution: **0 diagnostics** each.
- An additional full Node matrix after clean candidate reinstall passed all exact observation assertions (diagnostic exit 2), beyond the ten-run set above. One restricted-sandbox esbuild invocation could not access a parent directory; rerunning with process permissions succeeded. This environment setup error is not an SDK compatibility failure. Standard Git application and the builder both reproduce the same LF-normalized patched source.
- Application `pnpm exec tsc -b` and `pnpm lint`: passed, **0 errors / 0 lint warnings**.
- First `pnpm test`: **800 passed, 3 failed** in 118.78 s. Unchanged History pagination tests hit their existing 5,000 ms limit: loading 2,000 records, loading 2,001 records, and sorting 2,001 by date ascending. This run overlapped the native experiment. The isolated unchanged History file then passed **111/111** in 47.39 s; a full repeat with no experiment/browser runner active passed **803/803**, 37 files, in 66.88 s. No timeout, worker setting or assertion was changed. The observed sensitivity is consistent with resource contention, but its precise cause is not proven or claimed fixed by this PR.
- `pnpm build`: passed; the existing **525.45 kB** JS chunk still triggers Vite's >500 kB warning. No application bundle optimization was made.
- Diff/scope checks: only the new experiment directory and this report; production code, dependency manifests, existing tests/experiments and CI unchanged.

There were no unexpected experiment errors or watchdog stalls in the final repetition sets. Deliberately orphaned comparison promises remain recorded as failed compatibility guarantees. This report does not turn those failures into passes because the harness recognized them.

## Reproduce from a clean checkout

Use Node 24, the repository's pinned pnpm, and installed Chrome/Chromium. Commands run from the repository root. Candidate installs are ignored, separately pinned and contain synthetic fixtures only.

```powershell
pnpm install --frozen-lockfile
node experiments/r4-auth-01/setup.mjs
npm ci --prefix tmp/r4-auth-01-candidate --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01-npm-cache
node experiments/r4-auth-01b/setup.mjs
npm ci --prefix tmp/r4-auth-01b-official --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01b-npm-cache
node experiments/r4-auth-01b/build-patches.mjs
node experiments/r4-auth-01b/sdk.mjs --inventory
node experiments/r4-auth-01b/run.mjs
# Expected exit 2: CONDITIONAL GO, official SDKs still fail. Unexpected assertions exit 1.
node experiments/r4-auth-01b/native.mjs --browser 'C:/Program Files/Google/Chrome/Application/chrome.exe'
# Expected exit 2; a fresh disposable profile is created on every invocation.
```

Repeat the Node command ten times and native command three times, requiring both exit 2 **and** these complete summary lines (exit 2 by itself is not proof):

```text
VERIFIED: 126 blocker observations; 50 preserved lifecycle cases; 96 generation groups; 12 unsafe controls.
VERIFIED NATIVE: 126 blocker observations; 50 preserved lifecycle cases; 96 generation checks; 12 unsafe controls; 66 multi-page/lock/reload/restart/interval scenarios.
```

Node JSON observations are written to `tmp/r4-auth-01b/node-<pid>.json`; browser observations and disposable profiles live under `tmp/r4-auth-01b-chrome-*/`. SDK sources/builds live only in `tmp/r4-auth-01b-build/`. Keep expected stderr/error observations when reviewing results; do not suppress them to present an official candidate as passing.

```powershell
node experiments/r4-sec-11/run.mjs       # Expected exit 0; unsafe controls intentionally reproduce damage.
node experiments/r4-auth-01/run.mjs      # Expected exit 2; original compatibility NO-GO unchanged.
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

The unchanged CI jobs validate the application and isolated PostgreSQL suites. They do **not** install these candidate dependencies or run this new browser/SDK matrix. The experiment has explicit local evidence, not an invented automated CI gate; adding a dedicated job would require a separately authorized change.

## Minimal upstream proposal and remaining release gates

The complete reviewable patch is `upstream-2742.patch` followed by `storage-settlement.patch`, applied to the pinned base. `upstream-2709.patch` is an alternative evaluated independently, not applied in addition to #2742. No patch is applied to production node_modules.

Proposed upstream review scope:

1. Own the entire initial-session read/subscription task, including storage getter and listener failures (#2742).
2. Propagate initialization recovery failure through the existing public initialization error result; review whether the flag/exception boundary needs narrower public error typing.
3. Guarantee resolve/reject of the shared refresh deferred when terminal-error handling itself throws, before clearing its reference.
4. Port the rejecting-getter, post-preflight, transient-read, empty-refresh-token, malformed-user, 2/4 waiter, removal/abort/quota, delayed/lost-ack and subsequent-refresh regressions into upstream's suite. Assert one cleanup, exact errors, no unhandled event, no retained old waiter and truthful residual storage.

Prerequisites for R4-AUTH-02: independent source/security review; upstream merge and an official release containing equivalent fixes (or separate explicit approval of a supported distribution strategy); rerun the full matrix against the actual released package/integrity; review new initialization error semantics and lifecycle API changes; validate all SEC-12 migration gates, additional browsers/private-storage modes and crash-recovery expectations. The current production shared-client architecture still needs the independently reviewed generation/isolation migration. Successful local byte erasure is not server token revocation or immediate JWT invalidation.

No production SDK upgrade or R4-AUTH-02 work is authorized by this result.
