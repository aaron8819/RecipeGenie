# Architectural Decisions

This document captures key architectural and design decisions for Recipe Genie, including rationale and tradeoffs.

---

## ADR-001: Flask Monolith with Single-File Backend

**Status:** Accepted (inferred from existing implementation)

**Context:** The application needed a web framework for a local meal planning tool.

**Decision:** Use Flask as a monolithic single-file application (`app.py`, ~820 lines).

**Rationale:**
- Flask's minimal footprint suits a local-first, personal-use application
- Single-file structure reduces cognitive overhead for a project of this scope
- No need for multi-process scaling or distributed deployment

**Tradeoffs:**
- (+) Simple deployment: `python app.py` starts everything
- (+) Easy to understand the full request lifecycle
- (-) File will grow unwieldy if features expand significantly
- (-) No separation of concerns (routes, models, business logic colocated)

**Risks:**
- If the app exceeds ~1500 lines, consider splitting into blueprints
- Testing is harder without dependency injection

---

## ADR-002: JSON File Storage Instead of Database

**Status:** Accepted (inferred from existing implementation)

**Context:** Recipe, pantry, and configuration data needs to persist between sessions.

**Decision:** Store all data in JSON files in the `data/` directory:
- `recipes.json` - Recipe collection
- `pantry.json` - Pantry inventory
- `config.json` - User preferences and excluded keywords
- `history.json` - Recipe cooking history
- `weekly-plans.json` - Saved weekly meal plans
- `shopping-list.json` - Current shopping list state

**Rationale:**
- Human-readable format allows manual editing
- No database setup required for end users
- Suitable for single-user, local-only deployment
- Easy backup (copy the `data/` folder)

**Tradeoffs:**
- (+) Zero dependencies beyond Flask
- (+) Transparent data format
- (+) Portable across systems
- (-) No concurrent access safety (file-level race conditions possible)
- (-) No query optimization; full file loads on every request
- (-) No referential integrity between files

**Risks:**
- Data corruption if multiple browser tabs modify simultaneously
- Performance degrades with large recipe collections (500+ recipes)

**Mitigation:** For current scope (personal use, <200 recipes), these risks are acceptable.

---

## ADR-003: Single-Page Application with Vanilla JavaScript

**Status:** Accepted (inferred from existing implementation)

**Context:** The UI needs multiple views (planner, recipes, pantry, shopping list).

**Decision:** Implement as a single HTML template (`index.html`) with client-side view switching via vanilla JavaScript (`app.js`).

**Rationale:**
- No build toolchain required (no webpack, no npm for frontend)
- Reduces complexity for a local tool
- Server renders one template; JS handles all view transitions

**Tradeoffs:**
- (+) Simple deployment and development setup
- (+) No framework lock-in or version management
- (+) Fast initial page load (no large framework bundle)
- (-) State management is ad-hoc
- (-) DOM manipulation verbose compared to React/Vue
- (-) Limited component reusability

**Risks:**
- As UI complexity grows, vanilla JS becomes harder to maintain
- No type safety in JavaScript code

---

## ADR-004: Category-Based Recipe Organization

**Status:** Accepted (inferred from existing implementation)

**Context:** Recipes need organization for meal planning variety.

**Decision:** Categorize recipes by protein type (chicken, turkey, steak, beef, lamb, vegetarian).

**Rationale:**
- Protein is often the primary meal differentiator
- Enables balanced weekly plans (e.g., "2 chicken, 1 steak, 1 vegetarian")
- Categories are user-configurable via `config.json`

**Tradeoffs:**
- (+) Simple mental model for users
- (+) Supports meal variety constraints
- (-) Single-axis categorization limits flexibility
- (-) Some recipes don't fit neatly (e.g., seafood, breakfast items)

**Future Consideration:** Multi-tag system could provide more flexibility but adds UI complexity.

---

## ADR-005: Keyword-Based Ingredient Exclusion

**Status:** Accepted (updated 2026-01-24)

