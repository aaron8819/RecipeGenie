# Recipe Genie

A cloud-hosted weekly meal planning application with automatic shopping list generation and multi-user support.

## Features

- **Recipe Management**: Store and organize your recipes by protein category
  - Manual entry, import from plain text, or import from URL (JSON-LD / HTML scraping)
  - Supports Unicode fractions, ranges, alternative ingredients ("X or Y"), and various recipe formats
  - Upload and display recipe images (JPG, PNG, WebP, max 5MB)
  - Cook mode: step-by-step fullscreen view with wake lock
  - Export recipes as JSON or plain text
- **Recipe Sharing**: Share recipes with other users by exact email; recipient gets an owned copy
- **Meal Planning**: Randomly generate weekly meal plans based on your preferences
  - Save and reload named plan templates
  - Calendar view with day assignments and swap/undo support
- **Smart Shopping Lists**: Automatically aggregate ingredients from selected recipes with drag-and-drop reordering, custom categories, and category ordering to match your store layout
- **Pantry Tracking**: Mark items you have on hand; "What Can I Make?" shows recipes you can cook now
- **Multi-User Support**: Each user has their own private data via Supabase Auth
- **Responsive UI**: Desktop header with tab navigation; mobile bottom nav; Stitch design (Outfit, Playfair, sage/terracotta palette)
- **Cloud Deployment**: Host on Vercel for access from anywhere

## Tech Stack

- **Frontend**: Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Row Level Security)
- **State**: TanStack Query (React Query)
- **UI**: Radix UI primitives with shadcn/ui styling
- **Rate limiting**: Upstash Redis (`@upstash/ratelimit`)
- **HTML parsing**: Cheerio (server-side recipe URL scraping)

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm (comes with Node.js)
- A Supabase account (free tier available at [supabase.com](https://supabase.com))

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to **SQL Editor** in the dashboard
3. Apply the canonical baseline migration: `supabase/migrations/001_baseline.sql`
4. Go to **Authentication > Providers** and ensure Email auth is enabled
5. Go to **Storage** in the dashboard and verify the `recipe-images` bucket was created
6. **(Optional)** To show default images for the 8 built-in recipes, place the default images in `web/.cursor/images/` and run: `cd web && npx tsx scripts/upload-default-recipe-images.ts` (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`)

### Schema Bootstrap Strategy

- Canonical bootstrap is baseline-first via `supabase/migrations/001_baseline.sql`.
- Historical `012+` migration files are retained as legacy records (the earlier `001-011` history is incomplete in version control and is intentionally not reconstructed).
- New schema changes must be added as incremental migrations after the baseline.

For local Supabase CLI workflows, use:

```bash
supabase start
supabase db reset
```

This should rebuild from the baseline-forward migration chain deterministically.

### 2. Configure Environment

```bash
cd web
cp .env.local.example .env.local
```

Edit `.env.local` with your Supabase credentials (found in Project Settings > API):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here  # For migration only
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Migrate Existing Data (Optional)

If you have existing recipes in `data/*.json` from the legacy Flask version:

```bash
npm run migrate
```

This imports your recipes, pantry, config, and history into Supabase.

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Testing

- **Unit tests (Vitest):** `npm run test` or `npm run test:watch`. Tests live in `src/hooks/__tests__/`, `src/lib/__tests__/`, and similar.
- **E2E tests (Playwright):** `npm run test:e2e`. Requires the dev server (`npm run dev`). Optional: run global setup once to persist auth state for authenticated E2E tests (`playwright/.auth/`). Other scripts: `test:e2e:ui`, `test:e2e:headed`, `test:e2e:debug`, `test:e2e:report`, `test:e2e:codegen`.

## Supabase Types Baseline

From `web/`, regenerate the Supabase TypeScript baseline with:

```bash
npm run db:types:regen
```

This command uses Supabase CLI project-id generation and requires `SUPABASE_ACCESS_TOKEN` (or prior `supabase login`) in your shell.
It updates `web/src/types/database.generated.ts` only.

## Deployment to Vercel

### 1. Push to GitHub

Ensure your code is in a GitHub repository.

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and import your repository
2. Set the root directory to `web`
3. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

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

1. Click "My Recipes" tab
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

1. Click "My Recipes" tab
2. Click the category settings button (⚙️) in the header
3. In the category settings modal:
   - **Add categories**: Type a name and click "Add"
   - **Edit categories**: Click the pencil icon to rename a category (all recipes with that category are automatically updated)
   - **Reorder categories**: Drag and drop categories to reorder them
   - **Delete categories**: Click the trash icon (requires reassigning recipes if the category has recipes)
   - **Reset to defaults**: Restore default categories (chicken, beef, turkey, lamb, vegetarian)
4. Category changes automatically sync with your meal planner preferences

### Generating a Meal Plan

1. Click "Meal Planner" tab
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

1. Click "Pantry" tab
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
│   │   └── page.tsx            # Main page with tabs
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
├── scripts/
│   └── migrate.ts              # JSON to Supabase migration
└── package.json
```

## Documentation

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Claude Code context — commands, conventions, architecture quick-ref |
| `project_overview.md` | 10-minute engineering orientation (architecture, data flow, adding features) |
| `changelog.md` | Recent version history (v2.8+); `changelog-archive.md` for older |
| `decisions.md` | Architectural Decision Records (ADRs 001–019) |
| `supabase/SCHEMA.md` | Database schema — tables, RLS policies, migrations, query examples |
| `docs/shopping-component.md` | Shopping list component deep-dive (architecture, data flow, testing) |
| `docs/planner-component.md` | Meal planner component deep-dive (auto-assign, date handling, templates, history) |
| `docs/recipes-component.md` | Recipes component deep-dive (CRUD, parser, URL import, cook mode, sharing) |
| `docs/pantry-component.md` | Pantry component deep-dive (items, keywords, What Can I Make?) |
| `web/tests/README.md` | E2E testing guide (Playwright setup, fixtures, debugging) |
