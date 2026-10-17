# R3-PERF-01 — History-ის წარმადობის აუდიტი

ეს არის გაზომვის აუდიტი. `src/`, არსებული ტესტები, dependency-ები და ინფრასტრუქტურა უცვლელია. ოპტიმიზაცია არ განხორციელებულა. Production-ზე მოთხოვნა, მონაცემის შექმნა/წაშლა, SQL ან ხელით deployment არ შესრულებულა.

## გარემო და გამეორება

საწყისი commit: `56cc41f2a0566927d7360ba2ce5f29ebe15f5a42` — main, merged PR #33. გაზომვა: 2026-10-18, ადგილობრივი დრო. Windows 10.0.26300 x64, Intel i5-1135G7 @ 2.40 GHz, 8 logical CPU, 7.78 GiB RAM; Node 22.14.0; Chrome 155.0.8059.80, ახალი იზოლირებული headless profile. Viewport 1440×900, DPR 1, en-US, UTC, CPU throttle ×1.

```powershell
pnpm install --frozen-lockfile
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 5 --label controlled
node scripts/history-benchmark/summarize.mjs tmp/history-perf-controlled.json

# დამატებითი შემოწმებები; არ გაუშვათ ძირითად გაზომვასთან პარალელურად
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 1 --sizes 501 --cap 200 --latency 0 --mbps 1000 --label cap-check
node scripts/history-benchmark/run.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --runs 1 --sizes 5000 --latency 0 --mbps 1000 --profile --label profile
```

სხვა Chromium-ისთვის შეცვალეთ მხოლოდ executable path. საჭიროა Node ≥22 და არსებული lockfile-ის dependency-ები; დამატებითი პაკეტი ან რეალური Supabase credentials საჭირო არ არის. Vite-ის programmatic production build ცალკე HTML entry-ს ქმნის `tmp/`-ში, იყენებს უცვლელ History-ს, მის hooks/helpers-ს, რეალურ CSS-ს, production React-სა და დაყენებულ Supabase SDK-ს. მხოლოდ Auth და Supabase-ის ინიციალიზაციის საზღვრებია ჩანაცვლებული. ჩვეულებრივი `pnpm build` და პროდუქტის entry უცვლელია. ეს არ არის dev server ან jsdom benchmark.

სკრიპტი localhost-ზე აწყობს GET-only სინთეზურ PostgREST endpoint-ს; ამოწმებს `user_id`, `select=*`, `test_date.desc,id.desc`, offset/limit-ს და პირველი გვერდის exact count-ს. ცალკე ანგარიშის 11 ჩანაწერი ყოველ dataset-ში არსებობს, მაგრამ შედეგებში ვერ ხვდება. `.range()`-ის ინკლუზიური საზღვრები და server cap დაცულია. ყველა სრულ წაკითხვაზე ID-ების სრული მიმდევრობა, რაოდენობა და დუბლირების არარსებობა მოწმდება. UI-ის დასრულება მთლიანი მოსალოდნელი სიისა და Total Tests-ის გამოჩენას მოითხოვს. Browser fetch მხოლოდ ადგილობრივ GET endpoint-ს უშვებს; server ყველა mutation-ს უარყოფს; CSP გარე კავშირებს კრძალავს. Delete ღილაკს benchmark არ აჭერს.

Fixtures მოიცავს 10/20/30 კითხვიან შედეგებს, ორივე მიმართულებას, 20–100% ქულებს, 0–24 შეცდომას, შენახულ prompts/definitions/answers-სა და HTML description-ს. შვიდ ჩანაწერს ერთი timestamp აქვს. ეს განსაზღვრული სინთეზური დატვირთვაა და არა რეალური მომხმარებლების განაწილების შეფასება.

## მეთოდოლოგია და მეტრიკების მნიშვნელობა