**Context:** Shopping lists should exclude common pantry staples the user always has.

**Decision:** Use configurable keyword matching with exact string matching (case-insensitive) to auto-exclude ingredients (e.g., "oil", "salt", "pepper").

**Rationale:**
- Precise control over what gets excluded
- "pepper" only matches "pepper", not "poblano pepper" or "black pepper"
- Prevents false positives from partial matches
- Users can add specific variants to the exclusion list if needed (e.g., "black pepper", "white pepper")

**Implementation:**
- Uses exact string matching (case-insensitive, trimmed)
- Keyword must match ingredient name exactly
- Example: "pepper" matches "pepper" but not "poblano pepper"

**Tradeoffs:**
- (+) Precise matching prevents unexpected exclusions
- (+) Configurable per-user preferences
- (+) Clear, predictable behavior
- (-) Users must add multiple variants if they want to exclude them (e.g., "black pepper", "white pepper" separately)

**Risks:**
- Users may need to add more keywords to cover variants
- Solution: UI shows "excluded" items separately (already implemented)
- Users can add specific variants to the exclusion list as needed

---

## ADR-006: Configurable Recipe History Exclusion

**Status:** Accepted (updated 2026-01-09)

**Context:** Generated meal plans should avoid recently-cooked recipes for variety.

**Decision:** Exclude recipes made within a configurable window (default 7 days) from random selection (with fallback if insufficient alternatives).

**Rationale:**
- Prevents repetitive meal plans
- 7 days is reasonable default for weekly planning cycle
- Graceful degradation when recipe pool is limited
- Configurable to accommodate different household sizes and recipe collection sizes

**Configuration:**
- `historyExclusionDays` in config.json (default: 7)
- Smaller values (3-5) for small households or limited recipes
- Larger values (10-14) for large recipe collections

**Tradeoffs:**
- (+) Automatic variety without user intervention
- (+) Fallback prevents blocking when options are scarce
- (+) User can tune to their needs
- (-) No weighting (a recipe made N-1 days ago treated same as yesterday)

---

## ADR-007: REST API Design

**Status:** Accepted (inferred from existing implementation)

**Context:** Frontend needs to communicate with backend for all operations.

**Decision:** Expose RESTful JSON APIs under `/api/` prefix with standard HTTP verbs.

**Rationale:**
- Clear separation between UI and data operations
- Standard patterns (GET/POST/PUT/DELETE)
- JSON payloads work naturally with JavaScript

**API Structure:**
- `/api/recipes` - CRUD for recipes
- `/api/pantry` - Pantry management
- `/api/config` - Configuration
- `/api/generate-meal-plan` - Meal plan generation
- `/api/generate-shopping-list-scaled` - Shopping list generation with scaling
- `/api/weekly-plans` - Persistent weekly plan storage

**Tradeoffs:**
- (+) Testable independently of UI
- (+) Could support future mobile app or CLI
- (-) No API versioning
- (-) No authentication (acceptable for local-only use)

---

## ADR-008: Input Validation on API Endpoints

**Status:** Accepted (2026-01-09)

**Context:** API endpoints accepted any JSON structure without validation. Malformed requests could corrupt data files or cause runtime errors.

**Decision:** Add validation functions for critical data types (recipes, pantry items, config) that run before any file I/O.

**Implementation:**
- `validate_recipe()` - checks required fields (name, category, servings, ingredients) and types
- `validate_pantry_item()` - checks item is non-empty string
- `validate_pantry_bulk()` - checks array structure
- `validate_config()` - checks field types if present

**Validation Rules:**
| Field | Rule |
|-------|------|
| Recipe name | Required, string |
| Recipe category | Required, string |
| Recipe servings | Required, positive integer |
| Recipe ingredients | Required, array of objects with `item` string |
| Pantry item | Required, non-empty string |
| Config categories | If present, must be array |
| Config historyExclusionDays | If present, must be non-negative integer |

