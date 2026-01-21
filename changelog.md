# Project Changelog

All notable changes to Recipe Genie are documented here.

---

## [2.6.0] - 2026-01-21

**Summary:** Major shopping list refactor with unit normalization, unified merging, and comprehensive test suite

### Added

- **Unit Normalization System**:
  - `normalizeUnit()` function normalizes all units to lowercase canonical form (e.g., "TBSP" → "tbsp")
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
- Deterministic generation: same inputs → same outputs
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
- Settings are accessible via plan settings modal (⚙️ button in meal planner)
- Guest mode includes default settings (no excluded days, no preferred days, auto-assign enabled)

---

## [2.4.1] - 2026-01-20

**Summary:** Shopping list UX enhancements with mobile swipe hints, bulk actions, and improved feedback

### Added

- **Mobile Swipe Hint**: 
  - First-time mobile users see an animated hint showing "Swipe left to delete"
  - Hint appears on the first shopping list item on mobile devices only
  - Automatically dismissed after animation and stored in localStorage to prevent re-showing
  - Smooth animation guides users to discover swipe-to-delete functionality

- **Bulk Check-Off**: 
  - "Check All" button in category headers (appears when category has 2+ items)
  - Move all items in a category to "Already Have" with one click
  - Optimistic updates for instant feedback
  - Toast notification confirms action with item count

- **Enhanced Source Tags**: 
  - Truncated recipe names in source tags are now tappable on mobile
  - Tap to expand and see full recipe name in popover
  - Improves mobile usability when recipe names are long

- **Toast Notifications**: 
  - Copy to clipboard now shows confirmation toast
  - Adding items manually shows confirmation toast with count
  - Bulk check-off shows confirmation toast
  - All toasts use consistent styling and timing

- **Flexible Undo Toast**: 
  - Undo toast component now supports informational toasts (without undo button)
  - `onUndo` callback is now optional
  - Enables consistent toast UI for both undoable and informational actions

### Changed

- Shopping list item animations improved for better visual feedback
- Source tag component refactored to support mobile tap-to-expand
- Toast system unified for consistent user feedback across shopping list actions

### Technical Notes

- New hook: `useBulkCheckOff()` for bulk item check-off operations
- New hook: `useSwipeHint()` for managing swipe hint display logic
- CSS animation: `swipeHint` keyframes for hint animation
- Popover component used for expandable source tags on mobile
- localStorage key: `shopping-swipe-hint-shown` tracks hint display

---

## [2.4.0] - 2026-01-17

**Summary:** Recipe category management with drag-and-drop reordering and bulk updates

### Added

- **Recipe Category Settings Modal**: 
  - New settings modal accessible from the recipe list view
  - Manage all recipe categories in one place
  - Add new custom categories
  - Edit category names with inline editing
  - Delete categories (with recipe reassignment if needed)
  - Drag-and-drop reordering of categories
  - Recipe count display per category
  - Reset to default categories option

- **Category Management Features**:
  - Bulk update recipes when renaming categories (all recipes with old category name are updated)
  - Reassign recipes dialog when deleting categories with recipes
  - Prevents deletion of categories that have recipes (requires reassignment first)
  - Automatically updates `default_selection` config when categories are renamed or deleted
  - Case-insensitive duplicate detection for category names

- **Enhanced Recipe Hooks**:
  - `useUpdateCategories()` - Update category list
  - `useBulkUpdateRecipeCategories()` - Bulk reassign recipes to new categories
  - Category validation and error handling

### Changed

- Recipe list view now includes a category settings button in the header
- Category management moved from inline editing to dedicated settings modal
- Improved category validation (no duplicates, no empty names)

### Technical Notes

- New component: `recipe-category-settings-modal.tsx` (600 lines)
- Uses `@dnd-kit` for drag-and-drop category reordering
- Bulk category updates use optimized database queries
- Category changes automatically sync with meal planner `default_selection` preferences
- Guest mode supported with guest config fallback

---

## [2.3.0] - 2026-01-17

**Summary:** Recipe day assignments with cross-device persistence

### Added

- **Day Assignments in Calendar View**: 
  - Assign recipes to specific days of the week in the calendar view
  - Dropdown menu on each recipe card to move recipes between days
  - Visual indication of which day each recipe is assigned to
  - Day assignments persist across page refreshes and devices (stored in database)
  - Works in both desktop grid view and mobile stack view

### Changed

- Calendar view now uses dropdown-based day selection instead of drag-and-drop
- Day assignments stored in `weekly_plans.day_assignments` JSONB column
- Improved reliability and cross-device synchronization

### Technical Notes

