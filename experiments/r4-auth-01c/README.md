# R4-AUTH-01C isolated reproduction

No application dependency or import uses these files. All network responses in the fixtures are synthetic. Never substitute production URLs or credentials. Do not push the disposable checkout anywhere.

## Prerequisites

Tested on Windows, Node 24.22.0, application pnpm 10.34.6, upstream pnpm 11.1.2 (selected by upstream `packageManager`), Chrome 155.0.8059.85. Upstream uses Jest 30.4.2, ts-jest and TypeScript 5.8.3. Docker was unavailable; the complete local Auth-service integration suite is not claimed as executed.

From this repository root, prepare the unchanged official artifacts:

```powershell
pnpm install --frozen-lockfile
node experiments/r4-auth-01/setup.mjs
npm ci --prefix tmp/r4-auth-01-candidate --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01-npm-cache
node experiments/r4-auth-01b/setup.mjs
npm ci --prefix tmp/r4-auth-01b-official --ignore-scripts --no-audit --no-fund --cache tmp/r4-auth-01b-npm-cache
node experiments/r4-auth-01b/build-patches.mjs
```

Create a **new** disposable checkout outside the application tree. Do not put it below `node_modules`: Node's native TypeScript support cannot load Nx configuration there. Putting it under the application's `tmp/` without `node_modules` also makes the unchanged application ESLint glob inspect upstream TypeScript.

```powershell
$auditRepo = (Get-Location).Path
$authUpstream = Join-Path ([IO.Path]::GetTempPath()) ('vocabulary-auth01c-' + [guid]::NewGuid())
git clone --no-checkout https://github.com/supabase/supabase-js.git $authUpstream
git -C $authUpstream checkout --detach 51816da3805daf2aed7393870e34d7e3374edb69
Push-Location $authUpstream
pnpm install --frozen-lockfile --ignore-scripts --filter '@supabase/auth-js...'
pnpm nx show project '@supabase/auth-js' --json
Pop-Location
```

Read upstream `AGENTS.md`, `packages/core/auth-js/AGENTS.md`, contribution instructions and Nx workspace instructions before preparing a contribution. The user has **not authorized** the upstream fork/push/submission workflow.

## Independent red/green upstream tests

`prepare.mjs` checks exact upstream HEAD and LF-normalized source checksums, applies unique exact hunks, and writes only the selected disposable GoTrueClient source plus two new test copies. It never resets a repository, changes installed packages, or writes to an upstream remote. `.ts.txt` keeps the portable tests out of this application's TS/ESLint/Vitest input; they are real `.test.ts` files when copied upstream.

```powershell
# Terminal base: expected 10 failed / 8 passed, specifically missing deferred rejection.
node experiments/r4-auth-01c/prepare.mjs $authUpstream base
Push-Location $authUpstream
pnpm nx test '@supabase/auth-js' --runInBand --runTestsByPath test/GoTrueClient.terminalStorage.test.ts --coverage=false
Pop-Location

# Terminal patch alone: expected 19 passed, including the existing upstream regression.
node experiments/r4-auth-01c/prepare.mjs $authUpstream terminal
Push-Location $authUpstream
pnpm nx test '@supabase/auth-js' --runInBand --runTestsByPath test/GoTrueClient.terminalStorage.test.ts test/GoTrueClient.refreshRejection.test.ts --coverage=false
Pop-Location

# Existing #2742: expected one failure (duplicate healthy-listener invocation), 16 passed.
node experiments/r4-auth-01c/prepare.mjs $authUpstream pr2742
Push-Location $authUpstream
pnpm nx test '@supabase/auth-js' --runInBand --runTestsByPath test/GoTrueClient.initialStorage.test.ts --coverage=false
Pop-Location

# Initial supplement alone: expected 17 passed; no terminal patch needed.
node experiments/r4-auth-01c/prepare.mjs $authUpstream initialSupplement
Push-Location $authUpstream
pnpm nx test '@supabase/auth-js' --runInBand --runTestsByPath test/GoTrueClient.initialStorage.test.ts --coverage=false
Pop-Location

# Combined proposal, deliberately without broad initialization-error propagation.
node experiments/r4-auth-01c/prepare.mjs $authUpstream proposal --bundle
Push-Location $authUpstream
pnpm nx test '@supabase/auth-js' --runInBand --runTestsByPath test/GoTrueClient.initialStorage.test.ts test/GoTrueClient.terminalStorage.test.ts test/GoTrueClient.refreshRejection.test.ts test/GoTrueClient.pkce.browser.test.ts test/GoTrueClient.pkce.test.ts test/GoTrueClient.signOut.test.ts test/GoTrueClient.lockWarning.test.ts --coverage=false
pnpm nx build '@supabase/auth-js'
pnpm exec tsc -p packages/core/auth-js/tsconfig.test.json --noEmit
git diff --check
Pop-Location
```

