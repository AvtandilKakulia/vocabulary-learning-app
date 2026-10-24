# R4-FUNC-01 — Functional gap audit and final verification

Audit date: 2026-10-24. This is a repository and isolated-fixture audit, **not production certification or a remediation PR**. Source references refer to the audited main commit.

## 1. Executive summary

**Decision: FUNCTIONAL FIXES REQUIRED.** Three current application defects were reproduced independently of the existing acceptance suite:

| ID | Priority | Observed failure | Evidence |
| --- | --- | --- | --- |
| FUNC-001 | P1 | An obsolete A profile save calls email update while B is current, then reports success in B's form. | Deferred React probe and real App/AuthProvider in production-mode Chromium; service boundary mocked. |
| FUNC-002 | P1 | Theme-preference read/write failure replaces the app with its generic error fallback. | Separate React read/write probes; write fault also reproduced in Chromium. |
| FUNC-003 | P1 | Two restored editors for the same active Test overwrite submitted answers with stale checkpoints. | Two-root React probe and two independent Chromium pages sharing real localStorage; reload restores rolled-back progress. |

Final unchanged frontend suite: **806/806 tests, 37 files**. Disposable PostgreSQL: **200 authorization checks + 30 word-version groups passed**. TypeScript, lint and build passed. Earlier local runs had intermittent timeouts, retained below. Four opt-in assertions reproduce the three defects; they assert broken current behavior, not successful remediation.

Earlier Search, word concurrency/mutation, Practice lifecycle/ownership, complete dictionary/History retrieval, History deletion/pagination and account-deletion safeguards remain present and pass their regressions. Auth-generation migration and **R4-AUTH-02 remain BLOCKED**. Experimental SDK patches are not installed fixes. No production code, dependencies, existing tests, migrations, configuration or service data were changed.

## 2. Exact audited main SHA and evidence boundary

