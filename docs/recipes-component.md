# Recipes Component Documentation

> **When to read:** You're working on recipe CRUD, the recipe list/grid, recipe dialog (create/edit), recipe parser, URL import, tags, categories, favorites, recipe images, cook mode, or recipe sharing.

**Last Updated:** 2026-02-26 (v2.15.0)

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Key Algorithms](#key-algorithms)
4. [Feature Descriptions](#feature-descriptions)
5. [Module Reference](#module-reference)
6. [Testing](#testing)
7. [Common Pitfalls](#common-pitfalls)

---

## Quick Start

### Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `components/recipes/recipe-list.tsx` | ~539 | Main container — filtering, sorting, search, dialog orchestration |
| `components/recipes/recipe-card.tsx` | ~504 | Card display — grid and list view modes |
| `components/recipes/recipe-dialog.tsx` | ~1,350 | Create/edit modal — manual entry + text/URL import; dynamically imports `recipe-sortable-ingredients.tsx` |
| `components/recipes/recipe-sortable-ingredients.tsx` | — | Extracted dnd-kit drag-and-drop row — dynamically imported to keep dnd-kit out of the initial bundle |
| `components/recipes/recipe-detail-dialog.tsx` | ~290 | Read-only detail view with actions, cook mode entry |
| `components/recipes/share-recipe-dialog.tsx` | ~170 | Share recipe modal (exact recipient email + optional note) |
| `components/recipes/shared-recipes-inbox.tsx` | ~220 | Inbox/sent view for incoming/outgoing shares |
| `components/recipes/add-to-plan-dialog.tsx` | ~100 | Add recipe to a weekly plan |
| `components/recipes/recipe-settings-modal.tsx` | ~100 | Category and tag management settings |
| `components/recipes/tag-management-modal.tsx` | ~100 | Tag rename, merge, delete |
| `components/recipes/index.ts` | 7 | Barrel exports |
| `hooks/use-recipes.ts` | ~771 | TanStack Query hooks — 15 exported hooks for recipe CRUD |
| `hooks/use-recipe-shares.ts` | ~170 | TanStack Query hooks for create/inbox/sent/accept/decline share flows |
| `hooks/use-recipe-import.ts` | — | URL import state management — wraps the `/api/recipe-import` fetch, loading/error state |
| `lib/recipe-parser.ts` | ~467 | Plain text → structured recipe parser |
| `lib/recipe-url-parser.ts` | — | Server-side URL fetch + JSON-LD / Cheerio HTML extraction (used by API route) |
| `lib/recipe-export.ts` | — | Serialize recipe to JSON or plain text for download |

### Quick Commands

```bash
# Run recipe parser unit tests
npm run test -- src/lib/__tests__/recipe-parser.test.ts

# Run E2E tests
npm run test:e2e -- tests/recipes.spec.ts
```

---

## Architecture Overview

### Data Flow

```
User creates/edits recipe
  -> RecipeDialog component (manual entry or text import)
  -> useCreateRecipe() / useUpdateRecipe() mutation
  -> Optimistic update to query cache
  -> Supabase insert/update (recipes table)
  -> Invalidate ['recipes', ...] + tag queries -> UI updates

User views recipes
  -> RecipeList fetches via useRecipes(filters)
  -> Multi-tag filter calls filter_recipes_by_tags RPC (&& overlap = OR); single tag uses standard query
  -> RecipeCard renders grid or list view
  -> Click card -> RecipeDetailDialog (read-only view)
```

### Component Structure

```
recipe-list.tsx
+-- RecipeList (main container)
|   +-- Filter Bar
|   |   +-- Category filter (pills)
|   |   +-- Tag filter (MultiSelect, OR logic)
|   |   +-- Favorites toggle
|   |   +-- Search input
|   |   +-- Sort dropdown (Most Made, Recently Made, Name, Newest)
|   |   +-- View toggle (grid/list)
|   |   +-- Settings button -> RecipeSettingsModal
|   |   +-- Add Recipe button -> RecipeDialog
|   |
|   +-- Recipe Grid/List
|   |   +-- RecipeCard (grid: image card, list: horizontal row)
|   |       +-- Category pill, tag pills, history stats
|   |       +-- Action buttons: Made, Shop, Plan
|   |
|   +-- RecipeDetailDialog (on card click)
|   |   +-- Image, title, ingredients, instructions
|   |   +-- Edit / Delete / Favorite actions
|   |
|   +-- AddToPlanDialog (from card or detail)
|       +-- Week selector: This week, Next week, Custom

RecipeDialog (create/edit)
+-- Manual Entry Tab
|   +-- Name, Category, Servings, Tags
|   +-- Ingredients (drag-reorderable via dnd-kit)
|   +-- Instructions
|   +-- Image upload (Supabase Storage)
|
+-- Import Tab
    +-- URL import -> /api/recipe-import -> preview -> apply
    +-- Text paste -> parseRecipeText() -> preview -> apply

RecipeSettingsModal
+-- Categories Tab (reorder, rename, delete with dnd-kit)
+-- Tags Tab -> TagManagementModal (rename, merge, delete)
```

### Hooks Layer (use-recipes.ts)

| Hook | Query Key | Purpose |
|------|-----------|---------|
| `useRecipes(options?)` | `['recipes', options]` | Fetch with filters (category, search, favorites, tags). 30s staleTime. |
| `useRecipe(id)` | `['recipes', id]` | Fetch single recipe by ID |
| `useCreateRecipe()` | mutation | Create with optimistic update. Auto-generates ID from name. |
| `useUpdateRecipe()` | mutation | Update with optimistic update |
| `useDeleteRecipe()` | mutation | Delete with optimistic removal |
| `useToggleFavorite()` | mutation | Toggle favorite boolean |
| `useCategories()` | `['user_config', 'categories']` | User's categories in custom order. Infinity staleTime. |
| `useAllTags()` | (derived) | All unique tags — derived from `useRecipes()` cache via `useMemo`. No extra DB call. |
| `useTagsWithCounts()` | (derived) | Tags with usage counts, sorted desc — derived from `useRecipes()` cache via `useMemo`. No extra DB call. |
| `useCategoryHasRecipes(name)` | (derived) | Check if category has recipes |
| `useUpdateCategories()` | mutation | Update user categories (validates no empty/dupes) |
| `useBulkUpdateRecipeCategories()` | mutation | Reassign recipes from old → new category |
| `useRenameTag()` | mutation | Rename tag via `rename_tag` RPC — single DB call, no per-recipe N+1 |
| `useMergeTags()` | mutation | Merge source tags into target via `merge_tags` RPC — single DB call |
| `useDeleteTag()` | mutation | Delete tag via `delete_tag` RPC — single DB call, no per-recipe N+1 |

**Optimistic update pattern:** All mutations implement `onMutate` (snapshot + optimistic update), `onError` (rollback), `onSuccess` (refine), `onSettled` (full refetch). Uses `updateRecipeQuery()` helper to handle both `Recipe[]` and single `Recipe` query shapes.

---

## Key Algorithms

### Recipe Text Parser

`parseRecipeText()` in `lib/recipe-parser.ts`:

1. Split text by newlines, trim, filter empty
2. Find section headers (case-insensitive): "Ingredients", "Instructions/Directions/Method/Steps"
3. Extract recipe name (text before Ingredients header, or first line)
4. Extract servings from name (e.g., "Recipe (4 servings)" → 4)
5. Parse each ingredient line via `parseIngredientLine()`
6. Extract instructions after Instructions header
7. Generate warnings for missing fields

**`parseIngredientLine()` handles:**
- List markers (`-`, `*`, `•`, `.`)
- Unicode fractions (`½`, `⅓`, `¾`, etc. — 14 supported)
- Ranges ("1-2 cups" → amount: 1, stores "1 - 2" in unit)
- Parenthetical units ("1 (28 oz) can" → unit: "can (28 oz)")
- Modifiers after comma ("lentils, rinsed" → modifier: "rinsed")
- 50+ unit abbreviations matched longest-first

### Sorting

`sortRecipes()` supports four modes:
- **Most Made** — by `timesMade` desc, fallback to name
- **Recently Made** — by `lastMade` desc, fallback to name
- **Name (A-Z)** — alphabetical
- **Newest First** — by `created_at` desc

### Tag Filtering

Multi-tag filtering calls the `filter_recipes_by_tags` RPC which uses the `&&` array overlap operator (OR semantics — recipes with ANY selected tag pass). Single-tag filtering uses the standard `useRecipes()` query. The old client-side filter over the full dataset has been replaced.

---

## Feature Descriptions

### 1. View Modes
- **Grid:** Card layout with image (60px height), category/tag pills, action footer
- **List:** Horizontal row with smaller image, text details, inline action icons (desktop) or dropdown menu (mobile)

### 2. Recipe Dialog (Create/Edit)
- **Three tabs (add mode):** Manual entry, Import from text, Import from URL
- **URL import flow:** Paste URL → server-side fetch/parse via `/api/recipe-import` → preview → apply & edit
- **Live import preview (v2.15.0):** Two-column responsive layout with real-time preview (300ms debounced). Desktop shows side-by-side input/preview, mobile stacks vertically. Preview displays recipe name, stats (ingredient/step counts), warnings, first 8 ingredients, and first 3 steps. "Apply to Form" button pre-fills Manual tab.
- **Import preview:** Scrollable preview area (warnings + name/servings/ingredients/instructions). No individual section scroll limits — entire preview scrolls as one unit within the tab.
- **Ingredient management:** dnd-kit drag-reorder, inline editing (amount, unit, item, modifier). The sortable row is in `recipe-sortable-ingredients.tsx`, dynamically imported by `recipe-dialog.tsx` to keep dnd-kit out of the initial bundle. On mobile, ingredient rows stack into two rows (item + drag/delete on top, amt/unit/modifier below). Column headers hidden on mobile.
- **Ingredient validation (v2.15.0):** Real-time validation with amber ring indicators and warning icons. Blocking issues: missing-item, unit-without-amount. Soft warnings: amount-without-unit (allows "3 bananas"). Validation summary banner with issue count and auto-fix button. Pre-submit validation blocks on critical issues only.
- **Alternative ingredients (v2.15.0):** Parser detects "X or Y" patterns (e.g., "Greek yogurt or sour cream"). Displays in recipe detail, cook mode, and shopping list as "(or sour cream)".
- **Image upload:** JPG/PNG/WebP, max 5MB, auto-compressed >1MB to 2000px width
- **Validation:** Requires name, category, at least 1 ingredient. Real-time validation indicators for ingredient issues (soft warnings don't block submission).
- **Post-creation:** `onRecipeCreated` callback passes newly created recipe to parent. `RecipeList` opens the detail dialog for the new recipe.
- **Mobile layout:** Responsive padding (`px-4 sm:px-8`), tab labels shortened ("Manual", "Import"), dialog width `w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)]` with `overflow-hidden`

### 3. Recipe Detail Dialog
- **Always-visible floating close button** — sticky at top-right, glass-effect backdrop blur, no scroll-based show/hide
- Image display (16:10 aspect), history stats, favorite toggle, edit/delete actions
- **Action buttons wrap** on mobile (`flex-wrap`, reduced padding `px-4 sm:px-6`)
- **Cook mode entry:** Closes dialog first, saves recipe to ref, renders `CookMode` independently via early-return path when `recipe` prop becomes null
- **Mobile layout:** Responsive padding throughout (`p-3 sm:p-6`, `px-4 sm:px-8`), `overflow-x-hidden` prevents horizontal overflow, `rounded-2xl sm:rounded-[32px]`

### 4. Category Management
- Drag-reorder categories (dnd-kit)
- Rename inline (pencil icon toggles edit mode)
- Delete with confirmation (shows recipe count affected)
- Bulk reassign recipes when renaming

### 5. Tag Management
- Rename tag across all recipes
- Merge multiple tags into one
- Delete tag (removes from all recipes)
- Shows usage counts per tag

### 6. Add to Plan
- Three options: This Week, Next Week, Custom (with week navigation)
- Respects `week_start_day` from user config

### 7. Recipe Sharing (Copy-on-Accept)
- **Share action locations:** recipe cards (list/grid), recipe detail dialog
- **Share dialog:** exact recipient email + optional message (max 300 chars)
- **Recipient inbox:** "Shared With Me" tab with Accept/Decline actions
- **Sent tab:** status tracking for outgoing shares (`pending`, `accepted`, `declined`, `canceled`)
- **Acceptance behavior:** creates a recipient-owned copy from immutable snapshot; no live sync to sender

---

## Module Reference

### lib/recipe-parser.ts

| Export | Purpose |
|--------|---------|
| `parseRecipeText(text)` | Main entry — returns `{ name, ingredients, instructions, servings?, warnings }` |
| `parseIngredientLine(line)` | Single line → `{ item, amount, unit, modifier?, alternatives? }` |

Internal helpers: `findSectionIndex()`, `normalizeUnicode()`, `parseAmount()`, `extractUnit()`, `matchUnit()`, `extractModifier()`, `parseFraction()`

### lib/recipe-url-parser.ts

Server-side only (used by `/api/recipe-import`). Fetches URL, extracts JSON-LD `Recipe` schema first; falls back to Cheerio-based HTML scraping. SSRF-guarded before the fetch via `lib/url-safety.ts`.

### lib/recipe-export.ts

| Export | Purpose |
|--------|---------|
| `exportRecipeAsJson(recipe)` | Returns formatted JSON string |
| `exportRecipeAsText(recipe)` | Returns human-readable plain-text |

### types/database.ts

```typescript
type Recipe = Database['public']['Tables']['recipes']['Row']
// { id, user_id, name, category, servings, favorite, tags, ingredients, instructions, image_url, created_at, updated_at }

interface Ingredient {
  item: string
  amount: number | null
  unit: string
  shoppingCategory?: string
  modifier?: string
}
```

---

## Testing

### Unit Tests (Vitest)

| Test File | Coverage |
|-----------|----------|
| `lib/__tests__/recipe-parser.test.ts` | Parsing: fractions, ranges, units, modifiers, section detection, Unicode |

### E2E Tests (Playwright)

- `tests/recipes.spec.ts` — Grid/list view, search, filtering, add/edit/delete, import from text, image upload, categories, tags
- `tests/recipes.spec.ts` (sharing coverage) — Share button visibility, share dialog opening, shared inbox opening
- Runs across all browsers + mobile viewports

---

## Common Pitfalls

1. **Supabase type inference**: `.insert()` and `.update()` infer params as `never` — use `@ts-expect-error` with comment.

2. **Tag filtering is client-side**: Supabase `.contains()` does AND; we need OR. Tags are filtered after fetch.

3. **Category staleTime is Infinity**: `useCategories()` never auto-refetches. Mutations must manually invalidate the `['user_config', 'categories']` key.

4. **Tag query cache key includes recipe count**: `['recipes', 'tags-with-counts', recipes?.length]` — busts cache when recipes change.

5. **Ingredient drag-and-drop**: Uses `dnd-kit` with sortable indices. The sortable row lives in `recipe-sortable-ingredients.tsx`, which is dynamically imported by `recipe-dialog.tsx` — do not move dnd-kit imports back into `recipe-dialog.tsx` or it re-enters the initial bundle. Don't forget the `DndContext` + `SortableContext` wrapper.

6. **Image handling**: Upload goes to Supabase Storage via `uploadRecipeImage()`. Delete old image before uploading new one. Placeholder shows cooking emoji if no `image_url`.

7. **Category pill colors**: Hardcoded map (`REF_CATEGORY_PILL`) for chicken/beef/lamb/turkey/vegetarian. Custom categories fall back to `getTagColor()`.

8. **Dialog mobile overflow**: Dialog containers need both `w-[calc(100%-Xrem)]` AND `overflow-x-hidden`. Width alone doesn't fix cutoff — internal content with fixed padding (`px-8`) or non-wrapping button rows will push content past the edge. Always make internal padding responsive (`px-4 sm:px-8`) and use `flex-wrap` on button rows.

9. **Cook mode lifecycle**: `CookMode` must render outside the `Dialog` tree. The parent nulls the recipe prop when the dialog closes, so use a `useRef` to persist the recipe for cook mode. The early-return path (`if (!recipe)`) checks `isCookMode` and renders `CookMode` from the ref.

10. **Duplicate close buttons**: When adding a persistent floating close button to a dialog, check for existing static close buttons (e.g., inside image areas) and remove them.

11. **Recipient lookup privacy**: Recipient discovery is exact-email only via server-side endpoint; no client-side searchable user directory.

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) — Project context and quick reference
- [project_overview.md](../project_overview.md) — Full architecture orientation
- [supabase/SCHEMA.md](../supabase/SCHEMA.md) — `recipes` table schema, indexes, RLS
- [decisions.md](../decisions.md) — Architectural decisions

---

*Last updated: 2026-02-27 (v2.16.0)*
