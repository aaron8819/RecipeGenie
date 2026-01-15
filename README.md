# Recipe Genie

A cloud-hosted weekly meal planning application with automatic shopping list generation and multi-user support.

## Features

- **Recipe Management**: Store and organize your recipes by protein category
- **Meal Planning**: Randomly generate weekly meal plans based on your preferences
- **Smart Shopping Lists**: Automatically aggregate ingredients from selected recipes
- **Pantry Tracking**: Mark items you have on hand to get only what you need to buy
- **Multi-User Support**: Each user has their own private data via Supabase Auth
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
3. Copy the contents of `supabase/migrations/001_initial_schema.sql` and run it
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
- Add your Vercel URL to **Site URL**
- Add `https://your-app.vercel.app/**` to **Redirect URLs**

## Usage

### Adding Recipes

1. Click "My Recipes" tab
2. Click "Add Recipe" button
3. Fill in the recipe details:
   - Name
   - Category (chicken, turkey, steak, etc.)
   - Servings
   - Ingredients (item, amount, unit)
   - Instructions
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
