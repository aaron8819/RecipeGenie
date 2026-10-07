# Approved Recipe and Planner application integration plan

Planning only, 2026-10-06. Application baseline: freshly fetched `origin/main`, `8277eeeb06ee68d5c198f0fa9d6d781f9135bacc`. No application or backend changes made. Detailed interaction ownership is in [the capability map](recipe-planner-capability-map.md).

## Frozen design authority

Use `../approved-prototype-review/review/REVIEW.md`, its capability checklist, `identities-reviewed.json`, and byte-identical `reference/recipe` / `reference/planner`. All 54 manifest files were verified against both live and frozen copies; zero mismatches. Reference identity: `992ffd65d2eab8342e647a5076766be349a9bdb4f318b8235aa579d12f4c5cd2`.

| Reference | Live preview | Branch / base | Principal SHA256 identities |
|---|---|---|---|
| Recipe collection/cards/detail | http://127.0.0.1:3174/ | `codex/recipe-ux-prototype` / `353e240d2766a378f352ee96998557359d223182` | `app.tsx`: `7af5a054e995adfad081fd06742817551e99e3c0797c23c4e30b172305903eb6`; served `dist/app.js`: `dc2b035fced08d135658aeffbd224d235f059298a8c888b2c289c69e805f1ed9` |
| Planner | http://127.0.0.1:3184/ | `codex/planner-ux-prototype` / `8277eeeb06ee68d5c198f0fa9d6d781f9135bacc` | `app.js`: `b19b1230c77039ba095bbc513683cf72822112df6d51d7f72a7c101b8907ab86`; `refined.css`: `e33c87b94fa49eb13542b90ca1b4e68753b997a44d8cb48e550cf4baabfa306d`; `refinement.js`: `29ff832ca1eb7821873d1a4714f433d9256d8896686387f63fdc8844bb12b257` |

Do not copy prototype stores, localStorage saves, generation algorithm, ingredient aggregation, replacement snapshots, or navigation shell into the app. Retain authenticated layout, desktop sidebar, mobile header and bottom navigation, including the existing 1024px shell breakpoint. Apply domain-scoped styles and existing UI primitives.

## Scope and sequence

Each slice is independently reviewable; keep orchestration and persistence in current owners. No schema migration is expected for the presentation scope below.

| Slice | Small implementation scope | Focused verification and disposable authenticated journey |
|---|---|---|
| 1. Recipe collection/cards | Update `recipe-list.tsx` / `recipe-card.tsx` hierarchy, title wrapping, consistent photo/no-photo geometry, compact menu and empty states. Retain URL filters/sort/view and browse restoration; keep existing action callbacks. | Existing list/card and recipe-route-state tests. Search/filter to empty results and recover; open detail and return to retained query, scroll and focus; long title/no-photo/dense collection. Pair collection screenshots. |
| 2. Recipe detail | Refine `RecipeDetailContent` using approved grouping and reading hierarchy; preserve quantities, prep, alternatives, qualitative wording and scalable yield. Keep source-aware back navigation and existing editor. | Detail/state, recipe-quantity and detail-navigation tests. Read all sections; change servings within validated bounds; verify exact ingredient text, print and return from Recipes, Planner, Dashboard and Shopping. Pair detail screenshots. |
| 3. Recipe action entry points | Wire cards/detail to the real Shopping selector, AddToPlanDialog, editor, sharing, favorite/delete and history actions. Extend card callback props only as needed. Keep command validation and pending/error states. Resolve saved-yield decision below first. | Shopping-selection and quantity tests plus changed action wiring tests; existing editor/import/sharing tests. Select partial ingredients and servings, submit, reopen and inspect persisted selection; edit while selection is open and recover from stale content; favorite, plan and mark made persist after reload. Separate owner B exercises sharing/isolation. Pair selection/menu screens. |
| 4. Planner presentation | Compact header/week toolbar; readable desktop day panels and mobile day agenda; consistent meal cards, compact empties, one secondary menu. Preserve real day grouping, mobile filters/progress and pointer drag/drop. Keep current hooks in MealPlanner. | Existing planner components/selectors/utils/route-state tests. Navigate date/week/current week; add several different recipes to one day; long titles, no-photo, cooked, empty and dense weeks; keyboard/menu alternative to drag. Pair desktop week/mobile agenda/screens with dialogs. |
| 5. Planner workflows/secondary controls | Relocate existing cooked/swap/move/remove/Shopping controls and templates/generation/settings. Preserve real confirmation, Undo, missing-recipe warning, generation rules and conflicts. No new Clear week or Unassigned behavior in this slice. | Existing planner interactions/template-load, swap dialog, replace-planned-recipe and direct-write tests. Build/revise week; cooked toggle/Undo; explicit and surprise swap; move/remove/Undo; per-meal/full-week Shopping; templates save/load/rename/delete; generate with cooked meals, history exclusions and preferred/excluded days. Reload to verify server state; stale swap must reject safely. Pair action/template/generation states. |

