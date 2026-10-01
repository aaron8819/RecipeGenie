# Dashboard integration plan

The approved local mockup adds a Dashboard destination alongside the existing
Recipes, Planner, Shopping, and Pantry screens. Integrate its presentation with
the current authenticated shell and domain hooks; do not ship the standalone
fixture application or replace the other screens. The shopping selection and
searchable swap modals are approved improvements to share with Planner.

This document is an implementation proposal, not authorization to commit,
push, apply migrations, merge, or deploy. Planning is Tier 1. Any eventual
database function change and production rollout require their own classification
and explicit authorization under `AGENTS.md`.

## Implementation progress

Focused layout polish is complete locally after integration commit `8acf0b2`.
No-photo meals use compact illustrated headings; photo cards retain their images.
Mobile populated Today uses the heading action without a second add card, and
weekly date headers own the add action so meal titles have room to wrap. Shared
Add and Swap pickers keep controls and actions visible around independently
scrolling results. Add shows the selected calendar date and existing week-wide
duplicate status with the assigned day, without changing selection rules.

Polish verification: Chromium browser inspection at 1440×900 and 390×844 covered
photo/no-photo cards, one/multiple meals, long weekly titles and multiple meals
per day, empty Today, Shopping counts zero/one/three, scrolling Add/Swap results,
selected-date context, duplicate indicators, keyboard Escape/return focus, and
44px action targets. In the same one-meal/no-photo mobile case, Shopping's top
moved from 856.04px to 561.49px (294.55px earlier). All 107 files / 1,635 unit tests
pass with two workers; the two focused dialog files / eight tests, lint, type
checking, repository guards, dependency checks, and webpack production build pass.
Screenshots and logs are ignored local artifacts; disposable local fixtures were
removed. Safari and a physical iPhone/onscreen keyboard remain unverified. Local
HTTP storage photos encounter the existing CSP restriction, so photo layout was
verified using a temporary same-origin image; no security policy was changed.

Slice 1 is implemented locally: Planner meal/week actions use the shared Shopping
selection dialog, including per-recipe yield and ingredient subsets. Existing V3
contributions and CAS replay remain the persistence authority. No migration is
introduced. Verification: `npm run verify` passes all 104 files / 1,619 tests;
`next build --webpack` passes. The disposable local verifier
`node --import tsx scripts/verify-shopping-selection-local.mjs` passes authenticated
V3 SQL round-trip and real desktop/mobile Chromium Planner flows, including axe
accessibility checks, saved-selection recovery, quantity preservation, and weekly
cooked-meal inclusion. Test accounts are deleted afterward; no shared database
reset is performed. Screenshots/logs are ignored local artifacts.

Local limitations: Turbopack cannot build with this worktree's dependency junction,
so webpack is used. Safari/WebKit verification is incomplete because existing CSP
upgrades loopback HTTP resources to HTTPS. No security-policy change is included.
At that slice, commit, push, merge, and deployment remained unauthorized. The
subsequent integration request authorizes committing the accumulated completed
work; push, merge, deployment, and migrations remain unauthorized.

Slice 2 is implemented locally: the searchable swap picker uses a single guarded
UPDATE through existing RLS and UUID ownership triggers. The existing SQL guards
support the replacement contract, so no new database function or migration is
needed. Membership, made state, and assignments are compared at write time;
concurrent changes stop for review. "Surprise me" uses the same guarded path. Verification: 106 test files / 1,628 tests
pass with `vitest run --maxWorkers=2`. Default parallel runs exceeded the existing
92-row Shopping test's 15-second limit; no timeout or assertion was relaxed.
Lint, type checking, migration integrity, UUID write guards, and dependency checks
pass. The local verifier passes desktop/mobile Chromium swap and Shopping flows,
axe checks, chosen-day/cross-category replacement, foreign-owner rejection, and
an actual read/write race where another session marks the old meal cooked. Existing
Shopping contributions and other meals' cooked/day state remain intact. Safari
verification retains the local HTTP/CSP limitation noted above. The webpack
production build passes. A final navigation fix closes the swap dialog when the
displayed week changes; all 12 Planner interaction tests (including that new
regression), focused lint, and type checking pass after that fix. Disposable local
verification accounts are confirmed absent after cleanup.

