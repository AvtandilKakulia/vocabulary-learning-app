# R3-PERF-02 — History sorting without refetch

## მიზეზი და ცვლილება

`History.tsx`-ში `useLatestRequest`-ის კონტექსტი შეიცავდა `userId`, `sortBy` და `sortOrder`-ს. დალაგების ცვლილება ცვლიდა read callback-ს, აუქმებდა მიმდინარე კითხვას და თავიდან იწყებდა სრული კოლექციის მიღებას, თუმცა გამოსახული რიგი უკვე `sortedHistory`-ის `useMemo`-ში გამოითვლებოდა.

ახლა read-ის კონტექსტი მხოლოდ `userId`-ს მიჰყვება. დალაგება იყენებს უკვე მიღებულ კოლექციას; მიმდინარე გვერდების მიღება გრძელდება და დასრულებისას ბოლო არჩეული რიგი ჩანს. დალაგების comparator და თანაბარი მნიშვნელობების stable tie order უცვლელია. შეცდომის შემდეგ sort არ იწყებს Retry-ს.

ანგარიშის context/generation დაცვა, `deletionVersion`-ის შემოწმება, explicit Retry, წაშლის საერთო კოორდინაცია და წაშლის შემდეგ სრული authoritative reload უცვლელია. ასევე უცვლელია 500-ჩანაწერიანი კითხვა, exact count/row validation, 100-ID deletion batches, ფილტრები, სტატისტიკა, confirmation scope და payload-ები. ცვლილება არ ქმნის cache-ს ანგარიშებს ან mount-ებს შორის.

## Regression coverage

დამატებულია 15 შემთხვევა: 100/1,001/2,001 ჩანაწერზე Date/Score ASC/DESC-ის ზუსტი რიგი, თანაბარი timestamp/score, ნულოვანი დამატებითი მოთხოვნები; სწრაფი sort ცვლილებები expanded details/selection/confirmation-ის შენარჩუნებით; შუა/ბოლო დაგვიანებულ გვერდზე დალაგება სრული შედეგის გამოქვეყნებამდე.

არსებული ტესტები გამკაცრდა read error → sort → explicit Retry, StrictMode A → B → A, single/bulk delete-ის შემდეგ ახალი მონაცემების დალაგების, partial/uncertain delete-ის სრული verification და უცვლელი confirmed IDs-ის შესამოწმებლად. ძველი sort-triggered stale-response ტესტები ახლა რეალურ deletion-version refresh-ს იყენებს. ანგარიში, unmount/navigation და deletionVersion კვლავ აუქმებს მოძველებული პასუხების გამოქვეყნებას.

საწყის კოდზე 12 ახალი sort შემთხვევა ჩავარდა: sort ისევ `Loading...`-ს აჩენდა. focused suite-ის პირველ გაშვებაში ერთი ადაპტირებული selection ტესტის ძველი score-order წინაპირობა იყო გამორჩენილი; ის აღდგა და exact confirmed-ID assertion უცვლელი დარჩა. არც timeout და არც უსაფრთხოების assertion არ შესუსტებულა.

## Chrome მეთოდი

PR #34-ის თავდაპირველი [ანგარიში](history-performance-audit.md) და [მონაცემები](history-performance-measurements.json) უცვლელია. ეს შედარება ახალ before/after სერიებს იყენებს, ორივეს ერთნაირი განახლებული harness-ით. Baseline კოდი იკითხება უშუალოდ `7595162d18dadda97ea20a9b260d91988037242d` commit-იდან; სამუშაო ფაილი არ იცვლება.