Use focused behavior tests when wiring changes; do not create CSS-mirroring tests. Run documented trusted verification gates for application changes, not ambient npm alone. The workflow's `focused --file web/src/...` escalates to the PR tier; budget for that gate. Relevant test paths and ownership are in the capability map.

## Capability gaps and decisions before implementation

| Difference | Integration disposition |
|---|---|
| Prototype initializes Shopping from currently viewed servings; app restores saved yield before caller default | Initially preserve app precedence; viewed servings may supply default only when no saved selection exists. Exact prototype override requires an explicit narrow selector-prop decision, tests for bounds/ordinals, and Dashboard/Planner regression; no migration expected. |
| Separate Unassigned panel and Move to Unassigned | App persists optional assignment but distributes unassigned recipes into visible day buckets; move accepts only seven days. Preserve existing grouping initially. A dedicated bucket and clearing assignment are workflow changes requiring a separate product/contract decision, even if existing columns suffice. |
| Clear week / prototype wholesale snapshot recovery | No current Clear week control/command found. Exclude; any bulk destructive operation needs explicit semantics for cooked/history/Undo/concurrency and a separate command review. Do not repurpose saveWeeklyPlan silently. |
| Simulated generation replaces the week and is deterministic | Reuse real generator: preserve cooked meals, history/config/category/day rules. Match presentation, not simulated results. |
| Multiple meals can suggest duplicate copies of one recipe | Current weekly UUID set prevents the same recipe twice in a week. Multiple different recipes per day are supported. Repeated instances require a new model/contract and likely migration; out of scope. |
| Expanded Recipe card edit/mark-made/print placements | Existing behavior exists on detail but card lacks these callback props. Add small UI contracts. For print, open canonical detail and use existing print; automatic one-click print needs a separate behavior decision. |
| Stronger concurrency implied by simulations | Shopping commands and replacement/cooked RPCs have stronger guarantees than direct Planner read/upsert paths. Preserve existing checks/rollback/recovery; do not claim all Planner writes are atomic CAS. Stronger multi-writer guarantees require separate RPC/contract and potentially migration work. |

Any new backend contract, migration, repeatable meal-instance model, or destructive operation stops the affected slice for a separately scoped plan before implementation. Unsupported prototype actions must not become success toasts without persistence.

## Shared surface boundaries

Keep `RecipeDetailContent` and source-aware navigation shared. Recipe card styling should not restyle Dashboard's own cards. Reuse ShoppingSelectionDialog and canonical quantity helpers; changes here affect Dashboard, Planner and Shopping. Keep recipe editor's complete import, grouped ingredients/instructions, quantities, alternatives, photo lifecycle and dirty/discard validation. Use only small presentation components/menu callbacks where duplication is real; avoid a generalized action controller or hook rewrite. Do not change global tokens or shell behavior as a side effect.

## Local preview and authenticated fixture plan

Future execution, requiring separate authorization for disposable backend writes:

1. Recheck listeners and local identities. Reuse healthy `Recipe_Genie` Supabase on loopback 54321 only after read-only schema/function/auth readiness checks. Existing container health is not schema evidence. Do not reset or apply migrations automatically. The other healthy Shopping Integration stack on 62821 does not meet the current runtime guard and should not prompt a guard change.
2. Use current guarded dev workflow on `http://127.0.0.1:3107` if free; `local-e2e-runtime.mjs` requires exactly this app origin and backend 54321. Preserve 3174, 3184, older 3111 and Dashboard fixture 3115. Start only an app server; no new Docker stack. If identities/schema disagree, report the specific setup requirement rather than falling back to hosted services.
3. Use pinned Node 22.23.1 / npm 10.9.8 through the trusted PowerShell launcher or explicit pinned runtime. Ambient doctor found Node 24.12.0/npm 11.6.2; invoking bundled npm alone still selected ambient Node for lifecycle scripts. Resolve runtime selection before environment-sensitive tests.
4. Create a task-owned disposable preview owner A and isolation/sharing owner B, with separate owners for destructive automated journeys. Seed Shawarma, Cava Bowls, Thai Basil and Chipotle using frozen editorial fixture content converted through current canonical DTO/write paths; task-owned UUIDs and photo uploads. Add task-owned long-title/no-photo/cooked/dense examples. Never overwrite an existing owner's recipes. The older four-recipe fixture module is useful data, but its loader uses a fixed account and writes credential/env files; do not run its load/reset against existing accounts.
5. Keep credentials/auth states only in ignored local files; provide login instructions without printing secrets. Preserve a stable hands-on fixture after tests. Cleanup may remove only task-owned data when explicitly authorized. Do not use `local:e2e:bootstrap`/reset on the shared healthy stack: those reset database state.

## Acceptance gate for every slice

- Approved visual direction retained; compare frozen prototype and actual app with the same fixture/state, viewport, theme and capture framing. Store baseline and after screenshots with commit/source identity and route. Explain necessary semantic differences explicitly rather than changing the frozen reference.
- Chromium and available WebKit at 1440×900, 390×844 and 320×844. Emulation is not physical-device coverage. No horizontal overflow, clipped titles/actions, trapped scrolling or bottom-nav overlap. Touch targets meet the reviewed reference; keyboard reachability, named menus, focus containment/return, Escape and dirty-dialog safeguards pass.
- Actual authenticated persistence verified after reload for changed journeys; owner isolation and invalid input tested. Preserve source fidelity, canonical UUIDs, quantities, servings bounds, category/tag filters, history semantics, confirmations, pending states and recoverable errors.
- Shopping: stale source selection rejects with reopen guidance, no lost draft or duplicate retry/unknown-outcome effects; current command receipts/revision handling remain authoritative. Planner: replacement conflict rejected/recovered; direct-write paths retain rollback and documented concurrency limits. Undo uses existing behavior, not a prototype snapshot overwrite.
- Dashboard/Shopping/editor regression journeys pass for shared changes, alongside focused suites and the repository's required trusted verification gate. No backend correctness conclusion is drawn from prototype PASS.

## Planner Slice 4/5 preparation — 2026-10-07

This section refines the existing slices; earlier Recipe scope remains intact.
Planning branch: `codex/planner-slice-preparation`, based on locally available
`origin/main` `8277eee`. The primary checkout is older (`f682945`); it is not the
integration base. No fetch or hosted production inspection was performed, so
this audit describes production application source at the recorded base, not
proof of the currently deployed SHA. Reconfirm the authorized base before coding.

Evidence: re-read the independent review and inspected its desktop/mobile initial
screens plus frozen Planner source/CSS. All 30 Planner manifest files match both
the frozen copies and prototype sources (60 comparisons, zero mismatches).
Port 3184 refused both browser and HTTP connections; no listed preview ports
3107/3111/3115/3174/3184 had a listener at inspection. Nothing was restarted.
The earlier independent review remains the interaction evidence; no new live
prototype or authenticated persistence journey is claimed.

### Slice 4: layout only

- Compact Planner title and week/date/current-week controls; visible Add meal
  and Add full week to Shopping. Dates and navigation still use current route
  state and configured week start, including Back/Forward and refresh.
- Replace the seven narrow desktop columns with chronological broad day panels:
  three columns at >=1200px, two at 768–1199px, one below 768px, matching the
  reviewed layout. Panel layout is independent of the unchanged 1024px shell
  breakpoint. Preserve mobile Today/This week filters, day navigation and progress.
- One day-level Add target; compact empty day/week states; consistent image and
  fallback frames; complete wrapping titles, category/time/servings metadata and
  cooked badges. No hardcoded fixture dates, servings, IDs or inferred meal totals.
- Preserve existing day buckets, draggable IDs, droppable day targets, pointer
  activation and drag overlay. Keep the menu move alternative and current action
  availability. Menu presentation may become compact, but workflow relocation
  and dialog entry-point changes belong to Slice 5; never ship inaccessible actions
  between slices. Retain current generation controls until Slice 5 relocates them.