Slices 3 and 4 are complete locally. `/dashboard` now reads the authenticated
Planner and Shopping data, uses canonical grouping and configured week boundaries,
and shares existing action hooks and dialogs. Desktop and mobile navigation include
Dashboard; Recipes remains the default landing destination. The approved mockup is
preserved separately in `web/mockup/`; fixtures and scenario controls are absent
from the integrated route. Shopping quick-add feedback and check-off intents are
narrow shared helpers used by both entry points. Sunday configuration now uses
nullish fallback in Planner instead of incorrectly treating zero as Monday.

Completed acceptance checks:

- [x] Chromium at 1440×900 and 390×844: approved section order, five destinations,
  direct recipe links, recipe return after refresh, root redirect, no horizontal
  overflow, accessible menus, keyboard Escape, dialog return focus, and touch
  controls. Axe reports no violations in Dashboard and the shared selection dialog.
- [x] Real populated, partially planned, multiple-meals-per-day, empty,
  all-cooked, and all-shopping-completed states; seven days and explicit week range.
  Sunday week boundaries agree with the linked Planner week.
- [x] Recipe opening, date-prefilled add picker, cooking/history, cooked action
  restrictions, explicit searchable swap, selected day, Surprise me, move, remove,
  retained Shopping contributions, and reload persistence.
- [x] Per-meal and displayed-week Shopping selection, adjustable servings,
  ingredient subsets, saved selections, canonical quantities/aggregation,
  duplicate quick-add, first-five preview, remaining counts, rapid check reversal,
  full-list completion, and cross-view persistence.
- [x] Loading remains distinct from empty. Injected Planner and Pantry failures
  preserve the successfully loaded section, show an error, and recover with Retry.
- [x] Existing local disposable-user verifier covers owner denial, cooked and
  duplicate rejection, stale-state races, preserved scale/unrelated assignments,
  selection replay/re-addition, and real V3 SQL validator round trips.
- [x] Full unit regression: 107 files / 1,633 tests with two workers, including
  server-render date initialization and local midnight/year rollover. Production
  webpack build passes. Local database checks: 208 SQL tests and generated-type
  parity. Required lint, type, hygiene, migration-reference, UUID, and cycle checks
  are recorded with the final commit verification.
- [x] Nine local smoke checks pass across the baseline run and focused rerun of
  both Shopping mode checks. The stale Shopping fixture helper now uses current
  ingredient/instruction controls and waits for canonical search navigation.
- [x] Root redirect, logo target, manifest start URL, and PWA launch configuration
  are unchanged in the accumulated diff.

Run the guarded integration checks from `web/` with Node 22:
`node --import tsx scripts/verify-dashboard-local.mjs`. It requires the existing
loopback Supabase runtime, refuses an occupied app port, creates disposable users,
deletes them afterward, and never resets the shared database. Evidence lives in
ignored `.codex-artifacts/dashboard/`.

No implementation slices remain. Safari and actual native iPhone Home Screen
launch require device/browser verification; preserving launch configuration is
not evidence of executing that launch. Webpack remains necessary for the linked
worktree dependencies. Production rollout is outside this authorization.

## Approved scope

- Desktop: Today and This week on the left, Shopping preview on the right.
  Preserve desktop account/profile, Help, and Sign out.
- Mobile: logo and account/profile at the top, no Help button; fixed bottom
  navigation with Dashboard plus the four existing destinations. Content order
  is Today, Shopping, This week, with safe-area padding and no covered controls.
- Dashboard uses the approved spacious meal cards, labeled Mark as cooked,
  and accessible overflow menus. Existing Planner and Recipes cards retain
  their presentation.
- Keep the root landing redirect, logo navigation target, PWA `start_url`,
  icons, and iPhone launch behavior unchanged. Dashboard is an explicit route,
  not the new default. Remove mockup badges and development controls from the
  production destination.
- Existing full screens remain intact. Quick Meal Mix, generation, templates,
  Shopping management, and Pantry editing remain in their current destinations.

## Existing implementation and gaps

