# Changelog Archive

Older changelog entries (v1.0.0 – v2.7.1). For recent changes, see `changelog.md`.

---

## [2.7.1] - 2026-01-24

**Summary:** Shopping list improvements for better merging and consistent recipe colors

### Changed

- **Recipe Color Mapping**:
  - Recipe source tag colors now use hash-based assignment instead of order-based
  - Colors remain stable regardless of recipe order in the list
  - Same recipe always gets the same color for better visual consistency

- **Shopping List Merging**:
  - When adding recipes to existing shopping lists, `already_have` and `excluded` arrays are now properly merged
  - Preserves items from previous recipes when adding new recipes
  - Prevents loss of pantry and excluded items when building shopping lists incrementally

---

## [2.7.0] - 2026-01-23

**Summary:** Enhanced shopping list workflow with checked states, pantry integration, recipe tag navigation, and bug fixes

### Added

- **Shopping List Checked States**:
  - Items can be checked off while remaining in the shopping list (toggleable checked state)
  - Checked items display with strikethrough and muted styling
  - Checked state persists across page refreshes
  - Resets only on "Complete Shopping" or "Clear" actions
  - Checked state stored in database (`checked` boolean field on `ShoppingItem`)

- **Category Auto-Collapse**:
  - Categories automatically collapse when all items are checked off
  - Manual expand/collapse toggle for categories (click category header)
  - User-expanded categories are preserved even when auto-collapse would trigger
  - Visual indicators show checked count per category (e.g., "Produce (3/5)")

- **Complete Shopping Button**:
  - Appears when all items in the shopping list are checked off
  - Clears the entire shopping list for a clean slate
  - All categories auto-collapse when complete shopping is triggered
  - Includes undo support for accidental clears

- **Pantry Integration**:
  - "Got it" section renamed to "Pantry" for clarity
  - Pantry section shows items that were attempted to be added but already exist in pantry
  - Pantry items are clickable to add them back to the shopping list
  - New "Add to Pantry" button next to trash button (desktop) and in swipe area (mobile)
  - Adding item to pantry removes it from shopping list with undo support

- **Recipe Tag Navigation**:
  - Recipe source tags in shopping list are now clickable
  - Clicking a recipe tag opens the recipe detail modal
  - Works for both recipe ID-based and name-based lookups
  - Recipe modal includes full edit functionality (Edit Recipe button)
  - Consistent recipe modal experience across all views (shopping list, recipe list, meal planner)

- **Excluded Items Clarity**:
  - Excluded items now display the matching keyword (e.g., "matched: garlic")
  - Improved descriptions in both shopping and pantry views
  - Better visibility into why items were excluded

### Changed

- **Shopping List UI**:
  - Checkbox replaces "check off" action (items stay in list when checked)
  - Category headers are clickable for expand/collapse
  - Chevron icons indicate collapse state
  - Improved mobile swipe gestures for pantry actions
  - Better visual feedback for checked states

- **Recipe Detail Dialog**:
  - Now accessible from shopping list recipe tags
  - Includes Edit Recipe button when opened from shopping list
  - Handles null/undefined recipe categories gracefully
  - Improved error handling for missing recipe data

### Fixed

- **Tag Color Errors**:
  - Fixed `Cannot read properties of undefined (reading 'toLowerCase')` error
  - `getTagColor()` and `getTagClassName()` now handle null/undefined tags
  - Category tags only render when category exists

- **Recipe Save Errors**:
  - Fixed `old.map is not a function` error when saving recipes
  - `setQueriesData` now handles both array queries (`useRecipes()`) and single recipe queries (`useRecipe(id)`)
  - Added `updateRecipeQuery()` helper function for safe query updates
  - All recipe mutations (update, delete, toggle favorite) now work correctly

- **React Warnings**:
  - Fixed "Cannot update a component while rendering" warning
  - Recipe detail dialog only mounts when recipe ID is set
  - Improved component lifecycle management

### Technical Notes

- New database field: `ShoppingItem.checked` (boolean, optional)
- New database field: `ShoppingItem.excludedBy` (string, optional) - stores matching keyword
- New hook: `useAddToPantryAndRemove()` - adds item to pantry and removes from shopping list
- Updated hooks: `useCheckOffItem()`, `useBulkCheckOff()` - now toggle checked state instead of moving items
- Updated hook: `useClearShoppingList()` - resets checked states
- New helper: `getExcludedKeyword()` in `shopping-categories.ts` - returns matching keyword
- New helper: `updateRecipeQuery()` in `use-recipes.ts` - safely updates both array and single recipe queries
- Component updates: `shopping-list.tsx`, `recipe-detail-dialog.tsx`, `pantry-list.tsx`
- Type updates: `database.ts` - added `checked` and `excludedBy` fields

---

## [2.6.1] - 2026-01-22

**Summary:** Refined recipe card design in planner views with improved button layout and visual consistency

### Changed