- Use existing presentation components and UI primitives; no new hook/controller,
  global CSS/token changes, prototype shell or shared Dashboard card redesign.
  Use the canonical `use-is-desktop.ts` if breakpoint handling is touched.

Expected edits: `web/src/components/planner/meal-planner.tsx` and
`meal-planner-components.tsx`, with Planner-scoped styling only if utilities are
insufficient. Update `docs/planner-component.md` for the resulting presentation.
Keep selectors, hooks, route helpers, Dashboard, Recipe detail and shell unchanged.

### Slice 5: supported workflows only

- Consolidate secondary week controls into one named menu: generation,
  settings and template save/load. Keep the existing category-count editor,
  confirmations, missing-recipe warnings and template rename/delete accessible.
- Consolidate meal actions through existing handlers: cooked/uncooked, explicit
  swap and same-category Surprise, move among seven days, remove and Shopping.
  Cooked recipes still cannot swap or enter individual Shopping; moving/removing
  remains available, and full-week Shopping includes cooked recipes.
- Retain add/remove Undo, operation pending/error states, dialog focus return,
  replacement conflict recovery and Shopping receipt/revision recovery.
  Removal changes the plan, not the recipe or Shopping/history. Existing add-back
  Undo is not a full made-flag/history snapshot restore; do not improve it silently.
- Preserve generation's actual cooked-ID retention, category/history rules,
  preferred/excluded days, auto-assignment and scale. Do not substitute prototype
  deterministic generation or snapshot Undo. Preserve the existing distinction
  between made flags and history-derived rendered cooked status.

Expected edits: `meal-planner.tsx` and presentation props in
`meal-planner-components.tsx`; only if needed, narrow presentation changes in
`add-recipe-to-plan-modal.tsx`, `swap-meal-dialog.tsx`,
`save-template-dialog.tsx`, `load-template-dialog.tsx`, and
`plan-settings-modal.tsx`. Existing `hooks/use-plan-templates.ts` remains the
template data owner; there is no `PlanTemplates` component at this base (the
earlier capability-map shorthand means the save/load dialogs). No service,
API or SQL edits.

### Four outstanding gaps

| Gap | Existing supported behavior | UI-only option | Contract / migration implication | Minimal first integration |
|---|---|---|---|---|
| Unassigned section / Move to Unassigned | Optional assignments persist; missing assignments are deterministically distributed into day buckets. Move accepts only day indexes 0–6. Dashboard uses the same grouping. | Showing a separate bucket is a selector/view change with no required schema migration, but changes visible day placement and Dashboard Today semantics; it is not a parity-only restyle. | Clearing an assignment can fit the existing assignment map and save hook, but needs explicit absent-key optimistic-overlay, cooked-date, swap expected-day, template, Dashboard and concurrency semantics. No migration inherently required; stronger atomic multi-writer guarantees would need a separate contract/RPC review. | Keep distribution and seven-day Move. Omit the panel/action rather than display misleading empty Unassigned or success feedback. |
| Clear week | No supported bulk-clear control/command. Individual remove preserves history and Shopping while removing the UUID, assignment and made flag from the plan. | A confirmation/menu alone does not implement durable clear. | Define whether cooked meals remain, history/Shopping stay, scale/settings remain, and how Undo interacts with newer edits. A safe atomic bulk operation needs a separately reviewed command/concurrency contract; migration is conditional on the chosen RPC/schema, not automatically necessary. Do not loop removals or reuse generic save as a substitute. | Omit Clear week; retain individual remove/Undo. |
| Same recipe repeated in a week | One UUID per week; add rejects duplicates. Many distinct recipes on one day are supported. Assignments/made flags are keyed by recipe UUID. | Clarify the duplicate restriction; keep already-planned recipes unavailable. Another week is supported. | Independent occurrences need meal-instance identity across assignments, cooking/history, swaps, templates and Shopping source/quantity rules. Requires a new persisted contract and likely migration; removing the duplicate guard alone is unsafe. | Preserve once-per-week rule; do not clone recipes or multiply Shopping contributions. |
| Saved Shopping servings vs prototype defaults | `initialShoppingSelection` restores saved exact scale and safe ingredient ordinals before caller default. Planner and Dashboard supply week scale only as fallback; invalid or stale saved selections trigger review notices. | Preserve precedence and use existing explanatory text; user can explicitly edit yield in the selector. A caller override prop could be a narrow UI contract change but would alter behavior across entry points. | No migration for preserving or explicitly overriding initial yield. Keep bounds 1–100, exact quantities, source snapshots and `upsertRecipes` validation. Persisted source/quantity rules stay unchanged. | Saved selection wins. New entry uses recipe yield × week scale, not fixture four servings. Re-add updates one contribution through the existing command. |