Expected combined result: **53 tests, seven suites**, build/typecheck successful. No Auth service is needed. Nx's existing test configuration prints a force-exit advisory; no global rejection listener suppresses failures and no timeout is increased. Use `--skipNxCache` for an additional genuinely executed repeat if Nx would reuse a result. An expected red test exit alone is insufficient: inspect that it fails on the stated assertion, not setup, networking, a watchdog, or a TS error.

Optional semantics comparison: prepare state `propagation`, then run the initial test file. It adds only the old `_recoverAndRefresh(true)` hunks for comparison; **4 fail / 13 pass** against unchanged initialization expectations. Inspect those four public-result differences. The nested write-failure and offline/503 tests still pass, demonstrating the limits of that flag. Restore state `proposal` afterward. This is not a third proposed patch.

Standard Git can also apply `terminal-refresh.patch` directly to the pinned base, or `initial-supplement.patch` after the preserved `../r4-auth-01b/upstream-2742.patch`. They touch separate methods. The patch artifacts omit the single-space prefix on empty context lines so that they can be stored without trailing whitespace; Git accepts this format. There is no `git diff --suppress-blank-empty` option (that name in the earlier report was inaccurate). `prepare.mjs` handles the format explicitly and rejects non-unique hunks. Compare its resulting source hashes with `provenance.json`.

## Real SDK Node and native Chrome matrix

```powershell
node experiments/r4-auth-01c/run.mjs
node experiments/r4-auth-01c/native.mjs --browser 'C:/Program Files/Google/Chrome/Application/chrome.exe'
```

Both must exit **0**, with the full final summaries:

```text
PASS: 21 blocker cases; 25 preserved lifecycle cases; 16 generation groups; 2 unsafe controls. Experimental source only.
VERIFIED NATIVE: 21 blocker observations; 25 preserved lifecycle cases; 16 generation checks; 2 unsafe controls; 11 multi-page/lock/reload/restart/interval scenarios.
```

Run the Node command in **10 fresh processes** and Chrome in **three fresh invocations**. Every native invocation creates a new disposable profile; one graceful browser restart reuses that profile to test persistence. Both unsafe shared-slot controls must continue reproducing damage. The old helper's `2.112.4` argument selects lockless expectations; actual wrapper artifact/header version is 2.118.0, and Auth source is the separately hashed master-based proposal.

The initial cases intentionally retain #2742's public initialization expectations; terminal cases require the old full-patch settlement expectations. The one changed listener assertion requires exactly one healthy event and retains every other result-field/diagnostic assertion. No official failing case is relabeled as green. Blocker faults are injected storage-boundary failures; separate generation/native scenarios use actual IndexedDB, Web Locks, BroadcastChannel, visibility and SDK intervals.

Node records: `tmp/r4-auth-01c/node-<pid>.json`. Native profiles/records: `tmp/r4-auth-01c-chrome-*/observations.json`. Do not delete a normal Chrome profile. No real Supabase network access is enabled by the fixture.

For independent prior-evidence preservation:

```powershell
node experiments/r4-auth-01b/run.mjs
# Expected diagnostic exit 2 plus its complete VERIFIED summary; released SDKs still fail.
```

Finally run unchanged application checks from `$auditRepo`: `pnpm exec tsc -b`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`. Existing GitHub Actions validates the application and 200 + 30 disposable PostgreSQL checks; it does not run this optional upstream/browser experiment. Nothing here authorizes dependency adoption, production migration or an upstream submission.