- Migration `008_add_day_assignments.sql` adds `day_assignments` JSONB column to `weekly_plans` table
- `day_assignments` format: `{"recipe-id": dayIndex}` where dayIndex is 0-6 (0 = Sunday, 6 = Saturday)
- New hook `useSaveDayAssignments()` handles saving assignments to database
- Guest mode uses query cache for day assignments (localStorage fallback)
- Backward compatible: falls back to localStorage if database data unavailable
- Added UI components: `alert-dialog`, `calendar`, `dropdown-menu`, `popover` (Radix UI primitives)
- New dependencies: `@radix-ui/react-alert-dialog`, `@radix-ui/react-popover`

---

## [2.2.0] - 2026-01-16

**Summary:** Custom shopping categories, category ordering, and enhanced shopping list settings

### Added

- **Custom Shopping Categories**: 
  - Create user-defined shopping categories (e.g., "Asian Market", "Specialty Store")
  - Up to 10 custom categories per user
  - Edit and delete custom categories with undo support
  - Custom categories appear alongside default categories in shopping lists
  - Items can be assigned to custom categories via drag-and-drop

- **Category Ordering**: 
  - Drag-and-drop reordering of all shopping categories (default + custom)
  - Reorder categories to match your store layout for efficient shopping
  - Reset to default order with one click
  - Custom order persists across shopping list generations

- **Shopping Settings Modal**: 
  - New settings dialog accessible from shopping list view
  - Three-tab interface:
    - **Order Tab**: Drag-and-drop category reordering with visual feedback
    - **Custom Tab**: Create, edit, and delete custom categories
    - **Overrides Tab**: View and manage all category overrides (item → category mappings)
  - Inline editing for custom category names
  - Undo support for category deletions

### Changed

- Shopping list categories now respect custom ordering when `category_order` is set
- Category overrides management moved to dedicated settings modal
- Custom categories are visually distinguished with "Custom" badge in shopping list

### Technical Notes

- Migration `007_custom_categories.sql` adds `custom_categories` and `category_order` columns to `user_config` table
- `custom_categories` stored as JSONB array: `[{ "id": "uuid", "name": "Category Name", "order": number }]`
- `category_order` stored as JSONB array of category keys: `["produce", "dairy", "custom_abc123", ...]`
- Custom category keys prefixed with `custom_` to avoid collisions with default categories
- Shopping list UI uses `getAllShoppingCategories()` to merge default and custom categories
- Settings modal uses `@dnd-kit` for drag-and-drop reordering
- Category deletion moves affected items to "misc" category automatically

---

## [2.1.1] - 2026-01-16

**Summary:** Improved signup trigger error handling, recipe parser enhancements, and robustness improvements

### Added

- **Recipe Text Parser**: 
  - Import recipes from plain text with automatic parsing
  - Supports multiple formats: structured sections, free-form text, or mixed formats
  - Automatically extracts recipe name, servings, ingredients, and instructions
  - Handles Unicode fractions (½, ⅓, ¼, etc.) and converts to decimals
  - Parses ingredient amounts with ranges (e.g., "½–1 cup")
  - Supports parenthetical units (e.g., "1 (28 oz) can crushed tomatoes")
  - Recognizes common section headers: "Ingredients", "Instructions", "Directions", "Method", "Steps"
  - Extracts servings from recipe name (e.g., "Makes 4 servings")
  - "Import from Text" tab in recipe dialog for easy pasting

### Fixed

- **Signup Trigger Error Handling**: 
  - Enhanced `handle_new_user()` trigger function with proper error handling
  - Added explicit `search_path` setting to prevent schema search path issues
  - Default recipe creation failures no longer block user signup
  - Errors are logged as warnings instead of failing the transaction
  - Improved `insert_default_recipes_for_user()` function with better error isolation

### Technical Notes

- Migration `006_fix_signup_trigger.sql` updates the signup trigger to be more resilient
- User creation will succeed even if default recipe insertion fails
- Errors are logged via `RAISE WARNING` for debugging without blocking signup
- Both functions now use `SECURITY DEFINER` with explicit `SET search_path = public`
- Recipe parser (`recipe-parser.ts`) handles Unicode normalization, fraction parsing, and flexible unit extraction
- Parser supports 20+ common unit abbreviations and variations

---

## [2.1.0] - 2026-01-16

**Summary:** Guest mode, shopping list enhancements, and category overrides

### Added

- **Guest Mode**: Users can try the app without signing up
  - Data stored in React Query cache (session-only, lost on page refresh)
  - Pre-populated with 8 default recipes
  - "Try as Guest" button on auth form
  - Seamless transition to authenticated account
