# R3-PERF-03 — History UI pagination

## ცვლილება და საზღვრები

History სრულ ავტორიზებულ კოლექციას კვლავ 500-ჩანაწერიანი მოთხოვნებით, exact count-ით და იგივე validation-ით იღებს. დალაგება, ფილტრები, სტატისტიკა და eligible selection სრულ კოლექციაზე გამოითვლება; მხოლოდ ამის შემდეგ გამოისახება მიმდინარე გვერდი. Default არის 25 ჩანაწერი; შესაძლო ზომებია ზუსტად 10/25/50/100. ერთდროულად მაქსიმუმ 100 History row არის mounted.

`history-page-size-v1` localStorage-ში მხოლოდ ზომის რიცხვს ინახავს, browser-wide UI preference-ის სახით. History, account ID, selection, confirmation და page index არ ინახება. არასწორი ან წაუკითხავი მნიშვნელობა იძლევა 25-ს; წერის შეცდომისას მიმდინარე mount-ში არჩეული ზომა მუშაობს. Words-ის ზომებიც იგივეა, მაგრამ მას persistence არ აქვს; Words არ შეცვლილა.

ზომის ცვლილება იყენებს `floor(oldOffset / newSize)`-ს და ინარჩუნებს წინა პირველი ჩანაწერის შემცველ გვერდს. Filter/sort/account ცვლილებები აბრუნებს პირველ გვერდზე. Authoritative refresh/deletion ინარჩუნებს მოქმედ გვერდს ან ბოლო გვერდზე ზღუდავს. Prev/Next სიის სათაურზე გადააქვს focus/scroll; ზომის, sort-ისა და selection-ის ცვლილება scroll-ს არ იწვევს.

**Select All ნიშნავს ყველა გაფილტრულ ჩანაწერს ყველა გვერდზე.** ეს ჩანს ღილაკის ტექსტსა და selected count-ში. ინდივიდუალური ID-ები ინახება page/size/sort ცვლილებისას; filter კვლავ ასუფთავებს selection-ს. Confirmation-ის scope კვლავ immutable ID snapshot-ია და DOM-ს არ ეფუძნება. 100-ID sequential DELETE, uncertain outcome, authoritative reconciliation, explicit confirmed retry და account/deletion-version guards უცვლელია.

`HistoryRows` ინახავს მხოლოდ გაფართოებული ჩანაწერის ID-ს. Memoized rows-ის ლოკალური expansion აღარ ამუშავებს მშობლის სრულ სტატისტიკას ან სხვა row-ებს. შენახული prompts/definitions/descriptions-ის რენდერი და sanitization შენარჩუნებულია. Read, mutation და სხვა რეჟიმების ფუნქციური ლოგიკა არ შეცვლილა.

## რეგრესიის მეთოდი

არსებული History ტესტების global selection labels განახლებულია. სრული read/order assertions კვლავ ყველა ჩანაწერს ამოწმებს: helper რეალური UI-ის 100-ჩანაწერიან გვერდებს გადის და ყველა row-ს აგროვებს. Native Chrome დამატებით გადის **ყოველ 25-ჩანაწერიან გვერდს**, მათ შორის 5,000 ჩანაწერის 200 გვერდს, და ამოწმებს ID membership/order, range/page labels, navigation boundaries, უცვლელ სრულ სტატისტიკასა და 0 დამატებით GET-ს.

Vitest ამოწმებს 0/1/10/25/26/49/50/51/100/101/1,001/2,001/5,000 მოცულობის საწყის/მომდევნო გვერდებსა და სრულ სტატისტიკას; ცალკე ბოლო გვერდებს, ყველა ზომას, storage/remount/StrictMode, invalid/blocked storage, offset retention, keyboard/focus/scroll, cross-page confirmation/cancellation/deletion, clamp, delayed/error/Retry და account transitions. Bulk tests დამატებით ამოწმებს partial failure-ის შემდეგ ბოლო გვერდის clamp-ს, explicit retry-სა და pending deletion-ისას stale page callbacks-ის შეზღუდვას.

