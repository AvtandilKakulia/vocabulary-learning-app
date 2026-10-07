# Database migrations

The complete migration chain bootstraps the application schema on a **fresh
Supabase-compatible database**. Supabase must already supply `auth.users`,
`auth.uid()`, the `anon`/`authenticated`/`service_role` roles, and UUID generation.
Apply migrations as the trusted database owner (`postgres`), using the standard
Supabase UTC database/session configuration.

Apply every SQL file in this order before using the application:

1. `20240619000000_initial_app_schema.sql`
2. `20240620_word_uniqueness.sql`
3. `20240621_search_words.sql`
4. `20261006183000_allow_word_meanings.sql`
5. `20261006_search_words_integrity_sorting.sql`
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
