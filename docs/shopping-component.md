# Shopping List Component Documentation

> **When to read:** You're working on shopping list generation, ingredient merging/normalization, category assignment, check-off UX, drag-and-drop reordering, or pantry/excluded keyword integration.

**Version:** 2.14.0
**Last Updated:** 2026-02-17
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

- "In Pantry" section shows items user already has (primary name OR any `alternatives[]` match)
- "Add to Pantry" adds to `pantry_items` + moves item to `already_have[]` with optimistic update
- Clicking an "In Pantry" item restores it to the shopping list immediately (optimistic update)
- Per-item pending tracking: adding item A to pantry never disables item B's button

### 5. Keyword Exclusion

- Exact match only (case-insensitive): "salt" excludes "salt", NOT "kosher salt"
- Only the primary item name is checked — `alternatives[]` cannot trigger exclusion
- Excluded items shown in collapsible section with the matching keyword displayed
- Clicking an excluded item restores it to the shopping list immediately (optimistic update)

### 6. Check-Off & Auto-Collapse

- Checkbox marks item as purchased (strikethrough, persists across refreshes)
- Per-item pending tracking: checking item A never disables item B's checkbox
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

### Per-Item Pending Tracking

To prevent a single mutation's `isPending` from blocking unrelated UI elements, the component
tracks pending state per-item using a `Set` of item keys:

```typescript
// In shopping-list.tsx — pattern for check-off and Add to Pantry
const [pendingItems, setPendingItems] = useState<Set<string>>(new Set())
const itemKey = item.item.toLowerCase().trim()
const isThisItemPending = pendingItems.has(itemKey)

// Only disable THIS item's button, not all buttons
<button disabled={isThisItemPending} ... />
```

This pattern applies to `useCheckOffItem`, `useAddToPantryAndRemove`, and any other
mutation where multiple items can be mutated concurrently.

---

## Testing Strategy

### Unit Tests — Business Logic (Vitest)

Location: `src/lib/__tests__/`

- `shopping-list.test.ts` — List generation, pantry matching, exclusion, alternatives, scaling
- `shopping-list-normalization.test.ts` — Unit/name normalization
- `shopping-list-merging.test.ts` — Item merging and unit conversion
- `shopping-categories.test.ts` — Category assignment and keyword lookup

### Unit Tests — Hook Mutations (Vitest + @testing-library/react)

Location: `src/hooks/__tests__/`

- `use-shopping-items.test.ts` — Optimistic updates and rollbacks for check-off, remove, add
- `use-shopping-pantry.test.ts` — Dual-cache optimistic updates for pantry and restore hooks
- `shopping-list-checked-state.test.ts` — `preserveCheckedItemsFromExisting` logic

**Hook test pattern:**
```typescript
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  // ... QueryClientProvider wrapper
  return { wrapper, queryClient }
}

// Pre-populate cache, call mutate(), assert via waitFor
const { wrapper, queryClient } = createWrapper()
queryClient.setQueryData([...SHOPPING_KEY], makeList({ items: [...] }))
const { result } = renderHook(() => useCheckOffItem(), { wrapper })
result.current.mutate(item)
await waitFor(() => expect(result.current.isSuccess).toBe(true))
```

**Supabase mock:** Chainable `vi.fn()` mock. Terminal calls:
- `single()` for reads and pantry inserts → `mockResolvedValue({ data: null, error: null })`
- `eq()` for updates → `mockResolvedValue({ data: null, error: null })`

To test rollback: fail `single()` → mutationFn throws → `onError` restores cache snapshot.

### E2E Tests (Playwright)

Location: `tests/`

- `shopping-list.spec.ts` — Desktop flows + persistence, pantry restore, excluded restore, rapid interactions
- `shopping-list-mobile.spec.ts` — Mobile-specific touch interactions and layout

### Running Tests

```bash
# All shopping unit tests
npm run test -- --run src/hooks/__tests__/use-shopping-items.test.ts src/hooks/__tests__/use-shopping-pantry.test.ts src/lib/__tests__/shopping-list.test.ts

# E2E shopping tests (Chromium only, fastest)
npx playwright test shopping-list.spec.ts --project=chromium

# Target specific E2E describe block
npx playwright test shopping-list.spec.ts --project=chromium -g "Rapid Interactions"
```

---

## Known Limitations

1. **Unit conversion limits**: Volume and weight cannot be merged (no density data). Stored in `additionalAmounts[]`.
2. **Pantry matching**: Exact/alternative matches only — fuzzy substring matching not supported ("garlic" ≠ "garlic cloves"). Alternatives array IS checked.
3. **Mobile drag**: Long-press required (250ms) to distinguish from scroll.
4. **Exclusion scope**: Only the primary item name is checked against excluded keywords — `alternatives[]` cannot trigger exclusion.
5. **Deferred-delete undo pattern**: `handleRemoveItem`, `handleRemoveRecipeItems`, and `handleClearListWithUndo` in `shopping-list.tsx`, and `handleDeleteCategory` in `shopping-settings-modal.tsx`, still use the deferred-delete approach — the actual mutation fires in the toast's `onExpire` callback. This means a page refresh during the toast window loses the deletion. The `UndoToastProvider` flushes `onExpire` on unmount as a best-effort safety net for in-app navigation, but cannot guarantee completion on browser refresh/close. (Shopping list items removed this way are recoverable by regenerating the list from the plan.)

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

*Last updated: 2026-02-17 (v2.14.0)*