- Repository: `AvtandilKakulia/vocabulary-learning-app`.
- Main: **`8590f4a166d631fcd903e4cc19090b41510eeb84`**, [PR #57](https://github.com/AvtandilKakulia/vocabulary-learning-app/pull/57) merged. A second fetch before report completion returned the same SHA.
- No open PRs were returned before this audit PR. PR #38 is closed **unmerged**, used only as historical diagnostic evidence.
- Branch: `codex/r4-func-01-functional-gap-audit`, created from that main with an initially clean tree.
- Windows/PowerShell; Node **24.22.0**, pinned pnpm **10.34.6**, Vitest **4.1.11**, React **18.3.1**, Vite **6.2.6**, installed Supabase JS **2.83.0**, disposable PostgreSQL **17.11**. The restricted-shell pnpm launcher initially could not lock its external store; authorized execution used the existing pinned runtime without dependency changes.
- Entry: `src/main.tsx` → StrictMode/ErrorBoundary → `App.tsx` → AuthProvider/ThemeProvider and feature roots. Navigation is React state, not a URL router.
- Evidence: source, regression tests, Git/PR history, repository reports, new synthetic probes and browser observations. No access to private conversations is claimed.
- Repository migrations/CI do **not** establish hosted deployment, schema or Auth configuration. No hosted Supabase connector, credentials, SQL or production operations were used. GraphQL retirement remains owner-reported, not independently verified hosted state.

## 3. Existing test and CI baseline

| Command/check | Actual result |
| --- | --- |
| `pnpm exec tsc -b` | Passed, zero errors. |
| `pnpm lint` | Passed, zero errors/warnings. |
| Final independent `pnpm test` | **806 passed / 37 files**, 87.54 s, default workers. |
| `pnpm build` | Passed; 1,607 modules; JS 526.48 kB / gzip 140.94 kB. Existing >500 kB chunk warning; no outdated Browserslist warning. |
| `node supabase/tests/authorization/run.mjs --pg-bin tmp/r3-a01-pg/pgsql/bin` | **200 passed**, fresh local PostgreSQL 17.11 cluster. |
| `node supabase/tests/word-version/run.mjs --pg-bin tmp/r3-a01-pg/pgsql/bin` | **30 groups passed**, fresh local PostgreSQL 17.11 cluster. |
| `pnpm exec vitest run --config experiments/r4-func-01/vitest.config.mjs` | Final four-probe version **4/4 in three fresh processes**, 7.59 / 2.80 / 1.79 s. |
| `git diff --check` | Final staged audit scope checked; see PR validation. |

Main push workflow [40096514618](https://github.com/AvtandilKakulia/vocabulary-learning-app/actions/runs/40096514618) passed both **quality** and **PostgreSQL integration**, including exact 200/30 contracts. Audit-head checks are reported separately in the PR/final delivery.

### Failed attempts retained

| Run | Actual result | Evidence/limits |
| --- | --- | --- |
| First default full suite | 802 passed / 4 failed of 806; 109.10 s | Five-second timeouts in FreeMode.reguess, WordManagement.save and two History.pagination cases. PG work overlapped part of run. |
| Second default full suite | 797 passed / 9 failed of 806; 119.91 s | Timeouts in DeleteAccountModal, FreeMode.reguess, two WordManagement.preferences and five History.pagination cases. Other audit work overlapped portions. |
| Focused unchanged six-file repeat | 59/59, 24.01 s | FreeMode.tabs/reguess, WordManagement.save/preferences/test and words/wordConcurrency. |
| Focused unchanged History + delete dialog | 137/137, 44.96 s | History.pagination and DeleteAccountModal. |
| Final full suite after stopping browser/PG work | 806/806, 87.54 s | No timeout, worker or assertion changes. |

First-run failure names: `keeps corrected words resolved across toggles and saves the original mistakes and scores`; `waits for an insert to succeed before closing and refreshing, and cannot switch entries mid-save`; `sorts 2001 records 'date' 'desc' with stable ties and zero additional reads`; `ignores obsolete deletion-version page failure and stops its pagination`. Second-run History failures included date ASC/DESC, score ASC and obsolete-deletion-version success/failure. These establish intermittence, **not a proven cause**. Host contention is plausible, not demonstrated. No new semantic regression of those features was established; stability remains a verification concern.

An initial audit-config mistake used `mergeConfig`, concatenating baseline/probe includes: 809 tests ran (806 + three early probes), 798 passed / 11 failed in 143.46 s, mostly timeouts plus missing-ready-UI assertions. This setup-confounded run is not a baseline. Final config explicitly replaces `include`; final probes number four. Early browser setup first missed a relative Supabase import, then instantiated duplicate mocks through Windows path variants. Both were corrected inside new fixture files before collecting evidence; no hosted request occurred.

Ignored logs: `tmp/r4-func-01/frontend-{1,2,3}.log`, `focused.log`, `focused-history.log`, `probes-*.log`, `postgres-auth.log`, `postgres-version.log`, `build.log`. Reproducible sources/commands are committed, not machine-specific logs. Expected theme-error diagnostics remain visible; no global rejection suppression was introduced.

## 4. Historical defect reconciliation

**FIXED_VERIFIED** below means current source plus relevant executed regressions support the fix in their fixture boundary, not that every old manual reproduction was repeated against a hosted service. **OPEN_REPRODUCED** requires a concrete current counterexample. **POTENTIAL_UNVERIFIED** is a gap, not a proved defect. Other statuses are **BLOCKED**, **DEFERRED_NONBUG**, **NOT_APPLICABLE**.

| Original symptom/cause | PR/commit | Current path and regression | Current status, reproduction and limit |
| --- | --- | --- | --- |
| Search incomplete Word erased grammar; sort followed pagination | Foundation `c2dd416`, later SQL reconciliation | useWords passes p_sort; current SQL complete public.words and ordering before range; useWords/WordModal/PG Search | FIXED_VERIFIED: represented reproductions pass; hosted RPC not inspected. |
| Independent meanings blocked; production missing normalized column | `1a5c30d`, migration 20261006183000 | Column/trigger/backfill and nonunique lookup; normalization/WordModal/PG | FIXED_VERIFIED; >API-cap duplicate-warning matches not stress-tested. |
| Early Test/Practice save, answer and History owner bugs | `7894e67`, `c93d524`, `2674a9b`, `f947f4d`; #8–#11 | Current mode/History tests, JSONB Search, missing-config guard | FIXED_VERIFIED in current regression contracts; old builds not rerun. |
| Test lost pending/zero-answer results, blocked-storage discard | #12 `d6b5db7` | TestMode, activeTestSessions/pendingTests; TestMode.test/active | FIXED_VERIFIED single-editor recovery. Concurrent same-session editor is new FUNC-003. |
| Hidden/stale History IDs broadened deletion | #13 `21718d4` | History eligible confirmed IDs/context guards; History/bulkDelete | FIXED_VERIFIED, later #33 retains exact scope. |
| Stale reads replace current view/account; failed reads look empty | #14 `2d5fc52`, #15 `77bd4cc` | useLatestRequest and Retry paths; App/profile/Words/mode/History tests | FIXED_VERIFIED for reads; profile writes lack equivalent guard (FUNC-001). |
| Practice storage crossed accounts; remount overlapped History saves | #16 `fe2d3a7` | practiceSessions/practiceSaves, UID roots and stable result identity | FIXED_VERIFIED tested recovery/runtime; SDK concerns separate. |
| Old browser data and Hook/Fast Refresh warnings | #17 `2c70dcb`, #18 `e3588d6` | Lockfile compatibility data, separated contexts/providers, lifecycle effects | FIXED_VERIFIED lint/build; theme exceptions not previously tested. |
| Blank/whitespace word validation | #19 `806c71c` | WordModal and normalization tests | FIXED_VERIFIED; no new acceptance of empty words found. |
| Word Save/Cancel race and zero-row false success | #21 `3fc6a81`, #22 `75008d8` | Modal phase ref, awaited/verified mutations; save/mutations tests | FIXED_VERIFIED; unknown transport cannot recall an already committed write. |
| Concurrent word edits lost updates, timestamp could fail to advance | #23 `a2b30ae` | Exact updated_at predicate, conflict UI, dedicated DB trigger; wordConcurrency + 30 PG groups | FIXED_VERIFIED locally including concurrent connections/microseconds; deployment unverified. |
| Historical mistakes resurrect corrected Practice words | #24 `de34e3d` | Unresolved-ID state, validated snapshots; FreeMode.reguess | FIXED_VERIFIED semantically; timeout recurrence retained in section 3. |
| Duplicate Check/Enter scores, order resets, reversed counter | #25 `38eb55b`, #26 `1f8b332` | Presentation guard, queue reconciliation, correct/attempts; scoring/order | FIXED_VERIFIED; deliberate separate attempts preserved. |
| Practice tabs overwrite progress; Cancel/acquire lock race | #27 `2c39dba` | Web Locks/request generations/checkpoint handoff; practiceOwnership/tabs | FIXED_VERIFIED regressions; native browser lifecycle limits remain. |
| Reset opens at 0/0 | #28 `29a7178` | Native disabled/manual guard while internal cleanup allowed; scoring/reset | FIXED_VERIFIED; native local 0/0 also disabled. |
| API caps truncate Practice/Test/History | #29 `1a93069`, #30 `97f9659`, #31 `9d5d721` | Exact count, range, stable ties, actual page-length offsets, overlap rejection; pagination suites | FIXED_VERIFIED through 2,001 and lower caps; not atomic snapshot isolation. |
| Saved Practice checkpoint resurrected by old persistence effect | #32 `211fe27` | Presentation identity fences effects; FreeMode.cleanup/tabs | FIXED_VERIFIED; no new cleanup counterexample. |
| Large DELETE URLs, unsafe partial success | #33 `56cc41f` | historyDeletion 100-ID sequential confirmed batches, refresh/explicit retry; bulkDelete | FIXED_VERIFIED 1–2,001 selections; no automatic destructive retry. |
| Unbounded History DOM, sorting refetches | #34 `7595162` audit, #35 `4431bf3`, #36 `f5b4e06` | Local sort, display pages 10/25/50/100, memoized rows; History tests/native historical benchmark | FIXED_VERIFIED; full-data retrieval/memory still scale with collection. |
| Words sort/page preferences reset | #37 `2f8eedc` | Validated preferences; useWords/WordManagement.preferences | FIXED_VERIFIED; browser-wide preferences intentionally non-sensitive. |
| Premature Practice checkpoint assertions | #38 unmerged; #39 `4b939be` | Complete checkpoint waits in reguess/FreeMode tests | FIXED_VERIFIED exact assertions preserved; #38 not incorporated. |
| B input reset before passive initialization | #40 `cf5dd99` | Layout-effect initialization, FreeMode.draft early/settled/StrictMode/outcomes | FIXED_VERIFIED; new Test checkpoint race is a different defect. |
| History test DOM traversal/icon cost | #41 `cba1498`, #56 `6386ad1` | Scalar assertions/file-local icons, unchanged functional checks | FIXED_VERIFIED mitigation remains; POTENTIAL_UNVERIFIED residual instability given fresh timeouts. |
| Missing authorization evidence/CI | #42 `4143bf8`, #43 `8c5aa1a` | Non-bypass roles, negative controls, exact 200/30 CI contracts | FIXED_VERIFIED locally and main CI; hosted config not certified. |
| Mutable function search paths | #44 `ca165ed` | Forward ALTER FUNCTION, fail-closed metadata/trigger checks | FIXED_VERIFIED in disposable chain; hosted metadata not read. |
| GraphQL exposure/dependency concern | #45 `aad0d71` | Owner reports disabled; SEC-05 historical audit | DEFERRED_NONBUG for retired surface; hosted status owner-reported/unverified, not reopened. |
| Deletion F1–F4 | #46 `a93a648` audit; #47 `786d24a`, #48 `0d86edb`, #49 `e33ff50` | Captured UID/Authorization, single-flight, per-account completion, scoped recovery erasure; deletion/erasure tests | FIXED_VERIFIED. #49 adds durable retirement when storage works; #48 memory-only snapshot is superseded in part. SDK bytes deliberately untouched. |
| Shared Auth client retirement races | #50 `3aa3fcf` | SEC-10 SDK-only reproductions; shared client still installed | BLOCKED: F1–F4 do not prove generation isolation/remote revocation. |
| Isolated generations and migration plan | #51 `63a6f23`, #52 `b6bf6f4` | SEC-11 PoC/SEC-12 plan only | BLOCKED production migration; NOT_APPLICABLE as deployed fix. |
| SDK storage/init/refresh failure gates | #53 `9cac790`, #54 `dd411f1`, #55 `83ad130` | AUTH-01/01B/01C candidates failed; patches experimental | BLOCKED; installed app remains 2.83.0, no patch/upstream submission. |
| History toolbar narrow layout/target size | #57 `8590f4a` | Responsive native controls, focus/44px tests, UX-01 | FIXED_VERIFIED tests; historical 36-combination native matrix not rerun. |

Reviewed reports: [History audit](history-performance-audit.md), [pagination](history-pagination-performance.md), [sort](history-sort-performance.md), [Practice tabs](practice-tab-coordination.md); [SEC-01](r4-sec-01-authorization-report.md), [SEC-05](r4-sec-05-graphql-security-review.md), [SEC-06](r4-sec-06-account-deletion-security-review.md), [SEC-08](r4-sec-08-account-deletion-lifecycle.md), [SEC-09](r4-sec-09-local-recovery-erasure.md), [SEC-10](r4-sec-10-auth-session-retirement-review.md), [SEC-11](r4-sec-11-auth-generation-poc.md), [SEC-12](r4-sec-12-production-auth-migration-plan.md), [AUTH-01](r4-auth-01-sdk-storage-compatibility.md), [AUTH-01B](r4-auth-01b-sdk-storage-resolution.md), [AUTH-01C](r4-auth-01c-upstream-review.md), [STAB-01](r4-stab-01-history-test-stability.md), [UX-01](r4-ux-01-history-selection-toolbar.md). PR numbers identify GitHub history, not private conversations.

## 5. Functional inventory and actual state flows

| Area | Active operations/transitions | Authority and interruption behavior |
| --- | --- | --- |
| Auth | Sign-up/sign-in → SDK → notification → workspace; initial/remembered session; sign-out; refresh/expiry | Shared client. Initial getSession cannot overwrite a newer auth event; subscription/mount cleanup exists. Real expiry/revocation/email flows unverified. |
| Profile | UID/email load → edit → name upsert → optional email update → App name refresh → delayed close | Read guard only. Write continuation/timer not lifecycle scoped (FUNC-001); two writes are not atomic. |
| Delete account | Captured UID + exact DELETE → pinned auth → single RPC → confirmed success/failure/unknown | Success retires initiating UID even obsolete; B preserved; scoped recovery cleanup. Unknown is not a known failure for automatic retry; no shared SDK signOut. |
| Words read | Debounced English/Georgian Search, sort/page/size → owner query or Search/count → current result | Server pagination, complete Word, SQL Search sort; distinct empty/loading/error Retry; persisted preferences. Plain-list tie guarantee unverified. |
| Words write | Add/edit definitions, POS, irregular forms, descriptions → validate/duplicate warning → awaited mutation | Separate meaning IDs; exact original version on edit; affected row validation; saving phase blocks stale Cancel. Bulk selection bounded to eligible loaded records. |
| Practice | Full vocabulary → restored/new queue → direction/order/retry preference → Check → Next/Finish/Reset | Complete load before queue reconciliation; presentation guards scoring; unresolved IDs drive retries while historical mistakes remain. Per-UID validated snapshots/legacy migration. |
| Practice save/interruption | Exclusive editor → checkpoint/handoff; stable result snapshot → save lock/runtime registry → cleanup or Retry | Web Locks/BC and request generations, no unsafe stealing. Stale effects fenced; unchecked draft intentionally not durable. |
| Test start/answer | Direction/Text/MC/length → protected Start → full pool/random selection/frozen options → draft/Next | Exact-count loading; no partial start; restored questions/options need no refetch. Same-session editors lack coordination (FUNC-003). |
| Test finish | Completed checkpoint/pending stable ID → History insert or conflict verification → saved cleanup/retry/confirmed discard | Owner/session guards; persisted-copy-aware discard; one result identity does not protect active answer checkpoints. |
| History read | Full collection → direction/score filter → complete filtered stats → local date/score sort → display page | 500-record requests, lower caps, no partial publication. Pages bound DOM, not stats/selection. Details use saved prompts/definitions/mistakes and display sanitization. |
| History delete | Select/filter → exact confirmation → owner-bound sequential batches → verified totals or stop → authoritative refresh | Single-flight/context/version guards; explicit new confirmation for remaining authorized IDs; failed refresh cannot resolve uncertain request outcome. |
| General | Local navigation, conditional dialogs, theme, keyboard/forms, native disabled actions, errors | Top-level boundary catches render/effect errors, not arbitrary async handlers. Theme storage unguarded; Browser Back not a screen router. Cleanup belongs to each feature. |

## 6. Per-feature verification matrix

Quality: **R** real React/DOM with controlled service promises; **L** helper/storage logic; **P** disposable real PostgreSQL; **B** real Chromium with synthetic service. Mocks do not prove actual network/Auth server behavior. Test paths are under `src/`.

| Scenario / source | Existing test / quality | Current result | Missing case, risk and recommendation |
| --- | --- | --- | --- |
| Auth initialization/notification/account/unmount — AuthProvider/authState | contexts/AuthContext, App (R) | Pass; native synthetic sign-out/in (B) | Real confirmation, expired token, refresh and transport races unverified; BLOCKED Auth gates. |
| Profile read/save/empty/error — UserProfile | UserProfile.test (R), eight cases | Existing pass; new delayed-write counterexample | Add A→B→A/upsert/email/timer/partial-error/duplicate save tests (FUNC-001). |
| Delete confirmed/failed/unknown/duplicate/interrupted/current B — App/accountDeletion | DeleteAccountModal/Lifecycle (R), PG (P) | Pass, exact owner completion | Remote JWT revocation and credential erasure intentionally unproved. |
| Recovery erasure/storage blocked/late writer/reload — recoveryStorage/eraseAccountRecovery | AccountRecoveryErasure, eraseAccountRecovery (R/L) | Pass, B exact bytes preserved | Suspended old version and failed durable marker limitations remain. |
| Words search/page/count/sort/empty/retry/stale — useWords/WordManagement | useWords, WordManagement/preferences (R/L), PG Search (P) | Pass; Georgian native Search (B) | Equal primary-sort ties and >cap duplicate-warning pool need focused verification. |
| Add/meanings/grammar/edit/Cancel/version — WordModal/useWords | WordModal/save/mutations/wordConcurrency (R), normalization (L), PG (P) | Pass; native add/edit/delete | Open draft/account-switch write continuation not independently covered; no bug claimed. |
| Word delete/bulk/zero-row/malformed/duplicate callback | mutations/useWords (R) | Pass, count/owner guards | Unknown transport remains uncertain; unbounded bulk N/A because UI page selection bounded. |
| Practice directions/alternatives/irregular/scoring/reset/order | FreeMode/scoring/order (R) | Pass; native 0/0→1/1/navigation (B) | Mobile/IME/physical keyboard matrix incomplete. |
| Practice retry/historical mistakes/legacy restore | reguess/practiceSessions (R/L) | Final pass and focused repeat | Timeout is unresolved stability evidence, not proof of retry semantic regression. |
| Practice early/settled input and A save while B active | FreeMode.draft and FreeMode.test (R) | Pass under StrictMode and both outcomes | No new B-input-loss counterexample; preserve #40. |
| Practice full dictionary/short cap/invalid page/account/owner/unmount | FreeMode.pagination (R realistic range/account mock) | Pass through 2,001, no partial publication | REST multi-page reads are not atomic snapshot. |
| Practice save/retry/identity/reset/cleanup/interrupt | FreeMode.cleanup/tabs/scoring, practiceSaves (R/L) | Pass; save cleanup retained | Real offline outage not exercised; mocks cover failed requests. |
| Practice lock/acquire/cancel/checkpoint/third tab | practiceOwnership/tabs (L/R), historical native harness | Pass | Exhaustive fresh native lifecycle matrix not run; no pseudo-lock fallback. |
| Test directions/length/MC/full pool/empty/large | TestMode/testQuestions, TestMode.pagination (R) | Pass through 2,001/lower cap; native short completion (B) | Very large start latency not freshly benchmarked. |
| Test recovery/draft/frozen options/no refetch/corruption/storage | TestMode.active (R/L) | Single-editor tests pass | Same restored session in two editors loses progress (FUNC-003, R/B). |
| Test final result/failure/retry/duplicate/checkpoint failure | TestMode.test/active (R), PG History (P) | Pass; native synthetic result totals correct | Divergent same-ID completion across tabs is untested related risk. |
| History full/count/details/intermediate failure/retry/malformed | History.pagination/History (R), PG (P) | Pass through 2,001, no partial stats | Full collection memory/network cost remains. |
| History local sort/filter/stats/pages/full selection | History/pagination/bulkDelete (R), prior native benchmark | Pass; native one-record selection | Not a new 5,000-row measurement; off-page filtered IDs intentionally selected. |
| History individual/bulk/partial/unknown/failed refresh/explicit retry | historyDeletion/History.bulkDelete (R), PG (P) | Pass, 100-ID sequential confirmed-only | Server commit cannot be recalled after navigation; no real deletions performed. |
| Theme saved/system/fault — ThemeProvider | ThemeContext (R) | Normal pass; fault loses usable UI | FUNC-002 get/set exceptions and malformed preference need acceptance tests. |
| Shell/boundary/navigation/keyboard/reload/resource cleanup | main/App/AuthPage/features; App/context/component tests (R/B) | Core synthetic flows exercised | Sign-up rejection/logout failure, Back expectations, accessibility/mobile/non-Chromium incomplete. |

Coverage spans positive/negative, network/storage fault, interruption, duplicate/concurrent operations, account change, reload/remount, stale response, empty/large data and partial success where relevant. **NOT_APPLICABLE** examples: pagination for sign-in; network failure for pure normalization; large datasets/partial server success for theme toggle; destructive server retry for local sorting. Missing tests are not automatically defects.

## 7. Confirmed unresolved defects

These P1 findings were recorded in this report at discovery. No application remediation was made. All probes remain opt-in.

### FUNC-001 — stale profile continuation crosses account context (P1)

- **Classification:** OPEN_REPRODUCED application call/lifecycle defect. Real component/native App; mocked service transport. Not a proved hosted account takeover or server email change.
- **Location:** `src/components/UserProfile.tsx:62` handleSave, upsert at 74, shared auth.updateUser at 83, success/callback/timer at 88–98. `useLatestRequest` at 25 protects reads only.
- **Reproduction:** Open A profile, edit email, submit and hold profile upsert. Switch to B and wait for B's form. Release A response. A's email update is invoked while B is current and A success text appears in B form. Explicit barrier, no arbitrary delay.
- **Native trace:** `[{"action":"profile-pending","uid":"audit-a"},{"action":"updateUser","uid":"audit-b","payload":{"email":"a-new@example.com"}}]`.
- **Expected:** Obsolete A continuation must not initiate a B-current mutation, publish A completion or close a new dialog. Intent/lifecycle must remain valid for each subsequent operation.
- **Actual/root cause:** Captured A user/email survives first await; second call uses shared current Auth client without generation/mount check. The first profile write remains A-scoped. The issue is the subsequent email call and stale UI completion. Delayed close is likewise unguarded; its independent new-dialog variant is inferred from source, not separately reproduced.
- **Reproducibility:** Deferred probe in three final runs plus native production-mode App. Real server email-confirmation rules and switching during the SDK call remain unverified.
- **Impact/security:** Wrong-account email-update intent and misleading success; possible form closure/loss. P1 concrete account-lifecycle violation, not a claim of RLS bypass or immediate email takeover.
- **Existing coverage:** UserProfile has read staleness/unmount tests and `preserves profile save and email-update contracts after loading`; no delayed write A→B test.
- **Smallest safe future fix:** Scope save intent, later mutations, UI notification and timer to immutable dialog/auth generation; invalidate on account transition/unmount; synchronous duplicate-submit guard and timer cleanup. UID comparison alone misses A→B→A. Do not add automatic shared SDK logout.
- **Regression:** A→B and A→B→A, held upsert success/error, unmount/new dialog, delayed email success/error, exact payload/no B call, partial name success/email failure, duplicate submit, obsolete close timer; preserve read guards.
- **Dependencies/complexity/model:** Bounded application guard actionable now; in-SDK generation isolation remains blocked. Medium; **GPT-6 Astra / Extra High**.

### FUNC-002 — theme preference exceptions disable usable UI (P1)

- **Classification:** OPEN_REPRODUCED application storage handling. Injection proves missing error handling, not real-world browser-policy prevalence.
- **Location:** `src/contexts/ThemeProvider.tsx:5–9` initializer and `:19–29` effect, direct getItem/setItem. Outer `src/main.tsx` ErrorBoundary catches the exception.
- **Reproduction:** Throw SecurityError independently from theme getItem and setItem; render real ThemeProvider/ErrorBoundary. Native `?block-theme=setItem` throws only for `vocab-app-theme`, leaving other storage usable.
- **Expected:** Optional display preference falls back to a usable in-memory/system theme when persistence fails.
- **Actual/root cause:** Uncaught preference exception replaces workspace with “Something went wrong”/refresh. Refresh repeats while failure persists. The boundary works; this is not an uncaught blank screen.
- **Reproducibility:** Two probes in each of three final runs; setItem native. Native getItem/physical quota exhaustion not executed.
- **Impact/security:** Conditional application-wide usability loss. No cross-account leak or recovery deletion demonstrated. P1 availability defect, not an assertion that all users are affected.
- **Existing coverage:** ThemeContext's three tests cover saved/system preference and missing provider, not exceptions/invalid stored values.
- **Smallest safe future fix:** Guard reads/writes, validate supported theme values and retain in-memory fallback. Do not change Auth/recovery storage policy.
- **Regression:** Startup/toggle get/set failures, invalid value/system fallback, DOM theme updates, normal persistence and no application fallback. No global error suppression.
- **Dependencies/complexity/model:** Independent of SDK migration; low; **GPT-6.1 Sol / High**.

### FUNC-003 — concurrent restored Test editors roll back answers (P1)

- **Classification:** OPEN_REPRODUCED application checkpoint data loss; native two-page localStorage reproduction.
- **Location:** `src/components/TestMode.tsx:101–103` recovery snapshot, `:132–150` saveActiveProgress/changeAnswer, `src/lib/activeTestSessions.ts:68–72` persistActiveTest. Retirement guards are not editor ownership checks.
- **Reproduction:** Start two-question Test in A; second same-origin page restores same session. First submits question 1 correctly/Next (`currentQuestion=1`). Second, still at question 1, types a draft. Reload first and enter Test.
- **Expected:** Stale editor becomes passive/synchronizes or requests explicit safe ownership before writing; cannot overwrite submitted work.
- **Actual:** Checkpoint returns to question 0; submitted answer/isCorrect become empty/false. Reload presents first question and stale draft. Probe verifies same session ID and overwritten fields without vocabulary/History calls.
- **Root cause:** Both editors snapshot once and replace the same account/session key with their whole local active object. No Test editor lock/revision/storage-event reconciliation. Stable History UUID guards result identity, not active progress. Practice coordinator does not cover Test.
- **Reproducibility:** Deterministic two-root probe in three final runs and two independent Chromium pages; first-page reload visibly restored rolled-back state.
- **Impact/security:** Same-account submitted answer loss/repeated questions. No B storage mutation demonstrated. Divergent simultaneous completion with one result ID is related untested risk, not a separately confirmed History bug.
- **Existing coverage:** TestMode.active verifies reload/navigation, frozen options, independent sessions, corruption and storage failure, but not concurrent editors of the same ID.
- **Smallest safe future fix:** Focused Test ownership/revision design with explicit safe handoff. Preserve separate intentional IDs, exact result identity, retirement guards, frozen options and zero-answer recovery. No localStorage pseudo-locks/unsafe stealing or blind copying of Practice state semantics.
- **Regression:** Two editors at draft/submitted states, stale typing/Next/Finish, reload, cancelled handoff, account change, separate IDs, pending History/conflicting payload and retired-account late writers; native two-page test.
- **Dependencies/complexity/model:** Same-origin protection independently actionable; not a cross-device/offline merge guarantee. Medium/high; **GPT-6 Astra / Extra High**.

## 8. Unverified risks and missing coverage

The following are **POTENTIAL_UNVERIFIED**, not additional confirmed defects:

1. Plain Words listing uses primary sort without Search/batched loaders' stable-ID tie contract. Verify ties across pages in a real DB fixture before proposing a fix.
2. Duplicate-warning lookup is unpaginated. More matching meanings than the API cap could truncate advisory warning coverage; no such scale reproduction was run.
3. Open Word modal draft/save across account switching needs deferred-write verification accounting for existing owner/mutation guards. No wrong-account Word mutation was proved here.
4. Exact-count ranged reads are not snapshot isolation: concurrent inserts/deletes can move offsets; overlap/short/count checks do not detect every same-count replacement.
5. Profile partial success, repeat submit and old close timer need explicit acceptance behavior along with FUNC-001.
6. Real sign-up confirmation, token expiry/refresh/logout failure, IME/mobile and Browser Back are insufficiently verified. State-based screen navigation is current design; adding routing requires a product decision.
7. Timeout sensitivity remains after #41/#56. This audit does not prove contention is the sole cause and does not reclassify all failed tests as harmless.
8. Suspended old tabs, process termination, disk failure and non-Chromium lock support are not fully represented by jsdom mocks. Preserve safe unsupported-browser behavior.

**DEFERRED_NONBUG:** Unchecked Practice drafts are intentionally not durable and takeover documentation says so. Same English spelling with different IDs means separate records. History Select All intentionally includes filtered off-page rows. Sort/theme preferences are browser-wide non-sensitive settings. Bundle size by itself is not a functional failure.

## 9. Existing SDK/Auth blockers

**R4-AUTH-02 and production Auth-generation migration remain BLOCKED.** Reports #50–#55 do not install a production fix:

| Concern | Evidence/status | Required gate |
| --- | --- | --- |
| Shared slot, pending/queued refresh/logout can outlive A | Historical SDK-only reproductions; current shared client remains | Supported generation isolation and reviewed lifecycle guarantees; no automatic shared signOut workaround. |
| Storage failures / initial-session error ownership | AUTH-01/01B candidate failures; 01C experimental proposals | Released or explicitly approved compatible SDK, observable initial failure ownership. |
| Concurrent refresh waiters | Experimental patch qualification only | All waiters settle under storage/network/error paths using supported behavior. |
| Complete local credential retirement | F4 erases recovery, not SDK credentials | Account-bound credential lifecycle, durable failure semantics, owner approval. |
| Legacy migration / cross-tab / reload / rollback | SEC-11 PoC and SEC-12 plan, not production | Old-tab compatibility, durable markers, safe rollback and explicit migration gates. |
| Remote revocation / JWT lifetime | Not proved by frontend cleanup or local SQL | Authorized isolated real-service evidence and owner/security decision. |

FUNC-001 increases urgency of application continuation guards but does not validate a production generation migration. FUNC-002 is our theme provider, independent of SDK storage; FUNC-003 is Test checkpoint ownership, independent of SDK upgrade. Historical SDK experiments were reviewed, not rerun/submitted upstream here.

Current #49 retirement marker strengthens the earlier #48 memory-only behavior when storage works. Still no guarantee of durable marker under blocked storage, physical erasure of all bytes, SDK-session removal or immediate remote JWT invalidation. Keep these distinctions explicit.

## 10. Functional performance observations

Current History retains #35 local sort and #36 bounded row rendering. Full data loads on relevant invalidation; sort changes do not query Supabase. Tests cover 2,001-record filtering/statistics/selection while displaying bounded pages. Deletion uses 100-ID sequential requests rather than old oversized URLs.

Historical [pagination benchmark](history-pagination-performance.md), **not remeasured here**: at 5,000 rows, post-network median 1,375.3→94.0 ms, DOM 167,598→987 nodes, heap 51.8→18.1 MiB. The old unbounded-DOM concern is superseded, not a current newly discovered bug.

Remaining costs: full payload/JSON allocation, retaining all rows, O(n) filtering/O(n log n) sort, full-filter selection, sequential large deletes. No new native large-data freeze was reproduced; fresh browser fixture is small. jsdom timeouts do not establish equivalent browser latency. Further server pagination/virtualization/payload changes require separate measurement and contract review.

Build's 526.48 kB chunk warning is a technical optimization opportunity, not a functional defect. No suppression/refactor was made.

## 11. Database/authorization evidence

Actually ran both existing runners with **fresh disposable loopback PostgreSQL 17.11 clusters**. No hosted URL/credentials, Supabase project connector, SQL editor, db push/reset or migration-ledger change.

- **200 authorization checks:** current migration chain, non-bypass application roles, owner reads/writes, cross-account denial, grants/RLS, profile ownership, complete Search/count fields/scoping, normalized independent meanings, History ownership, deletion authorization, function configuration/bindings and deliberately weakened negative controls. Existing search-path-hardening assertions preserved.
- **30 word-version groups:** normal/rapid/same-transaction updates, future versions, exact stale equality rejection, actual concurrent connections, six-digit precision, normalizer/profile preservation, invalid schema, lock timeout and guarded rollback/recovery.
- SEC-06's historical eight supplemental probes were reviewed as prior evidence, not rerun in this task. Fresh database result is 200/30.
- API caps/count validation/cancellation use realistic frontend mocks; raw PostgreSQL is not PostgREST. JWT signature/session issuance and hosted Auth configuration are not covered by these runners.
- GraphQL is owner-reported disabled; no hosted extension check or re-enablement.
- Prior global History UUID collision/existence signaling and remote JWT lifetime considerations remain owner/security concerns, not new data leaks proved by this audit.

## 12. Browser verification and limitations

Real production-mode React App in Chromium in-app browser, native localStorage and independent pages. Fixture imports real App/components/providers/styles with StrictMode, substitutes only the Supabase service boundary, rejects SDK bundle modules, uses isolated env directory, binds `127.0.0.1:4188` GET-only assets and CSP `connect-src 'none'`. No project credentials or real data.

| Executed | Observed |
| --- | --- |
| Synthetic sign-out/in | AuthPage then Word Studio; UI notifications verified, not real credentials. |
| Words + Georgian Search `კატა`, description-only edit | Three seed words; correct Cat match; noun/definition retained. |
| Add `audit` / `შემოწმება`, confirmed delete | In-memory count four then three; no real records. |
| Practice Check/navigation | Reset disabled at 0/0; correct bird answer 1/1; Words→Practice retains scored progress. |
| Custom two-question Test completion | 100%, 2/2, one matching in-memory History record. |
| History selection | Select All → one selected → Deselect All; no browser History deletion. |
| Pending profile A then B | FUNC-001 exact trace and stale success in B form. |
| Two Test pages + stale draft + first reload | FUNC-003 answer lost, first question/draft restored. |
| Theme-only setItem fault | FUNC-002 top-level fallback; fixture controls outside App remain. |

Screenshots kept locally in ignored `tmp/r4-func-01/profile-race.png`, `test-rollback.png`, `theme-fallback.png`. Service tables reset on reload; Test snapshots intentionally survive in native storage shared across pages. Fixture is **not** a full Auth/PostgREST emulator: no proof of real JWT, SQL policies, email delivery, server conflicts, latency or error codes. Separate PG/component tests establish narrower contracts.

Not executed: fresh full mobile matrix, Safari/Firefox, native offline outage, forced process crash, revoked JWT/email confirmation, large native benchmark or exhaustive Practice lock-race harness. PR57 responsive/native evidence remains historical. Web Locks availability alone is not proof of every handoff/cancel case.

## 13. New reproducible test evidence

See [experiment README](../experiments/r4-func-01/README.md).

- `functional.probe.tsx`: four current-behavior assertions importing untouched components and existing network-blocking test setup; stale profile continuation, two theme faults, competing Test checkpoints.
- `vitest.config.mjs`: opt-in `*.probe.tsx` only; default 806 tests unchanged.
- `browser-entry.jsx`, `browser-fixture.mjs`, `serve.mjs`: production-mode real-app synthetic harness; explicit response-release barrier, A/B auth notifications, theme fault toggle; no SDK/credentials/deployment.
- No arbitrary sleeps. Deferred profile barrier; synchronous real Test input/Next checkpoint assertions; real ErrorBoundary handles injected faults and expected diagnostics are asserted. No global unhandled-rejection suppression.

**Passing probes mean the defects exist.** Future fix PRs must add desired-invariant regressions and demonstrate pre-fix failure. Do not promote these broken-current-behavior expectations into application acceptance CI.

## 14. Prioritized remaining backlog

Five independent next tasks are justified; recommendations only, no issues or implementation started.

| Order/task | Priority/category | Objective/why | Dependencies/safe scope | Acceptance/coverage |
| --- | --- | --- | --- | --- |
| 1: R4-FUNC-02 Profile save lifecycle isolation | P1 confirmed fix now | Prevent obsolete A continuation from B-current mutation/stale close | UserProfile and narrowly necessary generation observation; no SDK/logout/migration; inside-SDK isolation separately blocked | Deferred A→B/A→B→A, unmount/new dialog, success/failure, exact payload/no B call, single-flight, partial failure/timer; native barrier safe cancellation. |
| 2: R4-FUNC-03 Test active-session ownership | P1 confirmed fix now | Prevent submitted-answer rollback | Test coordination/recovery/tests only; design review; preserve Practice and result identity | Two-page + deterministic stale typing/Next/Finish, reload/cancel/account/retirement, independent IDs, pending results; no silent overwrite/unsafe stealing. |
| 3: R4-FUNC-04 Theme storage resilience | P1 confirmed fix now | Keep app usable without preference storage | Theme provider/context tests; independent of Auth storage | get/set/toggle failures, invalid/default values, normal persistence, native app remains usable. |
| 4: R4-QA-NEXT Default-suite stability qualification | P2 verification | Distinguish fixture cost/scheduling/lifecycle causes | Unchanged runner baseline first; targeted instrumentation, no weakened timeouts/tests | Fresh default-worker series, retain failures, controlled host load, exact lifecycle traces; correction only after proof. |
| 5: R4-FUNC-VERIFY Words account/pagination boundaries | P2 missing verification | Close open-draft/account/tie/duplicate-scale gaps | Isolated React/PG first, no production or broad redesign | A/B deferred mutations, modal lifetime, ties across pages, full duplicate pool; classify before fixing. |

Other lanes: **C/BLOCKED** R4-AUTH-02/generation migration await SDK and owner gates; **D/DEFERRED_NONBUG** bundle splitting/visual refinement await functional work/measurement; **E/OWNER DECISION** isolated real-service environment, supported browsers, remote revocation/physical erasure semantics, Browser Back and cross-device expectations. Blocked production work is not scheduled as ready implementation.

## 15. Recommended Codex model/effort per task

| Task | Model / effort | Reason |
| --- | --- | --- |
| R4-FUNC-02 | GPT-6 Astra / Extra High | Cross-account identity/async mutations/Auth boundary. |
| R4-FUNC-03 | GPT-6 Astra / Extra High | Ownership, durable progress, History identity and interruption races. |
| R4-FUNC-04 | GPT-6.1 Sol / High | Bounded preference fallback/regression. |
| R4-QA-NEXT | GPT-6 Astra / Extra High | Evidence-based timing/concurrency diagnosis without weakening invariants. |
| R4-FUNC-VERIFY | GPT-6 Astra / Extra High | Account-sensitive writes/database pagination. |
| Blocked Auth migration, only after gates | GPT-6 Astra / Extra High | Security architecture/external SDK dependencies; not ready now. |

## 16. Functional readiness by module

| Module | Status | Reason |
| --- | --- | --- |
| Vocabulary | VERIFIED_WITH_LIMITATIONS | CRUD/Search/version tests + PG + small native flow; ties/duplicate scale/open-draft account gaps remain. |
| Practice | VERIFIED_WITH_LIMITATIONS | Scoring/retry/order/input/ownership/cleanup pass; no new counterexample, timeout/native limits retained. |
| Test | CONFIRMED_ISSUES | Single-editor saves/recovery pass; same-session concurrent rollback. |
| History | VERIFIED_WITH_LIMITATIONS | Complete read/stats/pages/confirmed batches pass; timeouts/unmeasured extreme load remain. |
| Profile/account | CONFIRMED_ISSUES | Deletion guards pass; profile continuation violates account lifecycle. |
| Data integrity | CONFIRMED_ISSUES | Word/History contracts verified locally; Test answer loss reproduced. |
| Browser lifecycle/recovery | CONFIRMED_ISSUES | Theme failure and concurrent Test checkpoint loss. |
| Auth/session safety | BLOCKED | Shared SDK and unresolved generation/storage/retirement gates. |
| DB authorization | VERIFIED_WITH_LIMITATIONS | 200+30 real local PG checks, not hosted policy/Auth inspection. |
| Cross-tab | CONFIRMED_ISSUES | Practice protections remain; Test same-session fencing absent. |
| Real-service end-to-end | INSUFFICIENT_EVIDENCE | No authorized isolated real Auth service; mocks/raw PG cannot replace it. |

These statuses do not authorize deployment. Aesthetic refinement cannot close data/lifecycle defects.

## 17. Functions not fully verified

- Real sign-up/confirmation, email change confirmation, session expiry/rotation, remote/global logout, revoked JWT.
- Full supported-browser background suspension, process kill, old deployed tabs, private-mode/storage partition/quota behavior.
- Complete credential erasure, durable retirement under blocked storage, legacy Auth migration/rollback.
- Profile email mutation inside real SDK/server after dispatch; confirmation-policy effect not tested.
- Word modal account-switch mutation continuation, tied ordinary listing, >cap same-spelling warnings.
- Atomic full-data reads under concurrent changes; range/count is not snapshot isolation.
- Fresh native large-data/mobile/IME/screen-reader matrix and Browser Back expectations.
- Concurrent divergent same-Test-ID completion and multi-device editing; only active local rollback proved.
- Hosted migrations/RLS/grants/function metadata/GraphQL/deployment beyond owner reports and source/CI.
- Perfect default-suite repeatability: prior failed runs remain disclosed.

## 18. Final decision and recommended next task

**FUNCTIONAL FIXES REQUIRED.** Begin with **R4-FUNC-02 profile save lifecycle isolation**, followed by Test ownership and theme resilience, each separately reviewed. Keep Auth-generation migration BLOCKED. Preserve 806 frontend tests/200 authorization checks/30 word-version groups and add desired-invariant tests for reproduced defects.

This audit provides evidence/scope, not fixes or release certification. Stop for independent review of the single audit PR.

No production application code was changed.

No Supabase SDK dependency or authentication configuration was modified.

No production database operation was performed.

Nothing was submitted to the upstream Supabase repository.
