# Recipe Genie

A cloud-hosted weekly meal planning application with automatic shopping list generation and multi-user support.

## Features

- **Recipe Management**: Store and organize your recipes by protein category
  - Manual entry, import from plain text, or import from URL (JSON-LD / HTML scraping)
  - Supports Unicode fractions, ranges, alternative ingredients ("X or Y"), and various recipe formats
  - Upload and display recipe images (JPG, PNG, WebP, max 5MB)
  - Recipe detail dialog with ingredients, instructions, notes, and cooking follow-up actions
  - Export recipes as JSON or plain text
- **Recipe Sharing**: Share recipes with other users by exact email; recipient gets an owned copy
- **Meal Planning**: Randomly generate weekly meal plans based on your preferences
  - Save and reload named plan templates
  - Calendar view with day assignments and swap/undo support
- **Smart Shopping Lists**: Automatically aggregate ingredients from selected recipes with drag-and-drop reordering, custom categories, and category ordering to match your store layout
- **Pantry Tracking**: Mark items you have on hand so matching recipe ingredients are classified as already available in Shopping
- **Multi-User Support**: Each user has their own private data via Supabase Auth
- **Responsive UI**: Desktop header and mobile bottom navigation use shareable routes; Stitch design (Outfit, Playfair, sage/terracotta palette)
- **Cloud Deployment**: Host on Vercel for access from anywhere

## Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Row Level Security)
- **State**: TanStack Query (React Query)
- **UI**: Radix UI primitives with shadcn/ui styling
- **Rate limiting**: Upstash Redis (`@upstash/ratelimit`)
- **HTML parsing**: Cheerio (server-side recipe URL scraping)

For verification and release commands, use the existing
[developer workflow guide](docs/developer-workflow.md).

## Start developing

Read [AGENTS.md](AGENTS.md), then the
[normal task path](docs/developer-workflow.md#normal-task-path) for setup,
focused checks, early drafts, hosted acceptance and release commands. Work from
an isolated cloud task by default when that is the authorized environment.
Runtime and dependency pins live in `web/.nvmrc`, `web/package.json` and the lockfile.
No production account, copied credentials or local database is needed for routine
editing and credential-free checks.

Use [the E2E guide](web/tests/README.md) for development-mode browser diagnostics,
[local auth fixtures](web/tests/LOCAL_AUTH_BROWSER.md) for explicitly selected local
inspection, and [operational verification](docs/operational-verification.md) for
read-only production checks. These specialist paths do not add default gates.

### Schema bootstrap and operations

Canonical bootstrap is baseline-first and applies every tracked file in
`supabase/migrations/`, currently `001_baseline.sql` through
`033_fix_recipe_quantity_rational_comparison.sql`. The
[schema/migration runbook](supabase/SCHEMA.md) owns setup, local reset, type
regeneration, preflight and authorized remote changes. Never apply the baseline
alone, rewrite the migration chain, or treat a pending-migration preflight option
as permission to push. Pre-baseline migrations under
`supabase/migrations/archive/2026-03-09-pre-028-squash/` are historical only.

For a separately authorized new installation, use the schema runbook to create
the full schema, enable Email auth and verify the `recipe-images` bucket. App
configuration is documented in `web/.env.example`; keep copies ignored and
service-role credentials server-only. Default recipe-image uploads remain an
optional specialist operation (`upload:default-recipe-images`) using images in
`web/.cursor/images/` and an authorized server-side credential.

## Deployment to Vercel

### 1. Push to GitHub

Ensure your code is in a GitHub repository.

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and import your repository
2. Set the root directory to `web`
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only recipe-sharing administration)
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN` (production rate limiting)

### 3. Configure Auth Redirect URLs

In Supabase Dashboard > Authentication > URL Configuration:
- Add your Vercel URL to **Site URL** (e.g., `https://your-app.vercel.app`)
- Add `https://your-app.vercel.app/auth/callback` to **Redirect URLs**

**For local development**, also add:
- `http://localhost:3000/auth/callback` to **Redirect URLs**

The app includes an auth callback route at `/auth/callback` that handles email confirmation links.

**Troubleshooting Email Confirmation:**
- If you see "Email link is invalid or has expired" errors, the confirmation link may have been:
  - Expired (links expire after 1 hour by default)
  - Pre-fetched by email clients or security scanners (which invalidates the link)
  - Already used
- To fix: Request a new confirmation email or check Supabase Auth logs for details
- Ensure the redirect URL is exactly `https://your-app.vercel.app/auth/callback` (no trailing slash)

## Usage

### Adding Recipes

1. Open **Recipes** (`/recipes`)
2. Click "Add Recipe" button
3. Choose entry method:
   - **Manual Entry**: Fill in recipe details manually (name, category, servings, ingredients, instructions)
   - **Import from Text**: Paste a recipe in plain text format and let the parser extract the details automatically
     - Supports structured formats with "Ingredients:" and "Instructions:" headers
     - Handles Unicode fractions (½, ⅓, ¼, etc.) and converts to decimals
     - Automatically extracts servings from recipe name (e.g., "Makes 4 servings")
     - Parses ingredient amounts, units, and item names
     - Supports ranges (e.g., "½–1 cup") and parenthetical units (e.g., "1 (28 oz) can")
     - Recognizes common section headers: "Ingredients", "Instructions", "Directions", "Method", "Steps"
