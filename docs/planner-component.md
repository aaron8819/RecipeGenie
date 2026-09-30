# Planner Domain Reference

Use this doc when working on meal-plan generation, week navigation, day assignments, template load/save, or planner history behavior.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Current State

- Planner presentation extraction is complete.
- Planner pure selector/helper extraction is complete.
- `meal-planner.tsx` is intentionally still orchestration-heavy.
- No planner hook extraction is recommended right now.

## Shopping actions

Meal and weekly shopping actions open the shared `ShoppingSelectionDialog`.
Opening performs no write. Users choose recipes, yield/servings, and ingredients,
then the existing Shopping mutation saves all selected contributions together.
Weekly actions include cooked meals. Pending and success feedback remains owned
by Planner; failed saves keep selections open for review. See
[Shopping Domain Reference](./shopping-component.md#planner-ingredient-selection)
for recovery and conflict behavior.

## Explicit meal swap

Planner's Swap recipe control opens `SwapMealDialog`. Users search recipes across
categories and choose a scheduled day; already-planned recipes are disabled.
"Surprise me" retains a random same-category choice through the same guarded save.
Opening performs no write, pending saves prevent dismissal/duplicate taps, and
failures remain visible inline with the dialog open.

`useReplacePlannedRecipe` reads the owner-scoped current plan, rejects a missing,
cooked, duplicate, or moved source, and performs one conditional UPDATE of UUID
membership and assignments. The WHERE clause compares the read membership, made
state, and assignments. A concurrent change aborts without a retry or a partial
replacement. Existing UUID triggers enforce replacement ownership and maintain
legacy mirrors; no new RPC or migration is required. Other meals, scale, history,
and Shopping contributions remain intact. The hook refetches plan/recipe caches
after success or failure. The older random hook remains exported for compatibility
but Planner no longer uses its full-plan upsert path.

## Key Files

Dashboard at `/dashboard` reuses these queries, grouping/made-state selectors,
mutations, and dialogs. Its current local calendar date refreshes at midnight
and on tab resume. Week links carry the displayed date in Planner URL state.
Both screens honor Sunday (`0`) as a configured week start. Dashboard adds meals
through the existing picker with a day prefilled and marks cooking history at
the displayed assigned day's local noon. Move and removal reuse existing hooks
and do not delete recipes or Shopping contributions.

| File | Responsibility |
|------|----------------|
| `web/src/components/planner/meal-planner.tsx` | Main planner orchestration: hook composition, week navigation, dialog state, DnD ownership, undo flows, async mutation sequencing. |
| `web/src/components/planner/meal-planner-components.tsx` | Presentation-only planner sections extracted from the main component. |
| `web/src/components/planner/meal-planner.selectors.ts` | Pure derived-state helpers for planner rendering and template shaping. |
| `web/src/components/planner/plan-settings-modal.tsx` | Planner settings UI for default breakdown, excluded days, preferred days, and history exclusion. |
| `web/src/hooks/use-planner.ts` | Planner data access and mutations. |
| `web/src/hooks/use-plan-templates.ts` | Plan template queries and mutations. |
| `web/src/lib/meal-planner.ts` | Plan generation and related planner business logic. |
| `web/src/lib/planner-utils.ts` | Date helpers and day-index utilities. |
| `web/src/lib/planner-route-state.ts` | Validates and builds the canonical `/planner?week=YYYY-MM-DD` route state. |

## Boundaries

- Components must not access Supabase directly.
- Hooks own planner reads and writes.
- Multi-step writes stay RPC-backed.
- Extracted selectors/helpers stay pure.
- `meal-planner.tsx` keeps orchestration concerns on purpose instead of hiding them in a large custom hook.

## Important Behaviors

### Day assignments

- Persistent day assignments live in `weekly_plans.day_assignments`.
- Planner uses pure selectors to normalize stored assignments and derive grouped day views.
- Local planner UI state may temporarily stage assignment changes, but durable writes still belong in hooks.

### Dates

- Use `toLocalNoonISOString()` for `date_made` values derived from a calendar day.
- Keep planner date handling local-calendar-safe to avoid UTC boundary drift.
- Planner view dates come from the `week` query parameter and are accepted only
  when they round-trip as real
  Gregorian calendar dates in canonical `YYYY-MM-DD` form. Invalid state falls
  back to the current planning week before any plan query runs.
- Week controls push a new URL so browser Back, Forward, refresh, and copied
  links preserve the selected week; session storage is not used.

### Weekly-plan persistence

- `weekly_plans.day_assignment_recipe_uuids` is non-null at the database
  boundary. Nullable domain input is normalized to `{}` immediately before
  create, update, or direct upsert writes.

### Templates

- Template load/save mutations belong in hooks.
- Selector helpers may shape template data, but async fetches, invalidation, toasts, and local-state coordination remain in `meal-planner.tsx`.

## Intentionally Not Being Refactored Further

- No planner hook extraction.
- No new extraction work that only moves orchestration around.
- Re-open planner structure only if a new pure seam appears or a boundary violation/regression makes the current split wrong.

## Verification

Run from `web/`:

```bash
npm run build
npm run test -- --run
npm run test:e2e:smoke
npm run check:cycles
npm run check:no-new-ts-expect-error
```

Last updated: 2026-08-03
