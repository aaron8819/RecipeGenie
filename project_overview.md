# Project Overview: Recipe Genie

> **When to read:** First session on this project, or you need a broad understanding of architecture, tech stack, and how the pieces fit together.

A cloud-hosted weekly meal planning application. This document provides a 10-minute orientation for new engineers.

---

## 1. What This App Does

Recipe Genie solves a common household problem: "What should we cook this week, and what do we need to buy?"

**Core Workflow:**
1. User maintains a collection of recipes organized by protein category
2. User configures how many meals per category they want (e.g., 2 chicken, 1 steak, 1 vegetarian)
3. App randomly generates a weekly meal plan, avoiding recently-cooked recipes
4. App produces a shopping list by aggregating ingredients and subtracting pantry items
5. User shops, cooks, marks recipes as "made" to influence future plans

**Key Behaviors:**
- Recipes made within the exclusion window (default 7 days, configurable) are excluded from random selection (with fallback)
- Ingredients matching "excluded keywords" (oil, salt, spices) auto-hide from shopping lists
- Shopping lists can be scaled (0.5x to 3x) for batch cooking
- Weekly plans persist per week-start date, enabling future planning
- Multi-user support: each authenticated user has private data via Row Level Security
- Shopping lists support drag-and-drop reordering and manual item addition
- Category overrides allow custom categorization of shopping list items
- Custom shopping categories: users can create their own categories (e.g., "Asian Market", "Specialty Store")
- Category ordering: drag-and-drop reordering of categories to match store layout
- **Unit normalization**: All units normalized to lowercase canonical form for consistent merging (e.g., "TBSP" → "tbsp")
- **Smart merging**: Compatible units automatically merged (e.g., cups + fl oz), incompatible units use `additionalAmounts`
- **Testing**: Playwright E2E for UI flows; Vitest for unit tests (e.g. shopping list checked state)
- Day assignments: assign recipes to specific days of the week in the calendar view (persists across devices)
- **Planner settings**: Configure default category breakdown, excluded days, preferred days, and automatic day assignment for meal plan generation
  - Default category breakdown persists across sessions
  - Day placement rules control which days meals can be placed on
  - Automatic day assignment intelligently distributes recipes respecting excluded/preferred days

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER ACTIONS                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 15 App Router)                                           │
│                                                                             │
│  src/app/page.tsx                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Planner Tab  │  │ Recipes Tab  │  │ Pantry Tab   │  │Shopping Tab  │     │
│  │  planner/    │  │  recipes/    │  │  pantry/     │  │  shopping/   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                 │                 │                 │             │
│         └─────────────────┴─────────────────┴─────────────────┘             │
│                                    │                                        │
│                     TanStack Query (useRecipes, usePlanner, etc.)           │
│                                    │                                        │
│                     src/lib/supabase/client.ts (browser client)             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                              Supabase Client SDK
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SUPABASE (PostgreSQL + Auth + RLS)                                         │
│                                                                             │
│  Tables:                          Features:                                 │
│  ─────────────────────────────    ────────────────────────────────────────  │
│  recipes                          Recipe CRUD (with user_id)                │
│  pantry_items                     Pantry CRUD                               │
│  user_config                      User preferences                          │
│  recipe_history                   Cooking history tracking                  │
│  weekly_plans                     Plan persistence per week                 │
│  shopping_list                    Current shopping list state               │
│  recipe_shares                    Share lifecycle (pending/accepted/etc.)   │
│  plan_templates                   Named reusable plan templates             │
│                                                                             │
│  Row Level Security: auth.uid() = user_id on all tables                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key Data Transforms:**

| Operation | Input | Transform | Output |
|-----------|-------|-----------|--------|
| Generate Meal Plan | category counts + history | Random sample excluding recent | Recipe list |
| Generate Shopping List | recipe IDs + pantry + keywords | Normalize units/names, aggregate quantities (merge compatible units), subtract pantry, filter keywords | 3 lists: to_buy, already_have, excluded |
| Mark Recipe Made | recipe ID | Insert timestamped entry | Updated history |

---

## 3. Main Components and Responsibilities

### Frontend (`web/src/`)

