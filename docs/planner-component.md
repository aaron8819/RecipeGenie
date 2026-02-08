# Meal Planner Component Documentation

> **When to read:** You're working on meal plan generation, week navigation, day assignments, recipe swapping, calendar view, plan settings, or history exclusion logic.

**Last Updated:** 2026-02-08 (v2.13.1)

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Key Algorithms](#key-algorithms)
4. [Date Handling](#date-handling)
5. [Day Assignments](#day-assignments)
6. [Module Reference](#module-reference)
7. [Testing](#testing)
8. [Common Pitfalls](#common-pitfalls)

---

## Quick Start

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `components/planner/meal-planner.tsx` | ~2,100 | Main component — week nav, calendar view, category view, recipe cards |
| `components/planner/plan-settings-modal.tsx` | — | Settings dialog — default categories, day rules, history exclusion |
| `components/planner/add-recipe-to-plan-modal.tsx` | — | Modal for adding a recipe directly to the plan |
| `hooks/use-planner.ts` | ~970 | TanStack Query hooks — 14 exported hooks for plan CRUD |
| `lib/meal-planner.ts` | ~180 | Business logic — plan generation, swap, auto-assign |
| `lib/planner-utils.ts` | ~76 | Date helpers — local parsing, noon ISO, day-index conversion |
| `lib/planner-colors.ts` | ~12 | Category hex color mapping |
| `lib/user-config.ts` | ~31 | Default config, `resolveUserConfig()` |

### Quick Commands

```bash
# Run planner unit tests
npm run test -- src/lib/__tests__/meal-planner.test.ts
npm run test -- src/lib/__tests__/planner-utils.test.ts
npm run test -- src/lib/__tests__/planner-colors.test.ts
npm run test -- src/lib/__tests__/user-config.test.ts

# Run E2E tests
npm run test:e2e -- tests/planner.spec.ts
```

---

## Architecture Overview

### Data Flow

```
User clicks "Generate Meal Plan"
  -> useGenerateMealPlan mutation
  -> Fetch: allRecipes, recipeHistory, userConfig
  -> generateMealPlan() in lib/meal-planner.ts
     -> Filter recipes by category
     -> Exclude recently-made (within historyExclusionDays)
     -> Randomly select requested count per category
     -> Fallback: include recent recipes if pool insufficient
  -> If auto_assign_days enabled:
     -> autoAssignDays() distributes recipes to days
  -> Upsert to Supabase (weekly_plans table)
  -> Invalidate query -> UI updates
```

### Component Structure

```
meal-planner.tsx
+-- MealPlanner (main component)
|   +-- Week Navigation (prev/next week, today button)
|   +-- Generation Controls
|   |   +-- Category pill selectors (count per category)
|   |   +-- Generate button
|   |   +-- Settings button -> PlanSettingsModal
|   |
|   +-- Calendar View (desktop: 7-column grid, mobile: day stack)
|   |   +-- Day columns with recipe cards
|   |   +-- FlipRecipeCard (animates on swap)
|   |   +-- Day assignment dropdowns
|   |   +-- Mark-as-made / Swap / Cart / Remove actions
|   |
|   +-- Category View (fallback when no day assignments)
|   |   +-- Grouped by recipe category
|   |
|   +-- View Shopping List button
|
+-- PlanSettingsModal
|   +-- Default Category Breakdown (save/load defaults)
|   +-- Day Placement Rules (excluded/preferred days)
|   +-- Auto-assign toggle
|   +-- History Exclusion Days slider
|
+-- AddRecipeToPlanModal
    +-- Search/filter recipes to add to current plan
```

### Hooks Layer (use-planner.ts)

| Hook | Purpose |
|------|---------|
| `useWeeklyPlan(weekDate)` | Fetch plan for a given week |
| `useWeeklyPlanRecipes(recipeIds)` | Fetch recipe details for plan |
| `useRecipeHistory()` | Fetch all recipe history |
| `useUserConfig()` | Fetch user config (uses `resolveUserConfig`) |
| `useUpdateUserConfig()` | Update user config |
| `useGenerateMealPlan()` | Generate a new plan |
| `useSwapRecipe()` | Swap one recipe in the plan |
| `useSaveWeeklyPlan()` | Save/upsert a plan |
| `useAddRecipeToPlan()` | Add a single recipe to existing plan |
| `useRemoveRecipeFromPlan()` | Remove a recipe from plan |
| `useMarkRecipeAsMade()` | Toggle made state for a recipe in plan |
| `useUnmarkRecipeAsMade()` | Undo mark-as-made |
| `useMarkRecipeMade()` | Record in recipe_history (with date) |
| `useSaveDayAssignments()` | Persist day assignments to DB |

**Query keys:** `['planner', userId, weekDate]`, `['recipes', userId]`, `['recipe_history', userId]`, `['user_config', userId]`

---

## Key Algorithms

### Meal Plan Generation

`generateMealPlan()` in `lib/meal-planner.ts`:

1. Calculate cutoff date: `today - historyExclusionDays`
2. Build set of recent recipe IDs (where `dateMade >= cutoffDate`)
3. For each category in the selection:
   - Filter recipes by category, excluding recent IDs
   - If enough non-recent: randomly select requested count (Fisher-Yates shuffle)
   - If insufficient non-recent: use all non-recent + fill from recent recipes
   - If insufficient total: add error, use all available
4. Return `{ recipes, errors }`

**Important boundary behavior:** Recipes made exactly N days ago ARE excluded (`dateMade >= cutoffDate`).

### Auto-Assign Days

`autoAssignDays()` in `lib/meal-planner.ts`:

1. **Prune stale assignments**: Remove entries for recipe IDs no longer in the plan
2. **Get available days**: All days (0-6) minus excluded days
3. **Build priority list**: Preferred days first, then remaining available days
4. **Round-robin**: Assign unassigned recipes to days cycling through the priority list

### Recipe Swap

`getSwapRecipe()` in `lib/meal-planner.ts`:

- Filters same-category recipes, excluding all current plan recipe IDs
- Returns a random available recipe, or `null` if none available
- The `useSwapRecipe` hook preserves the swapped recipe's day assignment

---

## Date Handling

**Critical pattern:** All dates that cross the client-server boundary must use local noon ISO strings to avoid UTC boundary shifts.

### The Problem

A date like `2026-02-04` stored as `new Date('2026-02-04').toISOString()` produces `2026-02-04T00:00:00.000Z` (UTC midnight). In timezones behind UTC (e.g., US Pacific = UTC-8), this resolves to Feb 3 locally, causing recipes to appear on the wrong day.

### The Solution

`lib/planner-utils.ts` provides:

| Function | Purpose |
|----------|---------|
| `parseLocalDate(iso)` | Parse `YYYY-MM-DD` as local date (midnight local) |
| `parseLocalCalendarDate(str)` | Parse both `YYYY-MM-DD` and full ISO strings as local calendar dates |
| `toLocalNoonISOString(date)` | Convert to ISO string at local noon (12:00) to survive timezone conversion |
| `dayIndexToDayOfWeek(idx, start)` | Convert 0-based day index to day-of-week, accounting for week start day |
| `dayOfWeekToDayIndex(dow, start)` | Reverse of above |
| `stableRecipeHash(id)` | Deterministic hash for consistent day placement |

**When to use what:**
- **Storing `date_made`**: Always use `toLocalNoonISOString()`
- **Comparing dates for history exclusion**: Use `parseLocalCalendarDate()`
- **Week range checks**: Use `parseLocalCalendarDate()` for both boundaries

### Day Index Convention

- `0` = Sunday, `1` = Monday, ..., `6` = Saturday
- `week_start_day` in user config: `1` = Monday (default)
- Day indices in `day_assignments`, `excluded_days`, `preferred_days` all use 0=Sunday

---

## Day Assignments

### Data Model

Stored in `weekly_plans.day_assignments` as JSONB:

```json
{
  "recipe-id-1": 0,    // Sunday
  "recipe-id-2": 3,    // Wednesday
  "recipe-id-3": 5     // Friday
}
```

### Assignment Sources

1. **Auto-assign on generation**: When `auto_assign_days` is enabled, `autoAssignDays()` distributes recipes
2. **Manual assignment**: User selects a day from dropdown on recipe card
3. **Swap preserves day**: When swapping a recipe, the new recipe inherits the old recipe's day

### Unassigned Recipes

Recipes without explicit day assignments are placed using `getUnassignedDayOfWeek()` from `planner-utils.ts`:
- Uses `stableRecipeHash(recipeId)` for deterministic placement
- Respects excluded/preferred day priority
- Same recipe always lands on the same day (stable across refreshes)

---

## Module Reference

### lib/planner-colors.ts

```typescript
CATEGORY_HEX_COLORS: Record<string, string>  // chicken: green, beef: red, etc.
getCategoryHexColor(category: string): string  // Returns hex color, default #6b7280
```

Used by both `meal-planner.tsx` and `plan-settings-modal.tsx` for category pill styling.

### lib/user-config.ts

```typescript
DEFAULT_USER_CONFIG: UserConfig  // All fields with sensible defaults
resolveUserConfig(data, error): UserConfig  // PGRST116 -> defaults, other errors -> throw
```

**PGRST116** is the Supabase error code for "no rows returned" — expected for new users who haven't saved config yet.

---

## Testing

### Unit Tests (Vitest)

| Test File | Coverage |
|-----------|----------|
| `lib/__tests__/meal-planner.test.ts` | Plan generation, history exclusion boundary, auto-assign logic |
| `lib/__tests__/planner-utils.test.ts` | Local date parsing, noon ISO strings, day-index conversion |
| `lib/__tests__/planner-colors.test.ts` | Category hex color lookup, default color |
| `lib/__tests__/user-config.test.ts` | Default config values, resolveUserConfig with PGRST116 |

### E2E Tests (Playwright)

- `tests/planner.spec.ts` — Week navigation, plan generation, recipe cards, day assignments

---

## Common Pitfalls

1. **UTC date shift**: Never use `new Date(dateString).toISOString()` for `date_made`. Always use `toLocalNoonISOString()`.

2. **Stale day assignments**: When regenerating a plan, call `autoAssignDays()` with existing assignments to prune recipes no longer in the plan. Without this, orphaned keys accumulate in `day_assignments`.

3. **History exclusion boundary**: The comparison is `>=` (not `>`). A recipe made exactly `historyExclusionDays` ago IS excluded.

4. **Week start day**: The `week_start_day` config affects how day indices map to calendar days. Always use `dayIndexToDayOfWeek()` / `dayOfWeekToDayIndex()` rather than hardcoding.

5. **Swap animation**: The `FlipRecipeCard` wrapper triggers animation when `recipe.id` changes in a slot. The `useSwapRecipe` hook optimistically updates the recipes query cache so the calendar doesn't unmount during the animation.

6. **PGRST116 handling**: `useUserConfig()` uses `resolveUserConfig()` — PGRST116 (no config row) returns defaults. Other Supabase errors are rethrown.

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) — Project context and quick reference
- [project_overview.md](../project_overview.md) — Full architecture orientation
- [supabase/SCHEMA.md](../supabase/SCHEMA.md) — `weekly_plans`, `user_config`, `recipe_history` table schemas
- [decisions.md](../decisions.md) — ADR-006 (history exclusion), ADR-010 (Next.js migration)

---

*Last updated: 2026-02-07 (v2.13.1)*
