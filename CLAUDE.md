# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Recipe Genie is a weekly meal planning app. Users maintain recipes by category, generate randomized meal plans, get smart shopping lists with ingredient merging, and track what they've cooked.

**Stack:** Next.js 15 (App Router) + TypeScript + Supabase (PostgreSQL/Auth/RLS/Storage) + TanStack Query v5 + Tailwind CSS + Radix UI/shadcn + Cheerio (server-side HTML parsing) + Upstash Redis (rate limiting)

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
- `web/src/hooks/` — All data access via TanStack Query hooks (`useQuery` for reads, `useMutation` for writes). Shopping hooks in `hooks/shopping/` (barrel via `use-shopping.ts`). Key hooks: `use-recipes.ts`, `use-recipe-shares.ts`, `use-recipe-import.ts`, `use-plan-templates.ts`, `use-pantry-match.ts`, `use-undo-toast.ts`, `use-wake-lock.ts`
- `web/src/lib/` — Pure business logic, no React dependencies. Core algorithms: `meal-planner.ts`, `shopping-list.ts`, `shopping-list-merging.ts`, `shopping-list-normalization.ts`, `recipe-parser.ts`, `recipe-url-parser.ts` (URL import/JSON-LD), `recipe-export.ts` (JSON/text export), `pantry-matcher.ts` (ingredient matching), `recipe-sharing.ts` (share lifecycle), `rate-limit.ts` (Upstash Redis), `url-safety.ts` (SSRF guard), `planner-utils.ts`, `planner-colors.ts`, `user-config.ts`
- `web/src/app/api/` — Server-side API routes: `recipe-import/route.ts` (URL fetch + JSON-LD parse, rate-limited), `recipe-shares/` (create, inbox, sent, accept, decline routes)
- `web/src/components/` — Organized by domain: `auth/`, `recipes/`, `planner/`, `pantry/`, `shopping/`, `layout/`, `ui/` (shadcn primitives)
- `web/src/types/database.ts` — All Supabase table types
- `web/src/lib/supabase/client.ts` — Singleton Supabase client; `admin.ts` — service-role client (server only)
- `web/src/lib/auth-context.tsx` — Auth state provider (React Context, the one exception to "no Context API")

**Supabase tables** (all scoped by `user_id` via RLS `auth.uid() = user_id`): `recipes`, `user_config`, `weekly_plans`, `pantry_items`, `recipe_history`, `shopping_list`, `recipe_shares`, `plan_templates`. Schema details in `supabase/SCHEMA.md`.

**Query key convention:** `['entity', userId, ...params]` — e.g., `['recipes', userId]`, `['planner', userId, weekDate]`

## Core Domain Logic

**Meal planner** (`lib/meal-planner.ts`): For each recipe category, filters by history exclusion window (default 7 days, configurable 3–14). Recipes made exactly N days ago ARE excluded (`dateMade >= cutoffDate`). Falls back to recent recipes when pool is insufficient. Day assignments use 0=Sunday through 6=Saturday.

**Shopping list** (`lib/shopping-list.ts` → `shopping-list-normalization.ts` → `shopping-list-merging.ts`): Aggregates ingredients, normalizes units, merges compatible units (e.g., cups + fl oz), stores incompatible in `additionalAmounts`. Pantry filter and keyword exclusion use exact case-insensitive matching ("pepper" ≠ "poblano pepper"). Category assignment: user overrides first, then defaults.

**Recipe parser** (`lib/recipe-parser.ts`): Parses plain text into structured recipes. Handles Unicode fractions, ranges, parenthetical units, modifiers, "X or Y" alternatives. Detects section headers (Ingredients/Instructions/Directions/Method/Steps).

**URL import** (`lib/recipe-url-parser.ts`): Server-side URL fetch via `/api/recipe-import`. Extracts JSON-LD `Recipe` schema with Cheerio fallback. SSRF-guarded by `url-safety.ts` (blocks private IPs). Rate-limited via Upstash Redis (`lib/rate-limit.ts`).

**Pantry matching** (`lib/pantry-matcher.ts`): Fuzzy ingredient-to-pantry matching for "What Can I Make?" feature. Checks primary item name and `alternatives[]`.

**Recipe export** (`lib/recipe-export.ts`): Serializes recipes to JSON or plain-text format for download.

## Code Conventions