- Windows 11, i5-1135G7, 8 logical CPU, 7.78 GiB RAM; Chrome 155.0.8059.80 headless, Node 22.14.0, Vite production build, React 18.3.1; viewport 1440×900, UTC/en-US, CPU throttle 1×.
- ხუთი ახალი browser context თითო ზომაზე (100/500/1,000/2,000/5,000), ზომების როტაცია; თითოეულში cold mount, warm remount და 15 interaction. Cold იწყება JS/CSS-ის ჩატვირთვის შემდეგ. Warm remount ისევ თავიდან კითხულობს მონაცემებს.
- იგივე synthetic fixtures, account filter, deterministic DB order, inclusive 500-row pages, exact count, რეალური SDK/JSON parse/DOM/CSS. მხოლოდ localhost GET; fake auth/key, CSP და fetch/server guards კრძალავს გარე/დესტრუქციულ მოთხოვნებს.
- ქსელის იგივე მოდელი: თითო გვერდზე 50 ms + gzip bytes / 10 Mbit/s, შემდეგ localhost burst. ეს არ არის რეალური Supabase latency, count/RLS query ან ინტერნეტის გაზომვა. JSON body bytes და server gzip bytes ცალ-ცალკეა; PR #34-ში აღწერილი Chrome Resource Timing compression შეზღუდვა ისევ მოქმედებს.
- Completion ამოწმებს **ყოველი რეალურად გამოსახული row-ის ID-ს სწორ რიგში**, სრულ რაოდენობას, სტატისტიკას და interaction-ის შედეგს. შესაბამისი მდგომარეობა მოწმდება ორი frame-ის შემდეგაც: baseline-ის ხანმოკლე sorted ძველი სია, რომელსაც effect-ის refetch მოჰყვება, დასრულებად არ ითვლება. Sort-ს GET-ის არსებობა აღარ მოეთხოვება; runner-ის after contract მოითხოვს ზუსტად 0 GET-ს და 0 JSON byte-ს ყველა გამეორებაზე.
- ID-ის შემოწმება benchmark-ში React 18-ის keyed DOM host fiber-ს მხოლოდ კითხულობს: fixture-ებში date/score/direction შეიძლება ემთხვეოდეს. React internal-ის ცვლილებისას harness აშკარად ჩავარდება. Product markup და fixtures არ შეცვლილა. Readiness-ის დამატებითი inspection მცირე გაზომვით ხარჯს მოიცავს ორივე სერიაში.
- ხანგრძლივობა action dispatch-იდან paint/readiness-მდეა, არა field INP. Median / nearest-rank p95, n=5; p95 აქ მაქსიმალური ნიმუშია. სერიები თანმიმდევრულად გაეშვა საერთო Windows გარემოში, პარალელური tests/build-ის გარეშე; OS/thermal drift სრულად გამორიცხული არ არის.

## გამეორება

```powershell
pnpm install --frozen-lockfile
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 5 --history-ref 7595162d18dadda97ea20a9b260d91988037242d --expect-sort-reads --label sort-before
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 5 --label sort-after
node scripts/history-benchmark/summarize.mjs tmp/history-perf-sort-before.json
node scripts/history-benchmark/summarize.mjs tmp/history-perf-sort-after.json
```

`--history-ref` იღებს მხოლოდ სრულ commit SHA-ს; source SHA-256 ინახება შედეგში. `--expect-sort-reads` მხოლოდ baseline-ის ძველი ქცევის assertion-ია. ახალი კოდის გაზომვისას არ გამოიყენოთ. `tmp/`-ში სრული traces იქმნება. გამოქვეყნებული comparison JSON ინახავს ყველა trial-ის timing/CPU/DOM/heap/frame ნიმუშს დაუმრგვალებლად, request URLs-ის ნაცვლად byte totals-ით.

```powershell
node scripts/history-benchmark/summarize.mjs docs/history-sort-performance-measurements.json before
node scripts/history-benchmark/summarize.mjs docs/history-sort-performance-measurements.json after
```

## უსაფრთხო manual Preview verification

1. იზოლირებულ test account-ში გახსენით History და დაელოდეთ სრულ ჩატვირთვას. DevTools Network-ში გაფილტრეთ `test_history`, გაასუფთავეთ log და შეცვალეთ Date/Score და ორივე მიმართულება. მოსალოდნელია **0 ახალი GET**, სწორი რიგი და უცვლელი სტატისტიკა.
2. მონიშნეთ რამდენიმე ჩანაწერი და გახსენით mistake details; სწრაფად შეცვალეთ sort. selection/details უნდა შენარჩუნდეს. Delete confirmation-ის გახსნა და Cancel უსაფრთხოა; რეალური ჩანაწერები არ წაშალოთ.
3. localhost fixture API-ის დაგვიანებული გვერდებით შეამოწმეთ sort ჩატვირთვისას: loading გრძელდება, partial stats არ ჩანს, დასრულებულ სიას ბოლო არჩეული რიგი აქვს. simulated read error-ისას sort არ უნდა კითხულობდეს; Retry სრულ კითხვას თავიდან იწყებს.
4. წაშლის/uncertain outcome/account race სცენარები შეამოწმეთ in-memory regression mocks-ით; ისინი რეალურ მონაცემებს არ ეხება. Preview-ს Production-თან შესაძლო კავშირის გამო bulk delete ხელით არ შეასრულოთ.

