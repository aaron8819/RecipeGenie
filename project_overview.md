# Project Overview: Recipe Genie

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
- Guest mode: users can try the app without signing up (data stored in browser session only)
- Shopping lists support drag-and-drop reordering and manual item addition
- Category overrides allow custom categorization of shopping list items
- Custom shopping categories: users can create their own categories (e.g., "Asian Market", "Specialty Store")
- Category ordering: drag-and-drop reordering of categories to match store layout
- **Unit normalization**: All units normalized to lowercase canonical form for consistent merging (e.g., "TBSP" → "tbsp")
- **Smart merging**: Compatible units automatically merged (e.g., cups + fl oz), incompatible units use `additionalAmounts`
- **Comprehensive testing**: 28 tests ensure deterministic behavior and catch regressions
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
│  FRONTEND (Next.js 14 App Router)                                           │
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
| `app/` | `layout.tsx`, `page.tsx` | Next.js App Router entry points, providers setup |
| `components/recipes/` | `recipe-list.tsx`, `recipe-card.tsx`, `recipe-dialog.tsx` | Recipe CRUD UI with text import parser and ingredient modifier support |
| `components/planner/` | `meal-planner.tsx` | Week navigation, plan generation, history |
| `components/pantry/` | `pantry-list.tsx` | Pantry items, excluded keywords |
| `components/shopping/` | `shopping-list.tsx`, `shopping-settings-modal.tsx` | Shopping list display, scaling, drag-and-drop reordering, category management |
| `components/ui/` | Various | Radix UI primitives (button, dialog, tabs, etc.) |
| `components/` | `error-boundary.tsx` | Error boundary component for application resilience |
| `hooks/` | `use-recipes.ts`, `use-planner.ts`, `use-pantry.ts` | TanStack Query hooks for Supabase |
| `hooks/shopping/` | Domain-focused modules | Shopping hooks split by domain (list, items, recipes, categories, config, pantry) |
| `lib/supabase/` | `client.ts`, `server.ts` | Supabase client initialization (singleton pattern) |
| `lib/` | `meal-planner.ts`, `shopping-list.ts`, `shopping-list-normalization.ts`, `shopping-list-merging.ts`, `shopping-categories.ts`, `recipe-parser.ts` | Business logic (plan generation, list aggregation with normalization, category management, recipe text parsing with modifier extraction) |
| `lib/__tests__/` | Test files | Comprehensive test suite for shopping list functionality |
| `types/` | `database.ts` | TypeScript types for Supabase tables |

### Middleware (`src/middleware.ts`)

Handles Supabase auth session refresh on every request to keep users logged in.

### Migration Script (`scripts/migrate.ts`)

One-time import of legacy `data/*.json` files into Supabase. Uses service role key for elevated permissions.

---

## 4. Where Data Lives

### Supabase PostgreSQL Tables

| Table | Schema | Purpose |
|-------|--------|---------|
| `recipes` | `id, user_id, name, category, servings, ingredients (JSONB with modifier support), instructions, favorite, created_at, updated_at` | Recipe collection |
| `pantry_items` | `user_id, item (PK), created_at` | Items user has on hand |
| `user_config` | `user_id (PK), categories[], default_selection, excluded_keywords[], history_exclusion_days, week_start_day, category_overrides, custom_categories[], category_order[], excluded_days[], preferred_days[], auto_assign_days` | User preferences |
| `recipe_history` | `id, user_id, recipe_id (FK), date_made` | When recipes were cooked |
| `weekly_plans` | `user_id, week_date (PK), recipe_ids[], day_assignments (JSONB), scale, generated_at` | Saved plans keyed by week start with day assignments |
| `shopping_list` | `user_id (PK), items[], already_have[], excluded[], source_recipes[], scale, total_servings, custom_order, generated_at` | Current shopping list state |

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
- `sessionStorage`: Guest mode flag (`recipe-genie-guest-mode`)
- `cookies`: Supabase auth session tokens (managed by `@supabase/ssr`)
- **Guest Mode**: Data stored in React Query cache only (lost on page refresh)

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
- `SUPABASE_SERVICE_ROLE_KEY`: Server-only, bypasses RLS (migration script only)

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
| Understand shopping list logic | `src/lib/shopping-list.ts` |
| Understand shopping categories | `src/lib/shopping-categories.ts` |
| Modify shopping hooks | `src/hooks/shopping/` (domain-focused modules) |
| Modify recipe form | `src/components/recipes/recipe-dialog.tsx` |
| Understand recipe parsing | `src/lib/recipe-parser.ts` |
| Change tab navigation | `src/app/page.tsx` |
| Add Supabase query | Create hook in `src/hooks/` |
| Get Supabase client | `src/lib/supabase/client.ts` (singleton) |
| Debug query state | React Query DevTools in browser |
| Check database schema | `supabase/migrations/001_initial_schema.sql` |