### Shared overlap and parallel-work boundary

Recipe correction branch inspected read-only: `codex/recipe-detail-slice2-corrections`
at `e9fd69a`; its correction since `05a651e` touches Recipe detail component/CSS,
detail tests and `docs/recipes-component.md`. Slice 4 has no direct file overlap.
Do not edit or cherry-pick that branch; reconcile the approved integration base
after the correction lands before implementation verification.

Dashboard owns its `MealMenu` and meal cards in `dashboard.tsx`, while reusing
`groupRecipesByPlannerDay`, assignment normalization, date helpers,
`AddRecipeToPlanModal`, `SwapMealDialog`, Planner add/remove/cooked/move/replace
hooks, and `ShoppingSelectionDialog`. Recipe detail also uses canonical detail
navigation, the add-to-plan flow, history hooks, quantity helpers and Shopping
commands. These are shared behavioral dependencies, even without direct file
overlap. Keep their signatures/semantics unchanged in Slices 4/5; if a dialog
presentation changes, verify both Dashboard and Planner callers. Planner opens
the existing `/recipes/[id]?from=planner` detail path; its URL week stays in
browser history. Recipe's global mark-made action remains distinct from weekly
Planner cooking. Keep all authenticated layout/sidebar/header/bottom-nav files
and Dashboard CSS out of scope.

### Acceptance journeys and focused checks

1. Slice 4: navigate date/previous/next/current week, Back/Forward and reload
   with non-Monday week start. Compare 1440×900, 390×844 and 320×844 against frozen
   evidence; check two-panel tablet at 768/820/1023/1024px and shell boundary.
   Empty week, empty day, six distinct meals/day, long titles, no photo, cooked
   cards and unassigned stored entries remain reachable with no overflow.
2. Slice 4: day Add opens correct configured calendar day; add different recipes,
   reject duplicate UUID, move through menu and pointer drag, then reload.
   Mobile Today/week/day/progress controls still work; details return to the
   correct Planner week with the corrected shared Recipe detail experience.
3. Slice 5: cook/uncook and Undo on an assigned calendar day, explicit cross-category
   swap, same-category Surprise, stale swap rejection/reopen, move/remove/Undo.
   Observe existing history/flag restoration limits rather than promise snapshot Undo.
4. Slice 5: per-meal and full-week Shopping with cooked states; restore saved
   partial ingredients/yield, default unsaved entries from week scale, validate
   1/100 limits and invalid yield, stale source and failed submission recovery.
   Reload Shopping; unrelated manual extras, checked coverage, Pantry/exclusions
   and organization remain intact. Re-adding never duplicates a recipe source.
5. Slice 5: save/load/rename/delete templates, missing-recipe load warning,
   replacement cancellation and real generation with made IDs/history/category/
   preferred/excluded-day settings. Reload confirms persisted intent; Dashboard
   Today/week grouping, add/swap/cooked/Shopping journeys remain consistent.
6. Both: keyboard menus, focus return/Escape, 44px action targets, long-dialog
   scrolling, Undo toast clearance, bottom-nav clearance, loading/error/retry and
   owner isolation. Reuse the prior plan's disposable-fixture and trusted-runtime
   gates; fixture writes and any implementation require separate authorization.

Focused suites: planner `meal-planner-components`, `meal-planner-interactions`,
`meal-planner-template-load`, selectors/utils and route-state; add/swap/template
dialog tests only when touched. Retain `use-planner-direct-writes`,
`use-planner-history`, `use-replace-planned-recipe`, `meal-planner`,
`shopping-selection`, and Dashboard shared-contract coverage. Reuse
`web/tests/meal-planner.spec.ts` and documented authenticated inspection flow.
No application tests were run for this planning-only documentation change.

### Decisions needing user input

