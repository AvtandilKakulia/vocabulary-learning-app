# R4-AUTH-01 — Supabase SDK storage-error compatibility

Date: 2026-10-24. Base: `b6bf6f4833f3fd0523f669f0bab5aee40081c57c`
(main after PR #52). Scope: isolated experiments and this report only.

**Decision: NO-GO. R4-AUTH-02 must not proceed to a production SDK upgrade.**
2.112.4 fixes the original refresh-setter unhandled rejection and correctly
rejects concurrent refresh callers in that case. It does **not** pass the full
storage-failure gate: unavailable storage during initialization still creates
an unhandled rejection, and a storage error while handling a terminal refresh
failure strands a concurrent waiter. Both failures reproduce in Node and Chrome.

**Production application code and dependency versions were not changed.**
No hosted Supabase connection, actual credentials, real account deletion, SQL,
Auth configuration, deployment or merge was used. All SDK HTTP is intercepted
with synthetic fixtures; an unexpected origin/endpoint fails the experiment.

## Evidence and reproducibility boundaries

Reviewed [R4-SEC-10](r4-sec-10-auth-session-retirement-review.md),
[R4-SEC-11](r4-sec-11-auth-generation-poc.md),
[R4-SEC-12](r4-sec-12-production-auth-migration-plan.md), all eight SEC-11
experiment files, the existing lockfile and both installed SDK source trees.
The original SEC-11 files and their assertions remain unchanged.

| Label | Meaning here |
| --- | --- |
| **VERIFIED** | Executed assertion, installed artifact inspection or explicitly linked release/source fact. The environment is stated. |
| **REPRODUCED FAILURE** | A required safety/compatibility property fails under a controlled execution. An assertion that reproduces it is not a passing release gate. |
| **REASONED RISK** | Consequence of demonstrated mechanisms, without a claim about Production frequency. |
| **UNVERIFIED** | Not established by these synthetic/local tests; cannot support an unconditional security promise. |

The experiment runners deliberately exit **2** after all diagnostic assertions
match, because compatibility remains **NO-GO**. Exit **1**, a watchdog expiration,
missing result, unexpected stderr/error or changed observation is a harness or
unexpected-behavior failure. Do not turn exit 2 into a green compatibility check.
The repeated-run commands below explicitly verify it as a reproduced blocker.

## Exact installations

Windows x64; Node **24.22.0**, npm **11.19.1**, pnpm **10.34.6**;
native Chrome **155.0.8059.85**. Node tests load the installed CommonJS entry;
browser bundles load each installed package's module entry. HTTP instrumentation
asserts the SDK version in `X-Client-Info`; the candidate is not merely a version
label applied to the baseline code.

The application still resolves **supabase-js/auth-js 2.83.0** through its existing
pnpm lockfile/node_modules. Candidate **2.112.4** is installed separately in
ignored `tmp/r4-auth-01-candidate/`. `setup.mjs` copies the experiment's integrity
lock into that directory; `npm ci --ignore-scripts` installs exactly that graph.
No root manifest/lock, workspace configuration, package cache or installed package
is committed. `candidate-lock.json` is an experiment input, not an application lock.

| Resolved package | Existing application | Isolated candidate |
| --- | --- | --- |
| `@supabase/supabase-js` | 2.83.0 | 2.112.4 |
| `@supabase/auth-js` | 2.83.0 | 2.112.4 |
| `@supabase/functions-js` | 2.83.0 | 2.112.4 |
| `@supabase/postgrest-js` | 2.83.0 | 2.112.4 |
| `@supabase/realtime-js` | 2.83.0 | 2.112.4 |
| `@supabase/storage-js` | 2.83.0 | 2.112.4 |
| `@supabase/phoenix` | Not in this dependency graph | 0.4.5 |
| `iceberg-js` | Not in this dependency graph | 0.8.1 |
| `tslib` | 2.8.1 | 2.8.1 |
| `@types/node` | 22.14.1 | Not in this dependency graph |
| `@types/phoenix` | 1.6.6 | Not in this dependency graph |
| `@types/ws` | 8.18.1 | Not in this dependency graph |
| `undici-types` | 6.21.0 | Not in this dependency graph |
| `ws` | 8.18.3 | Not in this dependency graph |

These are recursive required dependencies of each SDK installation, not the whole
application dependency tree. Candidate's optional `@opentelemetry/api` peer is
not installed. The candidate graph has nine packages; baseline graph has twelve.
The runtime requirement increases from Node >=20 to >=22. This repository runs
Node 24, but a general upgrade must not assume compatibility with Node 20 tools.

`GoTrueClient.ts` SHA-256:

- Baseline: `18bbbbc0155a875cf2816184073c4793e376de6e6854d14d24d9770f8a3dcb93`.
- Candidate: `b673c2a3900877241f96860d602173f7459b4250f95cca44174c6245fd07805c`.

The candidate source was fetched directly from the official `v2.112.4` tag and
compared byte-for-byte with the installed npm source: identical. Use
`node experiments/r4-auth-01/sdk.mjs --versions --verify-tag` to repeat that
comparison. Browser-indexed line numbers can describe cached source; the exact
installed artifact and hash above are the basis for this report's source analysis.

## Original failure and upstream fix

The [2.112.4 release](https://github.com/supabase/supabase-js/releases/tag/v2.112.4)
includes [upstream PR #2627](https://github.com/supabase/supabase-js/pull/2627).
The fix attaches rejection handling to the internally owned refresh deferred,
without changing the rejected promise received by concurrent waiters. This is
not an application-level global rejection suppressor.

**REPRODUCED FAILURE, baseline:** after successful synthetic sign-in, hold the
refresh response, arm a throwing session setter, then release successful HTTP.
The public refresh promise rejects and is handled. A separate internal deferred
also rejects without a consumer; strict Node exits **1**. The complete public
result is printed before the crash, with `INJECTED_refresh-set` in stderr.
The unchanged SEC-11 runner additionally verifies its original
`PUBLIC_REFRESH_REJECTION_CAUGHT` / `POC_STORAGE_REJECTION` negative control.

**VERIFIED, candidate:** the same public error remains observable, the old stored
session is preserved, no TOKEN_REFRESHED success event is emitted, and the child
exits **0**. With two callers, both reject with the injected error and only one
refresh HTTP request is made. Neither the caller nor the waiter error is swallowed.

Default coordination differs: baseline serializes the public refresh calls and
makes two requests; candidate deduplicates them into one in-flight deferred.
No deprecated custom SDK lock is supplied to the new experiments. Native tests
observe the baseline's actual Navigator Lock and the candidate's absence of that
SDK lock. Separate application Web Locks are still exercised for real exclusivity.
The [tagged lockless-coordination note](https://raw.githubusercontent.com/supabase/supabase-js/v2.112.4/packages/core/auth-js/migrations/lockless-coordination.md)
describes the intended transition; the assertions test the installed behavior.

## Remaining essential failures

### F-AUTH01-1 — Unavailable storage during initialization still rejects internally

**REPRODUCED FAILURE in both versions**, including candidate:

1. Seed A's synthetic saved session and make reads of that session reject.
2. Construct the real Supabase client and await public `initialize()`.
3. Initialization logs the storage error but returns `{ error: null }`.
4. The client's automatically registered Auth subscription attempts its initial
   session read. An additional unhandled rejection escapes. Node exits 1;
   Chrome records one unsuppressed `unhandledrejection`. A's bytes remain stored.

Source mechanism: `_recoverAndRefresh` catches/logs the first error and returns.
`onAuthStateChange` starts an asynchronous initial-emission operation without
an outer rejection owner. `_emitInitialSession`'s callback-local try/catch cannot
catch a storage exception thrown by `_useSession` before that callback starts.
The harness waits for the second actual main-session read, so clearing its fault
during cleanup cannot hide the subscription failure. No user async callback is
needed to cause this; SupabaseClient registers its own subscription.

**REASONED RISK:** an initializing app can receive a non-error initialization
result while storage is unusable and the SDK reports an uncaught error. A
preflight storage read cannot remove all later failure windows. A generation
manager must still fail admission closed, but does not itself fix this SDK error.

### F-AUTH01-2 — Terminal-refresh cleanup failure strands concurrent waiters

**REPRODUCED FAILURE in candidate**, for both read and removal faults:

1. Hold A's refresh HTTP response and start a second public refresh call.
2. Let the second call join the same in-flight refresh. Make A's stored access
   token expired, then return a terminal `refresh_token_not_found` response.
3. Reject either the storage read in error handling or the subsequent removal.
4. The first public caller rejects with the storage error. The second remains
   pending; it receives neither an error nor success.
5. Clear the injected fault and execute a new successful public refresh. The
   original waiter **still remains pending** after the new operation completes.

Source mechanism: the Auth-error branch inside `_callRefreshToken`'s catch block
awaits storage before resolving the shared deferred. A storage exception from
inside that catch escapes without resolving/rejecting it; `finally` then removes
the client's reference. The later successful operation uses a different deferred.
The upstream non-Auth-error rejection fix does not cover this nested failure.

This is not a timer-based guess about a slow operation. Explicit HTTP/storage
barriers establish ordering, queued promise reactions are drained, the original
caller settles, and a later full operation settles while the old waiter stays
pending. Source analysis identifies the missing settlement path. Baseline's
serialized callers reject rather than sharing this stranded candidate deferred.

**REASONED RISK:** a UI or background operation awaiting that second refresh may
never finish. Disposal is not a remedy for an already lost promise resolver.
This violates the required consistent-waiter/error-propagation gate.

## Public SDK storage/lifecycle matrix

Each version has **28 exact scenarios**, with explicit expectations in
`expectations.mjs`. “Throws” below means a handled public promise rejection.
“Returns error” means a resolved SDK result with an error field. Child crashes
and browser unhandled events are counted separately from both forms.

| Scenario(s) | 2.83.0 | 2.112.4 | Classification |
| --- | --- | --- | --- |
| Initialization: rejected getter | Returns no error, logs once, then unhandled subscription rejection; original bytes remain | Same | REPRODUCED FAILURE F-AUTH01-1 |
| `getSession`: rejected getter | Throws; bytes unchanged | Same | VERIFIED propagation |
| Password sign-in setter failure | Throws; no saved session | Same | VERIFIED propagation |
| Sign-up setter failure | Throws; no saved session | Same | VERIFIED propagation |
| Sign-up with a session / without a confirmed session | Saves A / returns no session and saves nothing | Same | VERIFIED, two scenarios |
| Refresh setter: generic error, quota-like error, abort-like error, access denied, typed retired write | Public throws plus unhandled deferred crash | Public throws without internal crash | VERIFIED fix, five scenarios; injected storage faults |
| Getter fails after successful refresh HTTP | Baseline has no corresponding post-fetch read; stores new A and succeeds | Throws, preserves old A, no unhandled rejection | VERIFIED behavioral difference |
| Write commits but acknowledgement rejects | Public throws plus unhandled rejection; renewed bytes already exist | Public throws, no unhandled rejection; renewed bytes already exist | VERIFIED uncertainty: rejected acknowledgement does not prove rollback/erasure |
| Write commits, acknowledgement is delayed | Public operation remains pending until acknowledgement; then success | Same | VERIFIED explicit acknowledgement barrier |
| Two successful refresh calls | Two serialized HTTP requests and two refresh events | One HTTP request/event; both callers succeed | VERIFIED actual default coordination |
| Two calls, refresh setter fails | Both public callers reject; two orphan rejections in Chrome (first kills Node) | Both reject, one request, zero unhandled rejections | VERIFIED fix preserves waiter errors |
| Terminal refresh error while access token still valid | Returns AuthApiError and removes session | Returns AuthApiError and preserves still-valid session | VERIFIED lifecycle difference |
| Terminal refresh error after token expires during held HTTP | Returns AuthApiError, removes session | Same | VERIFIED expired-session cleanup |
| Terminal refresh plus removal failure | Serialized callers reject; old bytes remain | First rejects, shared waiter stranded | REPRODUCED FAILURE F-AUTH01-2 |
| Terminal refresh plus getter failure | First returns AuthApiError; second rejects; an SDK background read also rejects unhandled | First rejects, shared waiter stranded | REPRODUCED FAILURE; paths differ |
| Local/global sign-out success | Exact requested scope, session removed, SIGNED_OUT | Same | VERIFIED, two scopes; synthetic server only |
| Sign-out HTTP 500 | Returns AuthApiError, retains local session | Returns AuthRetryableFetchError, clears local session and emits SIGNED_OUT | VERIFIED material compatibility change |
| Sign-out removal rejects after HTTP 204 | Throws; residual A bytes remain | Same | VERIFIED incomplete cleanup |
| Stop/dispose during held refresh | Public stopAutoRefresh exists; late refresh still writes/emits | Public dispose exists; late refresh still writes, subscription cleared | VERIFIED: resource cleanup is not erasure/cancellation |
| Automatic refresh setter failure | Tick logs error, then internal deferred crashes | Tick logs error; no unhandled rejection or false refresh event | VERIFIED fix; scheduler errors are logged, not a public refresh result |
| Expired `getSession` recovery / initialization recovery | Refreshes and restores A | Same | VERIFIED, two scenarios |

For F-AUTH01-2 the runner also records the later retry, including its two HTTP
refreshes when the expired stored session is first loaded and the explicit refresh
then runs. The recorded three total requests are one failed initial cycle plus
that successful retry flow; they are not mistaken for concurrent deduplication.

The getter/setter matrix uses a controlled asynchronous Map-backed adapter in
both Node and Chrome. Quota/access/abort-like errors are injected, not claims of
exhausting a physical disk or changing browser policy. Actual IndexedDB abort
and transaction preservation are exercised separately in the generation suite.

## Generation isolation, shared-slot controls and SDK lifecycle

**VERIFIED:** sixteen generation groups per SDK run against both the serialized
model and native IndexedDB. They cover A → B; queued/in-flight local/global A
logout; B activation during successful/terminal A refresh with/without retirement;
A → B → A account retirement; individual same-UID generation retirement; unbound
A candidate cleanup; late A sign-in/callbacks; transaction abort with honest
residual reporting; retirement before delayed SDK cleanup; stale data publication
and restoration. Exact B bytes, SDK UID, durable active ID and manager view are
asserted, not merely the absence of an exception.

The compatibility manager imports unchanged SEC-11 activation/publication logic,
injects the chosen SDK and changes only its experimental retirement ordering:
durable denial precedes SDK awaits. It uses the prior narrow typed-retired-write
discard at the SDK boundary; raw throwing adapters are independently tested in
the matrix. Genuine persistence errors are never discarded. This does not
implement R4-AUTH-03/04 or certify a production manager.

Candidate refresh's post-fetch guard returns `AuthRefreshDiscardedError` when
retirement removed its starting session. Baseline can report an obsolete success
after a deliberately discarded typed write. In both cases, transactional storage
and application-generation checks, **not the SDK result**, prevent reactivation
and preserve B. Native transaction abort retains prior data and reports failure;
it is never reported as completed erasure.

**REPRODUCED FAILURE in both SDKs:** the two unsafe shared-slot controls demonstrate
that this upgrade is not a complete shared-session fix:

- Hold A's logout, sign in B, release logout: B's slot is removed.
- Hold A's setter after refresh response/read checks but before its write, sign
  in B, release A's setter: A overwrites B. The candidate's read/compare guard
  is not an atomic storage transaction against a different writer.

The native comparison supplies no custom SDK lock. A queued logout is held at
the supported storage-read boundary; baseline holds its native SDK Web Lock,
candidate does not. An independent application lock test proves actual native
cross-tab exclusive admission without treating deprecated SDK locks as a solution.

Other material differences verified in installed source/execution: candidate
preserves unexpired access credentials after a failed proactive refresh, has a
token-keyed failure cooldown, changes HTTP-500 logout cleanup/error type, and
offers public disposal. These need separate review in any eventual upgrade.
The [current disposal API](https://supabase.com/docs/reference/javascript/auth-dispose)
does not promise to abort pending requests or erase storage; the late-write test
demonstrates that limitation directly. [Public auto-refresh guidance](https://supabase.com/docs/reference/javascript/auth-stopautorefresh)
also distinguishes scheduling/visibility management from operation completion.

## Native browser methodology and results

The runner bundles only experiments and the selected installed SDK using the
existing esbuild dependency. A loopback server, fresh headless Chrome profile,
injected HTTP and `connect-src 'none'` isolate the fixture. No user browser profile
or production environment file is read. The only network used to obtain evidence
is public package/source/document retrieval; Auth/data calls never reach a server.

Per fresh profile, both SDKs execute:

- 56 storage/lifecycle observations total, including expected unsuppressed errors.
- 32 generation groups using **native IndexedDB** transactions, including actual
  transaction abort and write/retirement ordering.
- Four unsafe shared-slot controls.
- 22 additional scenarios: two-page operations and delayed real BroadcastChannel
  hints, stale/forged hints, concurrent transactions, native application Web Locks,
  real page reload, graceful full-browser restart, native hidden/foreground expiry
  recovery, and real scheduled refresh intervals.

The interval fixture observes the host `setInterval` callback while retaining
its actual **30,000 ms** delay. It makes the synthetic session eligible only when
that callback runs, preventing unrelated initial `getSession` activity from
masquerading as an interval refresh. It never advances a fake clock or calls a
private SDK tick. Refresh completion requires an actual TOKEN_REFRESHED event,
one HTTP call, stored renewed bytes and an observed host callback. The observed
delay must exceed 25 seconds; this is a negative-control assertion, not a sleep
used to make the test pass. Visibility uses actual `Page.bringToFront` transitions,
not fabricated visibility events.

Browser listeners record unhandled rejections/errors without `preventDefault`.
Baseline has exactly eleven expected unhandled events per matrix (two for its
two independently failing concurrent refreshes); candidate has exactly one,
from F-AUTH01-1. Every message must match its injected case. Generation, multi-page,
restart, visibility and interval scenarios require no unexpected browser errors.
Candidate's pending-waiter failure does not itself produce an unhandled event;
it is verified independently, including successful later retry.

Graceful process restart is tested; forced power-loss durability is not claimed.

### Final fresh-process repetitions

| Execution | Repetitions | Exact observations per repetition | Result |
| --- | ---: | --- | --- |
| Fresh Node parent, fresh child per SDK/case | 10 | 56 storage/lifecycle observations; 32 generation groups; 4 unsafe controls | All exact expectations matched; **10/10 exit 2, NO-GO** |
| Fresh native Chrome profile | 3 | 56 observations; 32 native IDB generation groups; 4 unsafe controls; 22 additional native scenarios | All exact expectations matched; **3/3 exit 2, NO-GO** |
| Unchanged SEC-11 Node runner | 1 | 24 generation groups; 4 unsafe shared-client controls; original expected crashing design | Completed, exit 0; original negative control preserved |

Thus the Node repetitions execute **560 isolated case processes**, 320 model
generation groups and 40 unsafe controls. Each repetition has eleven expected
crashing children (ten baseline, one candidate), each with a completed public
result and the matching injected-error marker. The other 45 children exit 0.
Chrome adds 168 observations, 96 native generation groups, twelve unsafe controls
and 66 additional native scenarios. These are assertion groups, not new Vitest
test counts, and intentional failure observations are not compatibility passes.

The three fresh profile suffixes were `OwmVcs`, `qTxls2` and `TSKa7p`. Each profile
was also reopened for the explicit graceful-restart cases; repetitions never
share a profile. Real interval timings (milliseconds, baseline / candidate):

| Fresh profile | 2.83.0 interval | 2.112.4 interval |
| --- | ---: | ---: |
| 1 | 30,891.4 | 30,874.8 |
| 2 | 30,376.6 | 30,374.3 |
| 3 | 30,171.9 | 30,152.7 |

There was no unexplained variation in these final repetitions. Browser errors
were exactly the twelve expected unsuppressed events per profile, documented
above. The two stranded-waiter variants reproduced for candidate in every run.

### Harness corrections and unexpected development output

These are disclosed separately from SDK findings and final repetition results:

- Initial browser expectations counted one baseline concurrent-set rejection;
  execution showed two independently failing serialized refreshes. The harness
  now requires exactly two and validates both injected-error markers.
- An early interval fixture refreshed after approximately 53/11 ms because an
  initial session read saw its already-expired synthetic token. That was **not**
  interval evidence. The final fixture gates expiry on the real native interval
  callback and asserts its firing count, delay and elapsed time. All final timings
  above satisfy those stronger assertions.
- The baseline terminal-read expectation was corrected after observing its full
  serialized completion: returned Auth error, removal/SIGNED_OUT, second caller
  rejection and an internal background read rejection. No candidate failure was
  converted into a compatibility pass.
- The first local `pnpm lint` scanned a downloaded upstream `.ts` source copy in
  ignored `tmp/` and reported two `no-empty-object-type` errors in that external
  file. The evidence copy was renamed to `.source.txt`; ESLint configuration and
  application code were untouched. `sdk.mjs --verify-tag` compares bytes in memory
  and does not create a TypeScript copy, so the published commands avoid this.
- A read-only `pnpm list` attempt initially hit a sandbox store-lock access denial;
  actual dependency verification instead resolves and reads installed manifests.
  No substitute package graph or SDK was used.

## Reproduction

Use the repository root, its existing locked application installation, Node 24,
and a native Chromium/Chrome executable. Commands below are PowerShell, matching
the measured environment. Public npm/tag access is needed only for setup/source
verification; experiment Auth/data HTTP remains fully synthetic.

```powershell
node experiments/r4-auth-01/setup.mjs
if ($LASTEXITCODE -ne 0) { throw 'Candidate setup failed' }
npm ci --prefix tmp/r4-auth-01-candidate --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01-npm-cache
if ($LASTEXITCODE -ne 0) { throw 'Isolated npm ci failed' }
node experiments/r4-auth-01/sdk.mjs --versions --verify-tag
if ($LASTEXITCODE -ne 0) { throw 'Version/tag verification failed' }

node experiments/r4-sec-11/run.mjs
if ($LASTEXITCODE -ne 0) { throw 'Original negative controls changed' }

node experiments/r4-auth-01/run.mjs
if ($LASTEXITCODE -ne 2) { throw 'Unexpected diagnostic result; inspect output' }
node experiments/r4-auth-01/native.mjs --browser 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if ($LASTEXITCODE -ne 2) { throw 'Unexpected native result; inspect output' }
```

Exit 2 is the **failed compatibility gate**, even though the diagnostic assertions
complete. Do not describe these commands as passing compatibility tests. To
repeat the original single-error negative control without the parent runner:

```powershell
node --unhandled-rejections=strict experiments/r4-auth-01/probe.mjs baseline refresh-set
if ($LASTEXITCODE -ne 1) { throw 'Expected original internal rejection crash' }
node --unhandled-rejections=strict experiments/r4-auth-01/probe.mjs candidate refresh-set
if ($LASTEXITCODE -ne 0) { throw 'Candidate did not fix the original setter case' }
```

Exact repetition commands, including final-count assertions:

```powershell
for ($iteration = 1; $iteration -le 10; $iteration++) {
  $logPath = "tmp/r4-auth-01-final-node-$iteration.log"
  node experiments/r4-auth-01/run.mjs *> $logPath
  if ($LASTEXITCODE -ne 2) { throw "Unexpected Node exit in repetition $iteration" }
  if (!(Select-String -LiteralPath $logPath -SimpleMatch 'VERIFIED: 56 storage/lifecycle observations; 32 generation checks; 4 unsafe shared-slot controls.')) {
    throw "Missing Node completion in repetition $iteration"
  }
}
for ($iteration = 1; $iteration -le 3; $iteration++) {
  $logPath = "tmp/r4-auth-01-final-native-$iteration.log"
  node experiments/r4-auth-01/native.mjs --browser 'C:/Program Files/Google/Chrome/Application/chrome.exe' *> $logPath
  if ($LASTEXITCODE -ne 2) { throw "Unexpected Chrome exit in repetition $iteration" }
  if (!(Select-String -LiteralPath $logPath -SimpleMatch 'VERIFIED NATIVE: 56 observations; 32 generation checks; 4 unsafe controls; 22 multi-page/lock/reload/restart/interval scenarios.')) {
    throw "Missing Chrome completion in repetition $iteration"
  }
}
```

Each Node run writes `tmp/r4-auth-01-node-<pid>.json` with complete public results,
exit codes, stdout and stderr. Each native run writes `observations.json` inside
its newly created `tmp/r4-auth-01-chrome-*` profile. These synthetic artifacts,
packages, profiles and caches remain ignored and are not committed. A failed
watchdog is a failed experiment, never evidence of a successful safety gate.

## Added files and validation

Only the following new files belong to this PR:

| File | Purpose |
| --- | --- |
| `docs/r4-auth-01-sdk-storage-compatibility.md` | Findings, decision and reproducible commands |
| `experiments/r4-auth-01/candidate-lock.json` | Exact isolated npm graph and integrity hashes |
| `experiments/r4-auth-01/setup.mjs` | Prepare ignored isolated installation |
| `experiments/r4-auth-01/sdk.mjs` | Verify actual versions/graphs and exact tagged source |
| `experiments/r4-auth-01/fixtures.mjs` | Synthetic HTTP, controlled storage, deferred barriers |
| `experiments/r4-auth-01/storage-cases.mjs` | Shared real-SDK public lifecycle/error scenarios |
| `experiments/r4-auth-01/expectations.mjs` | Exact results, including failed compatibility gates |
| `experiments/r4-auth-01/probe.mjs` | One unsuppressed isolated child-process case |
| `experiments/r4-auth-01/run.mjs` | Node comparison and negative controls |
| `experiments/r4-auth-01/manager.mjs` | Experimental SDK-injected generation manager |
| `experiments/r4-auth-01/generation-cases.mjs` | Shared model/native generation assertions |
| `experiments/r4-auth-01/browser.mjs` | Native fixture and public refresh/visibility observations |
| `experiments/r4-auth-01/native.mjs` | Loopback server, fresh Chrome/CDP orchestration |

The existing `.github/workflows/quality.yml` is unchanged. Its `quality` and
`PostgreSQL integration` jobs validate the application baseline; they **do not**
run these optional SDK experiments or override the NO-GO decision. The PR/final
review record supplies the actual GitHub Actions run URL and results.

Local validation of the unchanged application:

| Command/check | Actual result |
| --- | --- |
| `pnpm exec tsc -b` | Exit 0; zero TypeScript errors |
| `pnpm lint` | Final exit 0; zero errors/warnings; initial external-source-copy failure disclosed above |
| `pnpm test` | **803/803 tests, 37/37 files passed**, 86.92 s; no History timeout or other intermittent failure observed in this full run |
| `pnpm build` | Exit 0; Vite 6.2.6, 1,607 transformed modules; 10.09 s build |
| `node --check` on every new `.mjs` | All eleven modules parsed successfully |
| `git diff --check` and `git diff --cached --check` | Passed |
| Diff against the pinned main baseline | Only thirteen new files in the authorized paths; application, existing tests, root manifests/lock, CI, SQL and original SEC-11 sources unchanged |

Build still reports the unchanged bundle-size advisory: the main JavaScript
chunk is **525.45 kB** (140.82 kB gzip), above Vite's 500 kB threshold. This task
does not alter application bundles or suppress that warning. Git also reports
its normal Windows LF-to-CRLF working-copy conversion advisory when staging the
new text files; whitespace checks pass. Local PostgreSQL integration was not
rerun for this SDK-only task; the unchanged CI job retains its required 200
authorization and 30 word-version checks, whose actual run result must be read
from GitHub Actions.

## Limitations, residual risks and next action

- **UNVERIFIED:** hosted Auth revocation/JWT validity, real user deletion, backend
  integration, production browser support, mobile suspension, Firefox/WebKit,
  process crash/power loss, OS quota exhaustion and browser-policy storage denial.
  Synthetic JWTs and responses prove local SDK behavior, not server guarantees.
- **UNVERIFIED:** an exhaustive review of every release between 2.83.0 and
  2.112.4. The relevant Auth paths and graph changes are examined; unrelated
  realtime/storage/query behavior is not certified for a production upgrade.
- **VERIFIED scope limit:** generation-manager guarantees require authoritative
  transactional admission/publication checks. Refresh read/compare checks and
  resource disposal alone do not prevent shared-slot credential replacement or
  erase already persisted credentials. Narrow typed-retired-write discards must
  never be generalized to real persistence errors.
- **REASONED RISK:** read failure during admission and interrupted terminal-error
  cleanup may stall or mislead application state even if other generation
  invariants hold. Neither global rejection suppression, memory-only storage
  fallback nor a deprecated custom SDK lock is an acceptable compatibility fix.
- **NO-GO next action:** address F-AUTH01-1 and F-AUTH01-2 in a separately reviewed
  SDK fix or a demonstrated supported lifecycle strategy; pin its exact artifact
  and rerun all gates. No upstream issue/PR has been submitted by this task.
  R4-AUTH-02 must **not** start automatically or proceed to a production dependency
  change based on this report. No production manager, migration, deployment or
  complete session-erasure/JWT-invalidation promise is delivered here.
