# Shopping List Component Documentation

> **When to read:** You're working on shopping list generation, ingredient merging/normalization, category assignment, check-off UX, drag-and-drop reordering, or pantry/excluded keyword integration.

**Version:** 2.13.1
**Last Updated:** 2026-02-08
**Component:** `web/src/components/shopping/shopping-list.tsx`

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Data Flow](#data-flow)
4. [Feature Descriptions](#feature-descriptions)
5. [Mobile vs Desktop Differences](#mobile-vs-desktop-differences)
6. [State Management](#state-management)
7. [Drag-and-Drop Implementation](#drag-and-drop-implementation)
8. [Testing Strategy](#testing-strategy)
9. [Known Limitations](#known-limitations)
10. [Future Enhancements](#future-enhancements)

---

## Quick Start

### Working with the Shopping Component

The Shopping List component is the fourth tab in Recipe Genie's main navigation. It generates aggregated shopping lists from meal plan recipes and supports:

- Manual item addition
- Ingredient categorization by grocery store section
- Check-off items while shopping
- Item reordering via drag-and-drop
- Pantry integration (skip items you already have)
- Excluded keywords (auto-filter common items like "salt")

### Key Files

| File | Purpose |
|------|---------|
| `components/shopping/shopping-list.tsx` | Main component (UI logic) |
| `components/shopping/shopping-settings-modal.tsx` | Settings dialog |
| `hooks/shopping/use-shopping-list.ts` | Fetch/generate/save list |
| `hooks/shopping/use-shopping-items.ts` | Add/remove/check items |
| `hooks/shopping/use-shopping-pantry.ts` | Pantry integration |
| `hooks/shopping/use-shopping-categories.ts` | Category management |
| `lib/shopping-list.ts` | List generation algorithm |
| `lib/shopping-categories.ts` | Category assignment logic |
| `lib/shopping-list-merging.ts` | Item merging logic |
| `lib/shopping-list-normalization.ts` | Unit normalization |

### Quick Commands

```bash
# Run unit tests for shopping logic
npm run test -- src/lib/__tests__/shopping*.test.ts

# Run E2E tests
npm run test:e2e -- tests/shopping-list.spec.ts

# Run mobile E2E tests
npm run test:e2e -- tests/shopping-list-mobile.spec.ts --project="Mobile Chrome"
```

---

## Architecture Overview

### Component Structure

```
shopping-list.tsx
+-- ShoppingList (main component)
|   +-- Header Section
|   |   +-- Title & Stats (servings, item count)
|   |   +-- Recipe Tags (sources)
|   |   +-- Action Buttons (Organize, Clear, Copy)
|   |
|   +-- Add Item Input
|   |   +-- Comma-separated multi-item support
|   |
|   +-- Category Cards (collapsible)
|   |   +-- CardHeader (category name, chevron, count)
|   |   +-- CardContent (item list, draggable)
|   |       +-- ShoppingItemRow (checkbox, name, amount, actions)
|   |
|   +-- In Pantry Section (optional)
|   |   +-- Horizontal scrollable items
|   |
|   +-- Excluded Section (optional)
|   |   +-- Horizontal scrollable items
|   |
|   +-- Complete Shopping Button (when all checked)
|
+-- ShoppingSettingsModal (dialog)
    +-- Categories Tab (view/reorder)
    +-- Order Tab (custom category ordering)
    +-- Excluded Tab (manage excluded keywords)
```

### Hooks Layer

```
Shopping Hooks (hooks/shopping/)
+-- use-shopping-list.ts      -> useQuery/useMutation for list CRUD
+-- use-shopping-items.ts     -> Item operations (add, remove, check, reorder)
+-- use-shopping-recipes.ts   -> Remove recipe from list
+-- use-shopping-categories.ts -> Category overrides
+-- use-shopping-pantry.ts    -> Move to/from pantry
+-- use-shopping-config.ts    -> User preferences
+-- shared.ts                 -> Constants and helpers
```

### Business Logic Layer

```
Shopping Logic (lib/)
+-- shopping-list.ts              -> List generation algorithm
+-- shopping-list-normalization.ts -> Unit/name normalization
+-- shopping-list-merging.ts      -> Item merging logic
+-- shopping-categories.ts        -> Category assignment
+-- unit-conversion.ts            -> Unit compatibility & merging
```

---

## Data Flow

### List Generation Flow

```
User clicks "View Shopping List" from Planner
  -> useGenerateShoppingList mutation triggered
  -> Fetch: recipes, pantryItems, config
  -> generateShoppingList() in lib/shopping-list.ts
     -> Aggregate ingredients from recipes (normalize names/units)
     -> Merge same items (unit conversion)
     -> Filter pantry items -> alreadyHave[]
     -> Filter excluded keywords -> excluded[]
     -> Categorize remaining -> items[]
     -> Sort by category order, then alphabetically
  -> Save to Supabase (shopping_list table)
  -> Invalidate query -> UI updates
```

### Check-Off Item Flow

```
User clicks checkbox
  -> Optimistic update (instant UI change)
  -> useMutation -> update items[] with checked: true
     -> If all items in category checked: auto-collapse category
     -> If all items checked: show "Complete Shopping" button
  -> Save to Supabase
  -> On error: rollback optimistic update
```

---

## Feature Descriptions

### 1. Manual Item Addition

- Single items: Type and press Enter
- Multiple items: Comma-separated (`apples, oranges, bananas`)
- Auto-categorization based on keywords
- Prevents duplicates (shows error toast)

### 2. Ingredient Merging

- Same item + same unit: add amounts
- Same item + compatible units: convert and add (e.g., cups + fl oz)
- Same item + incompatible units: store in `additionalAmounts[]`

### 3. Category Assignment

Priority order: user overrides > recipe-level override > keyword matching (longest match first) > default "Pantry"

### 4. Pantry Integration

- "In Pantry" section shows items from recipes user already has (exact match)
- "Add to Pantry" action adds item to `pantry_items` and moves from items[] to already_have[]

### 5. Keyword Exclusion

- Exact match only (case-insensitive)
- "salt" excludes "salt", NOT "kosher salt"
- Excluded items shown in collapsible section with matching keyword

### 6. Check-Off & Auto-Collapse

- Checkbox marks item as purchased (strikethrough, persists across refreshes)
- Categories auto-collapse when all items checked
- "Complete Shopping" button appears when all items checked

### 7. Drag-and-Drop Reordering

- Uses `@dnd-kit` library
- Drag within or between categories
- Sets `custom_order: true` on list
- Long-press (250ms) to drag on mobile

### 8. Complete Shopping

- Clears shopping list
- Records recipe history for exclusion algorithm

---

## Mobile vs Desktop Differences

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Item actions | Hover to reveal buttons | Three-dot menu |
| Header buttons | Text + icons | Icon only |
| Recipe tags | Inline | Horizontal scroll |
| Drag trigger | Click and drag | Long-press (250ms) |
| Settings modal | Centered dialog | Full-width sheet |
| Navigation | Header tabs | Bottom nav bar |

---

## State Management

### TanStack Query Keys

```typescript
const SHOPPING_KEY = ['shopping_list']      // Main list
const PANTRY_KEY = ['pantry']               // Pantry items
const CONFIG_KEY = ['user_config']          // User preferences
```

All mutations use optimistic updates for instant feedback with rollback on error.

---

## Testing Strategy

### Unit Tests (Vitest)

Location: `src/lib/__tests__/`

- `shopping-list.test.ts` - List generation
- `shopping-list-normalization.test.ts` - Unit/name normalization
- `shopping-list-merging.test.ts` - Item merging
- `shopping-categories.test.ts` - Category assignment

### E2E Tests (Playwright)

Location: `tests/`

- `shopping-list.spec.ts` - Desktop tests
- `shopping-list-mobile.spec.ts` - Mobile-specific tests

---

## Known Limitations

1. **Unit conversion limits**: Volume and weight cannot be merged (no density data). Stored in `additionalAmounts[]`.
2. **Pantry matching**: Exact matches only ("garlic" != "garlic cloves").
3. **Mobile drag**: Long-press required (250ms) to distinguish from scroll.

---

## Future Enhancements

- Smart unit conversion with density estimates
- Fuzzy pantry matching
- Shopping list sharing / real-time collaboration
- Multiple store layout presets
- Price tracking / budget estimation

---

## Related Documentation

- [CLAUDE.md](../CLAUDE.md) - Project context
- [decisions.md](../decisions.md) - Architectural decisions
- [project_overview.md](../project_overview.md) - Architecture orientation

---

*Last updated: 2026-02-07 (v2.13.1)*