- **Formatting:** Semicolons, single quotes, 2-space indent, 80 char width
- **Naming:** PascalCase components/types, camelCase functions/variables, kebab-case filenames
- **Exports:** Named exports preferred (no default exports)
- **Types:** `interface` for object shapes, `type` for unions/intersections
- **Styling:** Tailwind utilities + `cn()` helper for conditional classes. Design system: Outfit/Playfair fonts, sage/terracotta palette. Use CVA for component variants
- **Path alias:** `@/*` maps to `web/src/*`
- **Supabase type workaround:** Use `@ts-expect-error` for known Supabase TypeScript inference issues where update params infer as `never`
- **Commits:** Conventional commits — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`

## Performance Conventions

Patterns established during the 2026-02-27 performance audit. Treat these as hard rules — they exist because the naive alternative had measurable cost.

- **Middleware auth**: Use `getSession()` in `middleware.ts` — zero Supabase RTT. Reserve `getUser()` for API routes that require verified server-side identity.
- **Initial auth hydration**: Pass `initialSession` from the server layout to `AuthProvider` via `Providers`. Never block the first render on a client-side `getSession()` call — `loading` must initialize as `false` when a session is pre-hydrated.
- **Error toasts**: Every `catch` block in a mutation or async handler must show a user-visible toast. Silent failures are bugs.
- **Tag mutations**: Use `supabase.rpc()` for `rename_tag`, `delete_tag`, `merge_tags`. Never loop per-recipe — N+1 updates are banned for bulk tag operations.
- **Read-then-write banned**: Use `.upsert()` with explicit `onConflict` instead of fetch → conditional insert/update. Keys: `'user_id'` for `shopping_list`, `'user_id,week_date'` for `weekly_plans` (unique index, not constraint — must be explicit).
- **Heavy library dynamic import**: `@dnd-kit` and other large libraries must be dynamically imported (`next/dynamic`) and kept out of the initial bundle. The extracted file is `recipe-sortable-ingredients.tsx`.
- **Tab lazy-mounting**: Non-default tabs (`MealPlanner`, `PantryList`, `ShoppingListView`) are mounted on first visit only, tracked via a `visited` Set. Do not revert to always-mounting all tabs — each tab mounts its own queries.
- **Breakpoint detection**: `hooks/use-is-desktop.ts` is the canonical SSR-safe `matchMedia` hook. Do not add new `window.matchMedia` listeners directly in components.

---

## Testing

**Unit tests** (Vitest, `__tests__/` directories co-located with source):
- `web/src/lib/__tests__/` — Business logic tests (meal planner, shopping list, merging, normalization, categories)
- `web/src/hooks/__tests__/` — Hook mutation tests (optimistic updates, rollback); see `docs/shopping-component.md` for the `renderHook` + QueryClient + Supabase mock pattern

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
- **CSP nonces**: Middleware sets `x-nonce` header; root layout MUST call `headers()` to trigger Next.js 15 automatic nonce application to inline scripts
- **User config fetch**: PGRST116 (not found) is expected for new users — `resolveUserConfig()` returns defaults
- **Shopping per-item pending**: Never use `mutation.isPending` to disable all items in a list — track pending state per-item with a `Set<string>` of item keys; only disable the specific item being mutated
- **Shopping pantry alternatives**: Pantry matching checks both primary item name AND `alternatives[]`; exclusion keyword matching only checks the primary name (alternatives cannot trigger exclusion)
- **ingredientMap display strings**: `ingredientMap` stores `item` as the display string (e.g., "yogurt (or sour cream)"). Use `.entries()` to get the primary key for pantry/exclusion matching — never call `normalizeItemName()` on `ingredient.item` for these checks
- **Undo toast pattern**: For pantry/planner destructive actions — delete immediately, undo re-inserts. For shopping list items — deferring delete to `onExpire` loses the action if the page is refreshed (component unmounts, timer cleared, `onExpire` never fires). Use immediate-delete for shopping too
- **Rate limiting**: `lib/rate-limit.ts` uses `@upstash/ratelimit` with Upstash Redis. Requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars in production. Graceful fail-open in dev (missing env vars → no-op limiter)
- **Admin client**: `lib/supabase/admin.ts` uses `SUPABASE_SERVICE_ROLE_KEY` — server-only. Never import in client components. Used for cross-user identity lookup (recipient email resolution in recipe shares)

## Doc Router — Read Before You Act

Before starting work, match your task to a doc below and read it first.

| When working on... | Read first |
|---------------------|------------|
| Planner (components, hooks, lib, day assignments) | `docs/planner-component.md` |
| Shopping (components, hooks, merging, normalization, hook tests) | `docs/shopping-component.md` |
| Recipes (components, hooks, parser, CRUD, tags, cook mode, URL import, sharing) | `docs/recipes-component.md` |
| Pantry (components, hooks, excluded keywords, What Can I Make?) | `docs/pantry-component.md` |
| Database (schema, migrations, RLS, new tables/columns) | `supabase/SCHEMA.md` |
| E2E tests (writing, debugging, fixtures) | `web/tests/README.md` |
| Architectural decisions or major refactors | `decisions.md` |
| Version bumps or release notes | `changelog.md` |
| First session or onboarding | `docs/project_overview.md` |

When a task spans multiple areas, read all applicable docs. Update any doc you relied on if your work changes what it describes. Update `changelog.md` when shipping a version bump.