Recommended approval package: Slice 4 layout and Slice 5 supported workflows
with existing distributed unassigned entries, no Clear week, one recipe per week,
and saved Shopping yield precedence. No product choice blocks planning.
If desired later, separately decide (a) a real Unassigned bucket and Dashboard
Today meaning, (b) Clear week's cooked/history/Shopping/Undo semantics,
(c) whether repeated meals justify an instance model, and (d) whether viewed
Recipe yield should override saved Shopping yield. None is implicitly authorized
by approving the visual prototype.

Next recommended action: review the uncommitted Slice 4 preview and screenshot pairs; the four
gap dispositions are approved. Keep Slice 5 and publishing separately authorized.
## Slice 4 implementation handoff — 2026-10-07

The user approved Slice 4 and all four gap dispositions. Implementation is on
`codex/planner-layout-slice4` at freshly fetched `origin/main` `8277eee`, left
uncommitted. Recipe corrections at `e9fd69a` were inspected read-only and are
not included in this branch. No application file overlap exists; shared hooks,
selectors, dialogs, quantity helpers, Dashboard and shell remain unchanged.
The pre-edit audit is in `.codex-artifacts/slice4/OVERLAP.txt`.

Implemented: broad 3/2/1 day panels, compact week toolbar, wrapping horizontal
meal cards, one stable header Add per day, progress and mobile filters, and the
existing mobile template menu in the title row. Explicit meal action rows and
Desktop template/generation controls intentionally remain until Slice 5.
No Unassigned bucket/action, Clear week, repeated instances, new contracts or
migrations. Source and action owners are unchanged outside Planner presentation.

Preview: `http://[::1]:3124/planner?week=2026-10-05`, with existing loopback ingress
and optimized upstream on 3125. IPv6 isolates the task's login from existing
IPv4/localhost browser sessions. Credentials are ignored in `web/.env.e2e.local`.
Prototype 3184 is restored. Dedicated hands-on and journey users use the healthy
migration-032 backend 62821; existing accounts/defaults/stacks were preserved.
Frozen fonts/photo are ignored local copies; there is no application CSP change,
hosted access, migration, reset, commit, push, PR, merge or deployment.

Evidence in `.codex-artifacts/slice4/`: screenshot pairs and `gallery.html`,
`browser-report.json`, source audit and retained logs. Chromium in-app browser
journeys ran at CSS viewports 1440×900, 390×844, 320×844 plus tablet/shell boundary
checks. IAB JPEG exports scale out the scrollbar; source/application pairs have
matching pixel dimensions and DOM records preserve exact requested CSS sizes.
Fresh WebKit/native-device coverage is not claimed. Independent prototype review
remains reference evidence, not new application persistence evidence.

Verified: owner isolation; week/date/Back/reload and Sunday start; Add and duplicate
save rejection; canonical detail/return; assigned-day cooking and immediate Undo;
explicit swap and stale-swap rejection; seven-day menu move and pointer drag with
reload; removal/Undo; saved Shopping yield/partial ordinals, cooked full-week
inclusion, re-add and unrelated manual extras; Dashboard grouping; real template
save/load confirmation/cancellation; retained settings/generation confirmation;
unassigned distribution; six-meal dense days; titles, targets, overflow and focus.
The hands-on owner's initial five-meal plan remains separate from test mutations.

Verification: focused 55/55 pass, typecheck and lint pass; trusted repository
verification and production build pass. Overall trusted PR gate remains FAIL:
183 backup-tooling checks passed and one migration-016 assertion rejected the
required uncommitted worktree as `Recovery-tooling worktree must be clean`.
Retained diagnostic proves this pre-existing clean-worktree condition, not a
Planner failure. No policy or tooling was weakened to make it pass.

Final presentation qualification: the two changed component suites pass 24/24;
fresh whole-app lint/typecheck and the final optimized production build pass.
The mobile template menu is in the title row with its original actions, and
secondary text contrast improved from 3.88:1 to 9.00:1 using an existing token.
Final screenshot pairs and DOM geometry were refreshed against that build.

## Combined preparation checkpoint - 2026-10-07

Slices 1-3 and the approved Planner candidate are now locally combined. See
[the preparation checkpoint](recipe-planner-combined-preparation.md) for exact
inputs, preserved gap decisions, verification hold and parent-owned qualification.
This status supersedes earlier planning-only sequencing; it adds no Slice 5
workflow or contract scope and makes no combined runtime approval claim.