## დარჩენილი საზღვრები

ყველა ჩანაწერი კვლავ DOM-ში გამოისახება და sort/filter/selection მოქმედებები დიდ სიაზე React/DOM სამუშაოს იწვევს. ეს ცვლილება არ ახორციელებს virtualization-ს, UI pagination-ს, payload შემცირებას ან მრავალ mount-ს შორის caching-ს. ჩამოტვირთული სიის freshness ისევ mount/Retry/deletion refresh-ს მიჰყვება; sort-ის დაჭერა აღარ არის ფარული refresh. Production configuration, SQL, მონაცემები და სხვა რეჟიმები უცვლელია.

## გაზომილი before/after შედეგები

[სრული ნიმუშები](history-sort-performance-measurements.json): 25 trial თითო ვერსიაზე, 850 interaction ჯამში; ყველა რიგის/account/full-list/statistics assertion შესრულდა, 0 mutation, 0 runtime error, 0 safety violation. დრო **ms, median / p95**. Baseline-ის 540 GET შემცირდა 180 GET-მდე (დარჩა მხოლოდ cold/warm გახსნა). ყველა 100 after-sort მოქმედებაზე 0 GET და 0 JSON byte.

| Records | Sort | Before ms | After ms | Median ცვლილება | GET before → after | JSON bytes before → after |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | date-asc | 189.6 / 543.4 | 28.1 / 40.2 | -85.2% | 1 → 0 | 303236 → 0 |
| 100 | date-desc | 155.8 / 180.1 | 28.5 / 42.6 | -81.7% | 1 → 0 | 303236 → 0 |
| 100 | score-desc | 187.2 / 297.5 | 27.1 / 39.7 | -85.5% | 1 → 0 | 303236 → 0 |
| 100 | score-asc | 157.2 / 446.2 | 32.5 / 37.5 | -79.3% | 1 → 0 | 303236 → 0 |
| 500 | date-asc | 584.0 / 634.6 | 77.2 / 153.4 | -86.8% | 1 → 0 | 1555185 → 0 |
| 500 | date-desc | 468.9 / 623.3 | 104.6 / 122.4 | -77.7% | 1 → 0 | 1555185 → 0 |
| 500 | score-desc | 534.8 / 609.0 | 146.3 / 219.5 | -72.6% | 1 → 0 | 1555185 → 0 |
| 500 | score-asc | 591.8 / 623.1 | 128.5 / 199.7 | -78.3% | 1 → 0 | 1555185 → 0 |
| 1000 | date-asc | 948.6 / 1230.2 | 247.3 / 355.4 | -73.9% | 2 → 0 | 3115887 → 0 |
| 1000 | date-desc | 870.6 / 990.0 | 227.2 / 322.9 | -73.9% | 2 → 0 | 3115887 → 0 |
| 1000 | score-desc | 1069.2 / 1120.5 | 197.5 / 260.7 | -81.5% | 2 → 0 | 3115887 → 0 |
| 1000 | score-asc | 816.4 / 1047.3 | 244.0 / 264.9 | -70.1% | 2 → 0 | 3115887 → 0 |
| 2000 | date-asc | 1836.4 / 2162.6 | 541.8 / 753.0 | -70.5% | 4 → 0 | 6265286 → 0 |
| 2000 | date-desc | 1858.9 / 2043.0 | 468.0 / 570.3 | -74.8% | 4 → 0 | 6265286 → 0 |
| 2000 | score-desc | 1773.5 / 2005.5 | 535.6 / 573.1 | -69.8% | 4 → 0 | 6265286 → 0 |
| 2000 | score-asc | 1634.3 / 1738.9 | 502.1 / 514.9 | -69.3% | 4 → 0 | 6265286 → 0 |
| 5000 | date-asc | 4682.5 / 5333.3 | 1387.2 / 1680.7 | -70.4% | 10 → 0 | 15707792 → 0 |
| 5000 | date-desc | 4644.0 / 5145.7 | 1704.8 / 1983.2 | -63.3% | 10 → 0 | 15707792 → 0 |
| 5000 | score-desc | 4657.0 / 5033.4 | 1287.6 / 1759.0 | -72.4% | 10 → 0 | 15707792 → 0 |
| 5000 | score-asc | 4646.0 / 5571.5 | 1415.5 / 1703.9 | -69.5% | 10 → 0 | 15707792 → 0 |