- **Shopping List Custom Ordering**: 
  - Drag-and-drop reordering of shopping list items
  - `custom_order` flag preserves manual ordering
  - Automatic sorting disabled when custom order is set
- **Category Overrides**: 
  - Users can override automatic category assignment for shopping items
  - Stored in `user_config.category_overrides` JSONB field
  - Persists custom categorization preferences
- **Add to Shopping List**: 
  - Add meal plan ingredients to existing shopping lists
  - Merges quantities for duplicate items
  - Preserves manual items and custom ordering
- **Shopping List Enhancements**:
  - Move items between "To Buy", "Already Have", and "Excluded" sections
  - Remove all items from a specific recipe
  - Recipe source tags with color coding
  - Copy shopping list to clipboard

### Changed

- Shopping list items now support `custom_order` field
- Category assignment uses overrides when available
- Shopping list generation preserves existing items when adding recipes

### Technical Notes

- Guest mode uses `sessionStorage` for persistence flag
- All hooks support both authenticated and guest modes
- Default recipes created automatically for new users via database trigger
- Shopping list reordering uses `@dnd-kit` library

---

## [2.0.0] - 2026-01-15

**Summary:** Complete rewrite to Next.js + Supabase for cloud deployment and multi-user support.

### Architecture

- **Frontend:** Next.js 14 (App Router) with React 18, TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Row Level Security)
- **State Management:** TanStack Query (React Query) for server state
- **UI Components:** Radix UI primitives with shadcn/ui styling
- **Deployment:** Vercel-ready with environment-based configuration

### Added

- Multi-user authentication via Supabase Auth (email/password)
- Row Level Security (RLS) policies - users can only access their own data
- Type-safe database schema (`src/types/database.ts`)
- Server and client Supabase clients (`src/lib/supabase/`)
- Auth middleware for session refresh (`src/middleware.ts`)
- Migration script to import legacy JSON data (`scripts/migrate.ts`)
- React hooks for data fetching: `use-recipes`, `use-planner`, `use-pantry`, `use-shopping`

### Changed

- All data now stored in Supabase PostgreSQL (6 tables with indexes)
- Frontend rewritten as React components in `src/components/`
- API calls replaced with direct Supabase client queries
- Styling migrated from custom CSS to Tailwind + Radix
- Development server now runs on port 3000 (was 5000)

### Removed

- Flask backend (`app.py`) - replaced by Supabase
- Vanilla JavaScript frontend (`static/js/app.js`) - replaced by React
- JSON file storage (`data/*.json`) - replaced by PostgreSQL
- Python dependencies (`requirements.txt`) - now Node.js only

### Migration Path

1. Create Supabase project and run `supabase/migrations/001_initial_schema.sql`
2. Configure `.env.local` with Supabase credentials
3. Run `npm run migrate` to import existing JSON data
4. Deploy to Vercel with environment variables

### Technical Notes

- Legacy Flask code retained in repo for reference during transition
- RLS policies require authenticated user for all operations
- TanStack Query provides automatic caching and optimistic updates
- All components use React Server Components where possible

---

## [1.0.5] - 2026-01-09

**Summary:** Consolidated shopping list data structure

### Changed
- Shopping list now uses single `items` array instead of separate `items` and `manual_items`
- Manual items identified by `sources: [{recipeName: "Manual"}]`
- Backend `save_shopping_list()` auto-migrates old format (merges `manual_items` into `items`)
- Backend `add_shopping_list_item()` adds to `items` array with Manual source
- Backend `remove_shopping_list_item()` simplified to only check `items`
- Frontend `generateAndShowShoppingList()` extracts manual items from unified array
- Frontend `renderShoppingList()` renders all items from single array
- Frontend `copyShoppingList()` simplified

### Removed
- `manual_items` field from shopping list schema

### Technical Notes
- Backward compatible: backend merges `manual_items` if present in old data
- Reduces code complexity in both frontend and backend
- Single source of truth for all shopping list items
- Manual vs recipe items distinguished by source metadata, not separate arrays

---

## [1.0.4] - 2026-01-09

**Summary:** Added input validation to API endpoints

### Added
- `validate_recipe()` - validates recipe structure (name, category, servings, ingredients)
- `validate_pantry_item()` - validates pantry item has non-empty name
- `validate_pantry_bulk()` - validates bulk pantry array structure
- `validate_config()` - validates config structure and field types

### Changed
- `POST /api/recipes` - now validates input before saving
- `PUT /api/recipes/<id>` - now validates input before updating
- `POST /api/pantry` - now validates item before adding
- `POST /api/pantry/bulk` - now validates array before replacing
- `PUT /api/config` - now validates config before saving