ტესტების შემუშავებისას jsdom-ში მრავალჯერადი სრული გვერდების გავლა 5-წამიან ლიმიტს აჭარბებდა. ზედმეტი backtracking/ორმაგი traversal ამოღებულია. 5,000 ჩანაწერის სრული traversal რეალურ Chrome-შია, ხოლო jsdom-ში ამ მოცულობის ჩატვირთვა, პირველი/მომდევნო გვერდები და სრული სტატისტიკა რჩება. Assertion-ები, რომლებიც ადასტურებს სრულ რიგს/ID-ებს/უსაფრთხოებას, შენარჩუნებულია; timeout-ები არ გაზრდილა და არსებული ტესტები არ გამოტოვებულა. თარიღის ფორმატირების დროებითი mock საბოლოო ტესტებში არ არის.

## Chrome მეთოდი და გამეორება

PR #34/#35-ის ანგარიშები და ისტორიული JSON შედეგები უცვლელია. ახალი შედარება PR #35-ის merged main `4431bf352cb6ec0ce6883f387172a78548efd2f0`-ს ახლიდან ზომავს იგივე harness-ით. Baseline ყველა row-ს ითხოვს; ახალი კოდი ამოწმებს ზუსტ მიმდინარე გვერდს და **სრულ** filtered statistics-ს. ორივე იყენებს ერთსა და იმავე fixtures-ს, SDK-ს, CSS-ს, production build-სა და ლოკალურ API-ს.

```powershell
pnpm install --frozen-lockfile
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 5 --history-ref 4431bf352cb6ec0ce6883f387172a78548efd2f0 --all-rows --label pagination-before
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 5 --label pagination-after
node scripts/history-benchmark/summarize.mjs tmp/history-perf-pagination-before.json
node scripts/history-benchmark/summarize.mjs tmp/history-perf-pagination-after.json
```

`--all-rows` მხოლოდ ისტორიული baseline-ისთვისაა; მიმდინარე კოდთან არ გამოიყენოთ. `--history-ref` იღებს სრულ SHA-ს და წყაროს SHA-256 ინახება. ძველი PR #34 baseline-ის გასამეორებლად დამატებით საჭიროა `--expect-sort-reads`. `--sizes 100 --runs 1 --screenshots` ამოწმებს 1440/390 px განლაგებას და `tmp/`-ში PNG-ებს წერს; screenshot runs performance comparison-ში არ შედის.

- Windows 11, i5-1135G7, 8 logical CPU, 7.78 GiB RAM; Chrome 155.0.8059.80 headless, Node 22.14.0, React 18 production, 1440×900, UTC/en-US, CPU 1×.
- თითო ზომაზე ხუთი ახალი browser context, ზომების როტაცია, cold mount და warm remount. დრო JS/CSS-ის მიღების შემდეგ იწყება. Warm mount თავიდან იღებს სრულ მონაცემებს.
- მხოლოდ სინთეზური მონაცემები; account filtering, deterministic ordering, inclusive range, 500-row cap და exact count. localhost GET-only fetch/server guards + CSP; fake auth/key; 0 რეალური DELETE/გარე მონაცემები.
- ქსელი: თითო მოთხოვნაზე 50 ms + gzip bytes / 10 Mbit/s, შემდეგ localhost burst. ეს რეალური Supabase query/RLS/count/network latency არ არის. JSON bytes და server gzip bytes ცალკეა; Chrome Resource Timing compression-ის ადრე აღწერილი შეზღუდვა რჩება.
- Completion: exact rendered IDs/order, full count/average/questions, page/range/boundaries და ორი frame-ის შემდეგ განმეორებითი შემოწმება. Local pagination/size/filter/sort/selection/expansion ითხოვს 0 GET-ს. სრული page walk გაზომილი interactions-ისა და heap snapshot-ის შემდეგაა, ცალკე correctness validation.
- წინა ანგარიშის 3,000 px scroll შეიცვალა **1,000 px-ით ორივე ახალ სერიაში**, რათა default 25-row სია და baseline ერთნაირ მანძილზე შემოწმდეს. Screenshot/layout assertions მხოლოდ ცალკე smoke run-შია.
- Median / nearest-rank p95, n=5; p95 ამ ნიმუშში maximum-ია. დრო dispatch→paint/readiness-ს მოიცავს, არა field INP-ს. საერთო desktop გარემო და თანმიმდევრული runs OS/thermal drift-ს სრულად ვერ გამორიცხავს. Readiness-ის inspection თვითონაც მცირე ხარჯია, განსაკუთრებით baseline-ის ათასობით DOM ID-ზე.

