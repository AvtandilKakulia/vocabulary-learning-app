# Database migrations

The complete migration chain bootstraps the application schema on a **fresh
Supabase-compatible database**. Supabase must already supply `auth.users`,
`auth.uid()`, the `anon`/`authenticated`/`service_role` roles, and UUID generation.
Apply migrations as the trusted database owner (`postgres`), using the standard
Supabase UTC database/session configuration.

Migration filenames use 14-digit timestamp prefixes (`YYYYMMDDHHMMSS`) so normal
Supabase migration ordering is deterministic. Apply every SQL file in this order
before using the application:

1. `20240619000000_initial_app_schema.sql`
2. `20240620000000_word_uniqueness.sql`
3. `20240621000000_search_words.sql`
4. `20261006183000_allow_word_meanings.sql`
5. `20261006190000_search_words_integrity_sorting.sql`
6. `20261007234000_security_schema_reconciliation.sql`
7. `20261013211615_advance_word_updated_at.sql`
8. `20261020175702_harden_trigger_function_search_paths.sql`

The baseline creates prerequisites only. Later migrations introduce normalization,
remove temporary normalized uniqueness to allow independent meanings, evolve
Search, and apply the final JSONB/security reconciliation. Do not stop at an
intermediate migration: historical Search definitions are corrected at the end.

## Existing production

**Never manually apply the baseline to the existing production database.** It
aborts transactionally if any of `public.profiles`, `public.words`, or
`public.test_history` already exists. It does not merge or repair existing state.

As reported for Issue 7B, production already has Issue 7A applied manually and has
no `supabase_migrations.schema_migrations` ledger. Do not run an unreviewed CLI
push/reset against production or fabricate applied-migration records. Adopting a
production migration ledger requires a separate, deliberate operational plan.

## Maintenance and verification

Add schema changes through new forward migrations; do not edit the established
baseline or rewrite historical migrations. Test the full chain on an isolated
fresh target, including ownership policies, privileges, triggers, and RPCs.

Issue 7B verification applied every file unchanged to local PGlite PostgreSQL with
Supabase-like auth/role fixtures. This checks SQL and application contracts, but
does not replace a Supabase CLI/PostgREST/Auth integration test. No production
connection or migration-ledger adoption is part of this bootstrap work.

## R4-SEC-01: isolated authorization verification

The [authorization runner](tests/authorization/run.mjs) applies this complete,
unchanged chain to a new local PostgreSQL 17 cluster and tests anon/authenticated
access through a non-bypassing gateway connection. See the
[Georgian report and authorization matrix](../docs/r4-sec-01-authorization-report.md)
for reproducible commands, findings, limitations and validation results.
The separate word-version runner below remains unchanged. Neither runner accepts
a hosted connection URL; neither proves Production matches the repository.
The [metadata-only SQL](tests/authorization/production-metadata-readonly.sql) is
prepared for separately approved owner inspection, not automatic execution on
Production. The original audit added no migration, remediation or deployment.

## R4-SEC-03: PostgreSQL tests in CI

