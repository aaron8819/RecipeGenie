# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Recipe Genie is a weekly meal planning app. Users maintain recipes by category, generate randomized meal plans, get smart shopping lists with ingredient merging, and track what they've cooked.

**Stack:** Next.js 14 (App Router) + TypeScript + Supabase (PostgreSQL/Auth/RLS/Storage) + TanStack Query v5 + Tailwind CSS + Radix UI/shadcn

## Commands

All commands run from `web/`:

```bash
npm run dev                    # Dev server at localhost:3000
npm run build                  # Production build
npm run lint                   # ESLint (next lint)
npm run test                   # Vitest unit tests
npm run test -- --run path/to/file.test.ts  # Run single test file
npm run test:watch             # Watch mode
npm run test:coverage          # Coverage report
npm run test:e2e               # Playwright E2E (starts dev server automatically)
npm run test:e2e -- --project chromium  # Single browser
npm run test:e2e:headed        # E2E in headed mode
npm run test:e2e:debug         # E2E with debugger
```

E2E tests require `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEST_USER_EMAIL`, and `TEST_USER_PASSWORD` env vars. Global setup authenticates once; auth state is reused via `playwright/.auth/user.json`.

## Architecture

**Data flow:** User Action → React Event Handler → TanStack Mutation (custom hook) → Supabase Client → PostgreSQL (RLS) → Response → Query Invalidation → UI Update

**Key layers:**
- `web/src/app/page.tsx` — Single-page app with tab navigation (Planner, Recipes, Pantry, Shopping)
- `web/src/hooks/` — All data access via TanStack Query hooks (`useQuery` for reads, `useMutation` for writes). Shopping hooks are split into `hooks/shopping/` subdirectory with barrel export via `use-shopping.ts`
- `web/src/lib/` — Pure business logic, no React dependencies. Core algorithms: `meal-planner.ts`, `shopping-list.ts`, `shopping-list-merging.ts`, `shopping-list-normalization.ts`, `recipe-parser.ts`
- `web/src/components/` — Organized by domain: `auth/`, `recipes/`, `planner/`, `pantry/`, `shopping/`, `layout/`, `ui/` (shadcn primitives)
- `web/src/types/database.ts` — All Supabase table types
- `web/src/lib/supabase/client.ts` — Singleton Supabase client
- `web/src/lib/auth-context.tsx` — Auth state provider (React Context, the one exception to "no Context API")

**Supabase tables** (all scoped by `user_id` via RLS `auth.uid() = user_id`): `recipes`, `user_config`, `weekly_plans`, `pantry_items`, `recipe_history`, `shopping_list`. Schema details in `supabase/SCHEMA.md`.

**Query key convention:** `['entity', userId, ...params]` — e.g., `['recipes', userId]`, `['planner', userId, weekDate]`

## Core Domain Logic

**Meal planner** (`lib/meal-planner.ts`): For each recipe category, filters by history exclusion window (default 7 days, configurable 3–14). Recipes made exactly N days ago ARE excluded (`dateMade >= cutoffDate`). Falls back to recent recipes when pool is insufficient. Day assignments use 0=Sunday through 6=Saturday.

**Shopping list** (`lib/shopping-list.ts` → `shopping-list-normalization.ts` → `shopping-list-merging.ts`): Aggregates ingredients, normalizes units, merges compatible units (e.g., cups + fl oz), stores incompatible in `additionalAmounts`. Pantry filter and keyword exclusion use exact case-insensitive matching ("pepper" ≠ "poblano pepper"). Category assignment: user overrides first, then defaults.

**Recipe parser** (`lib/recipe-parser.ts`): Parses plain text into structured recipes. Handles Unicode fractions, ranges, parenthetical units, modifiers. Detects section headers (Ingredients/Instructions/Directions/Method/Steps).

## Code Conventions

- **Formatting:** Semicolons, single quotes, 2-space indent, 80 char width
- **Naming:** PascalCase components/types, camelCase functions/variables, kebab-case filenames
- **Exports:** Named exports preferred (no default exports)
- **Types:** `interface` for object shapes, `type` for unions/intersections
- **Styling:** Tailwind utilities + `cn()` helper for conditional classes. Design system: Outfit/Playfair fonts, sage/terracotta palette. Use CVA for component variants
- **Path alias:** `@/*` maps to `web/src/*`
- **Supabase type workaround:** Use `@ts-expect-error` for known Supabase TypeScript inference issues where update params infer as `never`
- **Commits:** Conventional commits — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

## Testing

**Unit tests** (Vitest, `__tests__/` directories co-located with source):
- `web/src/lib/__tests__/` — Business logic tests (meal planner, shopping list, merging, normalization, categories)
- `web/src/hooks/__tests__/` — Hook tests

**E2E tests** (Playwright, `web/tests/`):
- Tests for navigation, auth, recipes, planner, pantry, shopping list, responsive, accessibility, visual design
- Uses global setup with shared auth state
- Runs against all browsers + mobile viewports (Chromium, Firefox, WebKit, Pixel 5, iPhone 12, iPhone SE, iPad)

## Gotchas

- **Supabase types**: `.update()` and `.insert()` may infer params as `never` — use `@ts-expect-error` with explanatory comment
- **Dates**: Always use `toLocalNoonISOString()` from `planner-utils.ts` for `date_made` to avoid UTC boundary shifts
- **RLS**: Every new table needs an explicit RLS policy — test in Supabase SQL Editor first
- **Shopping merging**: Uses ES module imports only, not `require()` — dynamic require breaks at runtime
- **E2E env vars**: Tests need `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`
- **User config fetch**: PGRST116 (not found) is expected for new users — `resolveUserConfig()` returns defaults

## Doc Router — Read Before You Act

Before starting work, match your task to a doc below and read it first.

| When working on... | Read first |
|---------------------|------------|
| Planner (components, hooks, lib, day assignments) | `docs/planner-component.md` |
| Shopping (components, hooks, merging, normalization) | `docs/shopping-component.md` |
| Recipes (components, hooks, parser, CRUD, tags) | `docs/recipes-component.md` |
| Pantry (components, hooks, excluded keywords) | `docs/pantry-component.md` |
| Database (schema, migrations, RLS, new tables/columns) | `supabase/SCHEMA.md` |
| E2E tests (writing, debugging, fixtures) | `web/tests/README.md` |
| Architectural decisions or major refactors | `decisions.md` |
| Version bumps or release notes | `changelog.md` |
| First session or onboarding | `project_overview.md` |

When a task spans multiple areas, read all applicable docs. Update any doc you relied on if your work changes what it describes. Update `changelog.md` when shipping a version bump.