| Directory | Files | Responsibility |
|-----------|-------|----------------|
| `app/` | `layout.tsx`, `page.tsx`, `loading.tsx` | Next.js App Router entry points, providers setup; `loading.tsx` is a skeleton shell that prevents blank page during server render |
| `components/recipes/` | `recipe-list.tsx`, `recipe-card.tsx`, `recipe-dialog.tsx`, `recipe-sortable-ingredients.tsx`, `cook-mode.tsx`, `share-recipe-dialog.tsx`, `shared-recipes-inbox.tsx` | Recipe CRUD UI with text/URL import, cook mode, and sharing; `recipe-sortable-ingredients.tsx` extracts dnd-kit for dynamic import |
| `components/planner/` | `meal-planner.tsx`, `save-template-dialog.tsx`, `load-template-dialog.tsx` | Week navigation, plan generation, templates, history |
| `components/pantry/` | `pantry-list.tsx`, `what-can-i-make.tsx` | Pantry items, excluded keywords, ingredient matching |
| `components/shopping/` | `shopping-list.tsx`, `shopping-settings-modal.tsx` | Shopping list display, scaling, drag-and-drop reordering, category management |
| `components/ui/` | Various | Radix UI primitives (button, dialog, tabs, etc.) |
| `components/` | `error-boundary.tsx` | Error boundary component for application resilience |
| `hooks/` | `use-recipes.ts`, `use-planner.ts`, `use-pantry.ts`, `use-recipe-shares.ts`, `use-recipe-import.ts`, `use-plan-templates.ts`, `use-pantry-match.ts`, `use-undo-toast.ts`, `use-wake-lock.ts`, `use-is-desktop.ts` | TanStack Query hooks for Supabase; `use-is-desktop.ts` is the canonical SSR-safe breakpoint hook |
| `hooks/shopping/` | Domain-focused modules | Shopping hooks split by domain (list, items, recipes, categories, config, pantry) |
| `app/api/` | `recipe-import/route.ts`, `recipe-shares/` | Server-side API: URL recipe import (rate-limited, SSRF-guarded), share lifecycle routes |
| `lib/supabase/` | `client.ts`, `server.ts`, `admin.ts` | Supabase clients: browser singleton, server SSR, service-role admin (server only) |
| `lib/` | `meal-planner.ts`, `planner-colors.ts`, `planner-utils.ts`, `user-config.ts`, `shopping-list.ts`, `shopping-list-normalization.ts`, `shopping-list-merging.ts`, `shopping-categories.ts`, `recipe-parser.ts`, `recipe-url-parser.ts`, `recipe-export.ts`, `pantry-matcher.ts`, `recipe-sharing.ts`, `rate-limit.ts`, `url-safety.ts` | Business logic: plan generation, shopping aggregation, recipe parsing (text + URL), pantry matching, sharing, security utilities |
| `types/` | `database.ts` | TypeScript types for Supabase tables |
| `public/` | `manifest.json` | Static assets; web app manifest enables PWA install prompt (theme: sage, standalone display) |

**Testing:** E2E tests in `web/tests/` (Playwright); unit tests in `hooks/__tests__/` and `lib/__tests__/` (Vitest). See README Testing section.

### Middleware (`src/middleware.ts`)

Handles Supabase auth session refresh on every request to keep users logged in.

### Migration Script (`scripts/migrate.ts`)

One-time import of legacy `data/*.json` files into Supabase. Uses service role key for elevated permissions.

---

## 4. Where Data Lives

### Supabase PostgreSQL Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| `recipes` | `id, user_id, name, category, servings, ingredients (JSONB with item/amount/unit/modifier/alternatives/originalText), instructions, favorite, tags, image_url, created_at, updated_at` | Recipe collection |
| `pantry_items` | `user_id, item (PK), created_at` | Items user has on hand |
| `user_config` | `user_id (PK), categories[], default_selection, excluded_keywords[], history_exclusion_days, week_start_day, onboarding_completed_at, category_overrides, custom_categories[], category_order[], excluded_days[], preferred_days[], auto_assign_days` | User preferences |
| `recipe_history` | `id, user_id, recipe_id (FK), date_made` | When recipes were cooked |
| `weekly_plans` | `user_id, week_date (PK), recipe_ids[], day_assignments (JSONB), scale, generated_at` | Saved plans keyed by week start with day assignments |
| `shopping_list` | `user_id (PK), items[], already_have[], excluded[], source_recipes[], scale, total_servings, custom_order, generated_at` | Current shopping list state |
| `recipe_shares` | `id, sender_id, recipient_id, recipe_snapshot (JSONB), message, status, created_at, updated_at` | Share lifecycle — snapshot at creation, copy-on-accept |
| `plan_templates` | `id, user_id, name, recipe_ids[], day_assignments (JSONB), created_at` | Named reusable plan templates |

### Client-Side State (TanStack Query)