## დარჩენილი რისკები და manual verification

UI pagination არ ამცირებს ქსელურ payload-ს, exact-count query-ს ან სრული კოლექციის JS storage-ს. ყველა saved mistake კვლავ იტვირთება. Filter/sort/selection სრულ კოლექციაზე რჩება O(n)/O(n log n); global Select All-ის მნიშვნელობა და დიდი, მკაფიოდ დადასტურებული deletion-ის პასუხისმგებლობა არ შეცვლილა. Web storage preference browser-wide-ია; სხვა tab-ის ცვლილება live synchronization-ს არ აკეთებს, მაგრამ მომდევნო mount/read იღებს შენახულ მნიშვნელობას.

Preview-ზე გამოიყენეთ უკვე არსებული, მხოლოდ თქვენთვის ნებადართული test account; ჩანაწერები ხელით არ წაშალოთ:

1. History-ის სრული ჩატვირთვის შემდეგ გადაამოწმეთ 25-row default, სრული სტატისტიკა და გვერდების ორივე კონტროლი. DevTools-ში გაასუფთავეთ `test_history` log; Next/Previous და 10/25/50/100 ცვლილებებს 0 GET უნდა მოჰყვეს.
2. 51–75 პოზიციაზე შეცვალეთ ზომა 50-ზე: უნდა გამოჩნდეს 51–100. Filter/Sort ცვლილება page 1-ზე უნდა დაბრუნდეს და სტატისტიკა სრულ matching collection-ს უნდა აჩვენებდეს.
3. აირჩიეთ 50, გადადით Words-ზე და დაბრუნდით; browser refresh-ის შემდეგაც 50 უნდა დარჩეს. DevTools-ით მხოლოდ `history-page-size-v1`-ში არასწორი მნიშვნელობა ჩაწერეთ და History ხელახლა გახსენით: 25 უნდა აღდგეს.
4. მონიშნეთ სხვადასხვა გვერდის ჩანაწერები, შეცვალეთ ზომა/sort და გახსენით Delete Selected მხოლოდ scope-ის სანახავად; დააჭირეთ **Cancel**. Select All უნდა ეხებოდეს ყველა filtered page-ს. რეალური deletion არ დაადასტუროთ.
5. გახსენით mistakes, გადადით სხვა გვერდზე და დაბრუნდით; მონაცემები იმავე ID-ს უნდა ეკუთვნოდეს. შეამოწმეთ keyboard Enter/Tab, disabled საზღვრები და 390 px mobile layout.
6. Account switching/sign-out, unavailable reads და partial/uncertain deletion გამოიყენეთ in-memory tests-ით. Chrome benchmark არც ერთ DELETE-ს არ უშვებს. Production schema/config/data უცვლელია.

## ლოკალური validation

