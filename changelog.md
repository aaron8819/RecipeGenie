# Project Changelog

> **When to read:** You're shipping a version bump, writing release notes, or need context on recent changes.

All notable changes to Recipe Genie are documented here.

For older entries (v1.0.0 – v2.7.1), see `changelog-archive.md`.

## Table of Contents

- [2.14.0](#2140---2026-02-13) — Recipe sharing (copy-on-accept)
- [2.13.1](#2131---2026-02-04) — Mobile UX, MultiSelect refactor
- [2.13.0](#2130---2026-02-04) — Onboarding, default recipe images
- [2.12.6](#2126---2026-02-04) — Planner refactor, local-date handling
- [2.12.5](#2125---2026-02-02) — Shopping accessibility, unit tests
- [2.12.4](#2124---2026-02-01) — Planner swap UX, flip animation
- [2.12.3](#2123---2026-02-01) — Recipe list sort/view, recipe stats
- [2.12.2](#2122---2026-01-30) — Playwright E2E setup
- [2.12.1](#2121---2026-01-30) — Testing review fixes
- [2.12.0](#2120---2026-01-27) — Edit recipe modal redesign
- [2.11.0](#2110---2026-01-27) — Stitch visual redesign
- [2.10.2](#2102---2026-01-25) — Excluded items bug fix
- [2.10.1](#2101---2026-01-25) — Ingredient modifiers, date-based history
- [2.10.0](#2100---2026-01-24) — Error boundary, shopping hooks refactor
- [2.9.1](#291---2026-01-24) — TypeScript build fixes
- [2.9.0](#290---2026-01-27) — Recipe image support
- [2.8.1](#281---2026-01-26) — Ingredient drag-and-drop
- [2.8.0](#280---2026-01-25) — Meal planner settings

---

## [2.14.0] - 2026-02-13

**Summary:** In-app recipe sharing between existing users with exact-email recipient entry and copy-on-accept behavior

### Added

- **Recipe sharing data model**:
  - New `recipe_shares` table for sender/recipient metadata, immutable recipe snapshots, status, and response timestamps
  - Migration `016_recipe_sharing.sql` with indexes and RLS policies
  - `accept_recipe_share(p_share_id uuid)` database function for idempotent, transactional copy-on-accept
- **API routes**:
  - `POST /api/recipe-shares` to create share requests
  - `GET /api/recipe-shares/inbox` and `GET /api/recipe-shares/sent` for recipient/sender views
  - `POST /api/recipe-shares/[id]/accept` and `POST /api/recipe-shares/[id]/decline` for recipient actions
- **Recipe sharing UI**:
  - Share actions on recipe cards and recipe detail dialog
  - `ShareRecipeDialog` for recipient email + optional note
  - `SharedRecipesInbox` dialog with "Shared With Me" and "Sent" tabs
- **Hooks/types/helpers**:
  - `use-recipe-shares.ts` hooks (`create`, `inbox`, `sent`, `accept`, `decline`)
  - New `recipe_shares` and `RecipeShareSnapshot` TypeScript types
  - `buildRecipeShareSnapshot()` helper in `lib/recipe-sharing.ts`
- **Testing**:
  - Unit test for snapshot generation (`lib/__tests__/recipe-sharing.test.ts`)
  - Playwright coverage for share dialog/inbox visibility in `tests/recipes.spec.ts`

### Technical Notes

- Recipient discovery is exact-email only; there is no searchable user directory.
- Acceptance creates an independent recipient-owned recipe copy (no live sync).
- Pending duplicate shares for the same sender/recipient/recipe are deduplicated via partial unique index.

---

## [2.13.1] - 2026-02-04

**Summary:** Mobile UX improvements, MultiSelect refactor (Popover), planner scroll-to-day, and input/textarea zoom fix

### Changed

- **Input & Textarea (UI)**: `text-[16px] md:text-sm` so mobile browsers do not zoom on focus (iOS); desktop keeps `text-sm`.
- **MultiSelect**: Replaced custom dropdown with Radix `Popover`; removed in-dropdown search; close-on-outside and focus management handled by Popover. Clear and remove-tag actions use `role="button"`, `onMouseDown`/`onClick`, and keyboard (Enter/Space) for accessibility. Option labels use `truncate` and `min-w-0` for overflow.
- **Meal planner (mobile)**:
  - Day numbers in the mobile week strip are buttons that scroll to that day’s section (`scrollToDay`, `mobileDaysContainerRef`, `data-day-date` on day sections).
  - Added `formatLocalISODate` helper and `aria-label` on day buttons (e.g. “Scroll to Monday, February 4”).
  - Layout: `-mt-3 lg:mt-0` on week nav; mobile days container ref for scroll-into-view.
- **Recipe card**: Responsive padding and image size (`p-4 md:p-6`, `w-28 h-28 md:w-32 md:h-32`); category/tag pills smaller on mobile (`text-[10px]`/rounded-md, `md:text-xs`/rounded-full); favorite button always visible on mobile (`opacity-100 md:opacity-0 md:group-hover:opacity-100`); list card shows ChevronRight on mobile; `active:scale-[0.98]` tap feedback.
- **Recipe detail dialog**: Explicit close button (top-right) with `DialogClose`, `aria-label="Close"`.
- **Recipe dialog (ingredient row)**: SortableIngredientRow stacks on mobile: first row = drag handle + item, second row = amount, unit, modifier, delete (with `pl-6` on mobile); `sm:flex-row` for desktop.
- **Recipe list**:
  - Default view mode: list on mobile (<768px), grid on desktop; `useEffect` sets list on mount for narrow viewports.
  - Filter row: responsive layout (`flex-col md:flex-row`), smaller pills/buttons on mobile (`text-xs md:text-sm`, `py-2 md:py-2.5`); MultiSelect trigger width `w-[130px] md:w-[140px]`.
  - Settings and Add Recipe buttons hidden on mobile (Add Recipe FAB only); FAB position `md:right-8`, search input padding reduced on mobile.

### Technical Notes

- MultiSelect no longer uses internal search; relies on Radix Popover for positioning and dismiss behavior.
- `getTagClassName` still used in MultiSelect for tag pill colors; recipe-card uses `getTagColor` only.

---

## [2.13.0] - 2026-02-04

**Summary:** Onboarding completion tracking and default recipe images for new users

### Added

- **Onboarding completion**:
  - `user_config.onboarding_completed_at` (TIMESTAMPTZ, nullable) — stores when the user completed first-run onboarding
  - First-run onboarding checks this field; on completion, updates user config via `useUpdateUserConfig` so the dialog does not show again
  - Migration: `012_add_onboarding_completed_at.sql`

- **Default recipe images**:
  - Database trigger `set_default_recipe_images` on `recipes` (BEFORE INSERT): when `image_url` is null/empty, sets storage path (e.g. `defaults/mac-and-cheese.webp`) for the 8 default recipe slugs; supports recipe IDs with UUID suffix (`slug-uuid`) via `regexp_replace` to match base slug
  - Migrations: `013_default_recipe_images.sql` (exact ID match + backfill), `014_default_recipe_images_uuid_suffix.sql` (ID suffix match + backfill)
  - Script `web/scripts/upload-default-recipe-images.ts` — uploads default images from `.cursor/images` to Supabase Storage `recipe-images/defaults/`; run with `npx tsx scripts/upload-default-recipe-images.ts` (requires `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

### Changed

- **First-run onboarding**: Uses `useUserConfig` for `onboarding_completed_at`; on "Got it" calls `useUpdateUserConfig` with `onboarding_completed_at: new Date().toISOString()`
- **user_config types**: `DEFAULT_USER_CONFIG` and database types include `onboarding_completed_at: null`
- **Recipe images**: Default recipes (inserted by signup trigger) now get `image_url` set to storage path; client resolves paths via `getRecipeImageUrl()` (already supports storage paths → public URL)

### Technical Notes

- Default image paths are storage-relative (e.g. `defaults/mac-and-cheese.webp`); public URL is resolved client-side via `getRecipeImageUrl()` in recipe-card and recipe-detail-dialog
- Run migrations 012, 013, 014 in order after 011; upload default images to storage before or after so `defaults/*.webp` exist in the `recipe-images` bucket

---

## [2.12.6] - 2026-02-04

**Summary:** Planner refactor — shared lib modules, local-date handling, stale day-assignment pruning, and user-config error handling

### Added

- **Planner lib modules**:
  - `lib/planner-colors.ts` — `CATEGORY_HEX_COLORS` and `getCategoryHexColor()` shared by meal-planner and plan-settings-modal (replaces duplicated category pill colors)
  - `lib/planner-utils.ts` — `parseLocalDate`, `parseLocalCalendarDate`, `toLocalNoonISOString`, `dayIndexToDayOfWeek`, `dayOfWeekToDayIndex`, `stableRecipeHash` for local-date handling and day-index conversion
  - `lib/user-config.ts` — `DEFAULT_USER_CONFIG` and `resolveUserConfig()` for centralized defaults and config fetch error handling
- **Unit tests**:
  - `lib/__tests__/meal-planner.test.ts` — meal planner generation and auto-assign logic
  - `lib/__tests__/planner-colors.test.ts` — category hex color lookup
  - `lib/__tests__/planner-utils.test.ts` — local date parsing, noon ISO string, day-index conversion
  - `lib/__tests__/user-config.test.ts` — default config and resolveUserConfig behavior

### Changed

- **Local-date handling**: `isDateInWeekRange` in meal-planner now uses `parseLocalCalendarDate()` from planner-utils so YYYY-MM-DD and ISO strings are parsed in local time (avoids UTC boundary shifts). "Mark made" timestamps use `toLocalNoonISOString()` so stored dates do not shift across timezones.
- **Stale day_assignments**: `autoAssignDays()` in `meal-planner.ts` now prunes assignments for recipes no longer in the plan; regenerating a plan no longer leaves orphaned keys in `day_assignments`.
- **User config errors**: `useUserConfig()` uses `resolveUserConfig()`: PGRST116 (not found) returns default config; other errors are rethrown instead of masking backend issues.
- **Planner UI**: Meal-planner and plan-settings-modal import category colors from `planner-colors` and date/day helpers from `planner-utils`; no behavior change, reduced duplication.

### Technical Notes

- Planner improvements align with `.cursor/plans/planner_improvements` (P0 local-date, P1 prune assignments, P2 shared colors, P3 config error specificity).
- Unit tests use Vitest; run with `npm run test`.

---

## [2.12.5] - 2026-02-02

**Summary:** Shopping list accessibility improvements and test infrastructure additions

### Changed

- **Shopping list checkbox touch targets**:
  - Mobile checkboxes now meet WCAG 2.1 AA minimum touch target size (44x44px)
  - Desktop checkboxes remain compact (24x24px) for optimal space usage
  - Checkbox visual indicator wrapped in larger touch target container for better mobile UX
  - Added proper ARIA labels for screen reader accessibility
- **Shopping list header buttons**: Increased padding on Organize and Clear buttons for better touch accessibility (`p-2` → `p-3`)

### Added

- **Unit test infrastructure**:
  - `shopping-categories.test.ts` - Tests for shopping category logic
  - `shopping-list-merging.test.ts` - Tests for item merging behavior
  - `shopping-list-normalization.test.ts` - Tests for unit and item normalization
  - `shopping-list.test.ts` - General shopping list utility tests

### Technical Notes

- Touch target implementation uses nested span for visual checkbox inside larger button element
- Negative margin (`-my-2`) on mobile maintains visual alignment while expanding touch area
- `.gitignore` updated to exclude `web/docs/` directory from version control
- Test files use Vitest framework and follow established testing patterns from hooks tests

---

## [2.12.4] - 2026-02-01

**Summary:** Meal planner swap UX — preserve day assignment on swap, flip animation when recipe changes in slot

### Added

- **Planner swap behavior**:
  - **Flip animation**: Recipe cards in calendar view now play a flip-out/flip-in animation when the recipe in that slot changes (e.g. after swap)
  - **Stable slot keys**: Only the swapped card flips; other cards are unaffected

### Changed

- **use-planner.ts**: `useSwapRecipe` now reads/updates `day_assignments` when swapping; optimistically sets recipes cache for new recipe IDs so the calendar does not unmount and the flip animation runs smoothly
- **meal-planner.tsx**: New `FlipRecipeCard` wrapper runs flip phases (idle → out → in → idle) when `recipe.id` changes in a slot; used for desktop day columns and mobile day stack
- **globals.css**: Added `.flip-recipe-card-inner`, `.flip-out`, `.flip-in` for 3D flip effect (perspective, rotateY)

### Technical Notes

- Flip uses 200ms out + 200ms in; cleanup on unmount clears timeouts

---

## [2.12.3] - 2026-02-01


### Added

- **Header**:
  - **Onboarding**: Help icon opens OnboardingDialog (replaces inline help)
- **Recipe list**:
  - **Sort options**: Most Made, Recently Made, Name (A–Z), Newest First (driven by recipe history)
  - **View toggle**: Grid vs list view for recipe cards
  - **Recipe stats**: "Made X times" and "Last: date" from recipe history on cards
  - **Mark as made with undo**: Toast with undo after marking a recipe as made
- **Recipe card**:
  - **List view**: Horizontal card with image, favorite overlay, category/tag pills, history line, action icons (Mark as Made, Shop, Plan, Chevron)
  - **Grid view**: Rounded cards, category pills, history row, desktop 3-button row (Made, Shop, Plan), mobile 3-dot actions menu
  - **Tag click**: Clicking a tag adds it to the active filter

### Changed

- **Recipe list**: Settings and Add Recipe in filter row; skeleton only on initial load (stale-while-revalidate for refetch); sort applied to displayed recipes
- **Recipe card**: Category pill colors for grid (REF_CATEGORY_PILL); list view uses getTagColor; mobile grid uses dropdown for actions

### Technical Notes

- Recipe stats derived from `recipe_history` via `getRecipeStatsMap` in recipe-list
- Sort options: `timesMade`, `lastMade`, `name`, `newest`
- List view layout: image 128×128, title/tags/history, then action icons

---

## [2.12.2] - 2026-01-30

**Summary:** Playwright E2E testing setup, removal of shopping-list lib unit tests, and test artifact gitignore

### Added

- **Playwright E2E testing**:
  - `playwright.config.ts` with global setup for authenticated state
  - Scripts: `test:e2e`, `test:e2e:ui`, `test:e2e:headed`, `test:e2e:debug`, `test:e2e:report`, `test:e2e:codegen`
  - Dev dependency: `@playwright/test`
  - Tests live in `web/tests/` (gitignored; add tests as needed)
  - Reuses auth state from `playwright/.auth/user.json` (gitignored)

### Removed

- **Shopping list lib unit tests** (moved coverage to E2E / manual verification):
  - `web/src/lib/__tests__/shopping-list-generation.test.ts`
  - `web/src/lib/__tests__/shopping-list-merging.test.ts`
  - `web/src/lib/__tests__/shopping-list-normalization.test.ts`

### Changed

- **.gitignore**: Added test artifacts — `coverage/`, `playwright-report/`, `playwright/.auth/`, `test-results/`, `web/test-results/`, `web/tests/`, `blob-report/`
- Vitest remains for unit tests (e.g. `hooks/__tests__/shopping-list-checked-state.test.ts`)

### Technical Notes

- Run E2E: `npm run test:e2e` (requires dev server; use global setup for auth)
- Run unit tests: `npm run test` or `npm run test:watch`

---

## [2.12.1] - 2026-01-30

**Summary:** Comprehensive testing review fixes — auth, shopping merging, auth callback security, accessibility, and validation

### Fixed

- **Auth context**:
  - Added `.catch()` to `getSession()` so loading state exits on failure (no infinite loading on network error)
- **Shopping list merging**: Replaced dynamic `require()` in `shopping-list-merging.ts` with ES module import so category overrides work at runtime
- **Auth callback**:
  - Error logging for failed authentication exchanges
  - Sanitized error messages in redirect URLs (opaque codes instead of raw Supabase messages)
  - Redirect path validation to prevent open redirects
- **Meal planner**: History exclusion boundary fixed (`>` → `>=`) so recipes made exactly N days ago are excluded
- **Navigation**: Bottom nav padding corrected (`pb-20` → `pb-16`) to match 64px nav height
- **Tag input**: Added `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-haspopup`, `aria-autocomplete` for accessibility
- **Recipe dialog**: Aria-labels on ingredient delete buttons and drag handles; validation requires at least one ingredient before save
- **Tests**: Shopping list generation test fixtures updated with `image_url` property

### Technical Notes

- Full review and remaining issues documented in `.cursor/plans/comprehensive_testing_results.md`
- P0 critical and selected P1/P2 fixes applied; remaining items tracked in that plan for future work

---

## [2.11.0] - 2026-01-27

**Summary:** Stitch visual redesign, desktop header navigation, and auth callback fix

### Added

- **Stitch Visual Redesign**:
  - **Typography**: Outfit for body text, Playfair Display for headings (`font-display`)
  - **Color palette**: Deep farm green primary (`--primary`), sage secondary, terracotta accent; new design tokens: `card-cream`, `border-muted`, `accent-peach`, `accent-mint`, `accent-lavender`, `accent-rose`, `accent-green`
  - **Border radius**: Base radius 0.5rem → 0.75rem
  - **Recipe cards**: Category-based accent backgrounds (e.g. `accent-mint` for chicken, `accent-peach` for lamb); `card-cream` image placeholder
  - **Planner "cooked" cards**: Desktop and mobile styling for made recipes — grayscale and reduced opacity on card images (`planner-desktop-card-done`, `planner-mobile-card-done`, `.meal-image`)
  - **Recipe detail dialog**: Large image with `card-cream` fallback; `font-display` for title; custom desktop scrollbar (`.scrollbar-recipe-dialog`)
  - **Shopping list**: `font-display` for section headings

- **Desktop Header & Navigation**:
  - **Desktop (md+)**: Fixed header with centered nav tabs (Planner, Recipes, Shopping, Pantry); active tab underline
  - **Onboarding**: Help icon (HelpCircle) as trigger; UtensilsCrossed in primary box as logo
  - **Bottom nav**: Shown only on mobile (`md:hidden`); desktop uses header tabs
  - **Layout**: Main content `md:pt-[65px]` for fixed header; `md:pb-6` on desktop (no bottom nav padding)

- **Auth callback**: `export const dynamic = "force-dynamic"` on `/auth/callback` route for correct OAuth code-exchange behavior

### Changed

- **Layout**: `app/layout.tsx` — Inter replaced by Outfit + Playfair; CSS variables applied via `cn(outfit.variable, playfair.variable)`
- **Header**: Accepts `activeTab` and `onTabChange`; desktop nav; avatar with `getInitials()`
- **Page**: Passes `activeTab` / `setActiveTab` to `Header`; main `md:pt-[65px] md:pb-6`
- **Bottom nav**: `md:hidden` so it only appears on mobile
- **Tailwind**: New `fontFamily.display`, `fontFamily.sans`, `borderRadius.xl`; `card-cream`, `border-muted`, `accent-*` in `theme.extend`
- **globals.css**: Updated `:root` CSS variables for Stitch palette; `.scrollbar-recipe-dialog`; `.planner-desktop-card-done` / `.planner-mobile-card-done` image filters
- **Meal planner, recipe (card, detail, dialog, list), shopping list, add-recipe-to-plan modal, use-planner**: Styling and layout updates for new design tokens and responsive behavior

### Other

- **.gitignore**: `reference/` folder added (design reference HTML/CSS)

### Technical Notes

- Design references in `reference/` (e.g. `planner_mobile_redesign`, `shoppinglist_mobile_redesign`) inform token names and layout; `reference/` is gitignored
- Planner cooked state uses CSS classes + `globals.css` for image effects to keep component markup simpler

---

## [2.12.0] - 2026-01-27

**Summary:** Edit Recipe modal redesign per `reference/recipemodal_editmode_redesign` — 2-col layout, refined ingredient rows, and mobile-friendly behavior

### Added

- **Edit Recipe modal layout** (edit mode only; Add Recipe unchanged):
  - **Header**: "Edit Recipe" title, subtitle "Update your culinary masterpiece details.", and close button; `max-w-6xl`, `h-[90vh]`, `rounded-3xl`, flex column with scroll in body only
  - **Two-column grid** (stacks on mobile): Left — Recipe Image (label, `aspect-video`, dashed upload with "Upload Image" / "JPG, PNG, WebP. Max 5MB"), Recipe Name, Category and Servings (2-col), Tags with add-icon input; Right — Ingredients (label + "+ ADD INGREDIENT" text button, scrollable list) and Instructions (label, `rounded-2xl` textarea, placeholder "Step by step process...")
  - **Ingredient rows (edit mode)**: Drag handle | amount | unit | item | modifier (hidden on mobile) | delete; delete on row hover (desktop), always visible on mobile; scrollable list `max-h-[280px]` (mobile) / `max-h-[350px]` (desktop)
  - **Footer**: `bg-muted/50`, `border-t`; Cancel and Save Changes unchanged
- **TagInput**: Optional `showAddIconInInput` prop — when true, add icon on the right of the input to add the current value on click; used in Edit Recipe tags with placeholder "Add another tag..."

### Changed

- **recipe-dialog.tsx**: Edit-mode branch returns early with new 2-col layout; `SortableIngredientRow` supports `editModeLayout` (amount|unit|item order, compact inputs, delete-on-hover); edit shell uses dedicated header and footer styling; Add Recipe (manual/import) unchanged
- **tag-input.tsx**: `showAddIconInInput` and add-icon button; input `pr-10` when add icon shown

### Technical Notes

- Design reference: `reference/recipemodal_editmode_redesign` (code.html, screen.png)
- `editModeLayout` on `SortableIngredientRow`: modifier column `hidden sm:block` on mobile to avoid overflow; delete uses `opacity-100 sm:opacity-0 sm:group-hover:opacity-100` so it is always visible on touch
- Edit dialog uses `scrollbar-recipe-dialog` on the scrollable body

---

## [2.10.2] - 2026-01-25

**Summary:** Bug fix for excluded items not being removed when recipe is removed from shopping list

### Fixed

- **Shopping List Recipe Removal**:
  - Fixed bug where excluded items (items matching excluded keywords) were not removed when a recipe was removed from the shopping list
  - Now properly filters excluded items array when removing recipe items, matching behavior of regular items and "already have" items

### Technical Notes

- Updated `useRemoveRecipeItems` hook to include `excluded` array in filtering and database operations
- Excluded items are now properly removed from shopping list when their source recipe is removed
- Maintains consistency across all three shopping list arrays: `items`, `already_have`, and `excluded`

---

## [2.10.1] - 2026-01-25

**Summary:** Ingredient modifier support and date-based recipe history tracking

### Added

- **Ingredient Modifier Support**:
  - Ingredients can now include preparation modifiers (e.g., "lentils, rinsed" → item: "lentils", modifier: "rinsed")
  - Recipe parser automatically extracts modifiers from ingredient lines when importing from text
  - Modifiers displayed in recipe detail view and recipe cards with muted styling
  - Modifier input field added to recipe editing forms for manual entry
  - Supports common preparation instructions: rinsed, diced, minced, chopped, etc.
  - Smart detection: only treats text after comma as modifier if it's reasonably short and matches common modifier patterns
  - Handles edge cases: ignores commas inside parentheses (e.g., "1 (28 oz) can crushed tomatoes")

- **Date-Based Recipe History**:
  - When marking a recipe as "made" from the meal planner, uses the assigned day's date instead of today's date
  - Recipes assigned to specific days in the meal plan use that day's date for history tracking
  - Unassigned recipes or recipes marked from other views still use today's date
  - Date preserved on undo operations for accurate history tracking
  - Improves accuracy of history exclusion when generating future meal plans

### Changed

- Recipe parser now extracts and stores ingredient modifiers separately from item names
- `useMarkRecipeMade` hook now accepts optional `dateMade` parameter for custom date tracking
- Recipe detail dialog displays modifiers with muted text styling for visual distinction
- Recipe dialog forms include modifier input field alongside amount and unit fields

### Technical Notes

- New `modifier` field added to `Ingredient` interface (optional string)
- `extractModifier()` function in `recipe-parser.ts` handles smart modifier detection
- Modifier detection uses heuristics: length check, keyword matching, and avoids false positives
- Date calculation in meal planner uses assigned day's date with timezone-safe handling
- Backward compatible: existing recipes without modifiers continue to work normally

---

## [2.10.0] - 2026-01-24

**Summary:** Codebase improvements based on comprehensive analysis - error boundary, shopping hooks refactor, and Supabase client consolidation

### Added

- **Error Boundary with Recovery UI**:
  - New `ErrorBoundary` component that catches JavaScript errors in child components
  - Displays user-friendly error screen instead of blank crash
  - "Try again" button to reset error state without page reload
  - "Reload page" button for full page refresh
  - Error details shown in development mode for debugging
  - Integrated at app root level in `providers.tsx` to catch all errors
  - Prevents entire app crash from single component errors

- **Shopping Hooks Modularization**:
  - Split monolithic `use-shopping.ts` (1,470 lines) into domain-focused modules
  - New structure: `hooks/shopping/` directory with specialized files:
    - `use-shopping-list.ts` - Core list operations (fetch, generate, save, clear)
    - `use-shopping-items.ts` - Item operations (add, remove, check, reorder, bulk)
    - `use-shopping-recipes.ts` - Recipe-related operations (add/remove recipe items)
    - `use-shopping-categories.ts` - Category override operations
    - `use-shopping-config.ts` - Shopping configuration operations
    - `use-shopping-pantry.ts` - Pantry integration operations
    - `index.ts` - Barrel export for backward compatibility
  - Backward compatible: existing imports from `@/hooks/use-shopping` continue to work
  - Each module is focused, testable, and easier to maintain

### Changed

- **Supabase Client Consolidation**:
  - Consolidated duplicate `getSupabase()` functions from 6 files into single source
  - All hooks now import from `@/lib/supabase/client.ts`
  - Singleton pattern ensures single client instance (better connection pooling)
  - Eliminates maintenance burden of updating multiple files for client changes
  - Updated files: `use-recipes.ts`, `use-planner.ts`, `use-pantry.ts`, `auth-context.tsx`, `page.tsx`, and all shopping hooks

### Technical Notes

- Error boundary uses React class component (required for error boundaries)
- Shopping hooks refactor maintains 100% backward compatibility via barrel export
- Supabase client singleton pattern improves performance and maintainability
- All three improvements address top recommendations from codebase analysis
- No breaking changes - all improvements are additive or internal refactoring

---

## [2.9.1] - 2026-01-24

**Summary:** Fixed TypeScript compilation errors related to Supabase type inference

### Fixed

- **TypeScript Build Errors**:
  - Resolved compilation failures caused by Supabase type inference issues
  - TypeScript incorrectly inferred parameter types as `never` for `.update()` and `.insert()` operations
  - Added `@ts-expect-error` comments with explanatory notes to affected Supabase operations
  - Fixed type assertions for Supabase query results across all hooks

- **Type Safety Improvements**:
  - Added explicit type assertions for `currentList`, `config`, `plan`, `recipe`, and other Supabase query results
  - Changed patterns from `data?.property` to `(data as Type | null)?.property` for better type safety

### Changed

- **Affected Files**:
  - `use-shopping-categories.ts` - Fixed category override updates
  - `use-shopping-config.ts` - Fixed config updates and inserts
  - `use-shopping-items.ts` - Fixed item updates and type assertions
  - `use-shopping-list.ts` - Fixed shopping list updates and inserts
  - `use-shopping-pantry.ts` - Fixed pantry-related updates
  - `use-shopping-recipes.ts` - Fixed recipe-related shopping list operations
  - `use-pantry.ts` - Fixed pantry item operations and config queries
  - `use-planner.ts` - Fixed meal plan updates and inserts
  - `use-recipes.ts` - Fixed recipe CRUD operations

### Technical Notes

- This is a known limitation with Supabase TypeScript type inference in certain contexts
- The `@ts-expect-error` comments document that these are type system limitations, not runtime errors
- All operations are type-safe at runtime; the workarounds are purely for TypeScript compilation
- Build now completes successfully with all type checks passing
- See ADR-016 for detailed explanation of the issue and workaround

---

## [2.9.0] - 2026-01-27

**Summary:** Recipe image support with Supabase Storage integration

### Added

- **Recipe Image Support**:
  - Upload images when creating or editing recipes
  - Images displayed on recipe cards in both grid and list views
  - Large image display in recipe detail dialog
  - Automatic image compression/resizing (max 2000px width, 85% quality)
  - Graceful placeholder (🍳 emoji) for recipes without images
  - Support for JPG, PNG, and WebP formats (max 5MB)
  - Images stored in Supabase Storage with user-specific folders
  - Row Level Security (RLS) policies for secure image access

### Changed

- Recipe cards now show images at the top (grid view) or left side (list view)
- Recipe detail dialog displays large recipe image at the top
- Recipe dialog includes image upload/removal functionality

### Technical Notes

- New database column: `recipes.image_url` (TEXT, nullable)
- New Supabase Storage bucket: `recipe-images` (public read, authenticated write)
- Storage helper functions in `web/src/lib/supabase/storage.ts`
- Images organized by user ID: `{user_id}/{recipe_id}.{ext}`
- Automatic cleanup of old images when recipes are updated/deleted

---

## [2.8.1] - 2026-01-26

**Summary:** Recipe ingredient drag-and-drop reordering and UI improvements

### Added

- **Drag-and-Drop Ingredient Reordering**:
  - Ingredients in recipe dialog can now be reordered via drag-and-drop
  - Visual drag handle (grip icon) for better UX
  - Keyboard navigation support for accessibility
  - Maintains ingredient order when saving recipes

### Changed

- Recipe dialog UI improvements for better ingredient management
- Removed unused mockup HTML files (meal-planner-calendar-mockup.html, recipe-card-mockup.html)
- Improved recipe card styling and layout

### Technical Notes

- Uses `@dnd-kit` library for drag-and-drop functionality
- Ingredient reordering persists in recipe data structure
- Supports both mouse and keyboard interactions

---

## [2.8.0] - 2026-01-25

**Summary:** Meal planner settings with default category breakdown, day placement rules, and automatic day assignment

### Added

- **Plan Settings Modal**:
  - New settings modal accessible via settings button (⚙️) in meal planner
  - Configure default category breakdown that persists across sessions
  - Save current selection as default or load saved defaults
  - Visual category pills with color coding for easy configuration

- **Day Placement Rules**:
  - **Excluded Days**: Configure which days of the week to exclude from automatic meal placement
  - **Preferred Days**: Set preferred days for meal placement (recipes prioritized to these days)
  - Visual day selector with checkboxes for excluded and preferred days
  - Conflict detection warns when more meals are selected than available days
  - Prevents excluding all days (validation)

- **Automatic Day Assignment**:
  - Toggle to automatically assign recipes to days when generating meal plans
  - Intelligent distribution respecting excluded and preferred days
  - Round-robin distribution when preferred days are exhausted
  - Day assignments preserved when regenerating plans (when possible)

- **History Exclusion Settings**:
  - Configure history exclusion days directly from plan settings modal
  - Previously only accessible via pantry settings
  - Integrated into meal planning workflow for better UX

### Changed

- Meal plan generation now uses saved default category breakdown when available
- Plan settings modal consolidates all meal planning preferences in one place
- Default selection automatically loads from saved preferences on page load
- "Use Current Selection" button to quickly update defaults from current pill selection

### Technical Notes

- Migration `009_planner_settings.sql` adds three columns to `user_config`:
  - `excluded_days`: INTEGER[] - Day indices (0-6) to exclude from placement
  - `preferred_days`: INTEGER[] | null - Day indices (0-6) to prefer for placement
  - `auto_assign_days`: BOOLEAN - Whether to auto-assign days on generation (default: true)
- `autoAssignDays()` function in `meal-planner.ts` handles intelligent day distribution
- Settings persist in user configuration and apply to all future meal plan generations

---

*For older entries (v1.0.0 – v2.7.1), see `changelog-archive.md`.*
