# Unpublished maintainer drafts

Prepared with AI assistance and local regression review. These drafts have **not** been posted. Submission requires separate owner approval. All values in the fixtures are synthetic.

## A. Review note for existing PR #2742

Thanks @hemanshuwadile for [#2742](https://github.com/supabase/supabase-js/pull/2742), building on [#2708](https://github.com/supabase/supabase-js/issues/2708) and @dasjideepak's [#2709](https://github.com/supabase/supabase-js/pull/2709). I tested your exact head `b72048731964c7213b47ffb0fe9cd3cfd3e95c01` hunks applied to master `51816da3805daf2aed7393870e34d7e3374edb69` using the repository's Nx/Jest/ts-jest setup.

The outward catch, awaited legacy-lock callback and owned IIFE rejection fix the initial storage-read rejection. One small supplemental change would avoid treating a subscriber exception as a failed session load:

1. Seed a healthy persisted session and await `initialize()`.
2. Register an `onAuthStateChange` listener that records `(event, session)` and throws on `INITIAL_SESSION`.
3. The current PR invokes that listener with the healthy session, then again with `null`. The second callback is caught by the new IIFE handler, so it no longer escapes, but the duplicate notification falsely suggests that the session disappeared.

Expected: one `INITIAL_SESSION` delivery with the successfully loaded session; the listener's exception is handled by the subscription task. A genuinely failed load should still deliver `INITIAL_SESSION(null)` once.

Suggested supplement: catch only the `_useSession` load and save its result, then call the subscriber once outside that catch. Keep your IIFE `.catch`, legacy `await`, and existing warn/error/debug classification. See `initial-supplement.patch`, which applies **after your patch**, and `GoTrueClient.initialStorage.test.ts.txt` (copy to the upstream `test/` directory without `.txt`). This is a review supplement, not a competing PR.

The throwing-healthy-listener test fails with two callbacks on #2742; the supplement passes all 17 focused initial-session tests. These cover failed getters, failure after preflight, one-shot read failure, late registration, missing refresh token, malformed user, empty/invalid storage, expired refresh, throwing listeners, unsubscribe during a read, legacy lock ownership, nested user-recovery write failure, and offline/503 recovery. The combined proposal also passes existing PKCE browser/sign-out/lock tests. Test details and commands are in our preparation report.

Compatibility: callback exceptions stop producing a second, fabricated null event. Diagnostics can occur before callback delivery for a failed read; no notification is added to other subscribers. This supplement deliberately leaves `initialize()`'s existing error-tolerant recovery contract unchanged. Storage health should not be inferred from `INITIAL_SESSION(null)` or `initialize().error === null` alone. No claim is made that local cleanup revokes a server token.

Affected official artifacts independently reproduced: 2.83.0, 2.112.4 and 2.118.0 exhibit initial-load rejection issues; #2742 addresses that escape but retains the callback duplication. Full hosted Auth integration was not exercised; all new traffic uses injected synthetic fetch.

## B. Proposed issue: terminal refresh cleanup rejection leaves concurrent callers pending

**Suggested title:** auth: storage failure during terminal refresh cleanup leaves joined refresh callers unresolved

**Affected:** `@supabase/auth-js` through `@supabase/supabase-js` 2.112.4 and 2.118.0, plus master `51816da3805daf2aed7393870e34d7e3374edb69`. The older 2.83.0 has different refresh rejection behavior and is not claimed to exhibit this exact single-flight orphan. Node 24.22.0 and Chrome 155; no hosted service is required.

**Reproduction:** use `GoTrueClient.terminalStorage.test.ts.txt` as `packages/core/auth-js/test/GoTrueClient.terminalStorage.test.ts` in the pinned upstream checkout, then run:

```sh
pnpm nx test @supabase/auth-js --runInBand --runTestsByPath test/GoTrueClient.terminalStorage.test.ts --coverage=false
```

The fixture constructs a real `GoTrueClient` with public custom storage/fetch, starts one `refreshSession`, holds its HTTP response behind a deferred barrier, and starts one or three additional calls. It observes that those callers joined the same deferred before releasing a synthetic `400 refresh_token_not_found`. The stored access token is expired. A getter or removal then throws inside terminal cleanup. Tests instrument the internal deferred only to observe its settlement; there is no application-side SDK mutation or timeout workaround.

**Actual:** the initiating call rejects with the storage exception; the joined callers retain an unresolved promise. `finally` clears `refreshingDeferred` without resolving or rejecting that promise. A later successful refresh creates a different deferred and cannot rescue the old callers. The base passes 8 healthy/delayed/proactive controls and fails all 10 failure cases, for two and four callers.

**Expected:** every joined caller settles with the same relevant failure, exactly once; the initiating caller keeps observing the original storage error. Retained credentials or an unacknowledged removal must not be described as successfully erased.

**Root cause:** the `isAuthError(error)` branch in `_callRefreshToken` awaits storage inside its catch. If that work throws, execution skips both the branch's `resolve(result)` and the outer catch's non-Auth `reject(error)` statement. A catch does not catch its own exception. #2627's no-op rejection handler prevents an unhandled rejection when the deferred is rejected, but it does not settle a deferred which was never rejected.

**Minimal proposal:** wrap only the Auth-error handling branch in an inner try/catch. On cleanup failure, reject the existing deferred with that same error and rethrow it. Preserve the cleanup, cache assignment, successful result and `finally` behavior. `terminal-refresh.patch` is independent of #2709/#2742 and contains no initialization API change.

**Coverage:** two/four callers; getter/remove failures; abort/quota-like failures; delayed durable acknowledgement; committed removal with lost acknowledgement; later success; exact deferred resolve/reject counts; exact primary-key removal and event counts; residual bytes; success; healthy terminal errors; proactive preservation; same-token cooldown; different-token recovery and cooldown clearing after success. 18 new tests pass with the patch, plus the existing single-caller `refreshRejection` regression.

**Related work:** #2708/#2709/#2742 concern initial subscription loading; #2767/#2769 and #2568 concern offline cooldown/resume; #2715 concerns classification of 429/408; #2759 concerns session-write races; #2756 concerns wrapper session-error propagation. None of the inspected descriptions resolves this catch-time orphan. #2759 touches nearby code and will require a fresh rebase/retest if merged. Please redirect this report if there is an equivalent tracker not found in our search.

## C. Proposed terminal-fix PR description

**Suggested title:** `fix(auth): settle refresh waiters when terminal cleanup throws`

When a terminal refresh response is followed by a storage exception during cleanup, only the initiating caller currently rejects. Concurrent callers remain attached to a deferred that `finally` drops without settling. A later successful refresh does not complete them.

Catch failures inside the Auth-error branch, reject the same shared deferred, and rethrow the original cleanup exception. Keep terminal Auth results, proactive session preservation, failure cooldown, cleanup ordering and notification behavior unchanged. This patch is independent of initial-session fixes and does not change the public initialization contract.

Validation on master `51816da3805daf2aed7393870e34d7e3374edb69`:

- Before: 10/18 new terminal tests fail specifically because the shared deferred is never rejected; eight controls pass.
- Terminal-only patch: all 18 tests plus existing `GoTrueClient.refreshRejection.test.ts` pass (19 total).
- Combined locally with #2742 and its proposed callback supplement: 53 tests across seven upstream suites pass; upstream Auth builds and its test TypeScript configuration pass.
- Separate real-SDK Node and Chrome experiments preserve account/generation isolation and storage-failure observations. Those are local supporting evidence, not a claim that this PR passed upstream CI or that a release is production-approved.

Risk: callers which previously hung now reject (or receive the SDK's existing public Auth-error wrapping if the thrown value itself is an AuthError). Cleanup failure is deliberately observable. No automatic retry, session removal, `SIGNED_OUT` event, timeout, dependency or lock is added. A committed-but-unacknowledged removal remains an error with an uncertain durability outcome, even though the fixture can inspect its actual bytes. This does not make multi-step storage cleanup atomic, solve shared-slot account races, or guarantee JWT invalidation.

## D. Initialization propagation proposal intentionally withheld

No upstream `_recoverAndRefresh(true)` proposal is prepared. Independent testing shows the broad flag changes four existing initialization expectations while leaving the nested `_getUser`/`_saveSession` catch error-tolerant. Offline/503 errors returned by `_callRefreshToken` do **not** become fatal merely because of this flag; the real concern is incomplete coverage and a changed cached public result for any escaping exception, not a proven blanket offline regression.

An application using the supported storage interface can record and rethrow failures at the operation boundary, and gate protected admission on health, public initialization/session results, valid identity/expiry and generation authority. A successful preflight is insufficient. The health record is per admission attempt and is not cleared by a later successful read. Explicit retry must create/revalidate a controlled attempt without reviving a retired generation. This contract needs the SDK subscription and terminal settlement fixes as prerequisites; by itself it does not make today's released SDKs acceptable. No new SDK initialization API is requested in these drafts.
