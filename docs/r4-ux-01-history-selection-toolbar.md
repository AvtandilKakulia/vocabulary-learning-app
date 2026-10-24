# R4-UX-01 — Responsive History selection toolbar

Base: `6386ad1b4d9467d99cd4557550d61e424084a694`, including merged R4-STAB-01 (#56).

## Visual refinement

The previous toolbar used two/three equal grid columns, 64px minimum button heights, a reserved empty Clear Selection slot and a bright full-width gradient deletion action. Working selection/deletion behavior was not a bug. The visual weaknesses were oversized desktop controls, conspicuous empty space when Clear Selection was absent, and a destructive action with disproportionate visual weight on mobile.

The toolbar now has a subtle blue/neutral bordered panel, consistent rounded corners and 8px action spacing. Buttons have a 44px minimum height and expand vertically only when text wraps. Regular actions use a neutral surface with blue text; deletion uses a restrained red border/background/text treatment. Exact button labels and the complete selection-count sentence are retained. Tabular digits help counts remain readable.

Below the existing `sm` breakpoint, actions stack at the available width in the order Select/Deselect All → optional Clear Selection → Delete Selected. At wider widths they wrap naturally, with a stable 256px minimum for Select/Deselect All and natural widths for Clear/Delete. Delete is aligned to the trailing edge when space permits. There are no invisible buttons or empty reserved grid cells.

The conditional Clear action intentionally adds/removes a real row on narrow screens. Long Select All labels may also require two lines. This natural height change is preferred to retaining an empty mobile slot or clipping the unchanged accessible label. Desktop controls retain their alignment and Select/Deselect width; this is not a promise of identical toolbar height at every selection/count/viewport combination.

## Behavior and accessibility

Only toolbar presentation markup/classes changed in `History.tsx`. Existing event handlers, disabled expressions, `allSelected`, `eligibleIds`, confirmations, owner scoping and query/deletion logic are unchanged. The non-interactive wrapper around conditional Clear Selection was removed. No record schema, account lifecycle or History filter/statistics semantics changed.

The named `role="group"` and polite live selection announcement remain. All controls are native buttons with their existing names and native disabled behavior. Explicit `focus-visible` rings use blue for regular actions and red for deletion, with a contrasting offset in both themes. The decorative trash icon remains hidden from assistive technology. DOM/tab order matches the logical action order; absent Clear Selection does not leave a focus target.

## Real-browser validation

Used the actual Chromium-based Codex in-app browser with explicit viewport overrides and a separate minified production-mode Vite fixture. It imports the actual History component, row components and application Tailwind CSS; the Auth and Supabase boundaries are replaced with a synthetic account and in-memory authorized ranged responses. CSP blocks outbound connections; the fixture explicitly refuses deletion. No production credentials, accounts, database or network service were used.

Tested **36 combinations**: six widths × zero/partial/full selection × light/dark, using **5,000 synthetic records**. Widths: **320, 375, 390, 768, 1024, 1440px**, each with a 900px viewport height. Captured a toolbar screenshot for each combination and measured the actual mounted DOM/button bounds and computed colors. Inspected mobile light/dark, tablet and desktop screenshots.

| Check | Result |
|---|---|
| All requested widths, both themes and three selection states | 36/36 passed |
| Horizontal document overflow | None; scrollWidth never exceeded clientWidth |
| Toolbar labels/count clipping | None in measured states; text wraps |
| Minimum button height | 44 CSS px |
| Enabled button text contrast, minimum measured | Light **5.49:1**, dark **7.25:1** |
| Keyboard focus | Visible blue and red two-pixel rings/offset observed through keyboard interaction |
| Selection across pages | 5,000 remained selected after Next; mounted row had `aria-pressed="true"` |
| Filtering after full selection | Direction filter produced 2,500 matching records and cleared selection according to the existing rule |
| Empty collection at 320px | Select All 0 and Delete Selected (0) both visible and disabled |

Contrast values use standard sRGB relative luminance for actual computed foreground/background colors of enabled buttons, including observed hover/focus surfaces. Disabled opacity is not presented as enabled-text contrast. Count text uses dark blue/light blue on the corresponding light/dark panel and was visually checked. This is not a full application accessibility certification or a screen-reader announcement test.

Browser assets and 36 screenshots are local ignored artifacts under `tmp/r4-ux-01/`, including `light-partial-320.png`, `dark-partial-390.png`, `dark-full-1440.png` and `visual-results.json`. The viewport override was reset and the temporary tab/server closed after verification. No browser deletion request was made; deletion outcomes are exercised by component tests.

## Regression coverage

Added three small-dataset cases to the existing pagination test file:

1. Empty-state exact accessible names, live count, visible disabled actions, ignored clicks and no confirmation/deletion.
2. Zero, one, multiple partial, full, deselected and cleared selections; exact action lists/no duplicates; keyboard Enter on Deselect All and Space on Clear Selection.
3. Loading and coordinated-deletion busy states disable every applicable toolbar action; ignored clicks cannot open a confirmation or send deletion; controls become usable afterward.

All pre-existing tests remain. The R4-STAB-01 file-local decorative SVG optimization and the complete real-DOM pagination helpers are unchanged. The new tests use at most six records, without additional full-history traversals. Existing tests cover cross-page selection, filter/account invalidation, stale callbacks, pending actual deletion requests, confirmations, successful/failed deletion and authoritative refresh; those protections were not rewritten for this visual task.

State coverage: empty and loaded-zero states (new case 1/browser); one/multiple/full selection (new case 2/browser); cross-page and filtering (existing tests plus browser); loading and busy (new case 3); actual pending/success/failure deletion (existing History and bulk-delete regressions).

## Validation and performance

| Check | Actual result |
|---|---|
| New focused accessibility/state tests | 3/3 passed |
| Complete targeted pagination file, first new-layout run | 114/114 passed, 49.69 s file execution |
| Paired comparison: original toolbar, same 114 tests | 114/114 passed, 40.52 s; slowest test 2,087.8 ms |
| Paired comparison: new toolbar, same 114 tests | 114/114 passed, 40.76 s; slowest test 2,079.3 ms |
| TypeScript / ESLint | Passed; zero errors / lint warnings |
| Complete default-worker `pnpm test` | 806/806 passed, 37/37 files, 81.05 s reported duration |
| `pnpm build` | Passed, 9.42 s Vite build; existing >500 kB chunk advisory, bundle now 526.48 kB |
| `git diff --check` | Passed |

All three complete targeted runs and the full suite passed without timeout or assertion failure. The first targeted run was slower than the later paired comparison, so it is not used alone to infer a styling regression. The original-toolbar comparison temporarily restored only the base History source, retained the same 114 tests and R4-STAB-01 mock, then restored the final source exactly before its repeat. The 0.6% paired difference is not significant evidence of regression. This is a small same-machine diagnostic, not a statistical performance guarantee. The original R4-STAB-01 median from an earlier task is not treated as an identical-load baseline.

The 803 pre-existing tests remain alongside three new focused cases. No timeouts or global worker settings changed. Existing History deletion/error/isolation tests passed as part of the complete suite.

Commands: `pnpm exec tsc -b`, `pnpm lint`, `pnpm test`, `pnpm build`, `git diff --check`. A full targeted JSON run additionally checks all History pagination tests and per-case timings. Existing CI remains unchanged, including 200 PostgreSQL authorization and 30 word-version checks; the final run URL/results are recorded in the PR.

Changed files:

- `src/components/History.tsx` — toolbar styles/layout only.
- `src/components/History.pagination.test.tsx` — three focused accessibility/state regressions.
- `docs/r4-ux-01-history-selection-toolbar.md` — this report.

## Manual Preview verification and remaining limits

For independent Preview verification, use an approved intercepted/mocked synthetic dataset; do not create or delete Production records for this review. Check zero, partial and full selection at the six widths in both themes; Tab through actions and verify rings; confirm that disabled Delete Selected (0) cannot open a dialog. Select across pages, then change a filter and check the existing clearing rules. Open Delete Selected and cancel to inspect confirmation without deleting records. Actual deletion checks belong to isolated disposable fixtures only.

Visual verification covers this toolbar in the actual History component with the normal main-width/padding wrapper. It does not certify the complete application's unrelated navigation at every mobile width, every browser/font/zoom configuration, actual touch hardware or screen-reader output. No production deployment was performed. Recommend merging only after independent review and manual Preview verification; do not merge as part of this task.

Selection and deletion functionality were preserved.

Production Auth and Supabase dependencies were not changed.

Nothing was submitted to the upstream Supabase repository.
