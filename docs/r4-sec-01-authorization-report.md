# R4-SEC-01 — ავტორიზაციისა და ანგარიშების იზოლაციის შემოწმება

საბაზისო commit: `cba14980d7aa449d8b4eac0d76b0500a2ea359f9` (PR #41).

## დასკვნა და საზღვრები

რეპოზიტორიის სრული, უცვლელი მიგრაციების ჯაჭვი შემოწმდა ნამდვილ,
იზოლირებულ PostgreSQL-ში. შემოწმებულ კონფიგურაციაში ანგარიშებს შორის
წაკითხვის, ცვლილების ან წაშლის ავტორიზაციის გვერდის ავლა არ დადასტურდა.
ეს დასკვნა **არ ადასტურებს Production-ის კონფიგურაციას**.

Issue 7A/7B თავიდან არ განხორციელებულა. Production-ზე კავშირი, SQL, Auth
მოთხოვნა, მონაცემთა ცვლილება ან migration-history-ის შეკეთება არ შესრულებულა.
`20261013211615_advance_word_updated_at.sql` გაეშვა მხოლოდ ახალ ლოკალურ
ბაზაში; Production-ზე მისი აქტიურობა არ ივარაუდება. ცალკე deployment
პროცედურა კვლავ [Supabase README-შია](../supabase/README.md).

## მეთოდი და გარემო

- Windows x64, Node 22.14.0, PostgreSQL **17.11**, loopback-ზე შემთხვევითი პორტი.
- ყოველი გაშვება ქმნის ახალ `initdb` cluster-ს OS temporary directory-ში;
  იღებს მხოლოდ `--pg-bin` არგუმენტს, არასოდეს DB URL-ს ან არსებულ target-ს.
  შლის მემკვიდრეობით `PG*` გარემოს პარამეტრებს, იყენებს `psql -X`, აშკარა
  host/port/user/database-ს; ბოლოს აჩერებს სერვერს. წარმატებული გაშვება შლის
  მხოლოდ თავის temporary directory-ს; წარუმატებელი ინახავს გაჩერებულ დიაგნოსტიკას.
- უცვლელად გამოიყენება `word-version/fixture.sql`; დამატებულია სინთეზური
  gateway role და `auth.uid()`-ის JSON/legacy subject კონტექსტი. საწყისი ფართო
  table/function grants განზრახ ამოწმებს, რომ მიგრაციები ზედმეტ უფლებებს აუქმებს.
  ეს fixture-ის დაშვებაა და არა hosted Supabase-ის სრული ასლი.
- მიგრაციები სრულდება postgres-ით; **ყოველი ჩვეულებრივი აპის probe** იწყება
  `authorization_gateway` კავშირით, `SET LOCAL ROLE anon/authenticated`-ით.
  ორივე იდენტობა `NOSUPERUSER/NOBYPASSRLS`-ია; ყოველ probe-ში ეს მოწმდება.
  `SET ROLE postgres/service_role` და `SET SESSION AUTHORIZATION postgres` უარყოფილია.
- ორი სინთეზური მომხმარებელი ფლობს ერთნაირად დაწერილ სიტყვებს, განსხვავებულ
  კერძო აღწერებს, ისტორიის შენახულ JSON დეტალებსა და პროფილებს. გვერდის ავლის
  მცდელობებში ხშირად განზრახ გამოტოვებულია frontend-ის owner filter.
- JWT ხელმოწერა აქ **არ მოწმდება**: ტესტი აწვდის gateway-ის უკვე მიღებულ
  subject-ს. A-ს კონტექსტით B-ს ID-ის მიწოდება RPC/SQL payload-ში ვერ ცვლის
  უფლებებს. თუ სანდო gateway თვითონ დააყენებს B-ს subject-ს, ბაზა B-დ მიიჩნევს
  მოთხოვნას — signing/expiry/HTTP authentication ცალკე საზღვარია.
- ძირითადი probes ტრანზაქციებს აბრუნებს; შედეგის row count/SQLSTATE მოწმდება
  rollback-მდე. დამატებით რეალურად COMMIT-დება პროფილის აღდგენა და account
  deletion მხოლოდ ცალკე disposable ასლებში; მეორე ანგარიშის სრული rows,
  timestamps და JSON ზუსტად შედარებულია ადმინისტრაციული oracle-ით.

## შემოწმებული აპის კონტრაქტები

`useWords.ts` იყენებს owner-scoped CRUD-ს, ნორმალიზებულ duplicate lookup-ს,
ორ Search RPC-ს და ძველი `updated_at`-ით UPDATE-ს. Practice/Test კითხულობს
owner-scoped სიტყვებს; History ინახება INSERT-ით სტაბილური UUID-ით, ხოლო
კონფლიქტის შემდეგ მოწმდება owner-scoped იგივე payload. History-ის UPDATE
არ არის ნებადართული. `History.tsx`-ის single/bulk DELETE-ები შეზღუდულია owner-ითა
და დადასტურებული ID-ებით. `UserProfile.tsx` იყენებს საკუთარი პროფილის upsert-ს.
Account deletion არის ნულარგუმენტიანი RPC, რომელიც `auth.uid()`-ს იღებს.

`AuthProvider.tsx` იყენებს SDK-ის `getSession`, `onAuthStateChange`, password
sign-in/sign-up, sign-out და email update-ს. ეს browser session-ს მართავს;
მონაცემებზე უფლებების დამოუკიდებელი დაცვა ბაზის RLS/GRANT-ებია. Browser-ში
გამოიყენება `VITE_SUPABASE_ANON_KEY`; Production-ის რეალური key/token ან მისი
კონფიგურაცია ამ სამუშაოსთვის არ წაკითხულა.

## ავტორიზაციის სრული მატრიცა

ქვემოთ „PASS“ ნიშნავს რეალურად შესრულებულ PostgreSQL probe-ს.
`0` ნიშნავს წარმატებულ SQL-ს **ნულოვანი ხილული/შეცვლილი rows-ით**, არა წაშლის
მტკიცებულებას. `42501` არის privilege/RLS უარყოფა; `23503` — FK დარღვევა;
`22P02` — არასწორი UUID; `23505` — primary-key კონფლიქტი.
ქცევის მტკიცებულება: [cases.mjs](../supabase/tests/authorization/cases.mjs),
სახელდებული `PASS` შედეგები runner-ის stdout-ში.

| ობიექტი / მოქმედება | საკუთარ ანგარიშზე მოსალოდნელი და მიღებული | სხვა ანგარიშზე მოსალოდნელი და მიღებული | მტკიცებულება |
|---|---|---|---|
| words SELECT, filter-ის გარეშეც | ყველა საკუთარი row; PASS | 0; PASS | `unfiltered SELECT`, `explicit other owner SELECT` — A და B |
| words INSERT | 1; ნორმალიზაცია და დამოუკიდებელი მნიშვნელობები მუშაობს; PASS | 42501; PASS | `own INSERT`, `normalization`, `repeated spelling`, `cross-owner INSERT` |
| words UPDATE | მხოლოდ საკუთარი rows; grammar დაცულია, version იზრდება; PASS | 0; PASS | `unfiltered UPDATE`, `cross-owner UPDATE`, `preserves grammar` |
| words ownership / upsert | საკუთარ row-ზე B-ს owner ვერ ინიშნება; PASS | სხვის ID-ზე takeover 42501; PASS | `cannot be transferred`, `Word upsert` |
| words DELETE / TRUNCATE | DELETE მხოლოდ საკუთარ rows-ს აბრუნებს; TRUNCATE 42501; PASS | DELETE 0; PASS | `unfiltered DELETE`, `cross-owner DELETE`, `TRUNCATE` |
| test_history SELECT / INSERT | საკუთარი სრული rows და INSERT 1; PASS | read 0 / insert 42501; PASS | იგივე table probes ორივე მომხმარებლისთვის |
| test_history UPDATE / ownership / upsert | ყველა UPDATE 42501; PASS | იგივე; PASS | `History UPDATE`, `owner reassignment`, `immutable History upsert` |
| test_history DELETE | საკუთარი IDs; mixed A+B selection შლის მხოლოდ caller-ის ID-ს; PASS | 0; PASS | `mixed confirmed History IDs`, `cross-owner DELETE` |
| History result ID collision | სხვა result-ს ვერ გადაწერს; 23505; PASS | conflict-recovery SELECT 0; PASS | `conflicting History ID`, `conflict recovery` |
| profiles SELECT / INSERT / upsert / UPDATE | საკუთარი profile; missing-profile INSERT და upsert მუშაობს; PASS | read/update 0; INSERT/upsert 42501; PASS | profile table probes და committed missing-profile case |
| profiles ownership / DELETE | owner reassignment 42501; direct DELETE 42501; PASS | იგივე; PASS | `cannot be transferred`, `profile DELETE` |
| search_words | სრული Word ზუსტად ემთხვევა row-ს; ASC/DESC/recent და fallback მუშაობს; PASS | `p_user_id=B` A-ს კონტექსტში: 0, ყველა sort; PASS | `Search ... other account argument`, `complete Word` |
| search_words_count | სწორი საკუთარი count; PASS | სხვისი count 0; PASS | `Search count own/other dictionary` |
| delete_user_account | caller-ის auth/profile/words/history იშლება COMMIT-ით; PASS | მეორე ანგარიში byte-equivalent JSON-ით უცვლელია; PASS | committed A და B deletion cases |
| delete RPC victim parameter | ასეთი overload არ არსებობს: 42883; PASS | B-ს არგუმენტით წაშლა შეუძლებელია; PASS | `no account deletion overload` |
| anon — ყველა table CRUD | 42501, subject-ის გარეშეც და ხელოვნურად მიწოდებული subject-ითაც; PASS | იგივე; PASS | `anon ... SELECT/INSERT/UPDATE/DELETE` |
| anon — სამი RPC | EXECUTE 42501; PASS | იგივე, subject-ის არსებობაც არ შველის; PASS | `anon ... RPC EXECUTE` |
| authenticated — subject არ არსებობს | reads/Search/count 0; INSERT/delete-account 42501; allowed UPDATE/DELETE 0; PASS | სხვა მონაცემები უცვლელია; PASS | `without subject`, `no subject` |
| უცნობი ან უკვე წაშლილი subject | reads 0; საკუთარი INSERT-ებიც FK 23503; PASS | სხვა ანგარიში უცვლელია; PASS | `unknown subject`, retained-subject checks after deletion |
| malformed subject | table reads/account deletion 22P02; PASS | ცვლილება არ არის; PASS | `malformed subject` |
| user_metadata-ში B / service_role | ownership ვერ იცვლება; PASS | B read 0; PASS | `user_metadata cannot grant other ownership` |
| trigger functions RPC | anon/authenticated EXECUTE 42501; PASS | escalation არ არის; PASS | `internal trigger RPC` |
| auth.users პირდაპირ / schema DDL / roles / RLS off | უარყოფილია; PASS | B უცვლელია; PASS | `cannot escalate`, `row_security=off` |
| თვითნებური GRANT | warning, ACL და ეფექტური უფლებები უცვლელია; PASS | anon ვერ იღებს SELECT-ს; PASS | `unprivileged GRANT` |

## კატალოგის მტკიცებულება და უარყოფითი კონტროლები

სამივე ცხრილი postgres-ის საკუთრებაა, RLS ჩართულია; FORCE RLS გამორთულია.
ჩვეულებრივი როლები არც owner არიან, არც bypass როლების წევრები. არსებობს
ზუსტად 10 permissive owner policy: profiles SELECT/INSERT/UPDATE, words ოთხივე
CRUD, History SELECT/INSERT/DELETE. UPDATE-ს აქვს `USING` და `WITH CHECK`.
words SELECT მხოლოდ authenticated-ს ეხება; დანარჩენი ისტორიული PUBLIC
policies შეზღუდულია owner predicate-ით და table ACL-ით — anon-ს წვდომა არ აქვს.

| ეფექტური უფლებები | anon | authenticated |
|---|---|---|
| words | არცერთი | SELECT, INSERT, UPDATE, DELETE |
| profiles | არცერთი | SELECT, INSERT, UPDATE |
| test_history | არცერთი | SELECT, INSERT, DELETE |
| TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, grant option | არცერთი | არცერთი |
| public/auth schema CREATE | არა | არა |
| search_words, search_words_count, delete_user_account EXECUTE | არა | კი |
| handle_new_user, set_english_word_norm, update_updated_at_column, advance_word_updated_at EXECUTE | არა | არა |

ეფექტური checks მოიცავს table/column ACL-ს, PUBLIC-სა და inherited უფლებებს.
სამივე FK არის validated, non-deferrable, `auth.users(id) ON DELETE CASCADE`.
ოთხი მოსალოდნელი trigger ჩართულია: ახალი მომხმარებლის პროფილი,
ნორმალიზაცია, profile timestamp და word timestamp.

ზუსტად შვიდი public function-იდან მხოლოდ `handle_new_user` და
`delete_user_account` არის postgres-owned SECURITY DEFINER; ორივეს აქვს
ცარიელი search_path და schema-qualified მიმართვები. Search-ები SECURITY
INVOKER-ია. Delete ტესტი caller-ის `pg_temp` shadow tables/search_path-საც
იყენებს და მაინც მხოლოდ სწორ სრულად მითითებულ ცხრილებზე მოქმედებს.

ცალკე disposable ასლებში განზრახ გაფუჭებული **ცხრა** კონფიგურაცია დაფიქსირდა:
PUBLIC table grant, inherited forbidden table grant, column-only grant, grant
option, PUBLIC function EXECUTE, inherited trigger-function EXECUTE, RLS off,
დამატებითი ფართო SELECT policy და Search SECURITY DEFINER. ბოლო სამ შემთხვევაში
რეალური A probe-ით B-ს ორი row ხილული გახდა **მხოლოდ გაფუჭებულ ასლში**; კატალოგის
შემოწმება ამას უარყოფს. ეს harness-ის მგრძნობელობის მტკიცებულებაა და არა
უცვლელ რეპოზიტორიაში ან Production-ში ნაპოვნი ხარვეზი.

## სიმძიმის მიხედვით შედეგები

**Critical / High / Medium:** შემოწმებულ სრულ migration chain-ში დადასტურებული
cross-account bypass ან ეფექტური ზედმეტი აპის უფლება არ გამოვლენილა.
Production-ის სავარაუდო drift-ს დადასტურებულ Medium finding-ად არ ვასაღებთ.

**Low — L1, hardening:** `set_english_word_norm()`
(`20261006183000_allow_word_meanings.sql`) და `update_updated_at_column()`
(`20240619000000_initial_app_schema.sql`) არ აფიქსირებს search_path-ს.
კატალოგში `proconfig=NULL`; ისინი INVOKER-ია და აპის EXECUTE აკრძალულია.
უფლების ესკალაცია არ დადასტურდა. სურვილის შემთხვევაში ცალკე forward migration-მა
შეიძლება დააფიქსიროს search_path და schema-qualified built-ins, trigger-ის
ქცევის შესაბამისი ტესტებით. ამ PR-ში არც ფუნქციები, არც მიგრაციები არ შეცვლილა.

**Low — L2, შეზღუდული არსებობის სიგნალი:** `test_history_pkey`-ს ცნობილ B UUID-ზე
A-owned INSERT აბრუნებს `23505`-ს; B payload-ის SELECT მაინც 0-ია და B უცვლელია.
რეპროდუქცია: `conflicting History ID` A/B probes. ეს PostgreSQL unique/FK
integrity checks-ის RLS-ს მიღმა მოქმედების შედეგია; იცავს overwrite-ისგან,
მაგრამ უკვე ცნობილი/გამოცნობილი UUID-ის არსებობას აჩენს. მგრძნობიარე/გამოცნობადი
ID-ები არ უნდა გამოიყენებოდეს; თუ existence hiding მოთხოვნა გახდება, ცალკე
განხილვას საჭიროებს write API/error contract. აქ არ იცვლება result identity
ან არსებული უსაფრთხო conflict recovery.

**Unverified — U1:** Production RLS, roles, inherited/PUBLIC/column grants,
function owners/bodies/overloads/search_path, extra views/functions, FK/trigger
drift, defaults და word-version deployment. რეპოზიტორიის README აღწერს ხელით
გამოყენებულ Issue 7A-ს და ledger-ის არქონას; ეს ისტორიული ცნობა ამ აუდიტში
ცოცხალი გარემოთი არ გადამოწმებულა.

**Unverified — U2:** hosted Auth/JWT signature, expiry, refresh/revocation,
PostgREST exposure/role switching, Storage/Realtime/სხვა extension ობიექტები,
რეალური project key ტიპი და გარემოს კონფიგურაცია. Synthetic auth fixture
`auth.users(id)`-ზე მეტ hosted Auth ქცევას არ წარმოადგენს. Account deletion-ის
შემდეგ retained subject-ის database isolation შემოწმდა; JWT-ის კრიპტოგრაფიული
გაუქმება არ შემოწმებულა და ასეთი დასკვნა არ კეთდება.

## განმეორების ინსტრუქცია

საჭიროა Node >=20 და PostgreSQL **17**-ის `initdb`, `pg_ctl`, `psql` ბინარები
ჩვეულებრივი OS მომხმარებლისთვის. Windows-ზე portable დისტრიბუციის bin/lib/share
ერთად უნდა იყოს; Linux-ზე initdb root-ით არ გაუშვათ. ახალი npm dependency არ არის.
Loopback trust cluster შეიცავს მხოლოდ სინთეზურ მონაცემებს; გაუშვით პირად,
არასაზიარო development გარემოში.

```powershell
node supabase/tests/authorization/run.mjs --pg-bin C:/path/to/pgsql/bin
node supabase/tests/word-version/run.mjs --pg-bin C:/path/to/pgsql/bin
```

Linux/macOS-ზე იგივე `--pg-bin /usr/lib/postgresql/17/bin`, ან არგუმენტის გარეშე,
თუ server binaries PATH-ზეა. Runner ბეჭდავს PostgreSQL ვერსიას, თითოეული
მიგრაციის SHA-256-სა და სახელდებულ PASS-ებს; ნებისმიერი შეუსაბამობა exit 1-ია.
ეს standalone PostgreSQL suite **არ ემატება არსებულ GitHub Actions-ს**.

```sh
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

### შესრულებული ვალიდაცია

| შემოწმება | რეალური შედეგი |
|---|---|
| ახალი PostgreSQL authorization suite | **200/200 PASS**, საბოლოო განმეორებით გაშვებაშიც, grant-option checks-ის დამატების შემდეგ |
| უცვლელი word-version suite | **30/30 PASS**, რეალური transaction/concurrent-connection და drift/rollback checks-ის ჩათვლით |
| `pnpm exec tsc -b` | PASS, 0 TypeScript error |
| `pnpm lint` | PASS, 0 error / 0 warning |
| `pnpm test` | **698/704 PASS**, 6 timeout, 0 skipped; 33 file, 150.88 წამი |
| ორი დაზარალებული ფაილის ახალი-process rerun | **168/168 PASS**, 0 skipped; 69.44 წამი; იგივე timeouts/workers |
| `pnpm build` | PASS; Vite 8.12 წამი; არსებული >500 kB chunk warning (517.01 kB JS) |
| `node --check` ორივე ახალ `.mjs`-ზე | PASS |
| `git diff --check` / staged diff check | PASS |

სრული frontend გაშვების ექვსი შეცდომა ყველა `Test timed out in 5000ms` იყო:
`History.pagination.test.tsx` — load 2000/2001 და date ASC/DESC sort 2001
(4 შემთხვევა); `words/useWords.test.ts` — installed SDK exact UPDATE/DELETE
count contract (2 შემთხვევა). მონაცემების assertion mismatch არ დაფიქსირებულა.
ეს ფაილები, production code, test setup, timeouts, workers, dependencies და
CI უცვლელია. შემდგომი წარმატებული rerun ვერ გააუქმებს სრულ გაშვებაში timeout-ის
ფაქტს; მათი საბოლოო მიზეზის გამოსწორება ამ უსაფრთხოების PR-ის ნაწილი არ არის.
სრულ გაშვებაში გამოჩნდა არსებული mocked `Multiple GoTrueClient instances` გაფრთხილება.

Harness-ის შემუშავებისას ორი ადრეული გაშვება შეწყდა მისივე შესასწორებელი
მოლოდინებით: `pg_ctl`-ის ignored stdout `null` იყო; მოგვიანებით unprivileged
GRANT-ზე მოსალოდნელი error-ის ნაცვლად PostgreSQL-მა warning და უცვლელი ACL
დააბრუნა. ორივე გასწორდა runner/test-ში და საბოლოო suite სრულად გაიარა;
აპის ავტორიზაციის დარღვევად არც ერთი არ კლასიფიცირდება.

GitHub Actions-ის საბოლოო head-ის სტატუსი და run URL მითითებულია PR-ის
აღწერასა და სამუშაოს საბოლოო პასუხში. არსებული Quality workflow PostgreSQL
suite-ს არ უშვებს; მისი შედეგი ლოკალური რეალური database evidence-ია, CI-ის
მწვანე სტატუსი კი ცალკე frontend install/typecheck/lint/test/build evidence.

## შეცვლილი ფაილები

| ფაილი | დანიშნულება |
|---|---|
| `supabase/tests/authorization/run.mjs` | უსაფრთხო disposable cluster, სრული მიგრაციების ჯაჭვი და რეალური როლებით probes |
| `supabase/tests/authorization/fixture.sql` | არსებული fixture-ის გამოყენება, gateway/JWT context და grants |
| `supabase/tests/authorization/cases.mjs` | authorization matrix, committed deletion/oracle და negative controls |
| `supabase/tests/authorization/production-metadata-readonly.sql` | ცალკე owner approval-ისთვის metadata-only inspection |
| `docs/r4-sec-01-authorization-report.md` | ეს ანგარიში, მატრიცა, წყაროები და განმეორების ინსტრუქცია |
| `supabase/README.md` | ახალ ტესტებსა და ანგარიშზე ბმულები |

## ცალკე ნებართვის შემდეგ Production metadata შემოწმება

მომზადებულია [production-metadata-readonly.sql](../supabase/tests/authorization/production-metadata-readonly.sql):
მხოლოდ catalog SELECT-ები `BEGIN READ ONLY`/ROLLBACK-ში, მოკლე lock/statement
ზღვრებით; არ კითხულობს აპის rows-ს, passwords-ს ან JWT-ებს და არ იძახებს RPC-ს.
მისი სინტაქსი მოწმდება **მხოლოდ ლოკალურ fixture-ზე**. განკუთვნილია PostgreSQL 17-ისთვის;
სხვა major version-ის შემთხვევაში ჯერ შესაბამისობა უნდა შემოწმდეს.

შემდეგი ეტაპი საჭიროებს owner-ის ცალკე, აშკარა თანხმობას და target-ის დამოუკიდებელ
დადასტურებას. Owner-მა metadata უნდა შეადაროს ზემოთ მოცემულ მატრიცას, გადახედოს
ყველა დამატებით public object-სა და role membership-ს; schema exposure/Auth
პარამეტრები ცალკე შეამოწმოს, რადგან catalog-ში `pgrst.*` პარამეტრების არქონა
არაფერს ამტკიცებს. შედეგებში შესაძლოა function body-ების შიდა დეტალები იყოს —
შეინახეთ კერძოდ. შეუსაბამობისას არაფერი „შეაკეთოთ“ ავტომატურად: მოამზადეთ
ცალკე მიზნობრივი remediation PR/forward migration და deployment review.
Hosted ფუნქციური destructive ტესტი ამ metadata ნებართვის ნაწილიც არ არის.

## ოფიციალური წყაროები

- [PostgreSQL RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html): owner/bypass როლები, policies და constraint-ის არსებობის სიგნალები.
- [PostgreSQL privilege inspection](https://www.postgresql.org/docs/17/functions-info.html): effective grants, memberships და ACL inspection.
- [PostgreSQL function security](https://www.postgresql.org/docs/17/sql-createfunction.html): definer, search_path და PUBLIC EXECUTE.
- [Supabase functions](https://supabase.com/docs/guides/database/functions) და [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): owner predicate და function exposure.
- [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data): account deletion არ ნიშნავს არსებული JWT-ის დაუყოვნებლივ გაუქმებას.
- 2026-10-18-ზე გადამოწმებული [changelog](https://supabase.com/changelog): [17.11 security update](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) და [HTTP TLS ცვლილება](https://supabase.com/changelog/cbc-tls-ciphers-deprecated). ტესტები იყენებს 17.11-ს; ჩამოთვლილი extension/custom-operator და hosted TLS ცვლილებები ამ ლოკალურ fixture-ს არ ეხება.