State is managed by TanStack Query via custom hooks:

```typescript
// Example: useRecipes hook
const { data: recipes, isLoading, error } = useRecipes();
const createRecipe = useCreateRecipe();
const updateRecipe = useUpdateRecipe();
const deleteRecipe = useDeleteRecipe();
```

- **Automatic caching**: Queries are cached and deduplicated
- **Background refetching**: Stale data is refreshed automatically
- **Optimistic updates**: UI updates immediately, rolls back on error
- **Query invalidation**: Mutations invalidate related queries

### Browser Storage

- `localStorage`: None required for authenticated users (all state in Supabase)
- `cookies`: Supabase auth session tokens (managed by `@supabase/ssr`)

---

## 5. Security Model

### Row Level Security (RLS)

All tables have RLS enabled with policies ensuring users can only access their own data:

```sql
CREATE POLICY "authenticated_full_access" ON recipes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### Authentication

- Supabase Auth handles user registration and login
- Email/password authentication enabled by default
- Session managed via HTTP-only cookies (`@supabase/ssr`)
- Middleware refreshes session on each request

### Client Keys

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Safe for browser (RLS restricts access)
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only, bypasses RLS. Used by migration script and by the recipe-shares API route for cross-user email lookup via `lib/supabase/admin.ts`

---

## 6. Adding Features Safely

### Before You Start

1. **Review `decisions.md`** for architectural context (ADR-010 through ADR-015)
2. **Check existing hooks** in `src/hooks/` for data access patterns
3. **Trace a similar feature** through: hook → component → Supabase query

### Adding a New Data Field to Recipes

```
1. Update Supabase schema (SQL migration or dashboard)
2. Update types in src/types/database.ts
3. Update hook queries/mutations in src/hooks/use-recipes.ts
4. Update form in src/components/recipes/recipe-dialog.tsx
5. Update display in src/components/recipes/recipe-card.tsx
```

### Adding a New Component

```
1. Create component in appropriate src/components/ subdirectory
2. Create or extend hook in src/hooks/ for data fetching
3. Add types to src/types/ if needed
4. Import and use in parent component or page
```

### Adding a New Supabase Table

```
1. Create table via Supabase dashboard or SQL migration
2. Enable RLS: ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
3. Add policy: CREATE POLICY "..." ON new_table FOR ALL TO authenticated USING (auth.uid() = user_id);
4. Add types to src/types/database.ts
5. Create hook in src/hooks/
```

### Safe Practices

| Do | Don't |
|----|-------|
| Use TanStack Query hooks for all data fetching | Fetch directly in components |
| Add RLS policies to new tables | Rely on client-side filtering for security |
| Type Supabase responses in `database.ts` | Use `any` types |
| Use existing UI components from `components/ui/` | Create one-off styled components |
| Handle loading and error states | Assume data is always available |

### Risk Mitigation

For database changes:
1. **Test RLS policies** in Supabase SQL Editor
2. **Verify migrations** don't break existing data
3. **Test with multiple users** to ensure data isolation

For UI changes:
1. **Test all four tabs** after changes
2. **Check responsive behavior** (Tailwind breakpoints)
3. **Verify TypeScript compiles** (`npm run build`)

---

## 7. Quick Reference

| Task | Start Here |
|------|------------|
| Understand data fetching | `src/hooks/use-recipes.ts` |
| Understand meal plan generation | `src/lib/meal-planner.ts` |
| Planner date/day helpers | `src/lib/planner-utils.ts`, `src/lib/planner-colors.ts` |
| User config defaults and errors | `src/lib/user-config.ts` |
| Understand shopping list logic | `src/lib/shopping-list.ts` |
| Understand shopping categories | `src/lib/shopping-categories.ts` |
| Modify shopping hooks | `src/hooks/shopping/` (domain-focused modules) |
| Modify recipe form | `src/components/recipes/recipe-dialog.tsx` |
| Understand recipe parsing | `src/lib/recipe-parser.ts` |
| Change tab navigation | `src/app/page.tsx` |
| Add Supabase query | Create hook in `src/hooks/` |
| Get Supabase client | `src/lib/supabase/client.ts` (singleton) |
| Debug query state | React Query DevTools in browser |
| Run unit tests | `npm run test` (Vitest) |
| Run E2E tests | `npm run test:e2e` (Playwright; dev server required) |
| Check database schema | `supabase/migrations/001_initial_schema.sql` |

---

*Last updated: 2026-02-27 (v2.16.0)*

*See `changelog.md` for version history.*