| Area | Current implementation | Integration work |
| --- | --- | --- |
| Shell | Separate authenticated routes; desktop sidebar and fixed mobile bottom bar | Add `/dashboard` and fifth nav item; remove mobile Header Help control, retaining desktop Help |
| Week and meals | Planner hooks plus pure date, assignment, grouping, and made-state selectors | Reuse these for the configured current week and every meal; avoid an independent assignment model |
| Recipe opening | Canonical recipe detail route; return source recognizes Recipes, Planner, Shopping | Add Dashboard as a source and verify Back, direct links, refresh, and fallback return |
| Plan picker | Existing `AddRecipeToPlanModal` accepts target day and week start | Reuse it for Today and unplanned days; only adapt presentation where necessary |
| Shopping add | `useAddToShoppingList` accepts recipe UUIDs and a single scale, resolves all ingredients | Add per-recipe servings and optional source-ingredient selection through the existing mutation seam |
| Shopping storage | V3 document supports per-recipe resolved ingredient entries; one contribution per UUID | Persist filtered contributions in the same document; no new shopping table/model proposed |
| Swap | `useSwapRecipe` randomly selects a category replacement, reads plan, then upserts | Add explicit replacement and selected day with atomic owner-scoped validation; do not implement remove followed by add |

Evidence is the checked-in code at base `f682945`, not a remote-state audit.
The mockup's fixed date, empty Pantry context, and simplified recipe details
must be replaced with real domain state in the integrated route.

## Data and action contracts

### Dashboard reads and navigation

Mount the route under `web/src/app/(authenticated)/dashboard/`. Subscribe only
to the active route's required owner-scoped queries: planner configuration,
current weekly plan, its recipes, cooking history required by existing made-state
rules, and the canonical Shopping projection with Pantry context. Do not keep
the Planner or Shopping screens mounted behind Dashboard.

Use local calendar dates and the configured week start. Reuse
`normalizeStoredDayAssignments`, `groupRecipesByPlannerDay`, and
`isRecipeMadeForWeek`; include the same fallback assignment behavior as Planner.
Derive Today by calendar date, not by a hard-coded weekday or UTC date string.
Update the current date at local midnight and when a suspended tab resumes;
switch to the new week without rendering the prior week's meals as current.

Open planner for the displayed week using canonical planner route state. View
all/View list opens the existing `/shopping` route. Image/title opens the actual
recipe detail route with a Dashboard return source.

Loading and errors are separate from empty success. Treat an absent weekly plan
as empty only after a successful query. Retry failed queries. Keep successful
sections usable when an independent section fails, and show the failure in its
own section. Do not show an empty list after a Shopping or Pantry-context failure.

### Meal actions

Use existing mark-made, add, move, and remove hooks and owner-scoped cache keys.
Preserve cooked restrictions: cooked meals can move or be removed; swap and
per-meal Add to shopping are unavailable. Mark as cooked uses the assigned
calendar date through `toLocalNoonISOString`, with existing history effects and
Undo behavior. Removal deletes the scheduled membership, never the recipe.

Keep per-meal pending state, visible failure feedback, and existing Undo flows.
Dashboard and Planner must agree immediately after mutation and after refetch.
Moving remains within the displayed week, as in the current card menu.

### Shopping selection and servings

Create one shared shopping-selection dialog. Open it with one meal or all
recipes in the displayed week. Weekly selection includes cooked meals, matching
the current Add Plan to Shopping behavior. Initially select all eligible source
ingredients; initialize servings from recipe yield and the plan's current scale
where applicable. Allow per-recipe servings and ingredient subsets.

Extend `useAddToShoppingList` rather than introduce another persistence hook.
Keep its existing callers compatible: omitted selections mean all ingredients;
omitted per-recipe scale retains the current scale behavior. Use canonical yield
and rational scaling helpers for production recipes, including structured
quantities, packages, ranges, and non-serving yields. Do not port the fixture's
simple numeric scaling arithmetic directly.

Selection refers to source ingredient occurrences before aggregation, not
shopping display names or aggregate row indexes. Capture source paths against
the recipe content shown in the dialog; verify that content on submission.
If an edit changes those paths or quantities, refresh and require a new selection
instead of silently applying stale indexes. Reuse the central ingredient resolver
to produce selected, scaled entries; retain all resolved semantic metadata.

Apply the selected recipes in one existing document mutation. Re-adding replaces
that recipe's contribution rather than multiplying it. Unselected recipes remain
unchanged; deselected ingredients remove only that recipe's contribution, leaving
other recipes and manual rows intact. Preserve checked overrides for surviving
aggregate identities and normal Pantry/exclusion policy. Tell the user that
re-adding updates that recipe's selection. Disable submission when no ingredients
are selected; do not persist empty contributions accidentally.