- **Calendar View Recipe Cards**:
  - Buttons are now icon-only (removed "Swap" and "Made" text labels) for cleaner, more compact design
  - All four action buttons (Swap, Made, Cart, Trash) now span full width of card with even spacing
  - Removed `flex-wrap` to ensure buttons always stay in one row
  - Removed redundant green circle checkmark in top-right corner (Made button already indicates status)
  - Category tags converted to circular badges showing only first letter (e.g., "V" for Vegetarian)
  - Tag positioned inline with recipe name for better visual hierarchy
  - Tag aligned closer to top of card for improved layout

- **Category View Recipe Cards**:
  - Buttons redesigned to be icon-only and properly sized (no longer overly wide)
  - All buttons are uniform size (`h-8 w-8`) with consistent spacing
  - Category tags converted to circular badges matching calendar view design
  - Tag positioned inline with recipe name (right after title)
  - Recipe cards are now clickable to open recipe detail modal (consistent with list and calendar views)
  - Added hover effects (`hover:shadow-md`) for better interactivity feedback
  - Improved button layout with tighter spacing (`gap-1.5`)

### Technical Notes

- Button containers use `flex-1` for even distribution in calendar view
- All button clicks properly stop propagation to prevent card click when interacting with buttons
- Circular tags use existing `getTagColor()` function for consistent color coding
- Category view cards use same click handler pattern as list view (`onClick={() => setViewingRecipe(recipe)}`)
- Loading states added for swap and add-to-cart actions in category view

---

## [2.6.0] - 2026-01-21

**Summary:** Major shopping list refactor with unit normalization, unified merging, and comprehensive test suite

### Added

- **Unit Normalization System**:
  - `normalizeUnit()` function normalizes all units to lowercase canonical form (e.g., "TBSP" -> "tbsp")
  - `normalizeItemName()` function ensures consistent item name formatting
  - Applied at all entry points: recipe parsing, item creation, merging, storage

- **Unified Merging Logic**:
  - `mergeShoppingItems()` function provides single source of truth for item merging
  - Eliminates code duplication across 4+ locations
  - Handles compatible unit merging, incompatible units (via `additionalAmounts`), and source deduplication
  - Preserves user overrides and custom order when requested

- **Comprehensive Test Suite**:
  - 28 tests covering unit normalization, item merging, and shopping list generation
  - Vitest testing framework with full coverage
  - Tests ensure deterministic behavior and catch regressions

- **Recipe Source Tracking**:
  - Sources now include both `recipeId` and `recipeName` for better tracking
  - Recipe removal properly handles source cleanup and item removal

### Changed

- **Shopping List Generation**:
  - Units normalized during generation (consistent lowercase canonical form)
  - Item names normalized (lowercase, trimmed)
  - Merging by normalized item name (not item+unit) for better deduplication
  - Compatible units automatically merged (e.g., cups + fl oz)

- **Hook Updates**:
  - `useAddToShoppingList()` uses unified merging function
  - `useRemoveRecipeItems()` uses unified removal function
  - Manual item creation normalizes units and item names
  - Custom order preserved when adding new recipes (inserts at end of category section)

- **Backward Compatibility**:
  - Existing shopping lists work without changes
  - Normalization happens on next generation
  - No database schema changes required

### Technical Notes

- New files: `shopping-list-normalization.ts`, `shopping-list-merging.ts`, test files
- Refactored: `shopping-list.ts`, `use-shopping.ts`
- All tests passing (28/28)
- Deterministic generation: same inputs -> same outputs
- Maintainable: single source of truth for merging logic

---

## [2.5.0] - 2026-01-21

**Summary:** Planner settings for day placement rules and automatic day assignment

### Added

- **Planner Settings Modal Enhancements**:
  - **Excluded Days**: Configure which days of the week to exclude from automatic meal placement
  - **Preferred Days**: Set preferred days for meal placement (recipes will be prioritized to these days)
  - **Auto Assign Days**: Toggle to automatically assign recipes to days when generating meal plans
  - Visual day selector with checkboxes for excluded and preferred days
  - Settings persist in user configuration and apply to all future meal plan generations

- **Automatic Day Assignment Logic**:
  - `autoAssignDays()` function in `meal-planner.ts` intelligently distributes recipes across available days
  - Respects excluded days (never places meals on excluded days)
  - Prioritizes preferred days when available
  - Preserves existing day assignments when regenerating plans
  - Round-robin distribution when preferred days are exhausted

### Changed

- Meal plan generation now automatically assigns recipes to days when `auto_assign_days` is enabled
- Plan settings modal now includes day placement rules section alongside category breakdown
- Day assignments are preserved when regenerating meal plans (unless explicitly changed)

### Technical Notes

- Migration `009_planner_settings.sql` adds three columns to `user_config`:
  - `excluded_days`: INTEGER[] - Day indices (0-6) to exclude from placement
  - `preferred_days`: INTEGER[] | null - Day indices (0-6) to prefer for placement
  - `auto_assign_days`: BOOLEAN - Whether to auto-assign days on generation (default: true)