---

*Last updated: 2026-01-25 (v2.10.1)*

## Recent Updates (v2.10.1)

### Ingredient Modifier Support & Date-Based History
- **Ingredient Modifiers**: Recipe parser now extracts preparation instructions (e.g., "rinsed", "diced") as separate modifier fields
- **Smart Detection**: Automatically identifies modifiers when importing recipes from text
- **Date-Based History**: Recipes marked as "made" from meal planner use assigned day's date for accurate history tracking
- **Visual Display**: Modifiers shown with muted styling in recipe views for clear distinction

## Previous Updates (v2.10.0)

### Codebase Improvements
- **Error Boundary**: Application-level error boundary prevents crashes and provides recovery UI
- **Shopping Hooks Refactor**: Split monolithic `use-shopping.ts` into domain-focused modules for better maintainability
- **Supabase Client Consolidation**: Single source of truth for Supabase client eliminates duplicate code

## Previous Updates (v2.9.1)

### TypeScript Build Fixes
- Resolved Supabase type inference issues with workarounds
- Added explicit type assertions for query results
- Build now completes successfully with all type checks passing

## Previous Updates (v2.8.1)

### Recipe Ingredient Reordering
- **Drag-and-Drop Ingredients**: Reorder ingredients in recipe dialog using drag-and-drop
- **Visual Feedback**: Grip handle icon indicates draggable items
- **Keyboard Support**: Full keyboard navigation for accessibility
- **Persistent Order**: Ingredient order saved with recipe

## Previous Updates (v2.8.0)

### Meal Planner Settings
- **Plan Settings Modal**: New comprehensive settings modal for meal planning preferences
- **Default Category Breakdown**: Save your preferred meal distribution as default (persists across sessions)
- **Day Placement Rules**: Configure excluded days (never place meals) and preferred days (prioritize placement)
- **Automatic Day Assignment**: Toggle to automatically assign recipes to days when generating plans
- **Intelligent Distribution**: Recipes distributed respecting excluded/preferred days with round-robin fallback
- **History Exclusion**: Configure history exclusion days directly from plan settings

## Previous Updates (v2.7.0)

### Enhanced Shopping List Workflow
- **Checked States**: Items can be checked off while remaining in the shopping list (toggleable checked state with strikethrough)
- **Category Auto-Collapse**: Categories automatically collapse when all items are checked off
- **Complete Shopping Button**: Appears when all items are checked - clears list for clean slate
- **Pantry Integration**: "Got it" section renamed to "Pantry", items clickable to add back to shopping list
- **Add to Pantry**: New button to add items to pantry directly from shopping list (removes from list)
- **Recipe Tag Navigation**: Recipe source tags in shopping list are now clickable to view recipe details
- **Excluded Items Clarity**: Excluded items now display the matching keyword for better visibility

## Previous Updates (v2.6.1)

