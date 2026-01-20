# Recipe Genie

A cloud-hosted weekly meal planning application with automatic shopping list generation and multi-user support.

## Features

- **Recipe Management**: Store and organize your recipes by protein category
  - Manual entry or import from plain text with automatic parsing
  - Supports Unicode fractions, ranges, and various recipe formats
- **Meal Planning**: Randomly generate weekly meal plans based on your preferences
- **Smart Shopping Lists**: Automatically aggregate ingredients from selected recipes with drag-and-drop reordering, custom categories, and category ordering to match your store layout
- **Pantry Tracking**: Mark items you have on hand to get only what you need to buy
- **Multi-User Support**: Each user has their own private data via Supabase Auth
- **Guest Mode**: Try the app without signing up (data stored in browser session)
- **Cloud Deployment**: Host on Vercel for access from anywhere

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Row Level Security)
- **State**: TanStack Query (React Query)
- **UI**: Radix UI primitives with shadcn/ui styling

## Quick Start

### Prerequisites

- Node.js 18 or higher
- npm (comes with Node.js)
- A Supabase account (free tier available at [supabase.com](https://supabase.com))

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to **SQL Editor** in the dashboard
3. Run all migration files in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_add_category_overrides.sql`
   - `supabase/migrations/003_add_made_recipe_ids.sql`
   - `supabase/migrations/004_merge_steak_into_beef.sql`
   - `supabase/migrations/005_multi_user_support.sql`
   - `supabase/migrations/006_fix_signup_trigger.sql`
   - `supabase/migrations/007_custom_categories.sql`
4. Go to **Authentication > Providers** and ensure Email auth is enabled

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

### Generating a Meal Plan

1. Click "Meal Planner" tab
2. Set the number of recipes you want for each category
3. Click "Generate Meal Plan"
4. Review your randomly selected recipes
5. Click "View Shopping List" to see aggregated ingredients

### Managing Your Pantry

1. Click "Pantry" tab
2. Add items you currently have on hand
3. Configure excluded keywords (staples like "oil", "salt")
4. These items will be automatically excluded from your shopping list

### Viewing Shopping List

After generating a meal plan, the shopping list shows:
- **Items to Buy**: Ingredients needed that aren't in your pantry
- **Already Have**: Ingredients from your pantry used in selected recipes
- **Excluded**: Items matching your excluded keywords (staples)

**Shopping List Features:**
- Drag and drop to reorder items manually
- Add items manually to your list
- Check off items as you shop (moves to "Already Have")
- Add meal plan ingredients to existing lists (merges quantities)
- Category-based organization with custom category overrides
- **Custom shopping categories**: Create your own categories (e.g., "Asian Market", "Specialty Store")
- **Category ordering**: Drag-and-drop reordering to match your store layout
- **Shopping settings modal**: Manage categories, ordering, and overrides in one place
- Copy shopping list to clipboard

## Project Structure

```
web/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root layout with providers
│   │   └── page.tsx            # Main page with tabs
│   ├── components/
│   │   ├── ui/                 # Radix UI components
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

- `project_overview.md` - Architecture and 10-min orientation
- `changelog.md` - Version history
- `decisions.md` - Architectural decision records (ADRs)
