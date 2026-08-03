# Architectural Decisions

> **When to read:** You're making a major architectural decision, proposing a refactor, or need context on why something was built a certain way.

*Last updated: 2026-08-03*

This document captures key architectural and design decisions for Recipe Genie, including rationale and tradeoffs.

---

## ADR-001: Flask Monolith with Single-File Backend

**Status:** Superseded by ADR-010 (Next.js migration)

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

**Status:** Superseded by ADR-011 (Supabase)

**Context:** Recipe, pantry, and configuration data needs to persist between sessions.

**Decision:** Store all data in JSON files in the `data/` directory:
- `recipes.json` - Recipe collection
- `pantry.json` - Pantry inventory
- `config.json` - User preferences and excluded keywords
- `history.json` - Recipe cooking history
- `weekly-plans.json` - Saved weekly meal plans
- `shopping-list.json` - Current shopping list state

**Current disposition:** These tracked files are inactive legacy archival
material. The supported application, migration, backup, and local E2E
workflows do not read them.

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

**Status:** Superseded by ADR-010 (Next.js migration)

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

**Status:** Superseded by ADR-011 (Supabase direct client queries)

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

**Status:** Superseded by ADR-011 (Supabase RLS + Zod client-side validation)

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

**Status:** Superseded (concept carried forward into Supabase schema)

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


## ADR-013: Guest Mode / Trial Access

**Status:** Superseded — not implemented. App requires Supabase authentication. Guest mode was planned (2026-01-16) but never built; the auth-first model was retained.

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

---

## ADR-016: Supabase TypeScript Type Inference Workarounds

**Status:** Superseded (2026-07-12)

**Context:** During TypeScript compilation, Supabase client operations (`.update()`, `.insert()`) were incorrectly inferring parameter types as `never` in certain contexts, causing build failures. This occurred despite the database types being correctly defined and the operations working correctly at runtime.

**Current decision:** The repository permits zero `@ts-expect-error`
directives. Use generated database types, narrow typed adapters, or explicit
result shaping instead. `npm run check:no-new-ts-expect-error` enforces the
zero baseline and is part of `npm run verify`.

**Historical context:** The accepted 2026-01-24 workaround used explanatory
`@ts-expect-error` comments around affected Supabase operations. That approach
unblocked builds but suppressed legitimate checking and became unnecessary
after the generated-type and query-boundary cleanup. It is retained here only
to explain older changelog entries and must not be used as current guidance.

---

## ADR-017: Error Boundary for Application Resilience

**Status:** Accepted (2026-01-24)

**Context:** A single JavaScript error in any component would crash the entire application, leaving users with a blank screen and no recovery path. This creates a poor user experience and makes debugging difficult.

**Decision:** Implement a React Error Boundary component at the application root level to catch errors in the component tree and display a recovery UI instead of crashing.

**Rationale:**
- Prevents entire app crash from single component errors
- Provides user-friendly error messaging instead of blank screen
- Enables recovery without full page reload ("Try again" button)
- Shows error details in development mode for debugging
- Industry best practice for production React applications
- Low effort, high impact improvement

**Implementation:**
- Custom `ErrorBoundary` class component (React error boundaries must be class components)
- Wrapped around entire app in `providers.tsx` at root level
- Displays branded error screen with recovery options
- Logs errors to console (can be extended to error reporting service)
- Development mode shows error message for debugging

**Tradeoffs:**
- (+) Prevents app-wide crashes
- (+) Better user experience during errors
- (+) Enables graceful degradation
- (+) Foundation for future error reporting integration
- (-) Requires class component (React limitation)
- (-) Only catches errors in render/componentDidCatch, not in event handlers or async code

**Risks:**
- Error boundary itself could have bugs
- **Mitigation**: Simple, well-tested pattern; errors in boundary fall back to browser default
- Some errors may not be caught (event handlers, async operations)
- **Mitigation**: Documented limitation; future work can add try-catch in critical async paths

**Future Considerations:**
- Integrate with error reporting service (Sentry, LogRocket) in `componentDidCatch`
- Add error boundary at component level for more granular error handling
- Add retry logic for specific error types (network errors, etc.)

---

## ADR-018: Shopping Hooks Modularization