- თითო ზომაზე 5 დამოუკიდებელი browser context; თითოეულში cold History mount და warm remount. ზომების რიგი გამეორებებს შორის როტირდება. Warm-საც ახალი GET-ები სჭირდება: API `no-store`-ია.
- „Cold“ ნიშნავს პირველ History mount-ს ახალი page/context-ში, უკვე ჩატვირთული JS/CSS-ით. „Warm“ ნიშნავს იმავე page-ში unmount/remount-ს. აპის ჩამოტვირთვა, ავტორიზაცია და მთელი browser/OS-ის ცივი გაშვება **არ შედის**. ეს History view-ის გახსნის გაზომვაა.
- დრო იწყება action dispatch-იდან; სრულ მოსალოდნელ UI მდგომარეობას ორი `requestAnimationFrame` მოსდევს, რომ შუალედში paint და ხელმისაწვდომი main-thread დაფიქსირდეს. ეს არ არის field INP ან აბსოლუტური TTI. ფილტრები native `change` event-ით, ღილაკები DOM click-ით იმართება; scroll — CDP-ის native mouse gesture-ით.
- Retrieval: პირველი fetch-ის დაწყებიდან ბოლო Resource Timing `responseEnd`-მდე. მოიცავს გვერდებს შორის დაგვიანებას/parse-საც. Post-network: ბოლო პასუხის დასრულებიდან UI readiness-მდე; მოიცავს SDK parse/validation/sort-ს, React-ს, layout-სა და frame-ის ლოდინს. **არ უდრის მხოლოდ React render დროს**.
- CDP ScriptDuration და LayoutDuration + RecalcStyleDuration main-thread-ის კომპონენტებს გვიჩვენებს. TaskDuration მათ მოიცავს, ამიტომ ერთმანეთს არ ვუმატებთ. CPU counters ოდნავ უფრო ფართო CDP command window-ს მოიცავს, ვიდრე action timer.
- JS heap იზომება forced GC-ის შემდეგ, timed actions-ის გარეთ. ეს არ არის Chrome-ის საერთო RSS/GPU/DOM მეხსიერება. DOM count მოიცავს element/text/სხვა კვანძებს; element count ცალკეა.
- Scroll: 3,000 CSS px, 1,500 px/s; rAF ინტერვალები დაახლოებით 2 წამში. ეს არის სიის ზედა მონაკვეთის steady-state scroll; არა მთელი სიის გავლა, touch device ან scroll პარალელურად sort/filter-სთან.
- თითო action-ზე median და nearest-rank p95, n=5. ამ მცირე ნიმუშში p95 უდიდესი დაკვირვებაა და არა production-ის სანდო tail estimate. Scroll-ის frame p95 ასობით frame-ს ეყრდნობა.
- ძირითადი გაზომვებისას სხვა ტესტები/build-ები არ გაშვებულა. მომხმარებლის საერთო Windows გარემო სრულად იზოლირებული laboratory არ არის.

### ქსელის საზომის მნიშვნელოვანი შეზღუდვა

საწყის smoke test-ში სერვერმა 100 ჩანაწერისთვის 9,980 gzip byte გაგზავნა, თუმცა ამ Chrome გარემომ Resource Timing-ში 303,236 encoded/decoded byte და 303,536 transfer byte დააფიქსირა; browser Response-ში Content-Encoding/Content-Length არ ჩანდა. მიზეზი ამ აუდიტში არ დადგენილა. ეს მაჩვენებელი რეალურ compressed wire traffic-ად არ არის წარმოდგენილი.

ამიტომ საბოლოო სერია CDP throughput throttling-ს არ იყენებს. ადგილობრივი სერვერი თითო პასუხს აყოვნებს `50 ms + gzip_body_bytes / (10 Mbit/s)`-ით; შემდეგ body ერთ burst-ად ბრუნდება. ეს **გამეორებადი ქსელის მოდელია**, არა გაზომილი ინტერნეტი. ცხრილში JSON და სერვერის gzip body ზომები ცალ-ცალკეა. Headers/TLS/TCP overhead და რეალური Supabase/RLS/count query execution არ გაზომილა. თავდაპირველი smoke/შეწყვეტილი CDP სერია საბოლოო შედეგებში არ შედის.

## კოდის ინსპექცია