### Recipe Card Design Refinements
- **Icon-Only Buttons**: Buttons in calendar and category views are now icon-only for cleaner design
- **Circular Category Badges**: Category tags converted to circular badges showing only first letter
- **Improved Layout**: Better button spacing and visual hierarchy in recipe cards
- **Clickable Cards**: Category view cards are now clickable to open recipe detail modal

## Previous Updates (v2.6.0)

### Shopping List Refactor
- **Unit Normalization**: All units normalized to lowercase canonical form for consistent merging
- **Unified Merging Logic**: Single source of truth for item merging eliminates code duplication
- **Comprehensive Test Suite**: 28 tests covering unit normalization, item merging, and shopping list generation
- **Recipe Source Tracking**: Sources now include both `recipeId` and `recipeName` for better tracking

## Previous Updates (v2.5.0)

### Planner Settings for Day Placement
- **Excluded Days**: Configure which days of the week to exclude from automatic meal placement
- **Preferred Days**: Set preferred days for meal placement (recipes prioritized to these days)
- **Auto Assign Days**: Toggle to automatically assign recipes to days when generating meal plans
- Settings accessible via plan settings modal (⚙️ button in meal planner)
- Automatic day assignment uses intelligent distribution respecting excluded/preferred days
- Day assignments preserved when regenerating plans

## Previous Updates (v2.4.0)

### Recipe Category Management
- **Category Settings Modal**: New dedicated modal for managing recipe categories
- **Add/Edit/Delete Categories**: Full category lifecycle management with validation
- **Drag-and-Drop Reordering**: Reorder categories to match your preferences
- **Bulk Recipe Updates**: Automatically updates all recipes when renaming categories
- **Recipe Reassignment**: Reassign recipes to other categories when deleting categories
- **Recipe Count Display**: See how many recipes are in each category
- **Config Sync**: Category changes automatically update meal planner `default_selection` preferences
- Accessible from recipe list view via settings button

## Previous Updates (v2.3.0)

### Recipe Day Assignments
- **Day Assignments**: Assign recipes to specific days of the week in calendar view
- **Cross-Device Sync**: Day assignments persist in database and sync across all devices
- **Dropdown Interface**: Simple dropdown menu on each recipe card to move recipes between days
- **Calendar View**: Visual calendar grid showing recipes organized by day
- Day assignments stored in `weekly_plans.day_assignments` JSONB column
- Works seamlessly with existing meal planning workflow

## Previous Updates (v2.2.0)

### Custom Shopping Categories & Category Ordering
- **Custom Categories**: Create user-defined shopping categories (e.g., "Asian Market", "Specialty Store")
- **Category Ordering**: Drag-and-drop reordering of categories to match your store layout
- **Shopping Settings Modal**: New three-tab settings dialog for managing categories, ordering, and overrides
- Custom categories appear alongside default categories in shopping lists
- Up to 10 custom categories per user
- Inline editing and undo support for category management

## Previous Updates (v2.1.1)

### Recipe Text Parser
- **Import from Text**: Users can now paste recipe text directly into the recipe dialog
- Supports multiple formats: structured sections, free-form text, or mixed formats
- Automatically extracts recipe name, servings, ingredients, and instructions
- Handles Unicode fractions (½, ⅓, ¼, etc.) and converts to decimals
- Parses ingredient amounts with ranges (e.g., "½–1 cup")
- Supports parenthetical units (e.g., "1 (28 oz) can crushed tomatoes")
- Recognizes common section headers: "Ingredients", "Instructions", "Directions", "Method", "Steps"
- Extracts servings from recipe name (e.g., "Makes 4 servings")

### Signup Trigger Improvements
- Enhanced error handling in `handle_new_user()` trigger function
- Explicit `search_path` setting to prevent schema search path issues
- Default recipe creation failures no longer block user signup
- Errors are logged as warnings instead of failing the transaction
- Improved `insert_default_recipes_for_user()` function with better error isolation