Initialize a previously added recipe from its saved contribution when its source
mapping can be recovered safely. The V3 document does not persist a durable source
selection mask, so ambiguous mappings after recipe edits must fall back to an
explicit fresh-selection notice, not an inferred match by name. Prove this behavior
in the first implementation slice before claiming selection persistence is complete.

The document appears sufficient for filtered contributions without a schema-version
change; confirm the client and SQL validators with real local round-trip tests.
Use existing revision checks, serialized writes, conflict replay, projection,
aggregation, quantity formatting, and preferences. No alternate shopping model.

### Shopping preview

Take the first five unchecked visible rows from the canonical ordered projection.
Use its quantities and additional quantities with existing formatting helpers.
Count all remaining visible rows, excluding Pantry/excluded buckets. Quick add
uses the current comma splitting, duplicate identity rules, feedback, and input
focus behavior. Reuse row references and existing check-off intent handling so
rapid taps and failed writes cannot overwrite newer intent or show false counts.

Per-meal and weekly additions invalidate/update the same cache used by the full
Shopping screen. Completion, if accessed through View list, remains the existing
all-checked completion/Undo behavior. Do not clear the whole list from a Dashboard
preview checkbox action.

### Explicit swap

Provide a shared searchable recipe picker with scheduled day selection. Exclude
recipes already in the displayed plan. Preserve the existing randomized swap as
a separate Planner capability if needed; do not silently remove it when adding
the picker. The explicit choice may span categories, as the approved picker does.

The existing swap helper performs a client read followed by a full-plan upsert.
Do not copy that pattern or compose remove/add writes. Implement a targeted atomic
owner-scoped replacement that verifies the old membership, rejects a cooked old
meal, verifies ownership of the replacement, rejects duplicate membership, and
updates membership plus day assignment together without changing unrelated
meals, made state, or scale. Surface stale-state failures and refetch the plan.

The implementation uses migration 031's owner-scoped invoker RPC. It locks the
plan and source recipe, compares current membership, made state and assignments,
and checks current-week history after any concurrent history writer commits.
History writes share the source lock. RLS and UUID synchronization validate
ownership. Only membership and assignments change.

Assess reuse of an existing atomic command first. If none supports these guards,
prepare a narrowly scoped additive database function under the existing migration
runbook. That is a separate reviewed change; this plan specifies no migration
execution commands or authorization. Swapping/removing a meal must not silently
remove its already-added Shopping contribution.

## Implementation sequence

1. **Shared shopping selection.** Implement the pure selection/scaling adapter,
   extend the existing add mutation, and connect the dialog to Planner's meal and
   week actions. Prove filtered contribution persistence, re-addition, checked
   state, concurrent conflict handling, and stale recipe detection locally.
2. **Explicit swap.** Implement the atomic command path and shared picker, then
   connect Planner. Validate ownership, cooked restrictions, duplicates, chosen
   day, stale membership, and preservation of unrelated state. Any additive
   database function remains separately reviewed and unapplied until authorized.
3. **Dashboard route and shell.** Reuse the verified actions and production
   selectors in the approved layout. Add navigation, Dashboard recipe-return
   support, and the agreed mobile header. Leave other destination layouts intact.
4. **Integration verification and delivery.** Test locally with disposable
   authenticated fixtures, prepare reviewable changes and an evidence summary,
   then stop before any unauthorized commit, push, merge, migration, or deployment.

Keep each slice reviewable. Do not copy the standalone mockup app into the
authenticated shell, build generalized dashboard infrastructure, or refactor
Planner orchestration solely to reduce its file size.

## Acceptance and verification

- Run the environment doctor before environment-sensitive checks; use the pinned
  runtime and established local E2E bootstrap/credential contract. Never fall back
  to production credentials for write-capable tests.
- Test pure grouping/date selectors and selection/scaling adapters where behavior
  is new. Include configured week boundaries, month/year rollover, multiple meals,
  cooked/history rules, source subsets, shared ingredient aggregation, and packages.
- Test Shopping mutation compatibility, revision conflict replay, partial re-add,
  preserved checks, recipe-edit invalidation, and client/SQL validator round trips.