### გახსნა და სხვა ურთიერთქმედებები

| Records | Cold before → after | Warm before → after | Select All before → after | Expand before → after | DOM nodes before → after |
| --- | --- | --- | --- | --- | --- |
| 100 | 192.6 / 351.5 → 193.5 / 320.6 | 130.4 / 150.1 → 132.0 / 148.0 | 47.1 / 291.8 → 47.2 / 49.1 | 49.5 / 349.9 → 47.0 / 47.7 | 3449 → 3449 |
| 500 | 362.2 / 401.1 → 346.4 / 396.9 | 302.6 / 435.9 → 299.6 / 326.0 | 56.0 / 96.4 → 92.9 / 107.8 | 77.3 / 311.5 → 74.3 / 110.9 | 16848 → 16848 |
| 1000 | 602.9 / 703.7 → 606.6 / 659.0 | 529.9 / 585.5 → 535.1 / 711.6 | 131.4 / 174.0 → 146.7 / 201.8 | 108.4 / 293.0 → 109.8 / 144.6 | 33599 → 33599 |
| 2000 | 1130.5 / 1311.4 → 1174.5 / 1365.3 | 1342.1 / 1524.0 → 1221.1 / 1521.3 | 263.1 / 310.8 → 291.0 / 350.4 | 136.9 / 177.3 → 197.0 / 233.6 | 67098 → 67098 |
| 5000 | 3185.5 / 3660.0 → 3242.1 / 3390.2 | 3103.6 / 3553.2 → 3027.8 / 3086.5 | 618.9 / 833.7 → 653.5 / 871.6 | 407.8 / 451.8 → 398.5 / 507.6 | 167598 → 167598 |

| Records | Direction filter before → after | Score filter before → after | Deselect All before → after | Loaded heap MiB before → after | Scroll frame p95 before → after |
| --- | --- | --- | --- | --- | --- |
| 100 | 27.6 / 29.3 → 26.9 / 28.8 | 29.7 / 31.0 → 26.4 / 29.3 | 44.1 / 47.1 → 47.9 / 50.4 | 2.6 / 2.6 → 2.6 / 2.6 | 18.2 → 18.2 |
| 500 | 35.4 / 48.9 → 34.5 / 147.3 | 48.5 / 74.1 → 38.0 / 46.4 | 61.8 / 89.8 → 121.5 / 183.2 | 6.6 / 6.6 → 6.6 / 6.6 | 18.2 → 18.2 |
| 1000 | 83.9 / 100.2 → 98.9 / 138.3 | 76.7 / 113.8 → 104.9 / 175.7 | 86.7 / 159.7 → 136.1 / 157.6 | 11.6 / 11.6 → 11.6 / 11.6 | 18.2 → 18.3 |
| 2000 | 204.2 / 217.7 → 222.0 / 260.7 | 142.3 / 229.5 → 185.1 / 217.9 | 191.8 / 206.5 → 238.5 / 268.0 | 21.6 / 21.6 → 21.6 / 21.6 | 18.3 → 18.4 |
| 5000 | 591.5 / 874.3 → 550.7 / 598.1 | 433.5 / 461.8 → 429.5 / 492.4 | 548.8 / 711.4 → 601.2 / 708.5 | 51.7 / 51.7 → 51.7 / 51.7 | 18.3 → 35.2 |

### ინტერპრეტაცია და შეზღუდვები

Sort-ის median გაუმჯობესდა ყველა ზომასა და რეჟიმში **63.3–86.8%**-ით. 5,000 ჩანაწერზე თითო დალაგებიდან ამოღებულია 10 GET და 15,707,792 JSON byte (486,718 server gzip byte). ახალი median ჯერ კიდევ **1.29–1.70 წამია**: მთელი DOM-ის გადაადგილება/რენდერი კვლავ ძვირია.