**Tradeoffs:**
- (+) Prevents data corruption from malformed requests
- (+) Returns descriptive error messages (400 status)
- (+) Validates before file I/O (fail-fast)
- (+) Foundation for future API consumers
- (-) Slight overhead on every write operation
- (-) More code to maintain

**Alternatives Considered:**
- JSON Schema validation library - rejected as over-engineered for this scope
- Database constraints - not applicable (JSON file storage)

---

## ADR-009: Unified Shopping List Items Array

**Status:** Accepted (2026-01-09)

**Context:** Shopping lists had two separate arrays: `items` (from recipes) and `manual_items` (user-added). This required merging logic in multiple places (rendering, copying, persistence).

**Decision:** Consolidate into a single `items` array. Manual items are identified by their `sources` metadata (`sources: [{recipeName: "Manual"}]`).

**Rationale:**
- Single source of truth for all shopping list items
- Reduces code duplication in frontend and backend
- Simpler iteration, filtering, and rendering
- Source metadata already existed; leveraging it for item type is natural

**Implementation:**
- Backend `save_shopping_list()` auto-migrates old `manual_items` into `items`
- Frontend identifies manual items by checking `sources[].recipeName === "Manual"`
- All CRUD operations work on single `items` array

**Tradeoffs:**
- (+) Simpler code - no more array merging
- (+) Consistent item structure regardless of source
- (+) Easier to add future sources (e.g., "imported", "shared")
- (-) Must check source metadata to distinguish item types (minor overhead)

**Migration:**
- Backward compatible: old data with `manual_items` is automatically merged on save
- No manual migration required

---

## ADR-010: Next.js + Vercel Migration

**Status:** Accepted (2026-01-15)

**Context:** The Flask + JSON file architecture (ADR-001, ADR-002) worked well for local single-user use, but had inherent limitations:
- No multi-user support (no authentication)
- No cloud deployment (local-only)
- File-based storage doesn't scale
- Vanilla JS frontend becoming harder to maintain

**Decision:** Rewrite the application using Next.js 14 (App Router) deployed to Vercel.

**Rationale:**
- Next.js provides React-based component architecture with TypeScript
- App Router enables server components and streaming
- Vercel offers zero-config deployment from Git
- Modern DX with hot reload, type safety, and ESLint
- React ecosystem provides better state management options

**Tradeoffs:**
- (+) Production-ready deployment infrastructure
- (+) TypeScript catches errors at compile time
- (+) Component-based architecture scales better
- (+) Large ecosystem of libraries and tools
- (-) More complex than Flask for simple use cases
- (-) Requires Node.js runtime knowledge
- (-) Build step adds deployment complexity

**Supersedes:** ADR-001 (Flask monolith), ADR-003 (Vanilla JS SPA)

---

## ADR-011: Supabase for Backend Services

**Status:** Accepted (2026-01-15)

**Context:** Moving from local JSON files to a cloud-hosted database requires:
- Database hosting and management
- User authentication
- Row-level security for multi-tenant data
- API layer for data access

**Decision:** Use Supabase as the backend platform, providing:
- PostgreSQL database with managed hosting
- Built-in authentication (email/password initially)
- Row Level Security (RLS) policies for data isolation
- Auto-generated TypeScript types
- Real-time subscriptions (future use)

**Rationale:**
- Single platform provides auth + database + API
- RLS ensures users can only access their own data without application-level checks
- PostgreSQL offers proper relational integrity and query optimization
- Generous free tier suitable for personal/small-scale use
- Supabase client libraries integrate well with Next.js

**Implementation:**
- 6 tables mirror the original JSON file structure
- RLS policy: `auth.uid() = user_id` on all tables
- Client-side queries via `@supabase/ssr` for cookie-based auth
- Server-side queries via service role key for migrations

**Tradeoffs:**
- (+) Managed infrastructure - no database administration
- (+) Built-in auth eliminates custom implementation
- (+) RLS provides security at database level
- (+) Real-time capabilities for future features
- (-) External dependency - requires internet connection
- (-) Vendor lock-in (mitigated by standard PostgreSQL)
- (-) Free tier has usage limits

