# Project Overview: Recipe Genie

This is the canonical architecture overview for the current codebase. Read this first when you need to understand how the app is structured, where domain logic lives, and which boundaries matter.

## What The App Does

Recipe Genie is a weekly meal-planning application.

Core user workflow:

1. Users manage recipes and pantry data.
2. The planner generates weekly meal plans while avoiding recently made recipes.
3. The shopping flow aggregates recipe ingredients, subtracts pantry items, and applies excluded keywords.
4. Cooking history feeds back into future plan generation.

## Architecture Summary

The application is a Next.js frontend backed by Supabase.

```text
UI components
  -> domain hooks
  -> pure library helpers/selectors
  -> Supabase / API routes / RPCs
  -> PostgreSQL + Auth + RLS + Storage
```

Current boundary rules are defined in [`ARCHITECTURE_GUARDRAILS.md`](ARCHITECTURE_GUARDRAILS.md). The short version:

- Components render and coordinate UI.
- Hooks own data fetching and mutations.
- Shared helpers/selectors stay pure.
- Multi-step writes go through RPCs.

## Major Layers

| Layer | Location | Responsibility |
|------|----------|----------------|
| App shell | `web/src/app/` | Next.js entry points, providers, main tab shell, API routes. |
| UI components | `web/src/components/` | Domain UI for planner, recipes, pantry, shopping, plus shared UI primitives. |
| Domain hooks | `web/src/hooks/` | TanStack Query reads/mutations and domain-specific orchestration around Supabase. |
| Pure logic | `web/src/lib/` | Deterministic business logic, parsers, selectors, normalization, matching, and utility helpers. |
| Types | `web/src/types/` | Typed representation of database rows and app-facing DB shapes. |
| Database | `supabase/` | Schema docs, migrations, RLS, RPCs, and storage configuration. |

## Major Domains

### Planner

- Main orchestration lives in `web/src/components/planner/meal-planner.tsx`.
- Pure planner derivations live in `web/src/components/planner/meal-planner.selectors.ts`.
- Presentation-only planner sections live in `web/src/components/planner/meal-planner-components.tsx`.
- Planner hooks and mutations live in `web/src/hooks/use-planner.ts` and `web/src/hooks/use-plan-templates.ts`.
- Plan-generation logic and date helpers live in `web/src/lib/meal-planner.ts` and `web/src/lib/planner-utils.ts`.

### Recipes

- Recipe list/detail/dialog UI lives in `web/src/components/recipes/`.
- Recipe CRUD hooks live in `web/src/hooks/use-recipes.ts`.
- Recipe import uses `web/src/hooks/use-recipe-import.ts` plus `web/src/app/api/recipe-import/route.ts`.
- Text and URL parsing logic lives in `web/src/lib/recipe-parser.ts` and `web/src/lib/recipe-url-parser.ts`.
- Recipe structure compatibility and flat/grouped conversion lives in `web/src/lib/recipe-structure.ts`.
- Recipe image upload/delete flows go through `web/src/hooks/use-recipe-image-storage.ts`.
- `getRecipeImageUrl()` in `web/src/lib/supabase/storage.ts` is a pure URL helper and can be used from components/selectors.
- Recipe list orchestration includes current search/filter UX, responsive toolbar behavior, and Recipes modal coordination.
- Recipe detail is query-backed and now owns common follow-up actions such as add-to-plan, add-to-shopping, and mark-made entry points.
- Persisted recipe data now includes first-class times and notes, plus additive grouped-instruction persistence, while retaining legacy flat `instructions` for backward compatibility.

### Shopping

- Shopping UI orchestration lives in `web/src/components/shopping/shopping-list.tsx`.
- Presentation-only shopping sections live in `web/src/components/shopping/shopping-list-components.tsx`.
- Shopping mutations and cache flows live in `web/src/hooks/shopping/`.
- Shopping aggregation/normalization/category logic lives in `web/src/lib/shopping-list.ts`, `web/src/lib/shopping-list-normalization.ts`, `web/src/lib/shopping-list-merging.ts`, and `web/src/lib/shopping-categories.ts`.
- Stable shopping row identity helpers live in `web/src/lib/shopping-row-identity.ts`.
- Shopping row-targeted server mutations now align on persisted `ShoppingItem.rowId` across UI state, cache mutations, and RPC boundaries.

### Pantry

- Pantry UI lives in `web/src/components/pantry/`.
- Pantry data access lives in `web/src/hooks/use-pantry.ts`.
- Pantry-to-recipe matching lives in `web/src/hooks/use-pantry-match.ts` and `web/src/lib/pantry-matcher.ts`.
- Pantry also feeds the shopping flow through `web/src/hooks/shopping/use-shopping-pantry.ts`.

## Data And Backend

Primary persistent tables:

- `recipes`
- `pantry_items`
- `user_config`
- `recipe_history`
- `weekly_plans`
- `shopping_list`
- `recipe_shares`
- `plan_templates`

All user data is isolated with Supabase Auth and RLS. Schema details and RPCs are documented in [`supabase/SCHEMA.md`](supabase/SCHEMA.md).

## Current Refactor Status

The recent architecture cleanup wave is complete for now.

- Shopping, recipe dialog, and planner presentation extraction are complete.
- Planner pure selector/helper extraction is complete.
- Planner intentionally stops at the current orchestration-heavy boundary.
- No planner hook extraction is recommended right now.
- Further refactor work in these areas should be justified by a new boundary problem or regression, not by file size alone.

## Where To Record Future Changes

- Update this file when architecture ownership or boundaries change.
- Update [`ARCHITECTURE_GUARDRAILS.md`](ARCHITECTURE_GUARDRAILS.md) when project-wide guardrails change.
- Update the relevant domain doc in `docs/` when a domain workflow changes materially.
- Record durable architecture decisions in [`decisions.md`](decisions.md).

Last updated: 2026-03-10