### Technical Notes
- All validation returns 400 with descriptive error message on failure
- Validation happens before file I/O to prevent corruption
- Recipe validation checks: name (string), category (string), servings (positive int), ingredients (array of objects with item field)
- Config validation checks: categories (array), default_selection (object), excluded_keywords (array), historyExclusionDays (non-negative int)

---

## [1.0.3] - 2026-01-09

**Summary:** Fixed keyword matching false positives

### Changed
- `is_excluded_ingredient()` now uses regex word-boundary matching instead of substring containment

### Fixed
- "oil" no longer matches "foil"
- "salt" no longer matches "salted butter"
- Keywords must appear as complete words to trigger exclusion

### Technical Notes
- Uses `\b` word boundaries in regex pattern
- Multi-word keywords like "garlic powder" still match as phrases
- Compound nouns like "rice vinegar" will still match "rice" (rice is a complete word) - this is acceptable behavior; users can adjust keywords if needed
- Added `import re` to app.py

---

## [1.0.2] - 2026-01-09

**Summary:** Made history exclusion window configurable

### Added
- `historyExclusionDays` config option (default: 7) - controls how many days back to look when excluding recently-made recipes from meal plan generation

### Changed
- `generate_meal_plan()` now reads exclusion window from config instead of hardcoded value
- `init_data_files()` auto-migrates existing configs to include new field

### Technical Notes
- Backward compatible: defaults to 7 days if not specified
- Users can now set 3 days (small households) to 14+ days (large recipe collections)
- Resolves documented limitation in changelog v1.0.0

---

## [1.0.1] - 2026-01-09

**Summary:** Code cleanup - removed dead endpoint

### Removed
- `/api/generate-shopping-list` endpoint (59 lines) - was never called by frontend; `/api/generate-shopping-list-scaled` handles all use cases with `scale=1.0` default

### Technical Notes
- Frontend `app.js:115` exclusively uses scaled endpoint
- No behavior change; this was unreachable code
- Reduces `app.py` from 817 to 758 lines

---

## [1.0.0] - Initial Baseline

**Summary:** Full-featured local meal planning application with recipe management, weekly planning, pantry tracking, and shopping list generation.

### Core Architecture
- Flask 3.0.0 backend (`app.py`) with REST API
- Single-page application frontend (vanilla HTML/CSS/JS)
- JSON file-based persistence in `data/` directory
- Local-only deployment (runs on `localhost:5000`)

### Features

#### Recipe Management
- Create, read, update, delete recipes via `/api/recipes`
- Recipe schema: name, category, servings, ingredients (item/amount/unit), instructions
- Category-based organization (chicken, turkey, steak, beef, lamb, vegetarian)
- Favorite toggle functionality
- Auto-generated slug IDs from recipe names

#### Meal Planning
- Weekly meal plan generation with category-based constraints
- Configurable recipe counts per category (e.g., 2 chicken, 1 steak)
- 7-day history exclusion to prevent repetitive plans
- Recipe swap functionality to replace individual selections
- Week navigation with configurable start day (Sunday-Saturday)
- Persistent weekly plan storage per week

#### Pantry System
- Add/remove pantry items
- Bulk pantry updates
- Case-insensitive item matching
- Pantry items automatically excluded from shopping lists

#### Shopping List Generation
- Aggregate ingredients from selected recipes
- Automatic quantity consolidation (same item + unit combined)
- Three-tier categorization:
  - **To Buy:** Items needed, not in pantry
  - **Already Have:** Matches pantry inventory
  - **Excluded:** Matches excluded keywords (staples)
- Recipe scaling support (multiply quantities)
- Manual item addition
- Persistent shopping list storage

#### Configuration
- User-configurable categories
- Default meal selection preferences
- Excluded keywords for pantry staples (oil, salt, spices, etc.)
- Week start day preference

### Data Files
| File | Purpose |
|------|---------|
| `recipes.json` | Recipe collection |
| `pantry.json` | Current pantry items |
| `config.json` | User preferences, categories, excluded keywords |
| `history.json` | Recipe cooking history (date-stamped) |
| `weekly-plans.json` | Saved weekly meal plans by date |
| `shopping-list.json` | Current shopping list state |

### UI Components
- Sidebar navigation (Meal Planner, My Recipes, Pantry, Shopping List)
- Recipe cards with category badges
- Meal plan results grid with swap buttons
- Shopping list with checkable items
- Modal forms for recipe editing

### Known Limitations
- Single-user only (no authentication)
- No concurrent access protection (file-based storage)
- Hardcoded 7-day history window
- Substring-based keyword matching (may over-exclude)
- No recipe import/export functionality
- No search within recipes

### Dependencies
- Python 3.8+
- Flask 3.0.0