**Supersedes:** ADR-002 (JSON file storage)

---

## ADR-012: TanStack Query for Server State Management

**Status:** Accepted (2026-01-15)

**Context:** The vanilla JS frontend maintained state manually via a global `state` object that could drift from the backend. React applications need a strategy for:
- Fetching and caching server data
- Synchronizing client and server state
- Handling loading and error states
- Invalidating stale data after mutations

**Decision:** Use TanStack Query (React Query) v5 for all server state management.

**Rationale:**
- Automatic caching reduces redundant network requests
- Built-in loading/error states simplify component logic
- Query invalidation ensures fresh data after mutations
- Optimistic updates provide responsive UX
- DevTools aid debugging during development

**Implementation:**
- Custom hooks wrap Supabase queries: `useRecipes`, `usePlanner`, `usePantry`, `useShopping`
- `QueryClientProvider` in root layout
- Mutations invalidate related queries automatically
- Stale time configured per query type

**Tradeoffs:**
- (+) Eliminates manual state synchronization bugs
- (+) Consistent loading/error handling patterns
- (+) Automatic background refetching
- (+) Reduces boilerplate compared to manual fetch + useState
- (-) Learning curve for query/mutation patterns
- (-) Additional bundle size (~12KB gzipped)
- (-) Debugging requires understanding cache behavior

**Alternatives Considered:**
- SWR - similar capabilities but TanStack Query has richer feature set
- Redux Toolkit Query - overkill for this application's needs
- Manual fetch + useState - rejected due to complexity managing cache/sync

---

## ADR-013: Guest Mode for Onboarding

**Status:** Accepted (2026-01-16)

**Context:** Requiring users to sign up before trying the app creates friction and reduces conversion. Users want to explore the app's features before committing to creating an account.

**Decision:** Implement a guest mode that allows users to use the app without authentication, with data stored only in the browser session.

**Rationale:**
- Reduces signup friction - users can try before committing
- Demonstrates app value before requiring account creation
- Uses React Query cache for seamless data management
- Pre-populated with default recipes to show functionality
- Clear messaging that data is session-only (lost on refresh)

**Implementation:**
- Guest mode flag stored in `sessionStorage` (not `localStorage` to emphasize temporary nature)
- All data hooks support both authenticated and guest modes
- Default recipes, config, and shopping list provided via `guest-storage.ts`
- Guest data stored in React Query cache with `true` flag in query keys
- Seamless transition: users can sign up/sign in from guest mode

**Tradeoffs:**
- (+) Lowers barrier to entry
- (+) Better user experience for exploration
- (+) No backend changes required (uses existing hook patterns)
- (-) Data is lost on page refresh (intentional, but may frustrate some users)
- (-) No persistence across devices
- (-) Additional complexity in hooks to support both modes

**Risks:**
- Users may not understand data is temporary
- **Mitigation**: Clear UI messaging ("Your data will be saved locally in this browser")
- Users may lose work if they forget to sign up
- **Mitigation**: Prompt to sign up when they try to persist data

**Future Considerations:**
- Could add localStorage persistence for guest mode (with clear warnings)
- Could prompt users to sign up after X actions in guest mode
- Could migrate guest data to authenticated account on signup

---

## ADR-014: Recipe Text Parser for Import

**Status:** Accepted (2026-01-16)

**Context:** Users want to quickly add recipes without manually entering each ingredient and instruction. Copy-pasting recipe text from websites, cookbooks, or notes is a common workflow, but manually parsing and entering the data is tedious.

**Decision:** Implement a client-side recipe text parser that automatically extracts recipe name, servings, ingredients, and instructions from plain text input.

**Rationale:**
- Reduces friction when adding recipes from external sources
- Supports multiple input formats (structured sections, free-form text, mixed)
- Handles common recipe text patterns (Unicode fractions, ranges, parenthetical units)
- No backend changes required - parsing happens entirely in the browser
- Users can still manually edit parsed results before saving