Initial cold median-ის ცვლილება −4.4%-დან +3.9%-მდეა, warm-ის — −9.0%-დან +1.2%-მდე; მის request count/payload/DOM/loaded heap-ში ცვლილება არ დაფიქსირდა. ამ მცირე სერიით initial loading-ის არსებითი სისტემატური გაუარესება არ დასტურდება.

**ყველა სხვა interaction არ აჩქარებულა.** მაგალითად 500-ზე Deselect All median გაიზარდა 61.8 → 121.5 ms, 2,000-ზე Expand — 136.9 → 197.0 ms; 5,000-ზე scroll frame p95 — 18.3 → 35.2 ms. ეს გაზომილი გაუარესებებია და არ არის გამოტოვებული. ხუთი თანმიმდევრული trial და საერთო desktop გარემო საკმარისი არ არის მათი მიზეზის გამოსაყოფად; არ ვაცხადებთ, რომ მხოლოდ noise-ია ან რომ sort ცვლილებამ დანამდვილებით გამოიწვია. სხვა interaction-ების სრული median/p95 მოცემულია comparison JSON-ში. Non-sort/scroll tail-ის დამატებითი counterbalanced profiling დამოუკიდებელი follow-up-ის საგანია; ამ PR-ში rendering-ის სხვა ოპტიმიზაცია არ გაკეთებულა.

საწყისი refetch-ის გაუქმების გამო sort აღარ იძლევა შემთხვევით server refresh-ს. მონაცემები კვლავ ახლდება mount-ზე, explicit Retry-ზე და წაშლის შემდეგ. ეს მოთხოვნილი lifecycle ცვლილებაა; ახალი გარე ჩანაწერის დასანახად History-ში ხელახლა შესვლა საჭიროა, თუ სხვა authoritative refresh არ შესრულდა.

## Validation და ღია დაკვირვება

- `pnpm exec tsc -b`: PASS, 0 error.
- `pnpm lint`: PASS, 0 error / 0 warning.
- საბოლოო `pnpm test`: **604/604 PASS, 30 ფაილი, 70.00 s**, skip-ის გარეშე. History-ის 125 ტესტი მოიცავს 15 ახალ შემთხვევას.
- `pnpm build`: PASS, Vite 6.92 s; JS 512.86 kB. არსებული >500 kB chunk warning დარჩა (baseline ~512.88 kB); ახალი warning არ დამატებულა.
- `git diff --check`: PASS. თავდაპირველი PR #34 ანგარიში/გაზომვები უცვლელია.
- Chrome: 50 cold/warm წყვილი და 850 მოქმედება, ყველა correctness/safety assertion PASS. გამოქვეყნებული JSON-ის summarize შედეგი ზუსტად ემთხვევა raw traces-ის summary-ს.

პირველი სრული `pnpm test` იყო **603 PASS / 1 FAIL** (71.37 s). უცვლელ `FreeMode.reguess.test.tsx`-ში `preserves a single checked wrong answer as one pending retry on reload` ერთხელ storage-ში `hasChecked: true`-ს კითხულობდა მოსალოდნელი `false`-ის ნაცვლად. Timeout არ ყოფილა. იგივე ფაილის ხუთი დამოუკიდებელი განმეორება იყო **19/19 PASS თითოეულში (95/95 ჯამში)**, შემდეგ სრული suite — 604/604 PASS. Practice-ის არც production კოდში, არც ტესტებში, არც persistence/ownership helper-ებში diff არ არსებობს. კოდში textbox-ის გამოჩენა და localStorage effect სხვადასხვა ეტაპებია, მაგრამ ამ დაკვირვებიდან failure-ის ზუსტი მიზეზი საბოლოოდ არ დგინდება; მხოლოდ scheduling noise-ად არ ვაცხადებთ. ეს ღია Practice restoration დაკვირვება დამოუკიდებელი მიმოხილვისთვის რჩება. არც assertion, არც timeout, არც failing test არ დამალულა ან შეიცვალა.

შეცვლილია მხოლოდ:

- `src/components/History.tsx`
- `src/components/History.test.tsx`
- `src/components/History.pagination.test.tsx`
- `src/components/History.bulkDelete.test.tsx`
- `scripts/history-benchmark/browser.jsx`
- `scripts/history-benchmark/run.mjs`
- `scripts/history-benchmark/summarize.mjs`
- `docs/history-sort-performance.md`
- `docs/history-sort-performance-measurements.json`
