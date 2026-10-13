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

## R3-A01: word-edit concurrency deployment prerequisite

**The frontend comparison alone is not a complete production fix.** The live
trigger was not inspected (the project owner explicitly declined production
inspection). No migration or production write was performed for R3-A01. The SQL
below is a proposal for separate database review/approval, not an applied migration.
Do not deploy this as verified concurrency protection until the database contract
below is installed and tested on the intended target.

The editor retains the original `updated_at` string alongside its initial draft.
`useWords.updateWord` sends one PATCH with `id`, `user_id`, and that exact version
as equality filters, plus `count: "exact"`. Exactly one affected row is success.
Zero rows leaves the draft open and explains that the row may have changed, been
deleted, or become inaccessible. Unexpected errors retain a separate generic
failure message. There is no pre-read/unconditional write or retry with a newer
token. Reloading and reopening deliberately obtains a new snapshot.

The repository baseline's `update_words_updated_at` trigger calls the shared
`update_updated_at_column()` function. It assigns `timezone('utc', now())`, which
does **not** guarantee a distinct token: `now()` is fixed at transaction start,
and assigning a timestamp without time zone back to `timestamptz` also depends on
the session time zone. `clock_timestamp()` alone would still allow equal or
backward times. These semantics are documented in the
[PostgreSQL date/time functions reference](https://www.postgresql.org/docs/current/functions-datetime.html).
The shared function also serves profiles; leave it unchanged.

PostgreSQL timestamps have microsecond resolution. The app must retain all six
fractional digits from PostgREST, without converting through JavaScript `Date`,
rounding, or generating a client timestamp. The column must be full precision
`timestamptz` (default precision or explicit 6), finite and NOT NULL. See the
[PostgreSQL date/time types reference](https://www.postgresql.org/docs/current/datatype-datetime.html).
The equality predicate belongs to the same UPDATE as the values: under Read
Committed, PostgreSQL rechecks its WHERE condition after a competing update
commits; higher isolation levels may instead raise a retryable database error.
See [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html).

### Read-only preflight, after separately confirming the target project

Run against an isolated target first, then only with authorization on the intended
production target. Inspect metadata and aggregate counts, not vocabulary contents:

```sql
SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
       a.atttypmod, a.attnotnull, a.attgenerated
FROM pg_catalog.pg_attribute a
WHERE a.attrelid = 'public.words'::regclass
  AND a.attname = 'updated_at' AND NOT a.attisdropped;

SELECT t.tgname, t.tgenabled, pg_catalog.pg_get_triggerdef(t.oid) AS trigger_sql,
       p.oid::regprocedure AS function_name, p.prosecdef, p.proconfig,
       pg_catalog.pg_get_functiondef(p.oid) AS function_sql
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.words'::regclass AND NOT t.tgisinternal;

SELECT count(*) FILTER (WHERE updated_at IS NULL) AS null_versions,
       count(*) FILTER (WHERE NOT pg_catalog.isfinite(updated_at)) AS nonfinite_versions
FROM public.words;
```

Require `timestamptz`, typmod -1 or 6, NOT NULL, no generated expression, and zero
invalid versions. Confirm the trigger runs BEFORE **every** UPDATE for each row,
is enabled for all application writer paths, and that no other trigger overwrites
the version afterward. Inventory the trigger owner/privileges and all writer
paths, including imports/admin jobs; none may disable/bypass version advancement.
If any assumption differs, stop and adapt the forward migration for review.
Do not repair drift by applying the bootstrap or assuming an existing ledger.

### Proposed forward-only migration (requires separate approval)

After preflight/review, create a new timestamped migration using the Supabase CLI;
do not modify the historical baseline. Review the new function name for collisions.
The following transaction replaces only the words timestamp trigger. It leaves
profiles, normalization, RLS, existing rows, and existing timestamps unchanged.

```sql
BEGIN;
LOCK TABLE public.words IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.words'::regclass AND attname = 'updated_at'
      AND NOT attisdropped AND atttypid = 'timestamptz'::regtype
      AND atttypmod IN (-1, 6) AND attnotnull AND attgenerated = ''
  ) THEN
    RAISE EXCEPTION 'words.updated_at must be a full-precision, non-null timestamptz column';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.words
    WHERE updated_at IS NULL OR NOT pg_catalog.isfinite(updated_at)
  ) THEN
    RAISE EXCEPTION 'words.updated_at contains invalid version tokens';
  END IF;
END;
$$;

CREATE FUNCTION public.advance_word_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.updated_at IS NULL OR NOT pg_catalog.isfinite(OLD.updated_at) THEN
    RAISE EXCEPTION 'Cannot advance an invalid word version';
  END IF;
  NEW.updated_at := GREATEST(
    pg_catalog.clock_timestamp(),
    OLD.updated_at + interval '1 microsecond'
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_word_updated_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS update_words_updated_at ON public.words;
CREATE TRIGGER update_words_updated_at
BEFORE UPDATE ON public.words
FOR EACH ROW EXECUTE FUNCTION public.advance_word_updated_at();
COMMIT;
```

The trusted owner creates the trigger. The new function ignores client-supplied
versions and takes the later of wall-clock time and the old token plus one
microsecond. This advances even within one transaction or when the old token is
ahead of the clock. Invalid/overflowing tokens fail the write instead of silently
reusing a version. Restrict timestamp writes on insertion to valid server defaults
in writer contracts; investigate invalid data separately rather than backfilling
or silently repairing it in this task.

If the target cannot guarantee full precision and trigger coverage, do not use
`updated_at` for this protection. The safer alternative is a server-owned,
monotonically incremented `bigint` revision per row, compared in the same UPDATE,
with a trigger that prevents clients choosing/reusing revisions. That requires a
separately reviewed schema/API change (including JSON serialization without JS
integer precision loss), not an unverified fallback in this PR.

### Verification and rollout gate

The automated `wordConcurrency.test.tsx` tests exercise the installed Supabase SDK,
HTTP filters, full-precision strings, exact counts and modal behavior against a
local atomic transport. They model an advancing version; **they do not execute
the proposed SQL or prove that a live trigger is installed**. No local PostgreSQL
runtime was available during R3-A01. Database verification remains outstanding.

Before approving deployment, run the proposed change on an isolated
Supabase/PostgreSQL instance with the target's actual schema, then verify:

1. A successful update returns one affected row and a strictly greater, distinct
   `updated_at`. Two updates in one explicit transaction also advance twice.
2. A row with an old version ahead of `clock_timestamp()` still advances by at
   least one microsecond. Attempting to set/reuse `updated_at` in a payload cannot
   bypass the trigger. Invalid/overflowing versions fail closed.
3. Two database connections read one original version. Hold connection A's
   matching UPDATE uncommitted, issue B's matching UPDATE, then commit A. B must
   affect zero rows at Read Committed (or fail at stricter isolation), and A's
   values must survive. Repeat with sequential requests via PostgREST and its
   `Prefer: count=exact` response header.
4. Six-digit fractional timestamps survive read -> UI draft -> PATCH equality
   unchanged. Reopening the latest row permits an intentional subsequent edit.
5. Deleted rows and rows hidden by ownership/RLS yield no false success. Distinct
   meaning IDs update independently. Profiles and word normalization still work.
6. Repeat the read-only preflight on the intended production target and confirm
   the reviewed function/trigger after a separately approved targeted rollout.

Deploy the database guarantee before relying on the new frontend, and reload old
application tabs. Older clients/admin writers that omit the version condition can
still overwrite newer data; trigger advancement alone cannot protect their writes.
Transport failures after a commit can leave the result uncertain: retain the
draft and reload/reopen the latest row before reconciling; never bypass the token.
Do not claim production concurrency is resolved until these prerequisites pass.