**Implementation:**
- Parser located in `src/lib/recipe-parser.ts`
- "Import from Text" tab in recipe dialog (`src/components/recipes/recipe-dialog.tsx`)
- Supports Unicode fractions (½, ⅓, ¼, etc.) converted to decimals
- Handles ingredient ranges (e.g., "½–1 cup")
- Extracts parenthetical unit information (e.g., "1 (28 oz) can crushed tomatoes")
- Recognizes common section headers: "Ingredients", "Instructions", "Directions", "Method", "Steps"
- Extracts servings from recipe name (e.g., "Makes 4 servings")
- Parses 20+ common unit abbreviations and variations

**Tradeoffs:**
- (+) Significantly faster recipe entry for users with text sources
- (+) No backend complexity - pure client-side parsing
- (+) Handles common formats automatically
- (-) May not parse perfectly for all recipe formats (users can still edit)
- (-) Requires maintenance as new recipe formats are encountered
- (-) Parsing logic adds ~400 lines of code

**Risks:**
- Parser may misinterpret some recipe formats
- **Mitigation**: Users can review and edit parsed results before saving
- Complex ingredient lines may not parse correctly
- **Mitigation**: Parser handles common cases; manual editing available for edge cases

**Future Considerations:**
- Could add support for more recipe formats (markdown, structured JSON)
- Could learn from user corrections to improve parsing accuracy
- Could support batch import of multiple recipes from a single text block

---

## ADR-015: Custom Shopping Categories and Category Ordering

**Status:** Accepted (2026-01-16)

**Context:** Users shop at different stores with varying layouts. The default shopping categories (produce, dairy, protein, etc.) may not match a user's store organization, and users may shop at specialty stores (e.g., Asian markets, specialty grocers) that require separate categories. Additionally, users want to reorder categories to match their store's physical layout for more efficient shopping.

**Decision:** Implement user-defined custom shopping categories and drag-and-drop category ordering to allow users to customize their shopping list organization.

**Rationale:**
- Enables users to match their shopping list to their store's layout
- Supports specialty shopping categories (e.g., "Asian Market", "Specialty Store")
- Improves shopping efficiency by organizing items in the order they appear in the store
- Custom categories integrate seamlessly with existing category override system
- Category ordering persists across shopping list generations

**Implementation:**
- `custom_categories` JSONB column in `user_config` table: `[{ "id": "uuid", "name": "Category Name", "order": number }]`
- `category_order` JSONB column in `user_config` table: `["produce", "dairy", "custom_abc123", ...]` or `null` for default order
- Custom category keys prefixed with `custom_` to avoid collisions with default categories
- Shopping Settings Modal with three tabs:
  - **Order Tab**: Drag-and-drop reordering of all categories (default + custom)
  - **Custom Tab**: Create, edit, and delete custom categories (up to 10 per user)
  - **Overrides Tab**: View and manage category overrides
- `getAllShoppingCategories()` function merges default and custom categories
- Shopping list UI respects custom ordering when `category_order` is set
- Category deletion moves affected items to "misc" category automatically

**Tradeoffs:**
- (+) Highly customizable to match any store layout
- (+) Supports specialty shopping scenarios
- (+) Improves shopping efficiency
- (+) Backward compatible (default order when `category_order` is null)
- (-) Additional complexity in shopping list rendering logic
- (-) Requires UI for category management (settings modal)
- (-) Category ordering must be maintained when categories are added/removed

**Risks:**
- Users may create too many categories, making the list cluttered
- **Mitigation**: Limit to 10 custom categories per user
- Category deletion may leave items in unexpected categories
- **Mitigation**: Automatically move items to "misc" category on deletion
- Custom ordering may become out of sync if default categories change
- **Mitigation**: Default order is preserved; custom order is additive

**Future Considerations:**
- Could support category templates for common store chains
- Could allow users to save multiple category orderings for different stores
- Could add category icons or colors for visual organization
- Could support category-based shopping list filtering