| ადგილი | დაკვირვება | სტატუსი |
|---|---|---|
| `History.tsx` 65, 80–157 | Sort state შედის read context-ში; ცვლილება ხელახლა კითხულობს მთელ კოლექციას. Query ყოველთვის date DESC/id DESC-ია. | request count-ით დადასტურებული |
| `History.tsx` 94–137 | 500-იანი sequential pages, exact authorized count, ყველა ჩანაწერი memory-ში; partial list არ ქვეყნდება. | არსებული safety გარანტია; RTT/payload ზრდის რისკი |
| `History.tsx` 312–324 | Sort memoized-ია; date comparator ყოველ შედარებაზე ქმნის Date-ს; score comparator ითვლის ratio-ს. | ხარჯის შესაძლო წყარო; არა ცალკე დადასტურებული მთავარი bottleneck |
| `History.tsx` 326–356, 435 | Filter, statistics, ID Set, eligible selection ხელახლა ითვლება component render-ზე. | O(n) კოდის რისკი; ხარჯი მთლიან render-ში იზომება |
| `History.tsx` 546–632 | ყველა filtered row რენდერდება; ცალკე memoized row არ არის; locale date formatting და callbacks ხელახლა იქმნება selection/expansion-ზეც. | დიდი DOM/reconciliation-ის გასაზომი რისკი |
| `History.tsx` expanded details | ყველა mistake payload წინასწარ ჩამოდის, მაგრამ description sanitization/DOM მხოლოდ გაშლილ ჩანაწერზე ხდება. | network/heap-ის და expansion-ის სხვადასხვა ხარჯი |
| `historyDeletion.ts` | module Map ინახავს account-ის busy/version-ს, არა History arrays-ს; subscription cleanup არსებობს. | აქ History-ს დიდი payload retention არ ჩანს; ბევრი account key-ის ზრდა თეორიულია |
| არსებული History tests | pagination/count/cap/errors/stale reads; selection/filter/stats; safe confirmed batches/uncertain outcomes. | უსაფრთხოების ფუნქციური baseline; jsdom duration performance მტკიცებულებად არ გამოიყენება |

## გაზომილი შედეგები

[ნიმუშების მონაცემები](history-performance-measurements.json) შეიცავს ყველა 25 trial-ის action timing/CPU/payload/DOM/heap/frame ნიმუშს. სრული request/resource traces გამეორებისას `tmp/history-perf-controlled.json`-ში იქმნება; committed ვერსია მათ ნაცვლად byte totals-ს ინახავს, რიცხვითი ნიმუშები დაუმრგვალებელია. ქვემოთ დროები **ms, median / p95**-ია. გამოქვეყნებულ მონაცემებსაც იგივე summarize სკრიპტი კითხულობს. ყველა 425 მოქმედებაზე სრული filter-dependent statistics დამატებით შემოწმდა fixture-ებისგან დამოუკიდებელი გამოთვლით.

### გახსნა, მიღება და render readiness

| Records | Cold გახსნა | Warm გახსნა | GET / სრული read | Retrieval (cold) | ბოლო პასუხის შემდეგ (cold) |
| --- | --- | --- | --- | --- | --- |
| 100 | 212.3 / 311.8 | 123.6 / 135.4 | 1 | 89.9 / 96.4 | 111.5 / 207.8 |
| 500 | 378.9 / 496.2 | 313.8 / 346.9 | 1 | 155.4 / 193.4 | 210.9 / 259.0 |
| 1000 | 596.1 / 678.7 | 571.1 / 585.1 | 2 | 308.5 / 338.4 | 279.1 / 289.0 |
| 2000 | 1145.3 / 1212.4 | 1312.4 / 1394.5 | 4 | 647.0 / 655.5 | 515.6 / 547.7 |
| 5000 | 3218.7 / 5350.6 | 3440.2 / 4686.2 | 10 | 1732.5 / 2421.0 | 1510.1 / 2886.4 |

Cold total ≈ retrieval + post-network + mount/fetch-start ხარჯი. სვეტების medians დამოუკიდებლადაა გამოთვლილი, ამიტომ მათი ზუსტი შეკრება არ არის მოსალოდნელი. Warm remount 5,000-ზე უფრო სწრაფი არ აღმოჩნდა; მონაცემისა და DOM-ის ხელახლა შექმნა მაინც საჭიროა.