**Status:** Accepted (2026-01-24)

**Context:** The `use-shopping.ts` file had grown to 1,470 lines with 18+ exported hooks covering multiple domains (list operations, item operations, recipe operations, category operations, config operations, pantry operations). This monolithic structure made the codebase harder to maintain, test, and reason about.

**Decision:** Split `use-shopping.ts` into domain-focused modules within a `hooks/shopping/` directory, maintaining backward compatibility through a barrel export.

**Rationale:**
- Improves maintainability by separating concerns
- Makes each module easier to understand and test in isolation
- Reduces cognitive load when working on specific shopping features
- Enables parallel development on different shopping domains
- Follows single responsibility principle
- Backward compatibility ensures no breaking changes

**Implementation:**
- Created `hooks/shopping/` directory with domain-focused files:
  - `use-shopping-list.ts` - Core list operations (fetch, generate, save, clear)
  - `use-shopping-items.ts` - Item operations (add, remove, check, reorder, bulk)
  - `use-shopping-recipes.ts` - Recipe-related operations (add/remove recipe items)
  - `use-shopping-categories.ts` - Category override operations
  - `use-shopping-config.ts` - Shopping configuration operations
  - `use-shopping-pantry.ts` - Pantry integration operations
  - `index.ts` - Barrel export re-exporting all hooks
- Maintained `use-shopping.ts` as backward-compatible barrel export
- All existing imports continue to work without changes

**Tradeoffs:**
- (+) Much easier to navigate and understand specific functionality
- (+) Each module can be tested independently
- (+) Reduces merge conflicts when multiple developers work on shopping features
- (+) Better code organization follows domain boundaries
- (+) Backward compatible - no breaking changes
- (-) More files to manage (mitigated by clear organization)
- (-) Some shared logic requires careful placement (handled via `shared.ts`)

**Risks:**
- Breaking changes if barrel export not maintained correctly
- **Mitigation**: Comprehensive barrel export in `index.ts`; all hooks re-exported
- Circular dependencies if not careful
- **Mitigation**: Shared constants and helpers in dedicated `shared.ts` file

**Future Considerations:**
- Remove `use-shopping.ts` barrel export after all consumers updated (clean break)
- Further split if any module grows too large (>500 lines)
- Consider extracting business logic from hooks into separate utility files

---

## ADR-019: Supabase Client Consolidation

**Status:** Accepted (2026-01-24)

**Context:** The `getSupabase()` function was duplicated across 6 files (`use-shopping.ts`, `use-recipes.ts`, `use-planner.ts`, `use-pantry.ts`, `page.tsx`, `auth-context.tsx`). This created a maintenance burden: any changes to client initialization, error handling, or configuration required updates in multiple places.

**Decision:** Consolidate `getSupabase()` to a single source in `lib/supabase/client.ts` with singleton pattern, and update all files to import from this central location.

