# R4-STAB-01 — History pagination test stability

Base: `83ad130490eecf82d729f4520a7738925adc0e58` (merged #55). Date: 2026-10-24.

## Findings and correction

The measurable avoidable cost is rendering decorative third-party SVG geometry while the tests walk the complete collection through the real History UI. A 2,001-record traversal mounts over 2,000 rows across 21 display pages. The row contains selection, deletion and sometimes expansion icons. Repeatedly creating their SVG paths adds substantial React/jsdom work which is unrelated to the collection, account, sorting or mutation assertions.

The correction is a **file-local Lucide mock** in `History.pagination.test.tsx`. Only five decorative row icons are simplified to SVG containers. Component identities, supplied props and actual Lucide class names are retained, including CheckSquare's `lucide-square-check-big` alias. All other Lucide exports remain real. The five class names were checked against server-rendered output of the installed library. This is isolated test infrastructure; it does not change production rendering or global setup.

The existing History component, row component, controls, input events, accessibility labels, selection state, saved details, data retrieval and deletion logic remain real. No assertion, test case, dataset, API failure, request-count check or traversal was removed or relaxed. SVG path geometry was never asserted by these tests; that decorative rendering is the explicit boundary of the mock. Other test files continue to use their existing icon implementation.

The experiment establishes a causal performance contribution, not the exact cause of every historical timeout. R4-AUTH-01B/01C documented 5-second History failures under normal workers and successful independent repeats, including a 244.26-second full single-worker run. The fresh baseline runs in this task passed. No new baseline timeout was induced by artificial load, and worker contention alone is not claimed as the root cause. Available memory and contention can amplify the remaining execution costs.

## Environment and method

- Windows_NT 10.0.26300; Intel Core i5-1135G7 @ 2.40 GHz, eight logical CPUs; 7.78 GiB RAM, 0.83 GiB free at initial sampling.
- Node 24.22.0, pnpm 10.34.6, Vitest 4.1.11; jsdom 26.1.0, React 18.3.1.
- Existing test timeout: 5,000 ms. Default Vitest forks/file parallelism and isolation retained. Installed Vitest's default count resolves to available parallelism minus one: seven workers here; a single targeted file naturally uses one file worker.
- No heavy browser experiment was running alongside benchmarks. Each invocation was a fresh process, run sequentially. No timeout, CI, dependency or global worker configuration changed.
- JSON reporter captures every test's duration and outcome. File execution time means the History test result's end minus start; run wall window means the final test end minus the reporter's run start (including collection/startup, excluding process teardown). These definitions are used consistently rather than comparing a sum of parallel test times with wall time.

Temporary instrumentation measured React Profiler actualDuration/commit counts, inclusive `fireEvent.click` time, DOM snapshot collection, storage-mock filtering/sorting, locale date formatting and peak mounted DOM nodes. It was removed before qualification runs. Profiler times are development React measurements; they are not native-browser production timings. Navigation time includes rendering and therefore must not be added to Profiler time as independent cost.

## Profiling evidence

The same five cases were profiled with real icons and then with simplified icons, with identical data and assertions:

| 2,001-record case | React render ms, real → simplified | Navigation ms, real → simplified | Commits, both |
|---|---:|---:|---:|
| Load | 1,232.9 → 791.8 | 1,332.2 → 872.1 | 29 |
| Date ascending | 1,889.3 → 1,270.2 | 2,058.6 → 1,536.6 | 30 |
| Date descending | 1,712.2 → 1,458.2 | 1,836.0 → 1,597.0 | 32 |
| Score ascending | 1,554.5 → 1,249.3 | 1,745.2 → 1,409.9 | 31 |
| Score descending | 1,424.4 → 973.0 | 1,714.0 → 1,174.9 | 31 |

Each traversal still performed exactly **20 page clicks**. Peak mounted DOM fell **2,078 → 1,473 nodes**; the same 100 real record rows were present on a full scan page. This is less decorative DOM, not fewer records or fewer visited pages.

Mock authorization/filtering/sorting took 1.7–5.2 ms before and 1.4–5.4 ms after in this comparison. Locale date formatting took 16.4–26.6 ms before and 15.3–24.8 ms after over 2,027–2,077 calls. Neither supports a date-format cache or mock-server rewrite as the principal correction. Snapshot collection took 176–229 ms before and 123–211 ms after; that instrumented figure includes the temporary DOM-node census. Its reduced cost is consistent with the smaller tree; the traversal itself was not changed.

Fixture construction is synchronous before rendering and unchanged. The retained React commit/page-click counts, complete ID/text comparisons and exact API reads rule out an optimization which simply omitted work necessary to the test. `findHistoryRow()` still returns a mounted live row after restoring page size; `allHistoryRows()` still scans every real page and rejects missing/duplicate IDs. Neither helper was changed.

Cleanup and memory considerations: the existing setup still unmounts React and clears storage per case. The helpers retain only scalar snapshots, not detached row subtrees. The new mock stores no record data and adds no per-test cache, timer or subscription. Separate heap-retention/GC measurements were not taken; memory leak absence is not claimed from a speedup. The low free-memory sample is a risk observation, not proof of the historical failure mechanism.

One early profiling generator produced an invalid replacement and two transform failures before any tests ran. It was corrected and both files restored. Those instrumentation setup failures are not counted as application regressions or successful repetitions. No temporary instrumentation remains in the diff.

## Before/after execution

Initial untouched targeted run: **111/111**, History file execution **55.85 s**, slowest case loading 2,000 records **2,578.6 ms**. Initial untouched full suite: **803/803**, wall window **72.56 s**; its slowest History case was date-ascending sorting of 2,001 records, **3,786.3 ms**. This shows resource/execution sensitivity even when the threshold is not crossed.

First single-variable exploratory icon run: **111/111**, History execution **36.69 s** (34.3% less than the initial isolated baseline), slowest case **1,676.8 ms**. Additional exploratory runs and final qualification results are recorded below. The CheckSquare class alias was corrected to match the installed library before final qualification; no assertion or rendering complexity changed in that correction.

Final decision: **RESOLVED** for the measured avoidable test-rendering overhead, with the historical-cause limitation above. Five fresh final-source targeted qualifications and three fresh default-worker full suites passed without timeout. Single-worker execution is supporting evidence, not the fix.

| Run | History execution seconds | Run wall window seconds | Passed |
|---|---:|---:|---:|
| Target qualification 1 | 33.62 | 35.43 | 111/111 |
| Target qualification 2 | 34.37 | 35.87 | 111/111 |
| Target qualification 3 | 33.46 | 35.22 | 111/111 |
| Target qualification 4 | 33.57 | 35.04 | 111/111 |
| Target qualification 5 | 32.54 | 34.23 | 111/111 |
| Full default-worker 1 | 51.01 | 54.11 | 803/803 |
| Full default-worker 2 | 52.62 | 55.62 | 803/803 |
| Full default-worker 3 | 61.54 | 65.66 | 803/803 |
| Full single-worker diagnostic | 34.28 | 193.44 | 803/803 |

Targeted final-source median: **33.57 s** versus **55.85 s** baseline. Slowest individual test across these five runs: **1799.3 ms**, below the unchanged 5,000 ms threshold. Full default-worker median wall window: **55.62 s**, versus **72.56 s** baseline.

| Case | Isolated before ms | Final targeted median ms | Final targeted max ms | Full default-worker max ms |
|---|---:|---:|---:|---:|
| loads 2000 records with complete statistics, deterministic ties, and no duplicate reads | 2578.6 | 1298.7 | 1486.9 | 3016.2 |
| loads 2001 records with complete statistics, deterministic ties, and no duplicate reads | 2169.8 | 1268.4 | 1312.3 | 2537.8 |
| sorts 2001 records 'date' 'asc' with stable ties and zero additional reads | 2103.4 | 1274.2 | 1799.3 | 3719.1 |
| sorts 2001 records 'date' 'desc' with stable ties and zero additional reads | 2030.8 | 1313.1 | 1320.6 | 3128.3 |
| sorts 2001 records 'score' 'asc' with stable ties and zero additional reads | 2175.6 | 1318.4 | 1367.6 | 3158.4 |
| sorts 2001 records 'score' 'desc' with stable ties and zero additional reads | 2164.6 | 1202.4 | 1380.5 | 3305.0 |

Run accounting: two untouched baseline processes (one targeted, one full) passed; four exploratory simplified-icon targeted runs passed; **five** final-source targeted qualifications passed; **three** JSON-reported normal-worker full suites passed; **one** independent full single-worker diagnostic passed. There were **zero test failures/timeouts** in those completed benchmark runs. The two early instrumentation transform failures were setup errors with zero executed tests, as documented above.

The additional final plain `pnpm test` passed **803/803, 37/37 files**, reported duration **53.69 s**. Thus post-change full default-worker verification is **4 successful / 0 failed runs**, alongside **9 successful / 0 failed targeted runs** (five final qualifications, four exploratory) and one successful single-worker diagnostic. TypeScript, ESLint and `git diff --check` passed without errors or lint warnings. The production build passed in 7.99 s with the existing **525.45 kB** bundle/chunk-size advisory; no new warning was introduced. CI results are recorded with the final PR, separately from these local measurements.


The unchanged data matrix still includes 0, 499, 500, 501, 1,000, 1,001, 2,000, 2,001 and 5,000 records. All four date/score direction combinations and tie checks remain, as do exact read counts, page-size persistence, final-page boundaries, full filtered statistics, cross-account transitions, StrictMode, stale callbacks, single/bulk deletion, authoritative refresh and selection safety. All 111 History cases and all 803 frontend tests remain present.

## Reproduction and validation

From a normal repository checkout with the frozen dependencies installed:

```powershell
pnpm exec vitest run src/components/History.pagination.test.tsx --reporter=json --outputFile=history-target.json
pnpm exec vitest run --reporter=json --outputFile=history-full.json
# Independent diagnostic only; never the normal test configuration:
pnpm exec vitest run --maxWorkers=1 --reporter=json --outputFile=history-single.json
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

Run targeted commands in five fresh processes and full default-worker commands in three fresh processes, sequentially. To compare the original behavior, repeat in a clean checkout of the pinned base on the same machine. Output files should be kept outside tracked source; profiling logs/JSON from this task live under ignored `tmp/r4-stab-01/`.

Only two tracked files change: `src/components/History.pagination.test.tsx` and this report. Production History, `src/test/historyPagination.ts`, global setup, Vitest configuration, dependencies, Auth, SQL and workflows are unchanged. Existing CI retains its default frontend execution and 200 authorization + 30 word-version checks. Final CI run and exact commit are recorded in the PR.

Remaining limits: jsdom speed depends on machine load, available memory and dependency/runtime changes. This correction does not certify SVG geometry or native rendering performance. It does not justify a production History redesign, dropping real-DOM assertions, changing timeouts or using one worker as the solution.

Production Auth and Supabase dependency versions were not changed.

Nothing was submitted to the upstream Supabase repository.
