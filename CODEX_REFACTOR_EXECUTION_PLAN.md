# Codex Refactor Execution Plan

Last updated: March 6, 2026

This execution plan reflects the current post-cleanup state. Completed work is recorded here so future PRs do not reopen finished extraction slices.

Canonical status document: `ARCHITECTURE_REFACTOR_PLAN.md`

## Completed

- `[x]` Phase 0 guardrails
- `[x]` Phase 1 drift cleanup
- `[x]` Phase 2 planner/recipes cycle break
- `[x]` Phase 2 cycle detection guard
- `[x]` Phase 2 planner component DB access removal
- `[x]` Phase 2 planner date/week utils extraction
- `[x]` Phase 2 shopping selectors extraction
- `[x]` Phase 2 recipe dialog helper extraction
- `[x]` Phase 2 shopping shared optimistic helper extraction
- `[x]` Phase 3 shopping presentation extraction
- `[x]` Phase 3 recipe dialog presentation extraction
- `[x]` Phase 3 planner presentation extraction
- `[x]` Phase 3 planner pure selector extraction
- `[x]` Phase 3 planner template-load shaping extraction

## Extracted Boundaries

- Shopping:
  - `ShoppingCategorySection`
  - `ShoppingItemRow`
  - `ShoppingStateSection`
- Recipe dialog:
  - `RecipeImportSection`
  - `RecipeImageField`
  - `RecipeDialogActions`
  - `RecipeMetadataSection`
  - `RecipeIngredientsSection`
  - `RecipeInstructionsSection`
- Planner presentation:
  - `PlannerDaySection`
  - `PlannerSectionShell`
  - `PlannerDesktopWeekShell`
  - `PlannerMobileHeader`
  - `PlannerMobileTabBar`
  - `PlannerActionBar`
  - `PlannerEmptyWeekPanel`
  - `PlannerMobileWeekStrip`
- Planner pure helpers/selectors:
  - made-state logic
  - progress calculation
  - grouped-by-day and unassigned distribution
  - active drag overlay metadata
  - total-meal count
  - parsed day-assignment normalization
  - template-load shaping

## Active Architectural Rules

- No Supabase in components.
- Hooks own data access.
- Atomic RPCs for multi-step writes.
- Pure utils/selectors only.
- No circular imports.
- No new `@ts-expect-error`.
- Smoke tests must stay green.

## Current Stopping Point

- Shopping, recipe dialog, and planner all completed the intended extraction wave.
- `meal-planner.tsx` remains large, but is now mostly justified orchestration.
- No planner hook extraction is recommended now.
- No further planner refactor is clearly justified now.

## Optional Future Follow-Ups

1. `[ ]` Reduce `@ts-expect-error` only when a narrow typed fix is obvious.
2. `[ ]` Narrow broad queries only where the selected shape is stable and smoke-covered.
3. `[ ]` Re-review planner only if a new pure-helper seam becomes unusually clear.

## Standard Verification

Run from `web/`.

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

## Working Rule For Future PRs

Do not reopen completed architectural boundary work unless a regression is found. Do not force a planner hook extraction. Treat any future work in these areas as optional review, not an active roadmap, unless a new narrow and low-risk slice is demonstrated first.