- `autoAssignDays()` function handles day distribution logic with priority ordering
- Settings are accessible via plan settings modal (gear button in meal planner)

---

## [2.4.1] - 2026-01-20

**Summary:** Shopping list UX enhancements with mobile swipe hints, bulk actions, and improved feedback

### Added

- **Mobile Swipe Hint**: First-time mobile users see an animated hint showing "Swipe left to delete"
- **Bulk Check-Off**: "Check All" button in category headers
- **Enhanced Source Tags**: Truncated recipe names are tappable on mobile
- **Toast Notifications**: Consistent toast system for clipboard, add items, and bulk actions
- **Flexible Undo Toast**: Undo toast component supports informational toasts (without undo button)

### Technical Notes

- New hooks: `useBulkCheckOff()`, `useSwipeHint()`
- CSS animation: `swipeHint` keyframes
- localStorage key: `shopping-swipe-hint-shown`

---

## [2.4.0] - 2026-01-17

**Summary:** Recipe category management with drag-and-drop reordering and bulk updates

### Added

- **Recipe Category Settings Modal**: Full category lifecycle management
- **Category Management**: Bulk recipe updates on rename, reassignment on delete, drag-and-drop reorder
- **Enhanced Recipe Hooks**: `useUpdateCategories()`, `useBulkUpdateRecipeCategories()`

### Technical Notes

- New component: `recipe-category-settings-modal.tsx` (600 lines)
- Uses `@dnd-kit` for drag-and-drop
- Category changes auto-sync with meal planner `default_selection`

---

## [2.3.0] - 2026-01-17

**Summary:** Recipe day assignments with cross-device persistence

### Added

- **Day Assignments in Calendar View**: Assign recipes to specific days via dropdown menu
- Day assignments persist in database (`weekly_plans.day_assignments` JSONB)

### Technical Notes

- Migration `008_add_day_assignments.sql`
- `day_assignments` format: `{"recipe-id": dayIndex}` (0=Sunday, 6=Saturday)
- New hook: `useSaveDayAssignments()`

---

## [2.2.0] - 2026-01-16

**Summary:** Custom shopping categories, category ordering, and enhanced shopping list settings

### Added

- **Custom Shopping Categories**: Up to 10 user-defined categories
- **Category Ordering**: Drag-and-drop to match store layout
- **Shopping Settings Modal**: Three-tab interface (Order, Custom, Overrides)

### Technical Notes

- Migration `007_custom_categories.sql`
- `custom_categories` JSONB, `category_order` JSONB in `user_config`
- Custom category keys prefixed with `custom_`

---

## [2.1.1] - 2026-01-16

**Summary:** Recipe text parser and signup trigger improvements

### Added

- **Recipe Text Parser**: Import recipes from plain text with automatic parsing
- **Signup Trigger Improvements**: Enhanced error handling in `handle_new_user()`

### Technical Notes

- Migration `006_fix_signup_trigger.sql`
- Parser in `recipe-parser.ts`: Unicode fractions, ranges, parenthetical units, 20+ unit abbreviations

---

## [2.1.0] - 2026-01-16

**Summary:** Shopping list custom ordering, category overrides, and add-to-shopping-list

### Added

- Shopping list drag-and-drop reordering, category overrides, recipe-to-list workflow
- Move items between sections, recipe source tags, clipboard copy

---

## [2.0.0] - 2026-01-15

**Summary:** Complete rewrite to Next.js + Supabase for cloud deployment and multi-user support.

### Architecture

- **Frontend:** Next.js 14 (App Router) with React 18, TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Row Level Security)
- **State Management:** TanStack Query (React Query) for server state
- **UI Components:** Radix UI primitives with shadcn/ui styling

### Added

- Multi-user authentication via Supabase Auth
- Row Level Security (RLS) policies
- Migration script for legacy JSON data (`scripts/migrate.ts`)
- React hooks for data fetching

### Removed

- Flask backend, vanilla JS frontend, JSON file storage, Python dependencies

---

## [1.0.5] - 2026-01-09

**Summary:** Consolidated shopping list data structure (unified `items` array)

---

## [1.0.4] - 2026-01-09

**Summary:** Added input validation to API endpoints

---

## [1.0.3] - 2026-01-09

**Summary:** Fixed keyword matching false positives (word-boundary matching)

---

## [1.0.2] - 2026-01-09

**Summary:** Made history exclusion window configurable (`historyExclusionDays`)

---

## [1.0.1] - 2026-01-09

**Summary:** Removed dead `/api/generate-shopping-list` endpoint

---

## [1.0.0] - Initial Baseline

**Summary:** Full-featured local meal planning application with Flask backend, vanilla JS frontend, and JSON file storage.

- Flask 3.0.0 backend with REST API
- Single-page application frontend
- JSON file-based persistence
- Recipe management, meal planning, pantry tracking, shopping list generation