| Records | JSON bytes / read | Server gzip bytes / read | DOM nodes (elements) | Heap loaded MiB | Heap after actions MiB | Heap after final unmount MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 303236 | 9980 | 3449 (2312) | 2.6 / 2.6 | 4.3 / 4.3 | 1.9 / 1.9 |
| 500 | 1555185 | 48282 | 16848 (11311) | 6.6 / 6.6 | 13.3 / 13.3 | 1.9 / 1.9 |
| 1000 | 3115887 | 96741 | 33599 (22562) | 11.6 / 11.6 | 24.6 / 24.6 | 2.0 / 2.0 |
| 2000 | 6265286 | 194272 | 67098 (45061) | 21.6 / 21.6 | 47.1 / 47.2 | 2.0 / 2.0 |
| 5000 | 15707792 | 486718 | 167598 (112561) | 51.7 / 51.7 | 115.0 / 115.0 | 2.0 / 2.0 |

5,000 ჩანაწერის DOM სიმაღლე 545,629 CSS px-ია, საწყისი row — 109 px. Heap მნიშვნელობები GC-ის შემდეგაა; საბოლოო unmount-ზე მცირე heap-მდე დაბრუნება ამ მოკლე სცენარში შეუქცევად History memory leak-ს **არ ადასტურებს**. Interaction-ებისას მაღალი live heap მაინც გაზომილი პრობლემაა.

### Main-thread breakdown (cold open)

| Records | Script CPU | Layout + style CPU | Task CPU (inclusive) | ყველაზე ხანგრძლივი task |
| --- | --- | --- | --- | --- |
| 100 | 35.9 / 39.4 | 89.6 / 93.4 | 144.0 / 149.4 | 72.0 / 78.0 |
| 500 | 66.4 / 95.9 | 121.3 / 162.5 | 239.8 / 313.7 | 121.0 / 153.0 |
| 1000 | 101.6 / 114.1 | 160.3 / 178.4 | 376.3 / 419.6 | 165.0 / 181.0 |
| 2000 | 152.1 / 172.3 | 314.2 / 334.3 | 614.8 / 660.2 | 354.0 / 371.0 |
| 5000 | 534.0 / 946.1 | 846.8 / 1439.2 | 1755.5 / 3585.1 | 1037.0 / 1904.0 |

### ფილტრები — 0 ახალი GET თითო მოქმედებაზე

მიმართულების sequence: All → English → Georgian → All. Score sequence: All → High → Medium → Low → All. საწყისი მდგომარეობები განსხვავდება, ამიტომ ეს სვეტები სხვადასხვა transition-ის ხარჯს აღწერს.

| Records | English → Georgian filter | Georgian → English filter | All directions | High | Medium | Low | All scores |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 22.9 / 28.9 | 25.2 / 30.2 | 27.8 / 28.6 | 26.3 / 27.6 | 24.7 / 27.1 | 24.4 / 27.1 | 25.0 / 29.2 |
| 500 | 36.5 / 44.0 | 61.5 / 88.5 | 90.3 / 95.5 | 38.1 / 41.3 | 40.9 / 46.4 | 39.6 / 50.0 | 84.3 / 100.8 |
| 1000 | 84.6 / 100.2 | 113.1 / 193.7 | 143.8 / 317.9 | 68.7 / 108.0 | 126.5 / 165.0 | 142.6 / 160.7 | 245.4 / 394.1 |
| 2000 | 205.2 / 300.2 | 323.7 / 356.2 | 549.1 / 600.4 | 174.4 / 184.5 | 273.6 / 291.7 | 272.4 / 309.6 | 486.2 / 587.4 |
| 5000 | 537.0 / 831.1 | 1084.8 / 1416.3 | 1414.3 / 2138.6 | 424.2 / 555.8 | 702.0 / 923.3 | 662.7 / 799.4 | 1650.3 / 2197.2 |

### Sort, selection და details

თითო sort ხელახლა იწვევს სრულ read-ს (1/1/2/4/10 GET შესაბამისად); Select/Deselect/Expand — 0 GET. ოთხი sort-ის გავლა 5,000-ზე 40 დამატებითი მოთხოვნა და 62,831,168 decoded JSON byte-ია.

