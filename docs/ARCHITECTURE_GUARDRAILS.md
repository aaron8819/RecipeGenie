# Architecture Guardrails

This is the canonical contributor guardrails document for the current post-refactor codebase. It records the architectural boundaries that still matter, the refactor stopping point, and the baseline verification expected for architecture-sensitive work.

## Current State

The recent cleanup wave is complete for now.

- Shopping, recipe dialog, and planner presentation extraction are complete.
- Planner pure selector/helper extraction is complete.
- Planner is intentionally stopping at the current orchestration-heavy boundary.
- No planner hook extraction is recommended right now.
- The recipe image storage boundary was tightened:
  - `getRecipeImageUrl()` is pure and safe to use from components/selectors.
  - Supabase-backed upload and delete operations live behind `useRecipeImageStorage()`.

## Non-Negotiable Boundaries

- React components must not access Supabase directly.
- Hooks own data fetching and mutations.
- Multi-step writes must use atomic RPCs instead of client-side read-modify-write chains.
- Pure selectors/helpers stay pure: no hooks, no network, no storage access, no side effects.
- No circular imports.
- No new `@ts-expect-error`.

These boundaries are partially enforced in `web/.eslintrc.json`:
- pure selector/helper-style modules cannot import hooks or Supabase-backed mutation/client modules
- components cannot import raw Supabase client modules or Supabase-backed recipe image mutation helpers
- `getRecipeImageUrl()` remains allowed because it is a pure URL helper

## Domain Boundaries

### Planner

- `web/src/components/planner/meal-planner.tsx` still owns orchestration:
  - hook composition
  - week navigation state
  - modal/dialog coordination
  - drag-and-drop ownership
  - optimistic state and undo flows
  - async mutation sequencing
- Presentation-only planner pieces live in `web/src/components/planner/meal-planner-components.tsx`.
- Pure planner derivations live in `web/src/components/planner/meal-planner.selectors.ts`.

### Recipes

- `web/src/components/recipes/recipe-dialog.tsx` still owns form/dialog orchestration, import flow, and submit sequencing.
- Presentation-only recipe dialog sections live in `web/src/components/recipes/recipe-dialog-components.tsx`.
- Recipe image uploads/deletes go through `web/src/hooks/use-recipe-image-storage.ts`.
- `web/src/lib/supabase/storage.ts` may expose pure helpers such as `getRecipeImageUrl()`, but components should not start calling Supabase storage APIs directly.

### Shopping

- `web/src/components/shopping/shopping-list.tsx` still owns UI orchestration, optimistic flows, DnD ownership, filtering/grouping orchestration, and undo/deferred-delete behavior.
- Presentation-only shopping sections live in `web/src/components/shopping/shopping-list-components.tsx`.
- Shared shopping optimistic helpers live in `web/src/hooks/shopping/shared.ts`.

## Refactor Stopping Point

Do not reopen the completed extraction wave without a new, narrow, low-risk reason.

- Do not force planner hook extraction.
- Do not continue extracting code only to reduce line count.
- Re-review these areas only if a new boundary violation or regression appears, or if a clearly pure helper seam emerges.

## Quality Baseline

These checks matter for architecture-sensitive changes. Run from `web/`.

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

For SQL changes, also verify the migration names referenced in docs and generated type parity.

## Where To Record Future Changes

- Update [`project_overview.md`](project_overview.md) when a boundary, layer, or domain ownership changes.
- Update the relevant domain doc in `docs/` when a domain workflow changes materially.
- Record durable architecture decisions in [`../decisions.md`](../decisions.md).
- Do not create a new execution-plan doc unless there is genuinely active, approved multi-step work that is not already captured elsewhere.

Last updated: 2026-03-07