**Rationale:**
- Single source of truth for Supabase client initialization
- Eliminates maintenance burden of updating multiple files
- Singleton pattern ensures single client instance (better connection pooling)
- Enables centralized error handling, logging, or configuration changes
- Follows DRY (Don't Repeat Yourself) principle
- Low effort, high value refactoring

**Implementation:**
- Updated `lib/supabase/client.ts` to export `getSupabase()` function with singleton pattern
- Maintained backward compatibility by also exporting `createClient` alias
- Updated all 6 files to import: `import { getSupabase } from "@/lib/supabase/client"`
- Removed duplicate function definitions from all hook files

**Tradeoffs:**
- (+) Single source of truth for client initialization
- (+) Easier to add request logging, error handling, or configuration
- (+) Singleton pattern improves connection pooling
- (+) Reduces code duplication
- (+) No breaking changes - same function signature
- (-) None significant

**Risks:**
- Breaking changes if import path incorrect
- **Mitigation**: All imports verified; TypeScript will catch import errors
- Singleton pattern may cause issues in test environments
- **Mitigation**: Can be addressed with dependency injection if needed in future

**Future Considerations:**
- Add request logging or error tracking in `getSupabase()` if needed
- Consider adding retry logic for network failures
- Could add request/response interceptors for debugging

---

## ADR-020: Recipe Sharing (Copy-on-Accept)

**Status:** Accepted (2026-02-14, v2.14.0)

**Context:** Users want to share recipes with friends or family. Sharing must preserve recipient autonomy — edits by the sender should not affect the recipient's copy, and the sender's recipe collection should not be visible to others.

**Decision:** Implement copy-on-accept sharing: when a recipient accepts a share, a new recipe row is created in their account from an immutable snapshot captured at share-creation time. There is no live sync.

**Rationale:**
- Immutable snapshots prevent surprise changes to the recipient's recipe
- Recipient owns their copy — they can edit or delete without affecting the sender
- Simple mental model: sharing is a gift, not a subscription
- Exact-email recipient lookup avoids exposing a searchable user directory
- `accept_recipe_share()` DB function atomically creates the copy and marks the share accepted

**Implementation:**
- `recipe_shares` table: `id`, `sender_id`, `recipient_id`, `recipe_snapshot` (JSONB), `status` (pending/accepted/declined/canceled), timestamps
- `/api/recipe-shares/` routes: create, list inbox, list sent, accept, decline
- Recipient email resolved server-side via `lib/supabase/admin.ts` (service-role); anon client cannot read `auth.users`
- Share dialog: exact recipient email + optional message (max 300 chars)
- Sent tab: live status tracking per outgoing share

**Tradeoffs:**
- (+) No surprise changes — recipient's copy is truly theirs
- (+) No cross-user data dependencies after acceptance
- (+) Simple data model — no sync machinery needed
- (-) Declined/canceled shares cannot be re-sent without creating a new share
- (-) Snapshot may be stale if sender edited the recipe after sharing

---

## ADR-021: Security Hardening (CSP Nonces, Rate Limiting, SSRF Guard)

**Status:** Accepted (2026-02-14, v2.15.0)

**Context:** Three attack surfaces needed hardening before wider deployment: (1) inline scripts lacked Content Security Policy coverage, (2) the URL import endpoint had no rate limiting, (3) the URL import endpoint could be used to probe internal network addresses (SSRF).

**Decision:** Apply three targeted mitigations: CSP nonces via middleware, Upstash Redis rate limiting on the import route, and an SSRF guard that rejects private/loopback IPs.

**Implementation:**
- **CSP nonces**: `middleware.ts` generates a nonce per request, sets it on `x-nonce` request header and in the `Content-Security-Policy` response header. Root layout calls `headers()` to trigger Next.js 15's automatic nonce injection onto inline scripts. Both parts are required — nonce on request headers only, or layout headers() call only, each silently breaks the other.
- **Rate limiting**: `lib/rate-limit.ts` wraps `@upstash/ratelimit`.
  `/api/recipe-import` enforces 10 requests/minute per IP. The implementation
  reads `KV_REST_API_URL` / `KV_REST_API_TOKEN`, degrades gracefully when they
  are absent in development, and fails closed in production.
- **SSRF guard**: `lib/url-safety.ts` resolves the import URL's hostname to IP addresses and rejects private ranges (127.x, 10.x, 172.16–31.x, 192.168.x, ::1) before any fetch is made.

**Tradeoffs:**
- (+) Nonces allow `'nonce-...'` CSP without `'unsafe-inline'`
- (+) Rate limiting prevents abuse without requiring auth on the import endpoint
- (+) SSRF guard blocks lateral movement to internal services
- (-) Upstash Redis is a required production dependency for rate limiting
- (-) CSP nonce setup requires both middleware and root layout changes; missing one silently breaks scripts

---

## ADR-022: Stable Shopping Row Identity

**Status:** Accepted (2026-03-07, v2.15.1)

**Context:** Shopping list items are stored as JSON arrays inside `shopping_list.items`, `shopping_list.already_have`, and `shopping_list.excluded`. Name-based targeting had become unsafe because duplicate item names are valid and common. That caused ambiguity across UI keys, drag-and-drop ids, optimistic mutations, and server-side RPC boundaries.

**Decision:** Treat `ShoppingItem.rowId` as the stable identity contract for all shopping rows. Every shopping row must carry a persisted `rowId`, and all row-targeted mutations must resolve by `rowId` rather than by item name.

**Rationale:**
- Duplicate names must remain distinct across active, pantry, and excluded lists
- Stable ids are required for deterministic optimistic UI and pending destructive overlays
- Row-based targeting aligns client behavior with backend mutation semantics
- Persisted row ids survive refetch, invalidation, and reordering without ambiguity

**Implementation:**
- Added `web/src/lib/shopping-row-identity.ts` to enforce, backfill, and resolve row ids
- Shopping list fetch paths backfill missing legacy row ids and persist them back to `shopping_list`
- UI keys, drag-and-drop ids, reorder logic, pending destructive overlays, and row-targeted cache mutations now use `rowId`
- Restore/remove/check/category/pantry flows target rows by `rowId`
- Supabase RPCs now use row identity:
  - `toggle_shopping_item_checked(p_row_id TEXT)`
  - `move_shopping_item_to_pantry(p_row_id TEXT, p_pantry_qty NUMERIC, p_pantry_unit TEXT)`

**Tradeoffs:**
- (+) Correct behavior when duplicate item names exist
- (+) Deterministic optimistic updates and undo flows
- (+) Cleaner server/client contract for shopping mutations
- (-) Legacy rows need one-time backfill on read
- (-) Shopping JSON payloads carry one extra field per row

**Risks:**
- Older shopping rows without `rowId` are not directly targetable by row-aware RPCs until they are backfilled
- **Mitigation**: fetch-time backfill persists missing row ids on the next successful shopping list read

**Future Considerations:**
- If shopping data ever moves from JSON arrays to first-class relational rows, preserve `rowId` semantics or perform an explicit migration plan

---

## ADR-023: UUID-Authoritative Recipe Identity with Compatibility Mirrors

**Status:** Accepted (2026-07-23; records migrations 007-013)

**Context:** Recipe names and mutable text aliases were unsafe as application
identity. The staged UUID migration had to preserve historical evidence and a
compatible storage shape while active callers moved to opaque identity.

**Decision:** `recipes.recipe_uuid` is the canonical identity exposed to the
application. Active recipe creation, lookup, mutation, deletion, planner,
template, sharing, history, and shopping commands are UUID-authoritative.
`recipes.id` and the text reference arrays/JSON fields remain as derived or
validated compatibility mirrors; unresolved historical evidence may retain a
text alias with nullable UUID linkage. Migration 013 is the current active tip.

Stage 3 physical-key promotion and removal of compatibility columns, helpers,
and counters is not complete. It requires a separate reviewed migration and
rollout; current documentation must not describe those objects as removed.

**Evidence and ownership:**

- `supabase/migrations/007_add_recipe_uuid_identity.sql` through
  `013_allow_uuid_shopping_contribution_replacement.sql` define the staged
  database contract.
- `web/src/types/database.generated.ts` records the current persisted shape.
- `web/src/lib/recipe-identity.ts` maps UUID persistence fields to application
  identity and retains aliases only as compatibility metadata.
- `supabase/SCHEMA.md` owns the current schema, migration chain, compatibility
  behavior, and operational runbook.
- `docs/recipe-identity-migration.md` is historical design, audit, and rollout
  context rather than current operational authority.

---

## ADR-024: Route-Owned Primary Navigation

**Status:** Accepted (2026-08-03)

**Context:** The primary features were kept mounted as client-selected panes on
`/`. That made the URL, browser history, scroll ownership, and screen lifecycle
depend on duplicated client persistence and custom reconciliation logic.

**Decision:** Recipes, Planner, Pantry, and Shopping own `/recipes`, `/planner`,
`/pantry`, and `/shopping` under one authenticated App Router layout. `/`
redirects to `/recipes`. Recipe browse state and planner week are canonical URL
query parameters. Recipe details use `/recipes/[id]` with an optional bounded
`from` hint; known sources return through history and direct links replace to
`/recipes`.

**Consequences:**

- Only the active feature screen mounts and owns its queries.
- Back, Forward, refresh, direct links, and copied URLs preserve supported view
  state without local storage, session storage, cookies, or origin tokens.
- The document owns scrolling; route transitions replace the old kept-mounted
  pane and pane-scroll helpers.
- Shared auth, onboarding, header, and bottom navigation stay centralized in
  the authenticated layout.