| Records | Date ASC | Date DESC | Score DESC | Score ASC | Select All | Deselect All | Expand |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 142.0 / 173.0 | 146.0 / 146.2 | 143.6 / 185.4 | 164.7 / 202.8 | 39.2 / 44.8 | 44.0 / 45.1 | 44.8 / 45.4 |
| 500 | 363.0 / 445.5 | 449.1 / 538.5 | 497.9 / 555.3 | 542.7 / 638.1 | 77.4 / 98.6 | 76.5 / 100.7 | 61.3 / 94.0 |
| 1000 | 1046.7 / 1278.7 | 973.7 / 1282.1 | 1061.9 / 1416.9 | 959.2 / 1185.0 | 147.8 / 210.3 | 125.2 / 156.7 | 112.3 / 147.7 |
| 2000 | 1928.2 / 2354.9 | 1878.2 / 2587.2 | 2035.8 / 2332.3 | 1926.1 / 2085.1 | 254.3 / 329.0 | 270.2 / 318.7 | 217.8 / 253.0 |
| 5000 | 5278.0 / 7558.4 | 5336.5 / 6208.1 | 5085.0 / 5402.6 | 5566.6 / 5736.6 | 696.3 / 817.0 | 639.6 / 668.3 | 439.9 / 661.4 |

### Native scroll

| Records | rAF interval median / p95 ms | Max gap ms | Frames >33.4ms | Frame samples |
| --- | --- | --- | --- | --- |
| 100 | 16.7 / 16.8 | 33.3 | 0% | 635 |
| 500 | 16.7 / 16.9 | 33.6 | 0.3% | 630 |
| 1000 | 16.7 / 16.9 | 50.3 | 0.5% | 623 |
| 2000 | 16.7 / 17.0 | 49.8 | 1.1% | 612 |
| 5000 | 16.7 / 17.0 | 83.7 | 2.9% | 595 |

ეს steady-state scroll მეტწილად 60 Hz-ის frame budget-შია; ზოგიერთ გრძელ gap-ს raw მონაცემი ინახავს. სიის ზრდასთან დაკავშირებული მთავარი დადასტურებული პრობლემა **მოქმედებისას/გახსნისას ხანგრძლივი main-thread სამუშაოა**, არა მუდმივი scrolling failure.

### დასკვნა და მტკიცებულების საზღვრები

100 → 5,000 records: cold median 15.2×, DOM 48.6×, loaded JS heap 19.9× იზრდება. 5,000-ზე cold retrieval median 1732.5 ms და post-network 1510.1 ms ერთმანეთთან შესადარებელი ხარჯებია. Date ASC მთლიანად 5278 ms-ია; მის task CPU-ში 3919.3 ms შედის, retrieval-ში 1799.4 ms (ეს inclusive ფაზები ერთმანეთს შეიძლება გადაფარავდეს).

დადასტურებულია დიდი DOM, ხაზოვანი heap ზრდა, network-free selection/expansion-ის შეფერხება და sort-ის redundant refetch/remount. ცალკე Array.sort/filter/Set ხარჯი ამ სერიაში იზოლირებულად არ გაზომილა; მხოლოდ კოდის მიხედვით მათი „მთავარ მიზეზად“ გამოცხადება არასწორი იქნებოდა. Database/RLS/count query cost, რეალური RTT და production payload-ის განაწილება კვლავ უცნობია.

### დამატებითი CPU sampling

ძირითადი სერიის შემდეგ ცალკე 5,000-record run შესრულდა `--profile --latency 0 --mbps 1000`-ით. მისი დროები ზემოთ median/p95-ში **არ შედის**. V8 sampled self-time, source map-ით:

| Action | დაკვირვებული self-time |
| --- | --- |
| Cold open | `setAttribute` 144.6 ms; `appendChild` 142.6 ms; `createElementNS` 104.8 ms; History row map 41.3 ms; GC 82.0 ms |
| Select All | `setAttribute` 37.6 ms; Lucide rendering 36.7 ms; History row map 31.9 ms; `removeChild` 25.1 ms; GC 73.6 ms |
| Expand | React DOM-ის ორი sampled frame 35.3 + 29.4 ms; History row map 21.9 ms; Lucide rendering 21.0 ms; GC 23.8 ms |

