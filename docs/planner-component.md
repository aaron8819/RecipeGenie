# Meal Planner Component Documentation

> When to read: You're working on meal plan generation, week navigation, day assignments, recipe swapping, calendar view, plan settings, or template loading.

Last updated: 2026-03-06

## Quick Start

### Key Files

| File | Purpose |
|------|---------|
| `components/planner/meal-planner.tsx` | Main orchestration component for week navigation, planner actions, DnD, dialog state, and mutation sequencing |
| `components/planner/meal-planner-components.tsx` | Presentation-only planner shells extracted from `meal-planner.tsx` |
| `components/planner/meal-planner.selectors.ts` | Pure planner selectors/helpers for derived state and template shaping |
| `components/planner/plan-settings-modal.tsx` | Settings dialog for default categories, day rules, and history exclusion |
| `components/planner/add-recipe-to-plan-modal.tsx` | Modal for adding a recipe directly to the current plan |
| `components/planner/save-template-dialog.tsx` | Save current plan as a reusable template |
| `components/planner/load-template-dialog.tsx` | Browse and apply saved templates |
| `hooks/use-planner.ts` | TanStack Query hooks for planner data access and mutations |
| `lib/meal-planner.ts` | Business logic for plan generation, swaps, and auto-assign |
| `lib/planner-utils.ts` | Date helpers and day-index conversion helpers |

### Refactor State

- Presentation-only planner shells were extracted into `meal-planner-components.tsx`.
- Pure derived planner logic was extracted into `meal-planner.selectors.ts`.
- `meal-planner.tsx` is still large, but it is now mostly justified orchestration.
- No planner hook extraction is recommended at this time.

## Component Structure

```text
meal-planner.tsx
+-- MealPlanner
|   +-- hook composition and fetched-data ownership
|   +-- week navigation and mobile-tab coordination
|   +-- mutation sequencing and undo toasts
|   +-- drag-and-drop active-item coordination
|   +-- dialog and modal open-state ownership
|
+-- DayColumn
+-- MobileDayColumn
+-- FlipRecipeCard
+-- StitchRecipeCard
+-- MobileRecipeCard

meal-planner-components.tsx
+-- PlannerDaySection
+-- PlannerSectionShell
+-- PlannerDesktopWeekShell
+-- PlannerMobileHeader
+-- PlannerMobileTabBar
+-- PlannerActionBar
+-- PlannerEmptyWeekPanel
+-- PlannerMobileWeekStrip

meal-planner.selectors.ts
+-- isRecipeMadeForWeek()
+-- derivePlannerProgress()
+-- deriveTotalMeals()
+-- groupRecipesByPlannerDay()
+-- deriveActiveRecipeOverlay()
+-- normalizeStoredDayAssignments()
+-- filterTemplateLoadData()
```

## Architectural Boundaries

- Components must not access Supabase directly.
- Hooks own planner data fetching and mutations.
- Multi-step writes must remain atomic RPC-backed flows.
- Extracted planner selectors/helpers must stay pure: no hooks, no side effects, no storage access.
- `meal-planner.tsx` intentionally retains orchestration concerns rather than hiding them in a god hook.

## Key Behaviors

### Date handling

- Use `toLocalNoonISOString()` when sending a `date_made` derived from a calendar day.
- Use local-calendar parsing helpers to avoid UTC boundary drift.

### Day assignments

- Explicit day assignments come from `weekly_plans.day_assignments`.
- Unassigned recipes are distributed deterministically by `groupRecipesByPlannerDay()` using `getUnassignedDayOfWeek()`.
- Legacy local storage day assignments are normalized by `normalizeStoredDayAssignments()`, but storage reads and writes remain in `meal-planner.tsx`.

### Template loading

- `filterTemplateLoadData()` handles deterministic payload shaping only:
  - filters missing recipe IDs
  - derives missing-count metadata
  - filters `day_assignments` to valid recipe IDs
  - preserves optional `category_selection`
- Async fetches, writes, local state updates, and toast orchestration remain in `meal-planner.tsx`.

### Undo patterns

- Remove-from-plan uses immediate remove plus undo re-add with the saved day assignment.
- Mark-made uses immediate mutation plus undo toggle with the same resolved `dateMade`.

## Verification

Run from `web/`:

```bash
npm run build
npm run test -- --run
npm run test:e2e:smoke
npm run check:cycles
npm run check:no-new-ts-expect-error
```

## Current Recommendation

Planner cleanup is intentionally stopping here for now.

- No planner hook extraction is recommended.
- No further planner refactor is clearly justified unless a new narrow pure-helper seam appears.
- Future planner changes should be behavior-driven, not structure-driven.