- TypeScript: `pnpm exec tsc -b` — PASS, 0 error.
- ESLint: `pnpm lint` — PASS, 0 error / 0 warning.
- სრული `pnpm test --maxWorkers=1`: **652/652 PASS**, 30 ფაილი, 248.51 s. დამატებულია 48 pagination შემთხვევა; History-ის ჯამია 173 ტესტი. საბოლოოდ დამატებული single-row render assertion ცალკეც შესრულდა: 1/1 PASS.
- საწყისი ჩვეულებრივი `pnpm test`: **646 PASS / 6 timeout**, 121.40 s. ექვსივე იყო History-ის სრული სიის მრავალგვერდიანი DOM traversal (5.17–6.50 s, არსებული 5 s limit); სხვა 29 ფაილი გავიდა. ერთი worker-ით იგივე სრული suite და უცვლელი assertions/timeouts წარმატებულია. ეს ადასტურებს local scheduling/resource sensitivity-ს, მაგრამ არ ამტკიცებს, რომ ყველა CI გარემოში timeout შეუძლებელია. Worker/timeout/config ცვლილება repository-ში არ გაკეთებულა; CI ჩვეულებრივ ბრძანებას იყენებს.
- `pnpm build` — PASS, Vite 10.19 s, JS 516.59 kB / gzip 138.02 kB. არსებული >500 kB chunk warning რჩება (PR #35: 512.86 kB); სხვა ახალი warning არ არის.
- `git diff --check` — PASS. Windows-ის Git მხოლოდ LF→CRLF informational warning-ს ბეჭდავს; whitespace error არ არის.
- Chrome smoke: 100 სინთეზური ჩანაწერი, 1440×900 და 390×900 viewport; screenshot inspection და horizontal overflow assertion წარმატებულია. რეალური დესტრუქციული მოთხოვნები არ შესრულებულა.

## გაზომილი შედეგები

[ყველა trial-ის მონაცემები](history-pagination-performance-measurements.json). დრო ms, median / p95; heap MiB. 25 cold/warm წყვილი თითო ვერსიაზე; ყველა safety/ID/statistics assertion შესრულდა.

| Records | Cold before → after | Warm before → after | DOM before → after | Loaded heap before → after |
| --- | --- | --- | --- | --- |
| 100 | 209.1 / 874.7 → 178.7 / 599.3 | 137.3 / 303.6 → 122.5 / 142.8 | 3449 → 987 | 2.6 / 2.6 → 2.1 / 2.1 |
| 500 | 357.3 / 885.9 → 245.9 / 340.5 | 292.5 / 651.8 → 196.1 / 206.9 | 16848 → 987 | 6.6 / 6.6 → 3.4 / 3.4 |
| 1000 | 625.0 / 1435.8 → 404.6 / 523.7 | 602.1 / 1375.4 → 354.1 / 412.3 | 33599 → 987 | 11.6 / 11.6 → 5.0 / 5.0 |
| 2000 | 1410.6 / 2022.7 → 724.8 / 903.7 | 1155.8 / 1879.1 → 647.2 / 666.6 | 67098 → 987 | 21.7 / 21.7 → 8.3 / 8.3 |
| 5000 | 3008.9 / 5387.1 → 1617.5 / 1882.0 | 2750.1 / 3616.3 → 1506.2 / 1715.9 | 167598 → 987 | 51.8 / 51.8 → 18.1 / 18.1 |

| Records | Retrieval before → after | Post-network before → after | GET per open | JSON / server gzip bytes |
| --- | --- | --- | --- | --- |
| 100 | 76.4 / 273.5 → 84.3 / 120.7 | 92.3 / 505.3 → 83.1 / 409.7 | 1 | 303236 / 9980 |
| 500 | 146.2 / 247.8 → 147.5 / 171.9 | 192.6 / 568.9 → 90.6 / 105.7 | 1 | 1555185 / 48282 |
| 1000 | 291.5 / 543.9 → 284.5 / 323.4 | 306.2 / 811.2 → 91.4 / 156.4 | 2 | 3115887 / 96741 |
| 2000 | 622.5 / 834.2 → 577.2 / 729.0 | 758.2 / 1178.9 → 93.8 / 151.4 | 4 | 6265286 / 194272 |
| 5000 | 1513.6 / 2098.3 → 1493.5 / 1666.8 | 1375.3 / 3234.3 → 94.0 / 184.6 | 10 | 15707792 / 486718 |

| Records | Date ASC before → after | Date DESC before → after | Score DESC before → after | Score ASC before → after |
| --- | --- | --- | --- | --- |
| 100 | 25.3 / 75.3 → 28.4 / 29.5 | 26.9 / 71.9 → 25.0 / 28.0 | 22.8 / 116.6 → 28.5 / 29.9 | 26.0 / 98.4 → 27.7 / 30.0 |
| 500 | 85.4 / 282.7 → 23.0 / 27.5 | 103.4 / 284.3 → 26.2 / 28.8 | 85.2 / 278.3 → 24.7 / 27.2 | 104.0 / 278.5 → 19.7 / 28.7 |
| 1000 | 198.8 / 564.2 → 16.1 / 17.2 | 181.3 / 504.0 → 12.3 / 22.9 | 188.0 / 562.9 → 14.0 / 22.2 | 202.8 / 406.6 → 21.7 / 26.1 |
| 2000 | 357.6 / 737.1 → 21.5 / 32.2 | 477.6 / 652.8 → 13.0 / 26.3 | 445.6 / 659.1 → 16.6 / 35.1 | 513.9 / 670.1 → 14.5 / 26.5 |
| 5000 | 866.0 / 1532.9 → 23.1 / 48.5 | 1147.1 / 1450.6 → 19.8 / 28.6 | 1104.2 / 1455.1 → 21.4 / 24.0 | 1070.5 / 1221.3 → 22.1 / 25.4 |

| Records | Direction en→geo before → after | Score High before → after | Select All before → after | Deselect All before → after | Expand before → after | Scroll frame p95 before → after |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 29.1 / 56.6 → 27.8 / 29.7 | 25.5 / 34.9 → 29.8 / 33.1 | 42.5 / 60.0 → 43.6 / 46.7 | 44.6 / 63.5 → 44.0 / 46.6 | 46.0 / 79.3 → 44.3 / 46.6 | 16.8 → 16.9 |
| 500 | 42.7 / 159.4 → 24.9 / 26.5 | 38.0 / 110.2 → 19.6 / 21.8 | 58.3 / 165.5 → 43.4 / 45.0 | 44.8 / 135.8 → 44.1 / 45.2 | 49.0 / 110.3 → 37.9 / 44.7 | 16.9 → 16.8 |
| 1000 | 107.6 / 254.8 → 19.5 / 26.1 | 60.5 / 197.4 → 14.1 / 21.2 | 104.9 / 223.3 → 35.4 / 43.4 | 104.1 / 271.7 → 34.7 / 41.2 | 86.5 / 159.7 → 39.3 / 43.2 | 16.8 → 16.9 |
| 2000 | 178.1 / 293.8 → 15.2 / 24.1 | 140.1 / 170.4 → 15.2 / 28.3 | 220.1 / 316.5 → 25.4 / 46.1 | 260.9 / 402.5 → 26.9 / 33.1 | 156.1 / 223.1 → 34.0 / 38.4 | 16.9 → 16.9 |
| 5000 | 417.7 / 708.1 → 15.1 / 21.3 | 299.1 / 534.8 → 12.5 / 24.7 | 518.1 / 648.6 → 31.0 / 41.4 | 461.7 / 503.1 → 31.8 / 37.2 | 362.5 / 637.4 → 38.3 / 39.4 | 16.9 → 16.8 |

| Records | Next top | Next bottom | Previous bottom | Previous top | Size 50 | Size 10 | Size 100 | Size 25 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 45.4 / 46.4 | 44.6 / 46.6 | 44.0 / 46.1 | 44.1 / 46.8 | 28.4 / 31.0 | 27.8 / 29.9 | 31.1 / 70.8 | 23.2 / 26.1 |
| 500 | 40.4 / 44.9 | 44.7 / 45.4 | 42.6 / 45.2 | 43.6 / 44.8 | 26.0 / 27.0 | 26.4 / 28.5 | 28.3 / 49.2 | 20.3 / 24.0 |
| 1000 | 37.7 / 48.7 | 35.2 / 41.6 | 38.8 / 40.8 | 40.0 / 42.2 | 19.2 / 24.8 | 10.2 / 24.5 | 43.7 / 57.7 | 16.0 / 20.2 |
| 2000 | 37.9 / 41.3 | 28.1 / 39.2 | 34.6 / 44.3 | 25.8 / 49.6 | 14.3 / 27.4 | 11.0 / 26.6 | 24.4 / 60.2 | 10.5 / 32.7 |
| 5000 | 22.6 / 34.2 | 34.0 / 41.3 | 29.7 / 34.0 | 28.1 / 37.1 | 19.6 / 21.7 | 15.7 / 21.9 | 26.1 / 41.2 | 14.3 / 30.1 |

ყველა ზომაზე default mounted row count არის 25; ყველა page-size interaction-ში ≤100. თითოეული ვერსიის გახსნებზე 180 GET არის (ორივეში ჯამში 360); local actions-ზე — 0. ახალი full-page validation-მა 1,720 გვერდზე 43,000 ID შეამოწმა, დამატებითი GET-ის გარეშე. სულ 1,100 გაზომილი interaction (425 baseline + 675 after), 0 mutation / runtime error / safety violation.

### ინტერპრეტაცია

5,000 ჩანაწერზე cold median შემცირდა 3,008.9 → 1,617.5 ms (46.2%), warm — 2,750.1 → 1,506.2 ms (45.2%). Post-network median 1,375.3 → 94.0 ms გახდა (93.2%); DB/network contract არ შეცვლილა. DOM შემცირდა 167,598 → 987-მდე (99.4%), ხოლო loaded heap 51.8 → 18.1 MiB-მდე. დარჩენილი დაახლოებით 1.5 s დიდწილად სრული მონაცემების retrieval-ია ამ ქსელის მოდელში; pagination ამ ხარჯს არ ხსნის.

5,000-ზე Date/Score sort median 866–1,147 ms-დან 19.8–23.1 ms-მდე შემცირდა. Select All 518.1 → 31.0 ms, Expand 362.5 → 38.3 ms. Next/Previous median 22.6–34.0 ms-ია; size change 14.3–26.1 ms. სრული selection/statistics semantics-ის შენარჩუნება ამ ზომებზე დამატებით server query-ს არ მოითხოვს.

**ყველა მცირე შედეგი არ გაუმჯობესებულა:** 100 ჩანაწერზე Score DESC median 22.8 → 28.5 ms, Date ASC 25.3 → 28.4 ms, Score High 25.5 → 29.8 ms, Select All 42.5 → 43.6 ms. ეს გაზომვები შენარჩუნებულია. მცირე ხუთნიმუშიანი სერია და frame-based readiness ასეთი სხვაობების მიზეზს ვერ გამოყოფს. Scroll p95 დაახლოებით 16.8–16.9 ms დარჩა ორივე ახალ სერიაში; ამ ტესტით scrolling-ის არსებითი გაუმჯობესება არ დასტურდება.

ორივე სერიის პირველი cold run ნელი იყო (100-ზე baseline 874.7 ms / after 599.3 ms), ხოლო ზოგი baseline-ის მომდევნო run-იც თანდათან აჩქარდა. ყველა ასეთი ნიმუში შედის median/p95-სა და JSON-ში. ახალი PR #35 remeasurement ძველი ანგარიშის რიცხვების პირდაპირი ჩანაცვლება არ არის: საერთო desktop/JIT/thermal მდგომარეობა და შეცვლილი 1,000 px scroll მეთოდი განსხვავდება. დიდი DOM reduction ზუსტია; wall-clock ეფექტის განზოგადებას სხვა მოწყობილობებზე მეტი გაზომვა სჭირდება.

## შეცვლილი ფაილები

- `src/components/History.tsx`
- `src/components/history/HistoryPagination.tsx`
- `src/components/history/HistoryRows.tsx`
- `src/lib/historyPreferences.ts`
- `src/components/History.test.tsx`
- `src/components/History.pagination.test.tsx`
- `src/components/History.bulkDelete.test.tsx`
- `src/test/historyPagination.ts`
- `scripts/history-benchmark/browser.jsx`
- `scripts/history-benchmark/run.mjs`
- `docs/history-pagination-performance.md`
- `docs/history-pagination-performance-measurements.json`