ეს ადასტურებს, რომ ერთი expansion-იც History row map-სა და React/icon reconciliation-ს ასრულებს. `(program)`-ის დიდი წილი ზუსტად ვერ ატრიბუცირდება და მთლიანად React-ს ან layout-ს არ მივაწერე. Date formatting-ის, sanitizer-ისა და Array.sort-ის ცალკე წილი სარწმუნოდ არ გამოყოფილა. Profiler/sample overhead-ისა და სხვა native სამუშაოს გამო ეს ციფრები action elapsed time-ის სრულ decomposition-ს არ წარმოადგენს. გამეორებისას სრული `.cpuprofile`-ები `tmp/`-ში იქმნება და Chrome DevTools-ში იხსნება.

## უსაფრთხოების პირობები მომავალი ოპტიმიზაციისთვის

ანგარიშის ცვლილებამ/unmount-მა ძველი შედეგი უნდა გააუქმოს; წაკითხვის დასრულებამდე partial data სტატისტიკაში არ უნდა მოხვდეს. სტატისტიკა მთელი **filtered authorized collection**-ის მიხედვით უნდა დარჩეს. Selection-ის eligibility უნდა განისაზღვროს ჩანაწერის ID-ითა და მოქმედი ფილტრით და არა DOM-ში mount-ით. PR #33-ის immutable confirmation scope, 100-იანი sequential deletion, uncertain outcome-ის authoritative refresh და ხელახალი explicit confirmation უნდა შენარჩუნდეს.

Virtualization ან UI pagination არ უნდა ნიშნავდეს „Select All = მხოლოდ mounted/page rows“ ჩუმ ცვლილებას. გაფართოებული დეტალები უნდა აჩვენებდეს History-ში შენახულ snapshot-ს, არა მიმდინარე vocabulary-ს. Memoized handlers-ს account/confirmation context-ის მოძველება არ უნდა გამოეპაროს. Server-side მიდგომას დასჭირდება ფილტრზე დამოკიდებული aggregate-ებისა და მთლიანი eligible selection-ის დამოუკიდებელი, შესამოწმებელი კონტრაქტი.

## პრიორიტეტული რეკომენდაციები — განხორციელების გარეშე

