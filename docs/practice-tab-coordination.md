# Practice across browser tabs (R3-A28)

## Ownership and handoff

The old account-scoped storage key prevented cross-account restoration, but two
independent editors could still overwrite the same account's checkpoint with stale
counters, queues or a reset. The initial two-root regression reproduced that lost
update before ownership protection was added.

`practiceOwnership.ts` holds an **exclusive Web Lock** for the active editor's
entire lifetime, keyed by account. The browser grants ownership; localStorage and
BroadcastChannel do not elect an owner. There is no persistent lock, heartbeat,
lease expiry, lock stealing or compare-and-swap assumption.

`PracticeAccess` mounts the editor only after the lock is granted. A passive tab
only reads the saved progress count; it does not fetch vocabulary, migrate a
legacy snapshot or expose editing controls. Real `storage` events refresh that
read-only preview. Changing focus does not transfer ownership.

**Continue in this tab** requires confirmation. A BroadcastChannel message asks
the current owner to checkpoint its committed React state. Its live permit is
revoked synchronously before it releases the lock. Only then can the waiting tab
mount an editor and restore the latest storage copy. A token prevents a delayed
message for an earlier owner from releasing a later owner. A failed checkpoint
keeps the original editor active and explains how to retry. Unchecked answer text
is not persisted; the confirmation explicitly warns that takeover loses it.
Checked answers retain the existing recovery behavior: advance past a checked
presentation once, requeueing it only when it remains unresolved and retry is on.

Storage writes, legacy migration, removal, answer/navigation/reset handlers,
vocabulary responses, delayed callbacks and completion handling all require a
live account-matching permit. A small runtime cleanup barrier handles React
StrictMode's cancelled initial acquisition; it does not replace browser exclusion.
Identical snapshots do not cause redundant storage writes. The persisted session
schema and existing account keys are unchanged; malformed and incompatible data
are retained.

## History and delayed responses

The existing stable result UUID is checkpointed before any insert. A second Web
Lock, keyed by account and result UUID, serializes inserts across independent JS
runtimes. After waiting, a save rechecks both its live editor permit and the exact
checkpoint before sending a request. An already-started request can finish after
its editor leaves; it cannot erase another editor's checkpoint.

Cleanup requires an editor permit and the exact raw checkpoint that was sent.
An old response may try a short `ifAvailable` editor lock; it never waits behind a
new active editor. If cleanup is unavailable, recovery remains in storage. The
new owner can use **Retry Save** to reconcile the same UUID, waiting for an earlier
in-flight request if necessary. An unknown cross-tab response remains unconfirmed,
not a claimed failure. A successful retry's duplicate-key response is accepted
only after the existing account/result/payload lookup matches exactly. History
payloads and database schema are unchanged.

Closing a page releases browser locks, but cannot cancel a request already
received by the server. Recovery therefore still depends on the existing History
primary-key uniqueness and exact duplicate verification. A lost response can
produce a repeated insert attempt with the same ID, not a new History identity.
Separate intentional sessions continue to get separate IDs. Copies from before
stable result IDs were introduced retain their existing recovery limitation:
an earlier committed result with no recorded ID cannot be identified reliably.

## Browser scope and limitations

- Web Locks requires a supported browser and a secure context (HTTPS, or localhost
  for development). If absent or denied, Practice is read-only with an explicit
  compatibility message. There is no best-effort writable fallback.
- BroadcastChannel is optional. If unavailable, the waiting tab can continue only
  after the owner closes or leaves Practice. A frozen/background owner may also
  need to be closed; there is intentionally no timeout that permits two editors.
- Closing/reloading a page or navigating away releases its editor lock. OS/browser
  termination releases native locks without a persistent lock to repair. Native
  verification covers page closure and reload, not forcibly killing the OS process.
- Coordination covers cooperating updated tabs in the same origin, browser
  profile and storage partition. Different devices/profiles/origins do not share
  local progress. Old tabs running code from before this fix, extensions or manual
  storage edits do not obey these locks; reload existing tabs after updating.
- Browser storage failures still prevent reliable checkpointing. The owner keeps
  editing access when a cooperative handoff cannot verify its latest snapshot.
  Closing that owner can lose unpersisted state, as with the existing storage-error
  behavior. No browser mechanism recovers data that was never persisted.

API references: [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API),
[LockManager.request](https://developer.mozilla.org/en-US/docs/Web/API/LockManager/request),
[BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel).

## Reproducible verification

Run the required local checks:

```sh
pnpm exec tsc -b
pnpm lint
pnpm test
pnpm build
git diff --check
```

`practiceOwnership.test.ts` uses independent coordinator/channel participants with
a deterministic browser-lock broker. `FreeMode.tabs.test.tsx` mounts independent
React roots sharing storage, including StrictMode, stale captured handlers,
handoff, storage failures, pending reads/saves and the four-word 4/5 retry sequence.
Save tests also recreate the module registry to test independent pending requests.
jsdom does not have real tabs: only the passive-preview test explicitly delivers
an other-context storage notification. Production never synthesizes writer events.

For native two-page verification, use an installed Chrome/Chromium executable:

```sh
node scripts/verify-practice-tabs.mjs --browser "/path/to/chrome"
```

Windows example:

```powershell
node scripts/verify-practice-tabs.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

The optional script uses Node 22+ and existing installed Vite/esbuild dependencies.
It starts a localhost-only server and a fresh headless browser profile under
ignored `tmp/`, runs the actual Practice UI in independent pages with native Web
Locks/BroadcastChannel/storage, and closes its own browser/server. Auth and History
are mocked; CSP blocks connections. It neither loads Supabase credentials nor
contacts a database. Nine checks cover passive startup/drafts, focus, explicit
handoff/stale handlers/order, owner closure, reload, pending same-ID save,
server-commit/lost-response recovery, unsupported locks and missing messaging.

## Manual Preview checks (separate owner review)

Use two tabs of the **same Preview URL** in the same browser profile, signed in to
the same test account. Do not use Production records for this verification.

1. Open Practice in A, type unfinished text, then open Practice in B. B must show
   the passive message and no editor controls; focusing either tab must not move
   ownership or clear A's draft.
2. In A, answer incorrectly, advance, change order and answer correctly. In B,
   confirm Continue. Verify the current queue, direction, order and counts restore;
   A becomes passive. A checked presentation should advance once on restoration.
3. Repeat handoff, close the owner, reload and navigate Practice → Words → Practice.
   Latest progress must survive; only one tab should edit. Exercise retry toggles
   and separate Enter presses/held Enter to verify existing protections.
4. Use four words: wrong first attempt, then four correct attempts including the
   retry. Verify 4/5 and 80% in the counter/summary and one historical mistake.
5. With network throttling on a disposable test account, save a completed result
   and take over while the response is pending. Retry in the new tab; verify the
   same result is recovered exactly once. Also test a rejected request and owner
   closure before the response. Save operations here intentionally create History
   records, so perform this only in an approved test setup.
6. Check a different account in an independent test context: its local snapshot
   must not be changed by the first account's handoff/save/cleanup.
