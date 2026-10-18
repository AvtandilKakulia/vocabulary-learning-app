# R3-QA-01 — History / Practice ტესტების დამოუკიდებელი გამოძიება

## ფარგლები და baseline

2026-10-18. Baseline: `2f8eedc7780fb7e93ef5c78d00ba966dc57582e0` — `main`, merged PR #37, 692 ტესტი / 32 ფაილი. ეს PR მხოლოდ აუდიტია: production კოდი, არსებული ტესტები, timeout-ები, worker/CI კონფიგურაცია და dependencies უცვლელია. ყველა მონაცემი fixture-ია; საერთო test setup კრძალავს ნამდვილ Supabase client-ს, fetch/XHR/WebSocket-ს.

Baseline-ის [Quality run 39134258342](https://github.com/AvtandilKakulia/vocabulary-learning-app/actions/runs/39134258342) წარმატებულია: 692/692, 47.83 s, build 2.83 s. ეს race-ის არარსებობის მტკიცებულება არ არის.

## გარემო და გამეორება

| პარამეტრი | ადგილობრივი აუდიტი |
|---|---|
| OS | Windows_NT 10.0.26300, x64 |
| Node / pnpm / Vitest | 22.14.0 / 10.34.6 / 4.1.11 |
| CPU | Intel Core i5-1135G7 @ 2.40 GHz; 8 logical CPU |
| RAM | 7.784 GiB; საწყისად თავისუფალი 0.820 GiB |
| runner | jsdom; forks; file isolation; sequential tests within each file |
| workers | default run: მაქსიმუმ 7; `--maxWorkers=1/2` ცალკე შედარებისთვის |
| timeout | არსებული 5,000 ms; არ გაზრდილა |
| CI განსხვავება | Ubuntu 24 hosted runner, Node 24.21.0; hardware/OS განსხვავებული |

`vitest.config.ts` მოიცავს მხოლოდ `src/**/*.test.{ts,tsx}`-ს და `restoreMocks: true`-ს. Vitest-ის დაყენებული `resolveMaxWorkers()` default run-ში იყენებს `availableParallelism() - 1`-ს. ერთი ფაილის focused run რეალურად ერთ worker-ს იყენებს. რეპეტიციები იყო ახალი პროცესები, მიმდევრობით; სხვა audit/test/build პროცესი მათ პარალელურად არ გაშვებულა. Desktop/OS ფონური დატვირთვა სრულად იზოლირებული არ არის.

```powershell
pnpm exec vitest run
pnpm exec vitest run --maxWorkers=1
pnpm exec vitest run src/components/History.pagination.test.tsx
pnpm exec vitest run src/components/FreeMode.reguess.test.tsx
pnpm exec vitest run src/components/FreeMode.test.tsx

# იგივე დაყენებული Vitest CLI, ახალი პროცესები, JSON + სრული log თითო run-ზე:
node scripts/audit-test-runs.mjs full default 2
node scripts/audit-test-runs.mjs full 1 1
node scripts/audit-test-runs.mjs history default 5
node scripts/audit-test-runs.mjs reguess default 5
node scripts/audit-test-runs.mjs practice default 5
node scripts/audit-test-runs.mjs mixed 2 2

# ცალკე opt-in lifecycle probes; ჩვეულებრივ 692 ტესტს არ ცვლის:
pnpm exec vitest run --config scripts/qa/r3-qa-01.config.ts
pnpm exec tsc -p scripts/qa/tsconfig.json
```

Runner პირდაპირ `node_modules/vitest/vitest.mjs`-ს უშვებს მიმდინარე Node-ით; timeout/config/assertions იგივეა. `tmp/r3-qa-01/<group>-<workers>-<unique>/` ინახავს exit code-ს, დროებს, სახელებს, stack/log-ს, JSON-სა და წამში ერთხელ გაზომილ მინიმალურ თავისუფალ RAM-ს. Fresh-process wall time შეიცავს CLI startup-საც; ის Vitest-ის `Duration`-ისგან განსხვავდება. Raw logs არ ერთვის PR-ს. `mixed` სამივე ზემოთ ჩამოთვლილ ფაილს აერთიანებს.

## წინა დაკვირვებები

| წყარო | დაფიქსირებული მარცხი |
|---|---|
| [PR #34 ანგარიში](history-performance-audit.md) | 586/589; სამი 5 s timeout; focused 9/9 და შემდგომი სრული 589/589 |
| [PR #35 ანგარიში](history-sort-performance.md) | 603/604; `FreeMode.reguess` single checked retry: expected `hasChecked:false`, received `true`; შემდეგ 5×19 და სრული 604/604 |
| [PR #36 ანგარიში](history-pagination-performance.md) | 646/652; ექვსი History traversal timeout, 5.17–6.50 s; single-worker სრული 652/652 |
| PR #37 შენახული ადგილობრივი log-ები | საწყისი 689/691: ახალი Words timeout და იგივე Practice restore mismatch; საბოლოო default 688/692: ოთხი History timeout; single-worker 691/692: B checkpoint expected `null`, received initial unscored B session |
| PR #37 და merged main CI | 692/692; წინა ადგილობრივი მარცხები ამით არ უქმდება |

PR #37-ის 691→692 ცვლილება მისივე ტესტის გაყოფას უკავშირდებოდა; ამ აუდიტის ყველა baseline run 692 ტესტზეა. წინა ადგილობრივი მტკიცებულება: `tmp-r3-ux-01-{full,final,serial}-test.log`; ეს ignored ფაილები ხელმისაწვდომი იყო ინსპექციისას, ახალ checkout-ში არ მოყვება. მათი კონკრეტული assertion-ები ქვემოთ ცალკე probes-ით მოწმდება.

## განმეორებითი შედეგები

| Run | worker limit / files | PASS / total თითო გაშვებაზე | wall time, s | min free RAM, GiB |
|---|---|---|---|---|
| D0 | default 7 / 32 | 669/692 | 209.97* | არ გაზომილა |
| D1 | default 7 / 32 | 669/692 | 224.73 | 0.449 |
| D2 | default 7 / 32 | 670/692 | 209.23 | 0.313 |
| S1 | 1 / 32 | 682/692 | 393.28 | 0.592 |
| H1–H5 | 1 / History | 102/107; 100/107; 105/107; 104/107; 107/107 | 125.91; 128.16; 113.58; 119.55; 113.79 | 0.516–1.013 |
| R1–R5 | 1 / re-guess | 19/19 ხუთივეში (95/95) | 14.84; 14.89; 14.63; 14.65; 15.70 | 1.460–1.686 |
| P1–P5 | 1 / save/account | 41/41; 41/41; 40/41; 41/41; 40/41 | 15.65; 16.55; 16.64; 16.62; 16.33 | 1.418–1.508 |
| M1–M2 | 2 / სამივე focused ფაილი | 162/167; 164/167 | 121.58; 115.17 | 0.455–0.797 |

*D0-ის დრო Vitest Duration-ია; დანარჩენი runner-ის wall time. 21 run-ში 3,937 განმეორებითი test execution: 3,832 PASS / 105 FAIL; baseline-ში 0 skipped. 103 მარცხი არსებული 5 s timeout-ია; ორი დამატებითი B draft-input mismatch ქვემოთ ცალკეა. ყველა 692 უნიკალური ტესტი ოთხ სრულ run-ში შესრულდა. არცერთი ლოკალური სრული run არ ყოფილა სრულად მწვანე. Full single-worker უფრო ნელია მთლიანობაში, მაგრამ ნაკლები timeout აქვს — worker limit-ის შემცირება მარტო სრულ გამოსავლად არ დასტურდება.

ქვემოთ ყველა ჩავარდნილი test title, source location, run და duration range. თითო execution-ის ზუსტი duration/stack runner-ის JSON/log-შია; სახელის პარამეტრები უცვლელადაა. **P3/P5**: expected `B input`, received empty; დანარჩენი: `Test timed out in 5000ms`. სინქრონული jsdom სამუშაოს გამო timeout-ის მიწოდებამდე elapsed შეიძლება 5 s-ს მნიშვნელოვნად ასცდეს.

| ფაილი:ხაზი | ზუსტი test name (describe prefix-ის გარეშე) | Runs | ჩავარდნის დრო, s (min–max) |
|---|---|---|---|
| `FreeMode.reguess.test.tsx:42` | `keeps corrected words resolved across toggles and saves the original mistakes and scores` | D0, D1, D2 | 5.116–5.135 |
| `FreeMode.reguess.test.tsx:273` | `uses complete irregular-verb correctness and preserves retries when direction advances a checked word` | D0 | 5.075–5.075 |
| `History.pagination.test.tsx:119` | `loads 1000 records with complete statistics, deterministic ties, and no duplicate reads` | D0, D1, D2 | 5.898–8.259 |
| `History.pagination.test.tsx:119` | `loads 2000 records with complete statistics, deterministic ties, and no duplicate reads` | D0, S1, D1, D2, H3, H4, M1, M2 | 5.669–13.597 |
| `History.pagination.test.tsx:119` | `loads 2001 records with complete statistics, deterministic ties, and no duplicate reads` | D0, S1, D1, D2, H2, H4, M1, M2 | 5.061–14.380 |
| `History.pagination.test.tsx:140` | `continues from actual row counts when the server cap is below 500` | D0, D1, D2 | 5.804–10.016 |
| `History.pagination.test.tsx:150` | `orders by date first, then descending ID across tied batch boundaries` | D0, D1, D2 | 5.885–10.933 |
| `History.pagination.test.tsx:192` | `preserves saved prompts, descriptions, definitions and legacy mistakes beyond the first batch` | D0, D1, D2 | 6.356–7.482 |
| `History.pagination.test.tsx:237` | `discards partial results after an intermediate API error and retries from scratch` | D0, D1, D2 | 6.984–9.300 |
| `History.pagination.test.tsx:237` | `discards partial results after an intermediate network rejection and retries from scratch` | D0, D1, D2 | 6.501–9.485 |
| `History.pagination.test.tsx:305` | `sorts 1001 records 'date' 'asc' with stable ties and zero additional reads` | D0, D1, D2 | 6.177–8.510 |
| `History.pagination.test.tsx:305` | `sorts 1001 records 'date' 'desc' with stable ties and zero additional reads` | D0, D1, D2 | 6.108–7.476 |
| `History.pagination.test.tsx:305` | `sorts 1001 records 'score' 'asc' with stable ties and zero additional reads` | D0, D1 | 5.104–5.527 |
| `History.pagination.test.tsx:305` | `sorts 2001 records 'date' 'asc' with stable ties and zero additional reads` | D0, S1, D1, D2, H1, H2, M1 | 5.199–10.129 |
| `History.pagination.test.tsx:305` | `sorts 2001 records 'date' 'desc' with stable ties and zero additional reads` | D0, S1, D1, D2, H1, H2, M1, M2 | 5.082–7.713 |
| `History.pagination.test.tsx:305` | `sorts 2001 records 'score' 'asc' with stable ties and zero additional reads` | D0, S1, D1, D2, H1, H2, H4, M1 | 5.062–7.735 |
| `History.pagination.test.tsx:305` | `sorts 2001 records 'score' 'desc' with stable ties and zero additional reads` | D0, S1, D1, D2, H1, H2 | 5.092–7.157 |
| `History.pagination.test.tsx:374` | `ignores obsolete deletion-version page success and stops its pagination` | D0, S1, D2, H1, H2 | 5.188–8.244 |
| `History.pagination.test.tsx:374` | `ignores obsolete deletion-version page failure and stops its pagination` | D0, S1, D1, H2, H3 | 5.043–6.966 |
| `WordManagement.preferences.test.tsx:87` | `preserves both choices through numbered/Next/Previous pages and their boundaries` | D0, D1, D2 | 5.105–5.779 |
| `WordManagement.preferences.test.tsx:124` | `restores explicit choices after section navigation and a fresh mount, without restoring search, page or selection` | D0, D1, D2 | 5.374–5.831 |
| `WordManagement.preferences.test.tsx:156` | `retains restored parameters in debounced entry Search, count, page boundaries and clear` | D0 | 5.098–5.098 |
| `WordManagement.preferences.test.tsx:156` | `retains restored parameters in debounced დათმობა Search, count, page boundaries and clear` | D0 | 5.340–5.340 |
| `History.pagination.test.tsx:352` | `keeps the same paginated read alive when sorting during the page at offset 500` | S1 | 5.315–5.315 |
| `History.pagination.test.tsx:586` | `shows the exact short/full final page for 2001 records` | S1, D1, D2 | 5.333–5.412 |
| `History.pagination.test.tsx:119` | `loads 499 records with complete statistics, deterministic ties, and no duplicate reads` | D1, D2 | 6.581–6.814 |
| `History.pagination.test.tsx:119` | `loads 1001 records with complete statistics, deterministic ties, and no duplicate reads` | D1, D2 | 6.521–9.274 |
| `WordManagement.preferences.test.tsx:106` | `resets only the page when either preference changes, preserving the other choice` | D1, D2 | 5.417–5.428 |
| `FreeMode.test.tsx:223` | `Practice account storage isolation isolates an old account save success after switching accounts` | P3, P5 | 0.310–0.360 |

## A — History traversal-ის ფასი

`src/test/historyPagination.ts:11`-ის `allHistoryRows()` ცვლის page size-ს 100-ზე, რეალური ღილაკებით გადის მთელ კოლექციას, `Map`-ში ინახავს ყველა გვერდის HTMLElement-ებს და აღადგენს წინა ზომას. ყოველი შემდეგი გამოძახება თავიდან ქმნის ამ სამუშაოს. შენახული ელემენტები მოხსნილი DOM subtree-ების სიცოცხლეს აგრძელებს assertion-ის დასრულებამდე.

`findHistoryRow()` (`:36`) ჯერ მიმდინარე გვერდს ამოწმებს, შემდეგ წინ და საჭიროებისას უკან გადადის. Backtracking შესაძლებელია, მაგრამ **არ არის სწორი** მტკიცება, თითქოს `allHistoryRows()` ყოველთვის პირველ გვერდზე ბრუნდება: production page-size ცვლილება პირველ ხილულ offset-ს ინარჩუნებს. 2,001-record tail-ის შემთხვევაში helper-ის დასრულების შემდეგ ბოლო ჩანაწერი უკვე ხილულია.

`History.tsx` სორტირებას memoize-ავს, ამიტომ page-only ცვლილება თავიდან არ ახარისხებს მონაცემებს. თუმცა filter/statistics/eligible-ID გამოთვლები სრულ კოლექციას გადის; ახალი გვერდი ქმნის row DOM-ს და `HistoryRows.tsx` თითო row-ზე თარიღს `toLocaleString()`-ით აფორმატებს. API mock-იც ყოველ request-ზე თავიდან ფილტრავს/ახარისხებს fixture-ს. ეს განსხვავებული ხარჯებია და მხოლოდ test duration-ით მათი წილი ვერ დგინდება.

დროებითი call-through instrumentation-ით გაიზომა იგივე fixture/server mock + რეალური History + უცვლელი helper. სამი ახალი process, თითოეულში 100/500/1,000/2,000/2,001 ზომები ამ რიგით; ნამდვილი formatter და DOM APIs უცვლელ შედეგს აბრუნებდა. React Profiler მხოლოდ კითხულობდა commit/duration-ს; fireEvent/DOM-selector/date wrappers თვლიდა დროს და რეალურ ფუნქციას იძახებდა. არც fake clock და არც timeout ცვლილება. ქვემოთ სამი trial-ის median, ms:

| Records | საწყისი list-ready | mock filter/sort ყველა request-ზე | სრული helper walk | helper React commits | შენახული row subtree DOM nodes |
|---|---:|---:|---:|---:|---:|
| 100 | 306.2 | 0.34 | 520.5 | 4 | 2,000 |
| 500 | 115.2 | 0.37 | 1,484.0 | 8 | 10,000 |
| 1,000 | 80.1 | 1.25 | 2,582.4 | 13 | 20,000 |
| 2,000 | 89.4 | 5.61 | 5,028.6 | 23 | 40,000 |
| 2,001 | 71.1 | 7.39 | 4,729.0 | 24 | 40,020 |

100-record case ყოველ process-ში პირველი/cold-ია; მისი initial-ready დანარჩენ warm cases-ს პირდაპირ არ უნდა შევადაროთ. Fixture construction median 0.69–2.30 ms იყო. 2,001 ჩანაწერზე helper აკეთებს 20 Next + 2 size ცვლილებას: synchronous events 3,875 ms, მათში React actualDuration 3,242 ms; selector calls 836 ms; 2,002 date-format call სულ 42.9 ms. ეს **ჩადგმული/inclusive** დროებია და ერთმანეთთან არ იკრიბება. ძირითადი ფასი React/jsdom UI traversal-ია; mock filtering/sorting ან date formatting დომინანტი არ არის.

2,001-ის tail lookup helper-ის შემდეგ დამატებით 0 click / 0.78 ms იყო; მხოლოდ 1 row რჩება live ბოლო გვერდზე (98 საერთო DOM node), helper-ის დაბრუნებული snapshot კი 40,020 row subtree node-ს იკავებს. ეს retention-ია assertion-ის განმავლობაში, არა დადასტურებული მუდმივი memory leak. 2,000-ზე helper walk-ის სამი დრო: 5,646.8 / 5,028.6 / 4,249.5 ms; observer overhead-იც შედის. Instrumented runs: 3/5, 4/5, 5/5; სამი მარცხი ისევ 5 s timeout, ყველა logged run-ში full-ID/order/statistics assertions შესრულდა. ეს profiling runs baseline matrix-ში არ ირიცხება.

გასამეორებლად ჯერ გამოიყენეთ ზემოთ მოცემული unchanged History focused command. ზუსტი profiling boundary: დრო გაზომეთ `render`-იდან Loading-ის გაქრობამდე, შემდეგ ცალკე `allHistoryRows()`-ის ირგვლივ; Profiler-ის counters ამ მეორე boundary-ზე გაანულეთ. API mock-ის filter+sort ცალკე გაზომეთ; same size sequence და სამი ახალი process შეინარჩუნეთ. Temporary trace/profile source და raw samples მხოლოდ ignored `tmp/r3-qa-01/`-ში დარჩა, debug instrumentation PR-ში არ შედის. ამიტომ committed runner თვითონ detailed profile breakdown-ს არ აგენერირებს.

ეს jsdom ტესტის ღირებულებაა, არა მომხმარებლის რეალურ Chrome-ში latency-ის საზომი. Browser მონაცემები ცალკე [PR #36 ანგარიშშია](history-pagination-performance.md). ამ აუდიტში History-ის runtime performance regression არ არის დამტკიცებული.

## B — visible textbox და persisted retry სხვადასხვა readiness პირობაა

საეჭვო ტესტი: `src/components/FreeMode.reguess.test.tsx:303`, `preserves a single checked wrong answer as one pending retry on reload`; დაუცველი storage assertion `:308`-ზეა.

რეალური lifecycle:

1. `FreeMode.tsx:288` აღადგენს შენახულ checked კითხვას; unresolved retry-ისას `[a]` რჩება `[a]`, `hasChecked` state ხდება false, score/mistakes უცვლელია.
2. vocabulary request-ის დასრულებას მოსდევს queue reconciliation (`:333`).
3. reconciled render ამონტაჟებს textbox-ს.
4. ამ render-ის **passive effect** (`:393`) წერს ახალ checkpoint-ს. მანამდე storage-ში ბოლო ვალიდური checked snapshot არის.

Opt-in probe-ის read-only React Profiler ამავე visible commit-ში ნამდვილად ხედავს `hasChecked:true`-ს. Deferred vocabulary-ის `act`-ით დასრულების შემდეგ **ერთადერთი** scoped write არის მთელი სწორი snapshot: queue `[a]`, hasChecked false, attempts 3, correct 2, იგივე mistakes/unresolved IDs. Remount-ზე ეს პროგრესი ისევ ზუსტია. შემოწმებულია StrictMode-ით და მის გარეშე; storage writes-ის არცერთი ძველი snapshot-ით გადაწერა არ დაფიქსირდა.

ეს ადასტურებს **test readiness კონტრაქტის დეფექტს**: DOM visibility არ უზრუნველყოფს storage effect-ის დასრულებას. მიმდინარე ჩვეულებრივ run-ებში თავდაპირველი `hasChecked` assertion mismatch არ გამეორებულა (წინა PR #37 log-ში 64 ms-ზე მოხდა), ამიტომ ყველა ისტორიული შემთხვევის ერთადერთ მიზეზად ამ მექანიზმს არ ვაცხადებთ. ამ კონკრეტულ [a] retry-ს ძველი ვალიდური snapshot-იდან განმეორებითი აღდგენა არც score-ს უმატებს და არც ახალ ID-ს ქმნის.

შესათავაზებელი მინიმალური test-only კორექცია: `waitFor`-ით დაელოდოს **თავად exact restored checkpoint-ს** (`queueIds`, `hasChecked`, attempts, correct count, unresolved IDs, mistakes), შემდეგ შეასრულოს პასუხი/Next და უცვლელად შეამოწმოს საბოლოო score/queue. არ დაემატოს sleep ან timeout; მხოლოდ textbox-ის პოვნა არ არის persistence barrier.

## C — B-ის საწყისი checkpoint და A-ის დაგვიანებული save

ტესტი: `src/components/FreeMode.test.tsx:533`, `follows the original pending save across account switch until success`; B-ის early snapshot `:552`, საბოლოო byte comparison `:575`.

მიმდევრობა: A აგზავნის frozen result-ს → B იტვირთება → B textbox commit → B-ის საკუთარი passive effect ქმნის საწყის 0/0 checkpoint-ს → A remount უერთდება იმავე pending save-ს → A-ის პასუხი წარმატება/მარცხია. არსებული `findByRole('textbox')`+storage capture ამ commit/effect საზღვარს არ ასინქრონებს; early `null` აუცილებლად არ ნიშნავს, რომ B არ უნდა შექმნას საკუთარი checkpoint.

Probe-ში B vocabulary Promise დაყოვნებულია და A save pending რჩება. B-ის პირველი visible commit-ისას storage ნამდვილად `null` არის; B initialization effect-ის შემდეგ იქ B-ის 0/0 session წერია **A-ის Promise-ის დასრულებამდე**. ამის შემდეგ იჭირება settled raw copy. A-ზე დაბრუნება იმავე request-ს უერთდება (Saving disabled, Retry არ არის); წარმატება შლის მხოლოდ A-ს exact copy-ს, მარცხი ინარჩუნებს მას და explicit Retry აგზავნის ზუსტად იმავე payload/ID-ს. B-ის raw bytes უცვლელია და შემდგომ B-ზე setItem/removeItem არ სრულდება.

ასევე შემოწმებულია B-ზე დარჩენა: მისი უკვე ინიციალიზებული draft `B input` და checkpoint უცვლელია A-ის success/failure-ის შემდეგ; A-ის toast/summary B-ში არ ჩნდება. ოთხივე route/outcome კომბინაცია StrictMode-ით და მის გარეშე მოწმდება. ყველა 10 opt-in probe სამ ცალკე process-ში გავიდა: **30/30**.

მიმდინარე baseline run-ებში თავდაპირველი `bCopy:null` mismatch არ განმეორებულა; წინა log-ში ის 261 ms-ზე, `:575`-ზეა. Controlled observation ადასტურებს early snapshot-ის პრობლემას და შემოწმებულ განრიგებში account isolation-ს; იგი არ გამორიცხავს ყველა სხვა scheduling შემთხვევას.

შესათავაზებელი test-only კორექცია: A-ზე დაბრუნებამდე დაელოდოს B-ის ვალიდურ, სრულ საწყის checkpoint-ს, დაიჭიროს მისი ზუსტი raw bytes, შემდეგ უცვლელად შეამოწმოს A-ის success/failure/retry-ის შემდეგ; დამატებით მონიტორინგი ჰქონდეს B-ზე set/remove ოპერაციების არყოფნას. `null`-ის arbitrary allowance, comparison-ის მოხსნა ან B-ის მონაცემების გასუფთავება არ არის მისაღები.

### დამატებითი finding — B draft input (ჯერ დაუდგენელი)

უცვლელი `FreeMode.test.tsx:204`-ის `isolates an old account save success after switching accounts` **P3 და P5-ში** ჩავარდა `:223`-ზე: expected `B input`, received empty; 359.55 / 310.34 ms. ეს არც timeout არის და არც ზემოთ განხილული `bCopy` assertion.

ტესტი `findByText('B private word')`-ის შემდეგ დაუყოვნებლივ აგზავნის change event-ს; პასუხის ინიციალიზაციის passive effect (`FreeMode.tsx:771–790`) იმავე question-ის გაჩენისას input-ებს ასუფთავებს. ეს შესაძლო ახსნაა, **არა დადასტურებული მიზეზი**. ტესტი არ ამოწმებს draft-ს უშუალოდ change-ის შემდეგ, ამიტომ არსებული failure ვერ ადგენს, input A-ის პასუხამდე თუ შემდეგ გაქრა.

დროებითი, read-only Profiler + boundary trace-ით იგივე ორიგინალური assertions 20 targeted trial-ში გავიდა. თითოეულში B checkpoint უკვე არსებობდა find-ის დაბრუნებისას; input change-ის შემდეგაც და A-ის resolution-ის შემდეგაც `B input` იყო. იმ temporary copy-ის სხვა 39 case testNamePattern-ით გამოირიცხა მხოლოდ ამ targeted experiment-ში; tracked baseline ტესტები არ გამოტოვებულა. Trace instrumentation თავად timing-ს ცვლის; ეს 20 წარმატება P3/P5-ს არ აუქმებს. Settled-input controls-იც წარმატებულია, მაგრამ ადრეული input-ის დაკარგვა **Not yet determined** რჩება. Native browser event-order reproduction და უშუალოდ event-მდე/შემდეგ დაკვირვება საჭიროა, სანამ ამ case-ს მხოლოდ test synchronization-ად ან runtime bug-ად მივიჩნევთ. ამ finding-ის speculative fix არ განხორციელებულა.

## საერთო მდგომარეობა, cleanup და უსაფრთხოების საზღვრები

- `setup.ts` ყოველ ტესტზე ქმნის ახალ lock/channel broker-ს; ასუფთავებს localStorage-ს, ბოლოს unmount-ს აკეთებს, აბრუნებს real timers/globals და ამოწმებს network attempts-ის არყოფნას. Mocks-ის `beforeEach` user-სა და Supabase stub-ებს თავიდან აყენებს.
- Vitest იზოლირებს ფაილებს. `practiceSaves`-ის module Map ინახავს დასრულებულ ოპერაციებსაც, რათა იგივე account/result-ID არ გაგზავნოს მეორედ; probe-ები unique result UUID-ებს იყენებს. `localReleases` განზრახ ელოდება წინა StrictMode cleanup Promise-ს და ბოლოს ჩანაწერს შლის.
- cleanup სინქრონულად აუქმებს `owner.canWrite()`-ს; lock-ის Promise release შემდეგ microtask-ებში სრულდება. Setup არ ელოდება ყველა თვითნებურ Promise-ს. ეს გასათვალისწინებელი საფრთხეა, მაგრამ ამ გამოძიებაში shared-cache/cleanup-ით cross-account დაზიანება არ დაფიქსირებულა.
- ორივე Practice suite requestAnimationFrame-ს ერთნაირად stub-ავს. Save ფაილში ორი case მხოლოდ `Date`-ს fake-ავს; afterEach აბრუნებს real timers-ს. მიზნობრივ სცენარებში retry loops/arbitrary timer delays არ არის.
- session key შეიცავს encoded user ID-ს; parser ადასტურებს payload owner-ს. save Map/result lock იყენებს account+stable result ID-ს. cleanup ამოწმებს account ownership-ს და exact saved raw copy-ს; ძველი save ვერ შლის ახალ checkpoint-ს მხოლოდ ID დამთხვევის გამო.
- History-ის read count, სრული გვერდების validation, stale-context guards, owner-scoped და confirmed-ID deletion უცვლელია. აუდიტი ნამდვილ deletion-ს არ ასრულებს.

## კლასიფიკაცია და შემდგომი PR-ები

| საკითხი | კლასიფიკაცია / მტკიცებულება |
|---|---|
| History timeout | **Confirmed test-performance problem**: სრული UI traversal თავისთავად 4–5+ s ღირს; single-worker-ზეც მეორდება; სრულად სწორი IDs/statistics checks დარჩენილია. |
| Worker/resource გავლენა | **დადასტურებული execution-environment sensitivity**, მაგრამ RAM/paging-ის კონკრეტული ძირითადი მიზეზი **Not yet determined**. Default runs-ში მეტი timeout და დიდი per-test დროა; მხოლოდ worker reduction ყველა მარცხს არ შველის. |
| Checked retry storage assertion | **Confirmed test synchronization defect** readiness წინაპირობაში: visible DOM commit ძველ storage-ს ხედავს; შემდეგ ერთადერთი write სწორი სრული snapshot-ია. მიმდინარე stochastic mismatch არ განმეორდა. |
| B checkpoint capture | **Confirmed test synchronization defect** early snapshot-ში: B-ს თავისი initialization write ჯერ არ დაუსრულებია; A-ის save-მდე ცვლილება დასაკვირვებელია. Settled B bytes ყველა controlled outcome-ში შენარჩუნდა. |
| ახალი B draft mismatch | **Not yet determined**: ორ უცვლელ focused run-ში რეალური assertion failure; tracing/control runs-ში არ გამეორდა. Runtime input loss ჯერ არ გამოირიცხება. |
| Default-run Words/ხანგრძლივი Practice timeouts | დაფიქსირებული გარემოზე მგრძნობიარე timeout-ები; ცალკე ხარჯის პროფილი არ ჩატარებულა. Data mismatch არ დაფიქსირდა; შეუმოწმებელ runtime root cause-ს არ ვასახელებთ. |
| Shared state / module cache / cleanup | ინსპექცია და controlled assertions არ აჩვენებს cross-account corruption-ს; ყველა შესაძლო late callback-ის არარსებობა არ დამტკიცებულა. |

**დადასტურებული ახალი application defect ამ აუდიტში არ არის**, მაგრამ დამატებითი draft finding ღიად რჩება.

შემდგომი სამუშაოს რიგი:

1. **P2, ცალკე Practice test-only PR:** მხოლოდ B/C-ის დასაბუთებული persisted-readiness waits; exact snapshot/byte equality, scores, mistakes, payload/ID და success/failure assertions სრულად შენარჩუნდეს. ახალი draft finding ავტომატურად ამავე კატეგორიაში არ ჩაითვალოს.
2. **P2, ცალკე targeted investigation:** B draft-ის early-input window, native browser + deterministic event trace. თუ runtime loss დამტკიცდა, მისი runtime fix ცალკე PR-ში; აქ effect-ის layout-effect-ად გადატანა ან input guard-ის შეცვლა უკვე დამტკიცებულ გამოსავლად არ არის მიჩნეული.
3. **P2, დამოუკიდებელი History test-performance PR:** helper-მა შეძლებისდაგვარად შეაგროვოს scalar ID/text snapshots და აღარ შეინახოს ყველა detached subtree; მოაშოროს განმეორებითი DOM lookups და იგივე traversal-ის ზედმეტი გამეორება. შეინარჩუნოს ყველა ID-ისა და რიგის სრული verification, ყველა ზომა, statistics/filter/read-count/selection/deletion assertions. ჯერ გაზომოს მოგება — მარტო ამ ცვლილებების საკმარისობა 5 s budget-ისთვის არ არის დამტკიცებული. Date formatting-ის mock-ით დაფარვა მტკიცებულებით არ არის გამართლებული.
4. **P3, გარემოს ცალკე შედარება:** Node 24 / CI-ს მსგავსი რესურსები, 1/2/default worker-ის matched runs. CI worker limit ან timeout ავტომატურად არ შეიცვალოს; global timeout increase აუდიტის გადაწყვეტა არ არის.

დამოუკიდებელ review-ზე გადასამოწმებელია probe-ების commit/passive-effect საზღვარი, storage-write assertions, worker შედარების პირობები და History helper-ის სრული correctness coverage-ის შენარჩუნების გეგმა. ამ PR-ში corrective implementation არ კეთდება.

## შეზღუდვები და შემოწმებები

Native browser/Web Locks-ის ახალი ექსპერიმენტი ამ test-runner აუდიტში არ შესრულებულა; broker არის deterministic mock. თავისუფალი RAM-ის დაბალი მაჩვენებელი მხოლოდ კორელაციაა — CPU scheduling/page-fault tracing არ ჩატარებულა. Node 22 Windows და Node 24 Linux შედეგები არ არის კონტროლირებული OS/Node A/B შედარება. შეზღუდული რაოდენობის runs ვერ ამტკიცებს ყველა შესაძლო runtime race-ის არარსებობას.

- `pnpm exec tsc -b` — PASS, 0 TypeScript error.
- `pnpm exec tsc -p scripts/qa/tsconfig.json` — PASS; opt-in diagnostic TS/TSX-იც შემოწმებულია.
- `pnpm lint` — PASS, 0 error / 0 warning.
- სრული Vitest / focused / two-worker results ზემოთაა; failures არ გამოსწორებულა და არ დამალულა.
- საბოლოო opt-in probes: 10/10 სამჯერ; Duration 7.37 / 6.18 / 5.53 s. პირველი draft probe-ის 8 case არასწორად ეძებდა Close & Save-ს; არსებული restored-result UI სწორად აჩვენებდა Retry Save-ს. შეიცვალა მხოლოდ ახალი probe-ის ეს წინაპირობა; final storage/payload assertions არ შესუსტებულა.
- `pnpm build` — PASS; Vite 13.33 s. არსებული 500 kB chunk warning რჩება (JS 517.00 kB); warning არ ჩახშობილა. Test logs-ში არსებული mocked-client `Multiple GoTrueClient instances` გაფრთხილებაც დარჩა.
- `node --check scripts/audit-test-runs.mjs` — PASS.
- `git diff --check` და `git diff --cached --check` — PASS.

შეცვლილი ფაილები: ეს ანგარიში; `scripts/audit-test-runs.mjs`; `scripts/qa/r3-qa-01.config.ts`; `scripts/qa/r3-qa-01.probes.test.tsx`; `scripts/qa/tsconfig.json`. Production source, არსებული regression tests, root Vitest/TypeScript/CI config და lockfile უცვლელია. Opt-in probes ჩვეულებრივ CI-ის 692 ტესტში არ შედის; მათი ცალკე გაშვების ბრძანება ზემოთაა.
