# Architecture Refactor Plan

Last updated: March 6, 2026

This document is the canonical architecture baseline after the completed cleanup wave. It records what has landed, what remains intentionally in place, and where refactor work should stop for now.

## Completed Work

### Phase 0 guardrails

- Smoke E2E split is in place via `npm run test:e2e:smoke`.
- Smoke test inventory is guarded by `web/scripts/check-smoke-tests.mjs`.
- New `test.skip` usage is gated by `npm run check:no-new-test-skip`.
- New `@ts-expect-error` usage is gated by `npm run check:no-new-ts-expect-error`.
- Dependency cycle detection is available via `npm run check:cycles`.
- Generated Supabase type baselines exist in `web/src/types/database.generated.ts` and `web/src/types/database.ts`.
- Deterministic type drift checking exists via `npm run db:types:check`.
- Atomic RPC migrations landed for the main multi-step mutation paths:
  - `supabase/migrations/022_atomic_toggle_shopping_item.sql`
  - `supabase/migrations/024_atomic_add_pantry_and_remove_shopping.sql`
  - `supabase/migrations/025_atomic_mark_recipe_made.sql`

### Phase 1 drift cleanup

- Legacy category drift was normalized with `supabase/migrations/026_normalize_legacy_steak_defaults.sql`.
- Current defaults and supporting docs were aligned to the canonical category set.
- Guardrail scripts and generated-type workflow are now part of the expected repo baseline.
- `@ts-expect-error` debt is now explicitly bounded by the quality baseline instead of growing silently.

### Phase 2 completed items

- Planner/recipes cycle break completed by extracting shared user-config access into neutral hook modules.
- Cycle detection guard completed with `dependency-cruiser` config in `web/.dependency-cruiser.cjs`.
- Planner component DB access removal completed; planner data access now belongs in hooks.
- Planner date/week utility extraction completed in `web/src/components/planner/meal-planner.utils.ts`.
- Shopping selector extraction completed in `web/src/components/shopping/shopping-list.selectors.ts`.
- Recipe dialog helper extraction completed in `web/src/components/recipes/recipe-dialog.validation.ts`.
- Shopping shared optimistic helper extraction completed in `web/src/hooks/shopping/shared.ts`.

### Phase 3 completed UI boundary cleanup

- Shopping presentation extraction completed in `web/src/components/shopping/shopping-list-components.tsx`.
- Extracted shopping presentation boundaries:
  - `ShoppingCategorySection`
  - `ShoppingItemRow`
  - `ShoppingStateSection`
- `shopping-list.tsx` intentionally still owns hooks, optimistic flows, mutation orchestration, filtering/grouping orchestration, DnD ownership, and undo/deferred-delete logic.

- Recipe dialog presentation extraction completed in `web/src/components/recipes/recipe-dialog-components.tsx`.
- Extracted recipe dialog presentation boundaries:
  - `RecipeImportSection`
  - `RecipeImageField`
  - `RecipeDialogActions`
  - `RecipeMetadataSection`
  - `RecipeIngredientsSection`
  - `RecipeInstructionsSection`
- `recipe-dialog.tsx` intentionally still owns validation, import parsing, submit/mutation flow, image flow, dialog state, and form state.

- Planner presentation extraction completed in `web/src/components/planner/meal-planner-components.tsx`.
- Extracted planner presentation boundaries:
  - `PlannerDaySection`
  - `PlannerSectionShell`
  - `PlannerDesktopWeekShell`
  - `PlannerMobileHeader`
  - `PlannerMobileTabBar`
  - `PlannerActionBar`
  - `PlannerEmptyWeekPanel`
  - `PlannerMobileWeekStrip`

### Phase 3 completed planner helper extraction

- Planner selector/helper extraction completed in `web/src/components/planner/meal-planner.selectors.ts`.
- Extracted planner pure logic:
  - made-state logic
  - progress calculation
  - grouped-by-day and unassigned distribution
  - active drag overlay metadata
  - total-meal count
  - parsed day-assignment normalization
  - template-load shaping
- `meal-planner.tsx` intentionally still owns hook composition, week navigation state, modal/dialog coordination, drag-and-drop ownership, undo toasts, optimistic state, and async mutation sequencing.

## Current Architectural Rules

- No Supabase client access in React components.
- Hooks own data access and mutation orchestration.
- Multi-step writes must use atomic RPCs instead of client-side read-modify-write chains.
- Extracted helpers must stay pure utils/selectors only.
- No circular imports.
- No new `@ts-expect-error`.
- Smoke tests must stay green.

## Current Architecture State

- The major UI hotspots are no longer dominated by presentation duplication.
- `shopping-list.tsx` is still large, but the remaining size is mostly justified orchestration and optimistic UX wiring.
- `recipe-dialog.tsx` is still large, but the remaining size is mostly justified dialog/form orchestration.
- `meal-planner.tsx` is still large, but the remaining size is now mostly justified orchestration.
- No planner hook extraction is recommended at this time.
- No further planner refactor is clearly justified right now.

## Optional Future Review

- Continue reducing `@ts-expect-error` only where typed helpers or narrower query shapes make that safe.
- Narrow high-traffic queries only where the selected shape is stable and verified by smoke coverage.
- Re-review planner only if a truly obvious pure-helper seam appears or a behavioral regression exposes a misplaced boundary.

## Verification Baseline

- `npm run build`
- `npm run test -- --run`
- `npm run test:e2e:smoke`
- `npm run check:cycles`
- `npm run check:no-new-ts-expect-error`

## Standard Verification Commands

Run from `web/` unless noted otherwise.

```bash
npm run lint
npx tsc --noEmit
npm run test -- --run
npm run test:e2e:smoke
npm run check:no-new-ts-expect-error
npm run check:no-new-test-skip
npm run check:cycles
npm run db:types:check
```

For PRs that touch SQL migrations, also verify the referenced migration filenames and generated type parity before merge.

## Status Summary

The architecture baseline is materially better than the pre-refactor state: major boundary violations were removed, the large UI hotspots have had presentation duplication stripped out, planner derivations now have a pure selector home, and the remaining complexity is concentrated in real orchestration instead of mixed rendering-and-logic blobs. The recommended stopping point for the current wave is to leave planner, shopping, and recipe dialog as-is unless a future review identifies a similarly narrow, low-risk extraction.