The [Quality workflow](../.github/workflows/quality.yml) runs the independent
`PostgreSQL integration` check on every pull request and push to `main`, alongside
the unchanged frontend `quality` job. It uses GitHub-hosted `ubuntu-24.04`,
Node.js 24, and explicitly installs `postgresql-17` / `postgresql-client-17` from
the [official PostgreSQL APT repository](https://www.postgresql.org/download/linux/ubuntu/).
It checks and prints the versions of `initdb`, `pg_ctl`, and `psql` in
`/usr/lib/postgresql/17/bin`; a missing binary or a different major version fails
the job. PostgreSQL 17 patch releases follow PGDG updates; the exact installed
version is recorded in each run's logs, including the actual server version.

The two dependency-free runners execute sequentially, as the regular runner OS
user (not root), without an npm install or the Supabase CLI:

```sh
node supabase/tests/authorization/run.mjs --pg-bin /usr/lib/postgresql/17/bin
node supabase/tests/word-version/run.mjs --pg-bin /usr/lib/postgresql/17/bin
```

CI requires both a successful process exit and the complete **200 authorization**
and **30 word-version** check summaries. Bash `errexit` and `pipefail` preserve
errors through log capture. Setup errors, failed assertions, missing completion
summaries, cleanup errors and unexpected process termination cannot pass the
check; the job has a 15-minute limit. When intentionally adding tests, update
the expected total in the workflow together with the suite. No failure is
optional. Making this check a merge requirement is a separate repository
branch-protection/ruleset setting; this workflow does not change those settings.

Authorization coverage includes owner/cross-account/anonymous access, RLS,
privileges, RPCs, account deletion, preserved data and negative controls that
deliberately weaken isolated fixtures. Word-version coverage includes timestamp
advancement, real concurrent transactions, stale-write rejection, normalization,
unchanged profiles behavior, schema-drift rejection and rollback/recovery.

Each runner creates its own fresh cluster under the OS temporary directory on a
random `127.0.0.1` port, disables Unix sockets, sanitizes inherited PostgreSQL
environment variables and accepts only a binary-directory argument. Tests apply
repository SQL solely to synthetic databases inside that cluster. Normal exit
stops the cluster; success removes its directory and failure retains stopped
diagnostics. A forced job cancellation may interrupt cleanup; GitHub discards
the disposable hosted runner. Local trust authentication is confined to this
temporary, single-job environment.

No hosted database connection, Supabase credentials, database passwords,
service-role keys or GitHub secrets are used. These tests exercise real
PostgreSQL with synthetic Supabase auth/role fixtures, **not** hosted Supabase
Auth/JWT validation, PostgREST, extensions or Production configuration/drift.
They neither deploy migrations nor create/repair a hosted migration ledger.

## R4-SEC-04: fixed trigger-function search paths (not deployed)

**Prepared for separate Production deployment approval only.** This work does
not connect to hosted Supabase or establish a Production migration ledger.
The owner reports PostgreSQL 17.11 and two postgres-owned SECURITY INVOKER
functions with NULL `proconfig` and no anon/authenticated execution rights.

[Forward migration](migrations/20261020175702_harden_trigger_function_search_paths.sql)
addresses Advisor `0011_function_search_path_mutable` for exactly:

```sql
ALTER FUNCTION public.set_english_word_norm() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
```

The file was generated with `pnpm dlx supabase@2.120.0 migration new
harden_trigger_function_search_paths` after inspecting `migration new --help`.
No function/trigger is recreated; no body, owner, ACL, dependency, policy, row or
table definition is changed. The only persistent metadata delta is
`proconfig: NULL -> ARRAY['search_path=""']` on these two existing function OIDs.
Built-ins still resolve through implicit `pg_catalog`; normalization keeps its
collapse-whitespace/trim/lowercase rule and the profile trigger retains its
existing transaction-start timestamp expression, including timezone semantics.
The dedicated `advance_word_updated_at()` words-version trigger stays unchanged.
See [ALTER FUNCTION](https://www.postgresql.org/docs/17/sql-alterfunction.html)
and [schema search paths](https://www.postgresql.org/docs/17/ddl-schemas.html).

### Preflight and deployment prerequisites

After separate owner approval, verify the target/backup and save metadata,
function definitions and the migration hash. The trusted operator must inspect
the actual bodies: they must implement the reviewed normalization/profile
expressions using built-ins; any new relation or user-defined function reference
requires review for schema qualification before setting an empty path.
The automated preflight validates metadata/bindings, not arbitrary body semantics.
Do not run concurrent privileged function/schema DDL during deployment.

The following are **owner-run read-only inspection queries**, not commands this
task executes against Production. Capture them before and after deployment:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT version(), current_user, current_setting('session_replication_role');
SELECT p.oid, p.oid::regprocedure AS identity, p.proowner::regrole AS owner,
       l.lanname, p.prokind, p.prorettype::regtype, p.prosecdef, p.proconfig,
       p.proacl, pg_get_functiondef(p.oid) AS definition,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN ('set_english_word_norm','update_updated_at_column');
SELECT t.oid, t.tgrelid::regclass, t.tgfoid, t.tgenabled, pg_get_triggerdef(t.oid)
FROM pg_trigger t WHERE t.tgfoid IN (
  'public.set_english_word_norm()'::regprocedure,
  'public.update_updated_at_column()'::regprocedure);
ROLLBACK;
```

Require exactly the two zero-argument PL/pgSQL trigger functions, postgres
ownership, SECURITY INVOKER, NULL configuration, and no effective
anon/authenticated/PUBLIC EXECUTE. Expected uses are only the enabled
`trg_set_english_word_norm` (BEFORE INSERT OR UPDATE OF english_word, ROW, words)
and `update_profiles_updated_at` (BEFORE UPDATE, ROW, profiles), with no trigger
arguments or WHEN condition. The migration repeats these checks transactionally;
missing/overloaded functions, different owners/configuration/privileges/bindings,
partial prior hardening and reruns fail closed without repair.

After approval, apply **only this forward file** as postgres, in origin
replication mode, with an error-stopping client (`psql -X -v ON_ERROR_STOP=1`).
The file owns BEGIN/COMMIT; do not wrap it in another transaction. Do not run
`db push`, `db reset`, replay historical files or create/repair a hosted ledger.
Verify COMMIT, both exact empty-path configurations, and unchanged OIDs,
definitions apart from SET search_path, owners, ACLs and trigger definitions.
No existing record or timestamp should change from this migration.
Then the owner can rerun Advisor: these two mutable-search-path warnings should
disappear. This task has not run hosted Advisor or claimed that result.

### Locking, verification and recovery

The transaction takes SHARE UPDATE EXCLUSIVE locks on words/profiles to stabilize
trigger bindings. Ordinary SELECT/INSERT/UPDATE/DELETE locks are compatible, but
DDL, VACUUM/ANALYZE and other maintenance can contend. There is no row scan or
rewrite. Lock timeout is 5s, statement timeout 30s per statement, and idle
transaction timeout 60s. Schedule a brief controlled deployment; a timeout/error
aborts all changes. Roll back or disconnect an errored interactive session.

The existing authorization runner now extends its complete-migration-chain
assertion group with before/after catalog/data snapshots, real authenticated
INSERT/UPDATE behavior under multiple caller paths and UTC/Asia-Tbilisi timezones,
hostile built-in shadowing, 18 fail-closed drift cases, rerun rejection, forced
failure of the second ALTER, rollback and forward recovery. All existing 200
top-level authorization checks remain; their catalog expectation now requires
empty paths for all seven public functions. The 30 word-version checks and the
CI exact-count contracts are unchanged. Run both commands in the CI section
above. These are disposable PostgreSQL tests, not hosted Supabase verification.

Before COMMIT, ROLLBACK/disconnection restores both original configurations.
After COMMIT, prefer a reviewed forward correction. If an incident requires
rollback, obtain separate approval, serialize DDL, and compare saved definitions,
OIDs, ACLs and bindings. Require both current configurations to be exactly
`ARRAY['search_path=""']` and all other metadata to match; stop on drift.
In a short transaction with the same timeouts/table locks, execute only:

```sql
ALTER FUNCTION public.set_english_word_norm() RESET search_path;
ALTER FUNCTION public.update_updated_at_column() RESET search_path;
```

This restores the original NULL configurations without restoring or rewriting
data, but reintroduces mutable caller paths and the Advisor warnings. Never use
`RESET ALL`, recreate functions/triggers, or blindly roll back later changes.
Reinspect metadata and behavior, then prepare a separately approved forward fix.

## R3-A01: word version migration and deployment review

**Prepared for separate Production deployment review; not deployed.** The owner
reported the Production checks below. This work did not connect to Production,
change its data, or create/repair a migration-history ledger.

Owner-confirmed state: `words.updated_at` is NOT NULL `timestamptz`, typmod -1,
with no NULL/non-finite values; `advance_word_updated_at()` does not exist; the
active words triggers are `trg_set_english_word_norm` and
`update_words_updated_at`. The latter calls the shared function using `now()`.
The additional exact trigger shapes, owners, grants and rules checked by the
migration still require the deployment preflight.

### Reviewed files and contract

- Forward SQL: [20261013211615_advance_word_updated_at.sql](migrations/20261013211615_advance_word_updated_at.sql).
- Incident rollback: [rollback_word_version.sql](operations/rollback_word_version.sql).
- Isolated regression runner: [run.mjs](tests/word-version/run.mjs), with
  [fixture.sql](tests/word-version/fixture.sql) and [behavior.sql](tests/word-version/behavior.sql).

The migration file was generated locally using
`pnpm dlx supabase@2.120.0 migration new advance_word_updated_at`, after inspecting
the CLI help. The CLI uses a UTC timestamp in its filename. No project linking,
remote commands, CLI push/reset/pull, or ledger synchronization was used.
See the [official migration-new documentation](https://supabase.com/docs/reference/cli/supabase-migration-new).

The dedicated postgres-owned, SECURITY INVOKER function sets:
`NEW.updated_at = GREATEST(clock_timestamp(), OLD.updated_at + interval '1 microsecond')`.
It rejects invalid old versions and non-advancing results; timestamp overflow
aborts the write. It ignores a timestamp supplied in an UPDATE payload. This
covers same-transaction updates, equal/backward clock readings, future old
versions and no-op updates. The shared profiles function is unchanged.

The previous `now()` value was fixed at transaction start and could repeat.
`clock_timestamp()` alone would also not prove strict advancement.
[PostgreSQL date/time functions](https://www.postgresql.org/docs/current/functions-datetime.html).
The column must keep full microsecond precision: the frontend retains the
original PostgREST string without JavaScript Date conversion, rounding, or a
client-generated timestamp.
[PostgreSQL timestamp precision](https://www.postgresql.org/docs/current/datatype-datetime.html).

The existing frontend UPDATE compares `id`, `user_id` and the original
`updated_at` atomically, requiring an exact affected count of one. A competing
committed update makes the stale condition false; PostgreSQL rechecks it after
waiting for the first writer at Read Committed.
[PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).
Zero matches retains the complete draft and gives noncommittal changed/deleted/
inaccessible wording. No pre-read or unconditional retry was added.

### Read-only preflight: owner runs only after approving the target

Confirm the project and database identity independently; keep the direct
connection details private. Save the output and existing trigger/function DDL
with the deployment record. Run these read-only checks as the trusted owner:

```sql
SELECT current_database(), current_user, version(),
       current_setting('session_replication_role') AS replication_mode;
SELECT c.relkind, c.relowner::regrole AS owner, c.relrowsecurity,
       c.relforcerowsecurity, c.relispartition,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c WHERE c.oid = 'public.words'::regclass;
SELECT attname, format_type(atttypid, atttypmod) AS type, atttypmod,
       attnotnull, attgenerated
FROM pg_attribute WHERE attrelid = 'public.words'::regclass
  AND attname IN ('updated_at', 'english_word') AND NOT attisdropped;
SELECT count(*) AS words,
       count(*) FILTER (WHERE updated_at IS NULL OR NOT isfinite(updated_at)) AS invalid_versions
FROM public.words;
SELECT t.oid, t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS trigger_sql,
       p.oid::regprocedure AS function_name, p.proowner::regrole AS function_owner,
       p.proacl, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS function_sql
FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid IN ('public.words'::regclass, 'public.profiles'::regclass)
  AND NOT t.tgisinternal;
SELECT oid::regprocedure, proowner::regrole, proacl
FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  AND proname = 'advance_word_updated_at';
SELECT * FROM pg_inherits
WHERE inhrelid = 'public.words'::regclass OR inhparent = 'public.words'::regclass;
SELECT rulename, pg_get_ruledef(oid) FROM pg_rewrite
WHERE ev_class = 'public.words'::regclass AND rulename <> '_RETURN';
SELECT * FROM pg_default_acl WHERE defaclrole = 'postgres'::regrole;
SELECT relname, relowner::regrole, relacl, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE oid IN ('public.words'::regclass, 'public.profiles'::regclass);
SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('words', 'profiles');
```

Require a standalone, non-partitioned, postgres-owned table with RLS enabled;
postgres migration role and origin replication mode; full-precision NOT NULL
timestamptz (typmod -1 or 6, not generated); zero invalid versions. Require exactly
two non-internal words triggers, both origin-enabled (`O`), without WHEN or
arguments: BEFORE UPDATE FOR EACH ROW calling `update_updated_at_column()`,
and BEFORE INSERT OR UPDATE OF english_word FOR EACH ROW calling
`set_english_word_norm()`. No extra user trigger, rewrite rule, inheritance,
overload/name collision, or unexpected default execution grant is accepted.
Different state must be reviewed, not automatically repaired or bypassed.

The transaction repeats these checks while holding the table lock. The full-row
validity scan uses `row_security=off`: this does not change policies and fails
rather than silently scanning an RLS-filtered subset. The new function grants no
RPC execution to PUBLIC/anon/authenticated/service_role; existing grants,
owners, policies, normalization trigger, indexes, constraints and rows are not
modified. Standard trigger invocation still works for authenticated writes.

### Isolated PostgreSQL verification

Run as a regular OS user with Node >=20 and PostgreSQL 17 binaries available
(`initdb`, `pg_ctl`, `psql`). No npm dependency is added. For Windows, the
[PostgreSQL download page](https://www.postgresql.org/download/windows/) links the
EDB portable ZIP; extract `pgsql/bin`, `pgsql/lib` and `pgsql/share` together.
Docker and the complete local Supabase stack are not required.

From the repository root:

```powershell
node supabase/tests/word-version/run.mjs --pg-bin C:/path/to/pgsql/bin
```

On Linux/macOS with server binaries on PATH:

```sh
node supabase/tests/word-version/run.mjs
# Or: node supabase/tests/word-version/run.mjs --pg-bin /usr/lib/postgresql/17/bin
```

The runner accepts only a binary-directory argument, never a DB URL. It creates
a fresh cluster in an OS temporary directory on a random loopback port, disables
Unix sockets, clears inherited PG connection settings, and stops the cluster in
finally. Successful runs remove only their own temporary directory; failed runs
retain stopped diagnostic files. Local trust authentication is used only for this
short-lived synthetic cluster. Do not use it on a shared/untrusted machine.

The fixture supplies minimal synthetic Supabase roles/auth.uid()/auth.users,
then applies the repository's previous migration chain **only to this new empty
cluster**. Each drift test clones the fixture database. No Production data or
credentials are copied.

Executed on PostgreSQL **17.11, Windows x64**, on 2026-10-14: **30 integration
checks passed** (the SQL assertion groups include multiple behavior cases).
- Normal, rapid, same-transaction and no-op updates advance versions.
- A future timestamp advances by exactly one microsecond; six fractional digits
  and non-UTC session behavior are verified; client timestamp payloads are ignored.
- Stale equality affects zero rows; fresh equality affects exactly one.
- Two real connections contend on the same row. The runner confirms B is blocked
  using pg_blocking_pids before releasing A. A COMMIT rejects B; A ROLLBACK allows B.
- Normalization INSERT/UPDATE, independent meanings, unchanged profiles behavior,
  authenticated owner writes, denied cross-owner access/reassignment, function
  permissions, and unchanged existing rows/catalog metadata are checked.
- Invalid/non-finite/overflow runtime values fail; drift, duplicate application,
  lock timeout and rollback dependency failures leave no partial changes.
- Explicit timestamptz(6), rollback preservation, and forward recovery are checked.

These are actual PostgreSQL tests, not JavaScript response mocks. They do not
test the hosted Supabase Auth service, PostgREST HTTP transport, Production
configuration, extensions, infrastructure or Production-scale lock duration.
The separate frontend suite covers the installed SDK's serialization/count
contract with a local transport. Both PostgreSQL runners now run in the separate
CI job described above. Neither suite substitutes for the target preflight.

### Separately approved deployment and verification

1. Obtain explicit deployment approval and confirm a backup/recovery point.
   Save the preflight metadata/DDL and migration hash. Identify all writers,
   including old browser tabs, imports and admin tools. Schedule a short
   maintenance window; pause writes and drain long transactions.
2. Apply **only the new forward SQL file** as postgres using an approved direct
   connection and a client that stops on errors. For example, after approval:
   `psql -X -v ON_ERROR_STOP=1 --dbname="$APPROVED_DATABASE_URL" --file=supabase/migrations/20261013211615_advance_word_updated_at.sql`.
   This standalone file owns BEGIN/COMMIT; do not wrap it in another transaction.
   Do not run CLI db push/reset or migration repair; do not create a ledger.
3. Confirm COMMIT. Re-run metadata checks: the timestamp trigger must reference
   `public.advance_word_updated_at()`; normalization/profile trigger definitions
   and OIDs, shared function body, old owners/ACLs/RLS/policies must match the saved
   output. No word timestamp or content should have changed from deployment itself.
4. With separately authorized disposable verification records, repeat
   normal/same-transaction and two-connection stale-save checks. Then perform the
   two-tab frontend test: A saves; B's stale save preserves its draft and A's data;
   copying/reopening the latest row allows intentional reconciliation.
5. Reload old clients, restore approved writers, and monitor save errors and lock
   waits. Record the SQL hash, operator, target, time and results externally;
   do not fabricate a historical migration ledger.

**Locks:** DROP TRIGGER requires ACCESS EXCLUSIVE, acquired up front to avoid an
upgrade deadlock. It blocks both reads and writes until commit; requests may also
queue behind the waiting DDL. lock_timeout is 5 seconds, statement_timeout is 30
seconds per statement, and idle-in-transaction timeout is 60 seconds. The finite
version scan runs under the lock and may dominate time on large tables. Test on
representative size and drain long transactions first; do not promise zero
downtime or raise timeouts blindly. Any failed statement aborts the entire
transaction. If using a persistent SQL session, issue ROLLBACK or disconnect
immediately after an error to release locks.

**Recovery:** Before commit, ROLLBACK/disconnection restores the original trigger
and removes the newly created function; inspect before retrying. A second
application intentionally fails rather than overwriting an installed function.
After commit, prefer a reviewed forward correction. If an incident requires
rollback, fence all writers and obtain separate approval before running
`supabase/operations/rollback_word_version.sql` with ON_ERROR_STOP. It verifies
the binding, restores only the words trigger to the untouched shared function,
and drops the new function with RESTRICT; unknown dependencies abort all rollback
DDL. Existing rows/timestamps are never restored or rewritten. Verify the saved
metadata and keep editing unavailable until the forward guarantee is reinstated:
the old trigger can repeat or move timestamps backwards, so rollback removes
reliable concurrency protection. Do not bypass the frontend version predicate to
make failures disappear.

**Remaining risks:** Direct/older writers without the original-version predicate
can still overwrite data; disabled triggers, replica sessions or later unreviewed
schema changes invalidate the contract. Invalid INSERT timestamps are not
backfilled or repaired: later UPDATE fails safely. An uncertain HTTP response
after commit requires copying the draft and reopening the latest record, not an
unconditional retry. Production remains unchanged; readiness here means ready
for separate deployment review, not deployed or verified in Production.