4. Click "Save Recipe"

**Quick Actions from Recipe Cards:**
- Click the shopping cart icon (🛒) to add a recipe's ingredients directly to your shopping list
- Click the calendar icon (📅) to add a recipe to your meal plan
- Click any recipe card to view full recipe details

### Managing Recipe Categories

1. Open **Recipes** (`/recipes`)
2. Click the category settings button (⚙️) in the header
3. In the category settings modal:
   - **Add categories**: Type a name and click "Add"
   - **Edit categories**: Click the pencil icon to rename a category (all recipes with that category are automatically updated)
   - **Reorder categories**: Drag and drop categories to reorder them
   - **Delete categories**: Click the trash icon (requires reassigning recipes if the category has recipes)
   - **Reset to defaults**: Restore default categories (chicken, beef, turkey, lamb, vegetarian)
4. Category changes automatically sync with your meal planner preferences

### Generating a Meal Plan

1. Open **Planner** (`/planner`)
2. Set the number of recipes you want for each category
3. Click "Generate Meal Plan"
4. Review your randomly selected recipes
5. Click "View Shopping List" to see aggregated ingredients

**Plan Settings:**
- Click the settings button (⚙️) next to the "Generate Meal Plan" button to configure:
  - **Default Category Breakdown**: Set your preferred meal distribution (saved as default for future plans)
    - Use category pills to set counts for each category
    - Save current selection as default or load saved defaults
    - Default selection automatically loads when generating new plans
  - **Day Placement Rules**: 
    - **Excluded Days**: Exclude specific days from meal placement (e.g., skip weekends)
    - **Preferred Days**: Set preferred days for meal placement (recipes prioritized to these days)
    - **Auto-assign Days**: Toggle automatic day assignment (recipes automatically assigned to days when generating plans)
    - Visual day selector with conflict detection (warns if more meals than available days)
  - **History Exclusion Days**: Control how many days back to exclude recently-made recipes

### Managing Your Pantry

1. Open **Pantry** (`/pantry`)
2. Add items you currently have on hand
3. Configure excluded keywords (staples like "oil", "salt")
4. These items will be automatically excluded from your shopping list

### Viewing Shopping List

After generating a meal plan, the shopping list shows:
- **Items to Buy**: Ingredients needed that aren't in your pantry
- **Pantry**: Items that were attempted to be added but already exist in your pantry (clickable to add back)
- **Excluded**: Items matching your excluded keywords (staples) - shows matching keyword for clarity

**Shopping List Features:**
- **Check off items**: Toggle checked state while shopping (items stay in list, show as checked with strikethrough)
- **Category auto-collapse**: Categories automatically collapse when all items are checked
- **Complete Shopping**: Button appears when all items are checked - clears list for clean slate
- **Pantry integration**: Add items to pantry directly from shopping list (removes from list)
- **Recipe tag navigation**: Click recipe source tags to view recipe details and edit recipes
- **Add recipes directly**: Use the shopping cart icon on any recipe card to add its ingredients to your shopping list
- Drag and drop to reorder items manually
- Add items manually to your list
- Add meal plan ingredients to existing lists (merges quantities)
- Category-based organization with custom category overrides
- **Custom shopping categories**: Create your own categories (e.g., "Asian Market", "Specialty Store")
- **Category ordering**: Drag-and-drop reordering to match your store layout
- **Shopping settings modal**: Manage categories, ordering, and overrides in one place
- Copy shopping list to clipboard
- Checked states persist across page refreshes

## Project Structure

```
web/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root layout with providers
│   │   ├── page.tsx            # Redirects authenticated entry to /recipes
│   │   └── (authenticated)/    # Shared shell and route-owned screens
│   ├── components/
│   │   ├── ui/                 # Radix UI components
│   │   ├── layout/             # Header, bottom nav, onboarding
│   │   ├── recipes/            # Recipe views & dialogs
│   │   ├── planner/            # Meal planner
│   │   ├── pantry/             # Pantry management
│   │   └── shopping/           # Shopping list
│   ├── hooks/                  # TanStack Query hooks
│   ├── lib/
│   │   └── supabase/           # Supabase clients
│   └── types/                  # TypeScript types
├── scripts/                    # Local workflow and maintenance commands
└── package.json
```

## Documentation

[`docs/DOCS_INDEX.md`](docs/DOCS_INDEX.md) is the complete documentation map.
Ownership is intentionally split:

| File | Authority |
|------|-----------|
| `AGENTS.md` | Agent guidance, repository conventions, authorization boundaries, and handoff |
| `README.md` | Human onboarding, local setup, feature overview, and links to specialist guidance |
| `docs/project_overview.md` | Current architecture layers and ownership boundaries |
| `supabase/SCHEMA.md` | Current database schema, active migration chain, compatibility state, and migration runbook |
| `decisions.md` | Durable architectural decisions and clearly labeled superseded decisions |
| `docs/*-component.md` | Feature-specific behavior, boundaries, and focused verification |
| `web/tests/README.md` | Playwright/E2E commands, target guards, fixtures, and authentication-state lifecycle |
| `changelog.md` | Complete release history |
