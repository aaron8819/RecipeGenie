# Planner Domain Reference

Use this doc when working on meal-plan generation, week navigation, day assignments, template load/save, or planner history behavior.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Current State

- Planner presentation extraction is complete.
- Planner pure selector/helper extraction is complete.
- `meal-planner.tsx` is intentionally still orchestration-heavy.
- No planner hook extraction is recommended right now.

## Key Files

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

Last updated: 2026-03-07
