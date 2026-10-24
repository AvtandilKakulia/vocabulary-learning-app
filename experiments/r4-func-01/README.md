# R4-FUNC-01 isolated functional counterexamples

Diagnoses main `8590f4a166d631fcd903e4cc19090b41510eeb84`; no application fixes. These files are outside default `pnpm test` and deployed entry points. See [audit report](../../docs/r4-func-01-functional-gap-audit.md).

## Automated probes

From repository root with existing dependencies:

```sh
pnpm exec vitest run --config experiments/r4-func-01/vitest.config.mjs
```

Expected: **four passing probes**. Passing means current defects reproduced: obsolete profile email mutation under B, theme read and write failures, and same-Test checkpoint overwrite. Config replaces include, reuses untouched network-blocking test setup. No sleeps/worker overrides/global rejection suppression. Expected theme SecurityError diagnostics can appear; real boundary fallback and diagnostic call are asserted.

Future fixes should make these current-behavior counterexamples fail and add desired-behavior tests to the normal suite. Do not make broken-behavior probes an acceptance CI contract.

## Native browser fixture

```sh
node experiments/r4-func-01/serve.mjs
```

Open **http://127.0.0.1:4188** in a fresh browser profile/isolated context. Use this origin only for synthetic tests: native recovery keys survive reload. Stop with Ctrl+C. No browser package installation required.

Build imports real App/providers/components/styles in production mode/StrictMode. Resolver replaces the service module, rejects SDK bundle modules and uses an isolated env directory. GET-only loopback server/CSP `connect-src 'none'` prevent real service calls. No account-delete RPC. Words/profile/History data is memory-only and resets on reload; Test checkpoints use actual shared localStorage. Auth is a notification stub, not a real server. Never point the fixture at Supabase.

### FUNC-001: profile continuation

1. As Fixture A open profile; change email to `a-new@example.com`, Save.
2. Upsert stays held. Click **Fixture B**, wait for `audit-b@example.com` form.
3. Click **Release profile response**, then **Read fixture trace**.
4. Defect: `profile-pending` for A, followed by `updateUser` for **B** with **A's edited email**; stale success in B form. Existing application two-second timer may close it; this is not a test sleep.

No real email changes. This proves app call ordering, not server confirmation semantics or SDK-internal races.

### FUNC-003: concurrent Test editors

1. Fresh fixture profile/origin with no prior Test: start custom **2** questions, **Text Input**, **Georgian → English**.
2. Open second page at same origin in **same browser profile/context**. Navigate Test to restore the same session.
3. First page: correctly answer question 1, **Next Question**. Seeds: cat/კატა, dog/ძაღლი, bird/ჩიტი; order randomized, answer actual prompt.
4. Second page remains on question 1: type `stale draft`.
5. Reload first, navigate Test. Defect: question 1/stale draft return; submitted answer/next-question progress lost.

Pages have independent service memory but shared native storage. Suitable for active-checkpoint race, not remote History constraint/duplicate behavior.

### FUNC-002: theme storage fault

- http://127.0.0.1:4188/?block-theme=getItem
- http://127.0.0.1:4188/?block-theme=setItem

Only `vocab-app-theme` access throws. App shows “Something went wrong”; synthetic controls outside boundary remain. Audit executed setItem natively and both React cases. Browser-policy prevalence/physical quota not measured.

### Positive smoke

Normal URL: search Georgian `კატა`, edit Cat description, create/delete synthetic word, Practice Check/navigate/back, finish short Test, view History/select/deselect, synthetic sign-out/in. No History/account deletion needed.

## Existing validation

```sh
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
node supabase/tests/authorization/run.mjs --pg-bin /path/to/postgresql/17/bin
node supabase/tests/word-version/run.mjs --pg-bin /path/to/postgresql/17/bin
```

Local PG17 binaries required. Audit Windows path: `tmp/r3-a01-pg/pgsql/bin`, an environment detail, not a committed dependency. Existing runners create disposable clusters; never substitute hosted connection strings or production. See [Supabase prerequisites](../../supabase/README.md). Baseline: 806 frontend tests, 200 authorization checks, 30 word-version groups; audit probes separate.