1. **პირველი, ვიწრო PR: display sort-ის გამიჯვნა data reload-ისგან.** დალაგება უკვე client-side სრულ კოლექციაზე ხდება, ხოლო database query sort ყოველთვის უცვლელია. თითო sort-ზე იგივე მონაცემების თავიდან მიღება, loading-ზე მთელი სიის მოხსნა და შემდეგ ხელახლა შექმნა რეალურად იზომება. ჯერ ეს ზედმეტი სამუშაო უნდა მოიხსნას. ეს არ აგვარებს initial load-ს ან ყველა row-ის reorder/render-ს; კონკრეტული speedup წინასწარ არ არის დაპირებული.
2. **შემდგომი მთავარი render ოპტიმიზაცია: bounded list.** Virtualization ამცირებს mounted rows/DOM-ს და კარგად შეესაბამება ყველა filtered record-ის უწყვეტ დათვალიერებას. საზომები მის საჭიროებას ამყარებს, მაგრამ მოგება ჯერ benchmark-ით არ დადასტურებულა. Variable-height mistake expansion, scroll anchoring, keyboard focus და accessibility შესამოწმებელია. ალტერნატივაა UI pagination, რომელიც ასევე ზღუდავს DOM-ს და სრულ statistics-ს client memory-ში ტოვებს. ის უფრო მარტივია, თუმცა navigation/Select All-ის მნიშვნელობაზე აშკარა UX გადაწყვეტილება სჭირდება. ორივე ერთდროულად არ არის რეკომენდებული.
3. **Memoized row და სტაბილური props/callbacks.** ერთი ჩანაწერის გაშლა/მონიშვნა დანარჩენი ათასობით უცვლელი row-ის ხელახლა გამოთვლას არ უნდა საჭიროებდეს. Filter/statistics/ID Set-ის memoization-იც შესაფასებელია. Select All მაინც ყველა row-ის selected state-ს ცვლის; memoization initial mount-ისა და დიდი DOM-ის პრობლემას ვერ მოაგვარებს. თარიღის ფორმატირების ცალკე cache/formatter მხოლოდ locale/timezone semantics-ის შენარჩუნებით უნდა განიხილებოდეს.
4. **Payload reduction / expanded details-ის lazy read — ცალკე გაზომვადი პროექტი.** 5,000 fixture-ში 40,819 mistake-ია. Description/definitions/prompts-ის გარეშე metadata + mistake_count-ის JSON 1,284,168 byte იქნებოდა, სრული array-ის 15,707,783 byte-ის ნაცვლად (დაახლოებით 92% ნაკლები decoded payload; ეს მხოლოდ fixture-ის byte calculation-ია, არა განხორციელებული API ან speedup). Mistakes ახლა უკვე მხოლოდ expansion-ზე რენდერდება; დამატებითი მოგება retrieval/parse/heap-შია. Details აუცილებლად იმავე შენახული History snapshot-იდან, account-scoped read-ით უნდა მოვიდეს. Loading/error/retry, სწრაფი expansion, deletion და account change ცალკე უნდა დაიფაროს.
5. **Server-side pagination/filter/sort — ჯერ არა პირველი ცვლილება.** მას შეუძლია client payload/heap-ის შეზღუდვა, მაგრამ full filtered statistics და selection მთელ matching set-ზე დამოუკიდებლად უნდა გადაწყდეს. ამ აუდიტში database query plan, exact count-ის ფასი და რეალური RTT არ გაზომილა; ამ არქიტექტურული ცვლილების აუცილებლობა ან ეფექტი დადასტურებული არ არის.

### შემოთავაზებული პირველი PR-ის ფარგლები

მხოლოდ History-ის read lifecycle-ისა და display sort state-ის გამიჯვნა, API/schema-ის ცვლილების გარეშე. Sort-ის შემდეგ გამოყენებული უნდა იყოს მიმდინარე ანგარიშის უკვე სრულად მიღებული collection; account change, unmount, explicit Retry და mutation version კვლავ უნდა მართავდეს authoritative read-სა და stale-response guard-ს. Loading-ისას შეცვლილი sort დასრულებულ კოლექციას სწორი ახალი რიგით უნდა აჩვენებდეს.

მიღების პირობები: ოთხივე sort-ზე 0 დამატებითი GET სრულად ჩატვირთული History-ისთვის; უცვლელი filter-dependent statistics/selection; old-account/stale mutation response-ის იგნორირება; PR #33-ის deletion refresh ყოველთვის სრული და ავტორიტეტული; არსებული safety ტესტები და focused lifecycle regressions; იგივე Chrome benchmark-ით before/after. Virtualization, pagination UX და lazy details ამ პირველ PR-ში არ შევა. **ჯერ საჭიროა დამოუკიდებელი განხილვა და მფლობელის თანხმობა.**

## შემოწმებები და შეზღუდვები

| შემოწმება | ფაქტობრივი შედეგი |
| --- | --- |
| `pnpm install --frozen-lockfile` | წარმატებული; lockfile უცვლელი; pnpm 10.34.6 |
| `pnpm exec tsc -b` | წარმატებული, 0 TypeScript error |
| `pnpm lint` | წარმატებული, 0 error / 0 warning |
| სრული `pnpm test --maxWorkers=1` | **589/589**, 30/30 ფაილი, 199.79 s; არცერთი გამოტოვებული ტესტი |
| `pnpm build` | წარმატებული; JS 512.88 kB; არსებული >500 kB chunk warning დარჩა |
| `git diff --check` და staged diff check | წარმატებული |
| ძირითადი native Chrome სერია | 25 cold/warm წყვილი, 425 actions, 540 account-scoped GET; 0 mutation / runtime error / scope violation |
| server cap 200, dataset 501 | წარმატებული; თითო read-ზე offsets 0/200/400, სრული ID-ები/სტატისტიკა |
| ცალკე native CPU profile | წარმატებული; 5,000 records, 3 sampled actions; არ შედის ძირითად timing-ებში |
| გამოქვეყნებული ნიმუშები | summary ზუსტად ემთხვევა სრული raw results-ის summary-ს |
| პროდუქტის build-ის იზოლაცია | `auditRequests` და fixture key `dist/`-ში არ არის |