- Test swap with disposable local users and real database state: ownership denial,
  atomic success, cooked/duplicate rejection, stale-plan rejection, and no loss of
  unrelated meals or assignments. Use the repository's required database checks
  and generated-type verification if an additive function is introduced.
- Authenticated browser checks at 1440×900 and 390×844: route switching and Back,
  direct recipe links, fixed bottom bar/safe areas, profile/sign-out, desktop Help,
  all action dialogs, keyboard focus, 44px touch targets, scrolling, multiple meals,
  empty/loading/failure/retry states, and immediate cross-screen shopping updates.
- Verify the root redirect, manifest start URL, logo target, and launch behavior
  stay unchanged. No fixture selector, placeholder screen, fixed evaluation date,
  or preview-account behavior may enter the production route.
- Run the repository verification baseline and production build for implementation
  changes. Document any unavailable local capability with its actual evidence.

Planning verification on September 30, 2026: reviewed source contracts and domain
documentation; workflow doctor confirmed Node 22.23.1/npm 10.9.8 and local verification
capability. No remote project health or migration state was checked. The approved
mockup and existing uncommitted work are preserved on `codex/dashboard-mockup`.

## Source files

- `web/src/app/(authenticated)/authenticated-shell.tsx`
- `web/src/components/layout/{desktop-sidebar,bottom-nav,header}.tsx`
- `web/src/components/planner/{meal-planner,add-recipe-to-plan-modal}.tsx`
- `web/src/components/planner/meal-planner.selectors.ts`
- `web/src/hooks/use-planner.ts`
- `web/src/hooks/shopping/use-shopping-document.ts`
- `web/src/lib/{shopping-document,shopping-ingredient-resolution,recipe-detail-navigation,planner-route-state,planner-utils}.ts`
- `docs/{planner-component,shopping-component,recipes-component,ARCHITECTURE_GUARDRAILS}.md`
- `supabase/SCHEMA.md`, `web/public/manifest.json`, `web/src/app/page.tsx`

## Independent-review corrections — October 1, 2026

Integrated current `origin/main` at
`624a97f9a39f6cc444b58dc13c07b49f58c3172e` into `codex/dashboard-mockup`.
Shopping conflicts retain main's authoritative V4 screen and command admission.
The earlier conditional UPDATE description above is superseded by migration 031's
owner-scoped invoker RPC and shared recipe/history lock. The user authorized
applying migrations only to a new disposable local stack (API 55321, DB 55322).
Shared local and production databases were not migrated.

The six review findings are corrected through authoritative partial-source
reconstruction, shared check evidence, per-image failure fallback/direct loading
for external hosts, atomic history-aware swaps, saved-scale yield initialization,
and explicit dialog focus restoration. Dashboard menu actions now open dialogs
only after the menu closes, avoiding an Escape/focus layer race. No approved
visual layout or global CSP/image allowlist was changed.

Browser regressions also exposed focus loss after successful saves: Planner's
Shopping trigger now stays enabled during success feedback, successful empty-slot
Add selects the persistent Planner fallback before that slot disappears, and
Dashboard keeps its Add dialog mounted while closing so Radix can complete focus
restoration. Cancel and Escape still restore the initiating control.

Regression coverage lives in `dashboard-shopping-contract.test.ts`,
`shopping-check-intents.test.tsx`, `dashboard-meal-image.test.tsx`, the updated
Shopping selection/swap hook tests, and `planner_history_swap_guard.sql`.
`test-dashboard-history-race.mjs` verifies a real concurrent history transaction;
`verify-dashboard-corrections-local.mjs` verifies both requested browser sizes
using disposable users and actual persistence. These are new candidate checks,
not claims that modified review-only fixtures prove the unchanged product works.
The final finding-to-fix handoff records exact commit/tree IDs and verification.
Safari and physical iPhone remain unverified.

Candidate verification: 133 unit test files / 2,066 tests pass with two workers;
lint, type checking, webpack production build, migration reference integrity,
staged artifact/secret/skip/type-error/UUID guards, and dependency checks pass.
The disposable database passes 218 SQL tests across seven files and generated
type parity. The two-transaction history race passes. Actual browser flows pass
at 1440×900 and 390×844, including persistence, cross-view checks, image cases,
stale-history rejection, dismissal, success and failed-save retry focus.
