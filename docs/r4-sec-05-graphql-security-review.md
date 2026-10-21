# R4-SEC-05 — GraphQL dependency audit and retirement plan

Date: 2026-10-21. Audited base: [`ca165edfdc753de2a2c9d4ffca376e06fdd47aa0`](https://github.com/AvtandilKakulia/vocabulary-learning-app/commit/ca165edfdc753de2a2c9d4ffca376e06fdd47aa0), latest `main` after PR #44 / R4-SEC-04.

**Decision: the application in this repository does not require `pg_graphql`.** All identified remote application operations use Supabase Auth or PostgREST, including SQL RPCs. No GraphQL client, document, endpoint, resolver invocation, subscription or indirect SQL dependency was found. This supports a separately approved retirement of the unused GraphQL surface, subject to the operator gates below.

**Status: audit and documentation only; retirement has NOT been performed.** No hosted database connection, credentials, SQL execution, extension toggle, deployment or Production modification was used in this task. No application, dependency, test, CI, migration, RLS, grant or migration-ledger changes are proposed. Approval of this documentation PR is not approval to disable Production GraphQL.

## Evidence boundaries

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| All 139 tracked files at the base commit; application call sites, import graph, lockfile, SQL and configuration review | No repository implementation depends on GraphQL; see the inventory and matrix below | Absence of external tools, old deployed clients, unpublished scripts, hosted jobs or manually created SQL callers |
| Owner's independent Production inspection, supplied with this task | PG 17.11; `pg_graphql` 1.6.2 in `graphql`, owned by `supabase_admin`; normal `postgres` is neither superuser nor a member of that owner role | Fresh deployment-time metadata or permission to perform hosted operations |
| Owner's dependency inspection | No direct external PostgreSQL object dependencies or dependent extensions were found | Future drift, textual/dynamic SQL calls or consumers outside PostgreSQL's dependency graph |
| Owner's RLS/privilege inspection | `words`, `profiles`, `test_history` have RLS; `anon` lacks table SELECT; `authenticated` has required SELECT under owner policies | Proof from the advisor warning alone that every possible access path is safe |
| Owner's available preceding 24-hour API logs | No `/graphql/v1` request was observed in that window | Historical non-use, inactive integrations, longer schedules or direct SQL calls to `graphql.resolve` |
| Existing isolated regression suites | Application authorization/version behavior without an installed `pg_graphql` extension, and mocked frontend behavior | Hosted GraphQL disable/re-enable behavior, gateway routing, live JWT verification or the actual Dashboard's permissions |

The owner also reports R4-SEC-04 already deployed, no trusted Production migration-history ledger, and a selective logical backup of `public`, `auth` and `storage`. These are supplied facts, not checks repeated by this audit. The backup is not a complete extension rollback.

## Repository audit and reproduction

Search the immutable base so this report's new GraphQL references do not contaminate the result. Run each command separately; `git grep` exit code 1 means no match, not a failed audit command.

```sh
git ls-tree -r --name-only ca165edfdc753de2a2c9d4ffca376e06fdd47aa0
git grep -n -i -E 'graphql|apollo|urql|relay|\.gql|graphql-ws|graphql-request' ca165edfdc753de2a2c9d4ffca376e06fdd47aa0
git ls-tree -r --name-only ca165edfdc753de2a2c9d4ffca376e06fdd47aa0 -- '*.graphql' '*.gql'
git grep -n -E '\.(from|rpc|auth|channel|functions|storage)\b|fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\(|require\(' ca165edfdc753de2a2c9d4ffca376e06fdd47aa0 -- src scripts
```

The GraphQL content and document-name searches returned no matches. The broader network/import search was traced to the call sites below, rather than treating a keyword search alone as proof.

| Surface inspected | Evidence and finding |
| --- | --- |
| Client initialization | [`src/lib/supabase.ts`](../src/lib/supabase.ts), `createClient(supabaseUrl, supabaseAnonKey)`, uses the two documented Vite variables with no custom transport, GraphQL adapter or alternate endpoint. Only `.env.example` was inspected; no secret files or hosted settings were read. |
| Direct and transitive packages | [`package.json`](../package.json) and [`pnpm-lock.yaml`](../pnpm-lock.yaml): locked Supabase JS 2.83.0 with Auth, PostgREST, Functions, Realtime and Storage subclients. No GraphQL/Apollo/urql/Relay package or code generator. Realtime's `ws`/Phoenix dependencies do not imply GraphQL subscriptions. |
| SDK transport cross-check | Installed, lockfile-matching `@supabase/supabase-js/src/SupabaseClient.ts`: constructor sets `auth/v1` and a `PostgrestClient` at `rest/v1`; `from()` delegates to `this.rest.from()` and `rpc()` to `this.rest.rpc()`. This agrees with the official [REST API architecture](https://supabase.com/docs/guides/api). Supabase JS does not silently translate these calls into GraphQL. |
| UI, hooks and contexts | All `src` imports and remote access sites reviewed. Auth is in `AuthProvider`; database access is in `App`, `UserProfile`, `useWords`, `FreeMode`, `TestMode`, `History`, `practiceSaves`. UI/modals call these helpers. No application raw HTTP client, dynamic network import, GraphQL endpoint construction, Realtime channel or subscription call was found. |
| Browser-only coordination | [`practiceOwnership.ts`](../src/lib/practiceOwnership.ts) uses native Web Locks and `BroadcastChannel`; session/preference helpers use localStorage. Auth's `onAuthStateChange` is an Auth subscription. None is a GraphQL subscription. |
| SQL | All eight files in [`supabase/migrations`](../supabase/migrations), [`operations/rollback_word_version.sql`](../supabase/operations/rollback_word_version.sql), both PostgreSQL fixtures/runners and SQL assertions contain no GraphQL reference. Final functions and their dependencies are listed below. Migration dynamic SQL formats grants/FKs, not remote requests or GraphQL calls. |
| Test and browser tooling | [`src/test/setup.ts`](../src/test/setup.ts) rejects real Supabase initialization and unexpected fetch/XHR/WebSocket use. Frontend tests mock Auth/PostgREST boundaries. [`scripts/history-benchmark/run.mjs`](../scripts/history-benchmark/run.mjs) injects a same-origin synthetic client restricted to GET `/rest/v1/test_history`; Practice browser harnesses inject in-memory `from()` mocks. Their WebSocket/fetch calls control local Chrome through CDP. PostgreSQL runners create disposable loopback clusters. |
| Build/deployment/configuration | [`index.html`](../index.html) loads only `src/main.tsx`; [`vite.config.ts`](../vite.config.ts) uses React, local aliases and a development-only source identifier plugin. Package scripts, TypeScript, ESLint, Vitest, Tailwind/PostCSS, workspace configuration, README/docs and [Quality workflow](../.github/workflows/quality.yml) contain no GraphQL integration or deployment step. No tracked Vercel/Netlify routing file, Supabase `config.toml`, Edge Function or separate backend was found. Hosted settings and ignored/untracked assets are outside this repository evidence. |

### Functional dependency matrix

“Unaffected” below is a code-based expectation assuming **only** the extension is disabled and the preflight confirms no unexpected dependencies. It is not a claim that hosted smoke tests ran.

| Feature | Actual path / relevant functions | Mechanism | Expected effect of retiring `pg_graphql` |
| --- | --- | --- | --- |
| Sign-in, sign-up, session recovery and sign-out | [`AuthPage.handleSubmit`](../src/components/AuthPage.tsx); [`AuthProvider`](../src/contexts/AuthProvider.tsx): `signInWithPassword`, `signUp`, `getSession`, `onAuthStateChange`, `signOut` | Auth (`/auth/v1`); signup triggers SQL profile creation | Unaffected: Auth calls and `handle_new_user()` do not call GraphQL. |
| Word listing, sort and pagination | [`useWords.loadWordsForContext`](../src/components/words/useWords.ts): `from('words').select(...).eq(...).order(...).range(...)` | PostgREST `/rest/v1/words` | Unaffected; full records/counts, filters and pagination remain REST operations. |
| Word search/count | Same function: `rpc('search_words', ...)`, `rpc('search_words_count', ...)` | PostgREST `/rest/v1/rpc/...`, then SECURITY INVOKER SQL | Unaffected: RPC means a SQL function exposed by PostgREST, not a GraphQL resolver. Both query `public.words` under RLS. |
| Word CRUD and duplicate lookup | `useWords.addWord`, `updateWord`, `deleteWord`, `bulkDeleteWords`, `checkExistingEnglishWords` | PostgREST insert/update/delete/select | Unaffected; owner filters, exact version comparison, normalized lookup and triggers are independent of GraphQL. |
| Practice dictionary, progress and results | [`FreeMode.loadWords`](../src/components/FreeMode.tsx); [`savePracticeResult`](../src/lib/practiceSaves.ts) | Batched PostgREST word reads; History insert and ID/payload reconciliation; browser persistence/locks | Unaffected; complete retrieval, retry identity, checkpoint cleanup and cross-tab coordination do not invoke GraphQL. |
| Test dictionary, questions and results | [`AccountTestMode.startTest`, `saveTestResult`](../src/components/TestMode.tsx) | Batched PostgREST word reads, History insert and conflict lookup; local frozen-session recovery | Unaffected; question/distractor generation, restored sessions and save idempotency are client/REST behavior. |
| History reads, statistics, filters and UI pages | [`History.loadHistoryForContext`](../src/components/History.tsx) | PostgREST batches with exact count; client filtering/sorting/statistics/pagination | Unaffected; no GraphQL query or connection-style pagination. |
| History single/bulk deletion and refresh | `History.deleteHistory`, `bulkDeleteHistory`; [`historyDeletion.ts`](../src/lib/historyDeletion.ts) | User-scoped PostgREST DELETE; bulk batches of 100 confirmed IDs and authoritative REST reload | Unaffected; confirmations, selection bounds, partial-failure handling and shared busy state remain intact. |
| Profile display/read/update | [`AppContent.loadDisplayName`](../src/App.tsx); [`UserProfile.loadProfile`, `handleSave`](../src/components/UserProfile.tsx) | PostgREST profile SELECT/upsert; email changes through Auth `updateUser` | Unaffected; profile timestamp trigger is ordinary SQL, with the R4-SEC-04 fixed search path. |
| Account deletion | [`DeleteAccountModal.handleDelete`](../src/components/UserProfile.tsx); also `AuthProvider.deleteAccount` | PostgREST `rpc('delete_user_account')` | Unaffected: zero-argument SECURITY DEFINER function derives caller from `auth.uid()`, deletes that account's records/auth user; no GraphQL dependency. |

The seven final `public` functions are `search_words`, `search_words_count`, `delete_user_account`, `handle_new_user`, `set_english_word_norm`, `update_updated_at_column`, `advance_word_updated_at`. Search/account/profile definitions are finalized in [security reconciliation](../supabase/migrations/20261007234000_security_schema_reconciliation.sql); normalization in [independent meanings](../supabase/migrations/20261006183000_allow_word_meanings.sql); strict word versions in [R3-A01](../supabase/migrations/20261013211615_advance_word_updated_at.sql); the two remaining search paths in [R4-SEC-04](../supabase/migrations/20261020175702_harden_trigger_function_search_paths.sql). Their bodies use application tables, `auth.uid()` and built-in PostgreSQL functions. None calls an extension-owned GraphQL object. Trigger bindings are ordinary database dependencies, independent of how an update arrived.

## Security interpretation and supported operations

The official [0027 advisor guidance](https://supabase.com/docs/guides/observability/advisors?lint=0027_pg_graphql_authenticated_table_exposed) flags authenticated-readable relations when GraphQL is installed and recommends disabling unused GraphQL. It describes schema discoverability; it is not evidence of cross-account row disclosure. Its general introspection wording must be read alongside the version-specific behavior below.

In [pg_graphql 1.6.0+](https://supabase.com/changelog/46320-breaking-change-in-pg-graphql-1-6-0-graphql-introspection-disabled-by-default), introspection is disabled by default, including the owner's reported 1.6.2. Actual per-schema directives can override that default. Disabled introspection does **not** disable ordinary queries/mutations. [GraphQL security](https://supabase.com/docs/guides/graphql/security) distinguishes role-controlled schema visibility from RLS-controlled row access. Retiring an unused endpoint reduces exposure, but does not replace RLS or the authorization tests.

The three application tables need authenticated SELECT for their REST features. **Keep those grants and all RLS policies unchanged.** Revoking them merely to clear this warning would break the application. No resolver grant changes, ownership changes or alternative suppression are proposed.

PostgreSQL [DROP EXTENSION](https://www.postgresql.org/docs/17/sql-dropextension.html) requires ownership. `RESTRICT` is the default and blocks ordinary dependent objects; it still removes extension members and explicitly extension-dependent routines. In [`pg_depend`](https://www.postgresql.org/docs/17/catalog-pg-depend.html), `e` means extension membership, while `x` denotes a non-member auto-dependent object. Consequently, “RESTRICT succeeds” alone is not proof that nothing else will be removed. Inspect all dependency types and object identities first. Catalog checks also cannot detect every dynamic/textual SQL reference or external HTTP client.

The reported `postgres` privileges do not authorize assuming it can drop a `supabase_admin`-owned extension. Supabase [does not grant normal users superuser access](https://supabase.com/docs/guides/database/postgres/roles-superuser). Use the documented [Dashboard extension controls](https://supabase.com/docs/guides/database/extensions). If the supported interface refuses permission or cannot perform the safe operation, stop and ask Supabase Support for the supported owner-level path. Do not impersonate `supabase_admin`, change ownership, elevate roles or bypass platform restrictions. Do not use `DROP EXTENSION CASCADE` or a UI cascade option.

## Separately approved operator procedure — not executed

### 1. Approval and recovery readiness

1. Obtain explicit Production owner approval for **this project's** GraphQL retirement and the intended maintenance window. Name the operator, rollback decision-maker and observation period. This report grants no hosted access.
2. Confirm no external GraphQL consumers with the owner: other repositories, mobile/older clients, reporting jobs, GraphiQL/codegen tools, integrations and direct SQL consumers. Review the longest available `/graphql/v1` log window and any scheduled workload inventory. The supplied 24-hour absence is supporting evidence only. A real dependency or unresolved owner concern blocks retirement.
3. Agree on recovery before proceeding. Confirm the supported Dashboard re-enable route, currently available/default version, metadata capture and a Support escalation path. If exact 1.6.2 behavior is required but cannot be restored through supported means, stop. The selective logical backup does not guarantee restoration of extension binaries, members, owners, ACLs, comments or platform configuration.
4. Use a quiet window and serialize relevant schema/configuration changes. DDL can wait on object locks or active GraphQL work; no zero-downtime guarantee is made. Do not cancel unrelated user sessions, change global timeouts or repeatedly retry a hanging toggle. An ambiguous result requires metadata inspection before any further action.

### 2. Fresh read-only preflight and baseline

Only the approved operator performs these hosted reads later. Store outputs privately; do not put credentials, JWTs, user content or personal data in the PR.

- Reconfirm extension name, version, schema, owner and dependencies immediately before the window. Review membership as well as incoming references to the extension **and its member objects**, including `x`/automatic dependencies, dependent extensions, custom wrappers, views, functions and event triggers. Identify the expected extension-owned objects; any application object among them or any unexplained external dependency is a stop condition. Inspect function definitions for textual/dynamic calls separately.
- Capture configuration beyond `pg_extension`: schema/table/column/function comments with `@graphql` directives (including actual `introspection`, `inflect_names`, row limits and naming overrides), member function definitions/configuration/ACLs, relevant schema ACLs, role/database settings, and any `graphql_public` gateway wrapper/configuration if present. `extconfig` is a dump-configuration table list, **not** a complete GraphQL-settings snapshot. Use the [configuration documentation](https://supabase.com/docs/guides/graphql/configuration) to interpret directives; do not replace existing comments.
- Use the existing [read-only metadata inventory](../supabase/tests/authorization/production-metadata-readonly.sql), after owner target approval, to capture table owners/definitions, RLS flags/policies, effective/column/inherited privileges, RPC definitions, triggers and role settings. Preserve R4-SEC-04's empty search paths and the strict word-version trigger. Record exact aggregate counts for `words`, `profiles`, `test_history` with an authorized read-only snapshot. Counts should be taken before smoke-test writes and compared in a quiet window; explain legitimate concurrent changes rather than silently accepting differences. Counts alone do not prove unchanged row content: retain an owner-approved backup or private content comparison for incident investigation.
- Baseline expectations: all three tables RLS-enabled; anon SELECT false; authenticated required SELECT true; existing ownership predicates and mutation privileges unchanged. Retain the three advisor findings and baseline app smoke results. No migration-ledger creation/adoption/repair.

These optional **read-only** SQL snippets document metadata collection. They were not run on hosted databases. Run in an error-stopping client; on any failure roll back/disconnect and review. They complement, rather than replace, the complete inventory above.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL search_path = pg_catalog;

SELECT e.oid, e.extname, e.extversion, n.nspname AS schema,
       pg_get_userbyid(e.extowner) AS owner, e.extrelocatable,
       e.extconfig, e.extcondition
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_graphql';

SELECT name, default_version, installed_version
FROM pg_available_extensions WHERE name = 'pg_graphql';

-- Membership and explicitly attached auto-dependencies (do not discard 'x').
SELECT d.deptype, pg_describe_object(d.classid, d.objid, d.objsubid) AS object
FROM pg_depend d JOIN pg_extension e
  ON d.refclassid = 'pg_extension'::regclass AND d.refobjid = e.oid
WHERE e.extname = 'pg_graphql'
ORDER BY d.deptype, object;

-- Direct incoming references to the extension and its members.
-- Includes internal edges for classification; NOT a list of only blockers.
WITH extension AS (
  SELECT oid FROM pg_extension WHERE extname = 'pg_graphql'
), targets AS (
  SELECT 'pg_extension'::regclass AS classid, oid AS objid FROM extension
  UNION
  SELECT d.classid, d.objid FROM pg_depend d JOIN extension e
    ON d.refclassid = 'pg_extension'::regclass AND d.refobjid = e.oid
  WHERE d.deptype = 'e'
)
SELECT DISTINCT d.deptype,
       pg_describe_object(d.classid, d.objid, d.objsubid) AS dependent,
       pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid) AS referenced
FROM pg_depend d JOIN targets t
  ON d.refclassid = t.classid AND d.refobjid = t.objid
ORDER BY dependent, referenced, d.deptype;
ROLLBACK;
```

Expected extension metadata is the owner-supplied `1.6.2 / graphql / supabase_admin`; any drift needs review. The direct-edge query deliberately returns internal members too and is **not** a recursive proof of safety: inspect each object and any further dependents, especially auto-dependent chains. Absence of catalog edges cannot establish absence of textual/dynamic SQL or external consumers. Do not test-drop the live extension, even inside a transaction.

### 3. Supported manual disablement

1. After every gate passes and approval is recorded, open **Supabase Dashboard → Database → Extensions → pg_graphql** in the explicitly confirmed project.
2. Review the current toggle/confirmation and disable only `pg_graphql` through that supported interface. Do not accept cascading removal. If the interface's behavior is unclear, or it requests removal of other objects, stop for Support clarification. This audit has not verified the hosted UI's internal SQL or effective execution role.
3. If the operation fails because of ownership, dependencies, locking or platform restrictions, retain the error and inspect the actual state. Do not fall back to privileged SQL, drop dependencies, alter grants, or repeat an uncertain destructive action.

### 4. Post-change acceptance checks

Before allowing smoke-test writes, repeat the metadata/count baseline. The `pg_extension` query must return **zero rows** for `pg_graphql`; the Dashboard must show it disabled. Application tables, records, RLS flags/policies, required privileges, functions and trigger bindings must be unchanged. Expected differences are limited to the approved extension/member removal and associated platform-managed GraphQL surface; investigate any other difference.

Rerun Security Advisor and confirm the three `0027_pg_graphql_authenticated_table_exposed` findings for `words`, `profiles`, `test_history` disappear. Do not promise all other advisor findings disappear. A stale warning should prompt a fresh check and metadata inspection, not permission changes. The GraphQL endpoint must no longer serve the generated schema/data API; do not prescribe a particular HTTP status, which may depend on the platform gateway.

Run the following smoke checks with separately approved disposable test accounts/fixtures, comparing to the pre-change baseline. Never delete real user records to test retirement. Inspect browser requests for Auth and `/rest/v1`/RPC behavior without recording tokens. Use a second test account to verify isolation.

| Area | Expected result |
| --- | --- |
| Auth | Sign up a designated disposable account (including normal email confirmation), sign in/out and reload session; profile creation succeeds. |
| Words | List, sort, page, search English/Georgian and compare counts; add/edit/delete only labelled disposable words. Preserve irregular forms and description. Concurrent edits still reject an old version. |
| Practice | Load full dictionary, answer, navigate/reload, switch ownership between test tabs, finish/save once; saved History row and browser cleanup behave as before. |
| Test | Start text-input and multiple-choice sessions in both directions, restore a draft, complete/save once; questions/options and History payload persist. |
| History | Load full list, filter/sort/page, expand saved mistakes; single/bulk deletion only of explicitly confirmed disposable fixtures, with accurate refresh/statistics. |
| Profile | Read/update a disposable account's display name; test email change only with an owner-controlled address and normal confirmation. |
| Account deletion | Only if separately approved, delete the designated disposable account through the existing confirmation; its records disappear and the second account remains intact. Never invoke this on the owner's account. |

Observe Auth/REST errors and `/graphql/v1` traffic for the agreed period, ideally covering known scheduled integrations. A previously unknown consumer is an incident/rollback decision, not evidence that table SELECT should be revoked. Record results and exact times; retire the change only after the owner accepts them.

### 5. Separate rollback / recovery

If a consumer breaks or verification fails, the owner decides whether to re-enable. Use **Dashboard → Database → Extensions → pg_graphql → enable**, through the supported interface. If unavailable, denied, blocked by residual objects or incompatible with the required version, stop and escalate to Supabase Support. Do not manually reconstruct platform-owned wrappers, force ownership, broaden ACLs or use CASCADE.

Re-read installed version/schema/owner, member definitions, resolver/wrapper bindings, privileges and saved configuration. Supabase's [version-pinning change](https://supabase.com/changelog/extension-version-pinning-ignored), effective 2026-08-05, means requesting a previous version is not a reliable rollback mechanism: creation/update uses the instance's default version for ordinary roles. Re-enabling is not guaranteed to restore 1.6.2, object OIDs or every setting. Compare actual results with the baseline before restoring any reviewed customization through supported, separately approved steps. Do not automatically turn on introspection or replay grants/comments.

Verify the affected external consumer, all application smoke checks and account isolation again. The three advisor findings may legitimately return when the extension is re-enabled; do not suppress them by breaking app privileges. If data or unrelated metadata differs, preserve evidence and use a separately reviewed incident recovery plan; an extension toggle will not restore deleted data. The selective `public`/`auth`/`storage` backup must not be blindly restored over live data as an extension rollback.

## Validation and limits

Executed locally on 2026-10-21 with Windows/PowerShell, Node 24.22.0, repository-pinned pnpm 10.34.6 and portable PostgreSQL 17.11. Each suite passed on its first run; no assertion, timeout, worker or count contract was changed.

| Check | Actual result |
| --- | --- |
| `pnpm exec tsc -b` | Passed; zero TypeScript errors |
| `pnpm lint` | Passed; zero ESLint errors/warnings |
| `pnpm test` (default plus JSON reporters) | 704/704 tests in 33 files; 0 failed, 0 skipped; 77.12 seconds |
| PostgreSQL Authorization | 200/200 check groups, including full-chain/search-path regression checks; non-bypassing application probes |
| PostgreSQL Word Version | 30/30 check groups, including real concurrent connections and rollback/negative cases |
| `pnpm build` | Passed; Vite build 8.21 seconds |
| `git diff --check` / staged diff review | Passed; only this new Markdown report changed |

Existing warnings remain: the SDK transport regression test reports multiple GoTrueClient instances in its mocked browser context, and Vite reports a 517.01 kB minified chunk exceeding 500 kB. No failures or intermittent retries occurred. Logs/JSON were retained locally under ignored `tmp/r4-sec-05/`, not committed. The PR description records the actual GitHub Actions run URL and results for `quality` and `PostgreSQL integration`; those hosted CI jobs are distinct from these local results.

Reproduction commands from the repository root:

```sh
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
node supabase/tests/authorization/run.mjs --pg-bin /path/to/postgresql-17/bin
node supabase/tests/word-version/run.mjs --pg-bin /path/to/postgresql-17/bin
git diff --check
```

The PostgreSQL runners accept a binary directory, create new temporary clusters bound to `127.0.0.1`, and do not accept a hosted connection URL. They use synthetic fixtures; no Supabase credentials are needed. Authorization probes use non-superuser/non-BYPASSRLS roles with synthetic JWT claims. The full migration chain does not install `pg_graphql`. These tests verify the application's SQL independently of GraphQL; they are **not** an extension removal/reinstallation rehearsal. Frontend tests use mocks, not a live Supabase gateway. Hosted retirement, fresh metadata verification and post-change smoke checks remain unexecuted and require separate owner approval.

Remaining risks are unknown external consumers, schema drift since inspection, managed-platform permissions, active-request/DDL lock delays, unavailable exact-version rollback and lost extension-specific customization. Within the repository, no application blocker was found. The next step is independent review of this report, followed only if approved by the manual operator procedure; no migration or automatic deployment is warranted.