**საწყისი სრული გაშვება ჩაიჭრა და არ არის დამალული:** `pnpm test --maxWorkers=4` — 586 passed / 3 failed, 99.70 s. სამივეს შეცდომა იყო უცვლელი `5000ms` test timeout, არა მნიშვნელობების assertion mismatch:

- `History.pagination.test.tsx`: `loads 2001 records with complete statistics, deterministic ties, and no duplicate reads` — 6,681 ms.
- იმავე ფაილში: `clears selection and invalidates stale confirmation callbacks on filtering after full loading` — 6,002 ms.
- `History.bulkDelete.test.tsx`: `keeps verification pending until every refresh page arrives and preserves filters and statistics` — 5,896 ms.

ეს სამი შემთხვევა ერთ worker-ზე სამჯერ განმეორდა: **3/3 თითო გაშვებაზე, ჯამში 9/9**, იგივე assertions და timeouts. შემდეგ მთელი 589-ტესტიანი სერია გაიარა. `src/`, არსებული ტესტები, Vitest config და lockfile უცვლელია. პირველი გაშვებისას ანგარიშის მონაცემების export/check-იც სრულდებოდა, რაც საერთო CPU დატვირთვას ამატებდა; ეს შესაძლო ხელშემწყობი ფაქტორია, არა დასაბუთებული ერთადერთი მიზეზი. პარალელური Windows/jsdom შესრულების timing sensitivity ბოლომდე აღმოფხვრილი არ არის და ამ measurement-only PR-ში არ გამოსწორებულა. Timeout არ გაზრდილა, ტესტი არ გამორთულა. ეს jsdom დროები browser benchmark-ის შედეგებში არ მონაწილეობს.

ფაილები: ეს ანგარიში; `docs/history-performance-measurements.json`; `scripts/history-benchmark/{run.mjs,browser.jsx,fixtures.mjs,summarize.mjs}`. არცერთი production source/config/test ფაილი არ შეცვლილა. pnpm-ის update notice მხოლოდ შეტყობინებაა; package manager/dependency upgrade არ შესრულებულა.

არ შესრულებულა Production-ის, რეალური ანგარიშის, Supabase query plan-ის, mobile/low-end მოწყობილობის, dark mode-ის ან ხანგრძლივი მრავალსაათიანი memory soak-ის ტესტი. Headless desktop-ის rAF მონაცემი perceived scrolling-ის სრული გარანტია არ არის. ნიმუშების მცირე რაოდენობა და საერთო Windows გარემო p95-ს ზღუდავს; არცერთი დასრულებული final-series outlier არ ამოგვიღია. Synthetic descriptions რეალურ მონაცემებზე უკეთ ან უარესად შეიძლება იკუმშებოდეს. UI readiness-ისთვის ორი frame-ის გამოყენება მცირე მოქმედებების მინიმალურ დროსაც ზრდის.

ავტომატური benchmark local-only fixtures-ს იყენებს. რეალურ Vercel Preview-ში ამ აუდიტის გასამეორებლად დიდი dictionary/History ან destructive მოქმედებები **არ გამოიყენოთ**. უსაფრთხო გამეორება ზემოთ მოცემული სკრიპტია.

ტექნიკური ცნობები: [Supabase inclusive range](https://supabase.com/docs/reference/javascript/range), [Chrome Performance counters](https://chromedevtools.github.io/devtools-protocol/tot/Performance/), [Chrome memory measurement caveats](https://developer.chrome.com/docs/devtools/memory-problems). დასკვნები ზემოთ აღწერილ კოდსა და ლოკალურ გაზომვებს ეყრდნობა.
