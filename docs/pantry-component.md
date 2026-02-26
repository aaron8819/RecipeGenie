# Pantry Component Documentation

> **When to read:** You're working on pantry items, excluded keywords, the pantry-shopping integration, or "What Can I Make?" ingredient matching.

**Last Updated:** 2026-02-26 (v2.15.0)

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Data Flow](#data-flow)
4. [Feature Descriptions](#feature-descriptions)
5. [Shopping List Integration](#shopping-list-integration)
6. [Module Reference](#module-reference)
7. [Testing](#testing)
8. [Common Pitfalls](#common-pitfalls)

---

## Quick Start

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `components/pantry/pantry-list.tsx` | ~257 | Main component — two-column layout for pantry items + excluded keywords |
| `components/pantry/what-can-i-make.tsx` | — | "What Can I Make?" panel — matches pantry against recipe ingredients |
| `components/pantry/index.ts` | 2 | Barrel export |
| `hooks/use-pantry.ts` | ~350 | TanStack Query hooks — 6 exported hooks for pantry CRUD |
| `hooks/use-pantry-match.ts` | — | `usePantryMatch()` — runs fuzzy ingredient match against current pantry |
| `hooks/shopping/use-shopping-pantry.ts` | ~292 | Shopping↔pantry integration hooks |
| `lib/pantry-matcher.ts` | — | Fuzzy ingredient-to-pantry matching logic; checks primary item + `alternatives[]` |
| `lib/shopping-list.ts` | — | `generateShoppingList()` uses pantry items for filtering |
| `lib/shopping-categories.ts` | — | `getExcludedKeyword()` — exact match logic |

### Quick Commands

```bash
# Run E2E tests
npm run test:e2e -- tests/pantry.spec.ts
```

---

## Architecture Overview

### Component Structure

```
pantry-list.tsx
+-- PantryList (main component)
|   +-- Left Card: Pantry Items (Package icon)
|   |   +-- Add form (comma-separated input)
|   |   +-- Tag pills with delete (X) buttons
|   |   +-- Background refetch loader
|   |
|   +-- Right Card: Excluded Keywords (Ban icon)
|       +-- Add form (comma-separated input)
|       +-- Tag pills with delete (X) buttons
|       +-- Background refetch loader

what-can-i-make.tsx
+-- WhatCanIMake (separate panel, rendered in Pantry tab)
    +-- Triggers usePantryMatch() to score recipes
    +-- Groups results: Can Make (100%), Almost (≥70%), etc.
    +-- Click recipe → RecipeDetailDialog
```

Two-column responsive grid (`md:grid-cols-2`). Pantry items use sage colors, excluded keywords use terracotta colors.

### Hooks Layer (use-pantry.ts)

| Hook | Query Key | Purpose |
|------|-----------|---------|
| `usePantryItems()` | `['pantry']` | Fetch all pantry items, sorted A-Z. 30s staleTime. |
| `useAddPantryItem()` | mutation | Insert item. Normalizes to lowercase. Dedupes. |
| `useRemovePantryItem()` | mutation | Delete item. Optimistic removal. |
| `useExcludedKeywords()` | `['user_config', 'excluded_keywords']` | Fetch keywords from user_config. PGRST116 → empty array. 30s staleTime. |
| `useAddExcludedKeyword()` | mutation | Add keyword. Creates user_config row if none exists. |
| `useRemoveExcludedKeyword()` | mutation | Remove keyword from array. |

### Pantry Match Hook (hooks/use-pantry-match.ts)

| Hook | Query Key | Purpose |
|------|-----------|---------|
| `usePantryMatch()` | (derived, no cache) | Scores all user recipes by how many ingredients are in pantry. Returns sorted results with `matchPercent` and `missingIngredients[]`. |

Internally calls `pantryMatcher.matchRecipes(recipes, pantryItems)` from `lib/pantry-matcher.ts`. Checks primary ingredient `item` plus any `alternatives[]`.

### Shopping Integration Hooks (hooks/shopping/use-shopping-pantry.ts)

| Hook | Purpose |
|------|---------|
| `useMoveToShoppingList()` | Move item from `already_have` → main `items` |
| `useMoveExcludedToShoppingList()` | Move item from `excluded` → main `items` |
| `useAddToPantryAndRemove()` | Add shopping item to pantry + move from `items` → `already_have`. Two-phase with rollback. |

---

## Data Flow

### Pantry Item Lifecycle

```
User adds "garlic" to pantry
  -> useAddPantryItem() mutation
  -> Normalize: "garlic" (lowercase, trimmed)
  -> Optimistic: add to ['pantry'] cache
  -> Supabase: INSERT into pantry_items
  -> On error: rollback cache

Later, shopping list generation:
  -> generateShoppingList() reads pantryItems
  -> Creates Set for O(1) lookup
  -> Each ingredient checked: pantrySet.has(item.toLowerCase())
  -> Match → items goes to already_have[] (not main list)
```

### Excluded Keyword Lifecycle

```
User adds "salt" to excluded keywords
  -> useAddExcludedKeyword() mutation
  -> Normalize: "salt" (lowercase, trimmed)
  -> Fetches current user_config (or creates one)
  -> Appends keyword to excluded_keywords[]
  -> Supabase: UPDATE user_config

Later, shopping list generation:
  -> generateShoppingList() reads excludedKeywords
  -> For each ingredient: getExcludedKeyword(item, keywords)
  -> EXACT match only (case-insensitive)
  -> "salt" matches "salt", NOT "kosher salt"
  -> Match → item goes to excluded[] with excludedBy field
```

### Shopping ↔ Pantry Bridge

```
Shopping list shows "garlic" in already_have section
  -> User clicks "Move to list"
  -> useMoveToShoppingList(): already_have → items
  -> Merges amounts if same item already in list

Shopping list shows "garlic" in main items
  -> User clicks "Add to pantry"
  -> useAddToPantryAndRemove():
     Phase 1: INSERT into pantry_items (23505 = dupe OK)
     Phase 2: Move from items → already_have in shopping_list
     On Phase 2 error: rollback Phase 1
```

---

## Feature Descriptions

### 1. Pantry Items
- Add single or comma-separated items ("garlic, onions, olive oil")
- All items normalized to lowercase, trimmed
- Duplicate detection at add time
- Tag-pill display with X button for removal
- **Immediate deletion** with undo toast — deletes from DB right away; Undo re-inserts the item
- Sorted A-Z

### 2. Excluded Keywords
- Same input UX as pantry items (comma-separated)
- Stored in `user_config.excluded_keywords[]`
- **Exact match only** — "pepper" does NOT exclude "poblano pepper"
- **Immediate deletion** with undo toast — same pattern as pantry items

### 3. Stale-While-Revalidate UX
- 30-second stale time on both queries
- Shows cached data immediately
- Subtle spinner in corner during background refetch
- No blocking loaders after initial load

### 4. What Can I Make?

The `WhatCanIMake` panel (rendered in the Pantry tab) cross-references all user recipes against current pantry items:
- Uses `lib/pantry-matcher.ts` to compute a match percentage per recipe
- Checks primary ingredient name AND `alternatives[]` against pantry
- Groups recipes: "Can Make" (100%), "Almost" (≥70%), "Missing a Few" (≥40%)
- Excluded keywords do NOT affect matching — only pantry items count
- Clicking a recipe opens the standard `RecipeDetailDialog`

### 5. Optimistic Updates
All six mutations follow the pattern:
1. Cancel outgoing refetches
2. Snapshot previous data
3. Update cache immediately
4. On error: rollback with snapshot
5. On settle: invalidate query for truth

Removals use **immediate-delete + undo re-inserts**: `removePantryItem.mutate(item)` / `removeKeyword.mutate(kw)` fires immediately (optimistic update removes it from the UI); the undo button calls `addPantryItem.mutate(item)` / `addKeyword.mutate(kw)` to restore it. There is no pending-deletion state in the component — the query cache is the source of truth.

---

## Shopping List Integration

### Three-Way Split in `generateShoppingList()`

```typescript
for each ingredient:
  if pantrySet.has(ingredient.item):
    → alreadyHave[]
  else if getExcludedKeyword(ingredient.item, keywords):
    → excluded[] (with excludedBy field)
  else:
    → items[] (main shopping list)
```

### Exact Match Semantics

`getExcludedKeyword()` in `lib/shopping-categories.ts`:

```
itemName.toLowerCase().trim() === keyword.toLowerCase().trim()
```

This is intentional. "salt" should not exclude "smoked salt" or "salt and pepper seasoning" — users add specific items they always have on hand.

### Two-Phase Pantry Addition

`useAddToPantryAndRemove()` is the most complex hook:
- Phase 1: Insert to `pantry_items` (PostgreSQL unique constraint `23505` treated as success)
- Phase 2: Fetch shopping list, move item from `items` → `already_have`
- If Phase 2 fails: delete pantry item added in Phase 1
- Invalidates both `PANTRY_KEY` and `SHOPPING_KEY`

---

## Module Reference

### types/database.ts

```typescript
type PantryItem = Database['public']['Tables']['pantry_items']['Row']
// { user_id, item, created_at }
```

### Database Schema (pantry_items)

| Column | Type | Constraints |
|--------|------|-------------|
| `user_id` | UUID | FK → auth.users(id), part of composite PK |
| `item` | TEXT | Part of composite PK |
| `created_at` | TIMESTAMPTZ | DEFAULT now() |

Unique index on `(user_id, item)`. RLS: `auth.uid() = user_id`.

### Excluded Keywords (user_config)

| Column | Type | Default |
|--------|------|---------|
| `excluded_keywords` | TEXT[] | `'{}'` |

Stored as a text array in the `user_config` table.

---

## Testing

### E2E Tests (Playwright)

`tests/pantry.spec.ts` — 7 describe blocks, ~352 lines:

| Group | Tests |
|-------|-------|
| Pantry List View | Empty state, inputs visible |
| Add Pantry Items | Enter key, button, clear input, duplicate prevention, case-insensitive dedup, batch add |
| Delete Pantry Items | Delete button, item removal |
| Excluded Keywords | Add/remove keywords |
| Clear All | Button, confirmation dialog, clear action |
| Sorting | Alphabetical A-Z order |
| Shopping Integration | Pantry items excluded from shopping list |

### No Unit Tests

The pantry subsystem has no dedicated unit tests. Business logic is minimal (normalization + dedup). The core algorithm lives in `shopping-list.ts` which is tested via shopping list unit tests.

---

## Common Pitfalls

1. **Exact matching only**: Pantry and keyword matching are both exact, case-insensitive. "garlic" ≠ "garlic cloves". This is by design.

2. **PGRST116 for excluded keywords**: `useExcludedKeywords()` returns `[]` when user_config doesn't exist (PGRST116). Don't throw on this error.

3. **Supabase type inference**: `@ts-expect-error` needed for `.insert()` / `.update()` on `pantry_items` and `user_config`.

4. **New user config creation**: `useAddExcludedKeyword()` creates a `user_config` row with defaults if none exists. The default values are hardcoded in the hook — keep them in sync with `lib/user-config.ts`.

5. **Unique constraint 23505**: `useAddToPantryAndRemove()` treats PostgreSQL unique violation as success — the item was already in the pantry.

6. **Two-phase rollback**: If adding an item to pantry succeeds but moving it in the shopping list fails, the hook rolls back the pantry insert. Don't change the operation order.

7. **Query key coupling**: Pantry uses `['pantry']`, excluded keywords use `['user_config', 'excluded_keywords']`. Shopping integration invalidates both keys.

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) — Project context and quick reference
- [shopping-component.md](./shopping-component.md) — Shopping list (downstream consumer of pantry data)
- [supabase/SCHEMA.md](../supabase/SCHEMA.md) — `pantry_items` and `user_config` table schemas

---

*Last updated: 2026-02-26 (v2.15.0)*
