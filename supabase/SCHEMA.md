# Recipe Genie - Supabase Database Schema Documentation

> **When to read:** You're adding/modifying tables, columns, indexes, RLS policies, triggers, migrations, or storage buckets.

*Last updated: 2026-03-10 (v2.17.0)*

This document describes the complete database schema for the Recipe Genie application.

## Table of Contents

- [Overview](#overview)
- [Tables](#tables)
  - [recipes](#recipes)
  - [pantry_items](#pantry_items)
  - [user_config](#user_config)
  - [recipe_history](#recipe_history)
  - [weekly_plans](#weekly_plans)
  - [shopping_list](#shopping_list)
  - [recipe_shares](#recipe_shares)
- [Storage Buckets](#storage-buckets)
  - [recipe-images](#recipe-images)
- [Indexes](#indexes)
- [Row Level Security (RLS)](#row-level-security-rls)
- [Functions](#functions)
- [Triggers](#triggers)
- [Relationships](#relationships)
- [Migration Workflow Runbook](#migration-workflow-runbook)

## Overview

The Recipe Genie database is designed for multi-user support with complete data isolation between users. All tables include a `user_id` column that references `auth.users(id)`, and Row Level Security (RLS) policies ensure users can only access their own data.

### Baseline-First Migration Strategy

- Canonical bootstrap migration: `supabase/migrations/001_baseline.sql`
- Canonical baseline includes all stable schema changes through the pantry row-id update previously developed as `028_pantry_item_ids.sql`.
- Archived historical migrations live under `supabase/migrations/archive/2026-03-09-pre-028-squash/`.
- Archived migrations are kept for audit/history but are no longer the source of truth for fresh environments.
- New migrations must be created incrementally on top of the baseline schema.

### Current Active Migration Chain

- `supabase/migrations/001_baseline.sql`
- `supabase/migrations/002_recipe_structure_parity.sql`
- `supabase/migrations/003_shopping_item_order_preferences.sql`

### Recent Drift Root Cause

The recent `supabase db push` failure was caused by migration history drift, not by a bad SQL migration:

- The repository's active chain was rewritten to start from the squashed `001_baseline.sql`.
- The linked remote still had pre-squash migration history entries recorded for older incremental files such as `012` through `028`.
- `supabase db push` compares local migration history to the remote migration history table before applying new SQL.
- Because local history only exposed `001` and `002`, while the remote still reported stale pre-squash entries, the CLI treated the histories as divergent and refused to continue.
- Repairing those stale remote history entries to `reverted`, then rerunning `supabase db push`, aligned the migration ledger with the intentionally squashed repo state.

The schema supports:
- Recipe storage with ingredients, instructions, grouped instructions, notes, and images
- Pantry item management
- User configuration and preferences
- Recipe history tracking
- Weekly meal planning
- Shopping list generation
- Recipe sharing requests and recipient acceptance
- Image storage via Supabase Storage

## Tables

### recipes

Stores all recipe information including ingredients, instructions, and metadata.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Unique recipe identifier |
| `user_id` | UUID | FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the recipe |
| `name` | TEXT | NOT NULL | Recipe name |
| `category` | TEXT | NOT NULL | Recipe category (e.g., 'chicken', 'beef', 'turkey', 'lamb', 'vegetarian') |
| `servings` | INTEGER | NOT NULL, DEFAULT 4 | Number of servings |
| `favorite` | BOOLEAN | DEFAULT FALSE | Whether recipe is marked as favorite |
| `tags` | TEXT[] | DEFAULT '{}' | Array of tags for the recipe |
| `prep_time_minutes` | INTEGER | NULL | Optional prep time in minutes |
| `cook_time_minutes` | INTEGER | NULL | Optional cook time in minutes |
| `total_time_minutes` | INTEGER | NULL | Optional total time in minutes |
| `ingredients` | JSONB | NOT NULL, DEFAULT '[]' | Array of ingredient objects — see structure below |
| `instructions` | TEXT[] | NOT NULL, DEFAULT '{}' | Array of instruction steps |
| `notes` | JSONB | NOT NULL, DEFAULT '[]' | Array of recipe note strings |
| `instruction_groups` | JSONB | NULL | Array of grouped instruction objects for higher-fidelity imported recipes |
| `image_url` | TEXT | NULL | URL or path to recipe image (Supabase Storage path or external URL) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when recipe was created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when recipe was last updated |

**Ingredient JSONB structure:**
```json
[
  {
    "item": "chicken thighs",
    "unit": "lbs",
    "amount": 1.5,
    "modifier": "bone-in",
    "alternatives": [],
    "originalText": "1.5 lbs bone-in chicken thighs"
  },
  {
    "item": "Greek yogurt (or sour cream)",
    "unit": "cup",
    "amount": 0.5,
    "alternatives": ["sour cream"],
    "originalText": "½ cup Greek yogurt or sour cream"
  }
]
```

All fields except `item`, `unit`, and `amount` are optional. `modifier` is a post-comma descriptor (e.g., "rinsed", "chopped"). `alternatives` are parsed from "X or Y" patterns; `item` stores the display string including the parenthetical "(or Y)". `originalText` captures the raw unparsed line for reference.

**Instruction group JSONB structure:**
```json
[
  {
    "label": "Pan Sauce",
    "steps": [
      "Lower heat to medium.",
      "Add stock and scrape the pan."
    ]
  }
]
```

`instruction_groups` is additive. `instructions` remains persisted for backward compatibility, simple textarea editing, and consumers that still expect a flat step list.

### pantry_items

Stores items in the user's pantry.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Stable pantry row identity |
| `item` | TEXT | NOT NULL | Pantry item name |
| `user_id` | UUID | FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the pantry item |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when item was added |

**Note:** Pantry rows now use `id` as the primary key while preserving logical uniqueness with a unique constraint on `(user_id, item)`.

### user_config

Stores user-specific configuration and preferences.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the config |
| `categories` | TEXT[] | DEFAULT ARRAY['chicken', 'beef', 'turkey', 'lamb', 'vegetarian'] | Available recipe categories |
| `default_selection` | JSONB | DEFAULT '{"chicken": 2, "beef": 1, "turkey": 1, "lamb": 1, "vegetarian": 1}' | Default number of recipes per category for meal planning |
| `excluded_keywords` | TEXT[] | DEFAULT '{}' | Keywords to exclude from recipe suggestions |
| `history_exclusion_days` | INTEGER | DEFAULT 7 | Number of days to exclude recently made recipes |
| `week_start_day` | INTEGER | DEFAULT 1 | Day of week that starts the meal plan (1 = Monday) |
| `onboarding_completed_at` | TIMESTAMPTZ | DEFAULT NULL | Timestamp when the user completed onboarding |
| `category_overrides` | JSONB | DEFAULT '{}' | User-defined category overrides for shopping list items (maps item names to category keys) |
| `custom_categories` | JSONB | DEFAULT '[]' | User-defined shopping categories: `[{ "id": "uuid", "name": "Category Name", "order": number }]` |
| `category_order` | JSONB | DEFAULT NULL | Custom order for all categories (array of category keys), null uses default order |
| `shopping_item_order` | JSONB | DEFAULT '{}' | User-learned item order within shopping categories (maps category keys to ordered normalized item names) |
| `excluded_days` | INTEGER[] | DEFAULT '{}' | Day indices (0-6) to exclude from meal placement. 0=Sunday, 1=Monday, etc. |
| `preferred_days` | INTEGER[] | DEFAULT NULL | Preferred day indices (0-6) for meal placement, or null for no preference |
| `auto_assign_days` | BOOLEAN | DEFAULT TRUE | Whether to automatically assign days to recipes when generating a meal plan |

Canonical default planner categories are: `chicken`, `beef`, `turkey`, `lamb`, `vegetarian`.
Legacy default `steak` values are normalized to `beef` by migration `026_normalize_legacy_steak_defaults.sql`.

**Example category_overrides JSONB:**
```json
{
  "sun dried tomatoes": "pantry",
  "olive oil": "pantry"
}
```

**Example custom_categories JSONB:**
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Asian Market",
    "order": 9
  },
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "name": "Specialty Store",
    "order": 10
  }
]
```

**Example category_order JSONB:**
```json
["produce", "dairy", "protein", "custom_550e8400-e29b-41d4-a716-446655440000", "pantry", "frozen"]
```

**Example shopping_item_order JSONB:**
```json
{
  "produce": ["blueberries", "guacamole", "pico de gallo", "basil", "mushrooms", "lemon", "lime", "avocado", "tomato", "pepper", "onion", "garlic", "potato", "cilantro", "parsley", "cucumber", "banana"]
}
```

### recipe_history

Tracks when recipes were made by users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing history entry ID |
| `recipe_id` | TEXT | FOREIGN KEY → `recipes(id)` ON DELETE CASCADE | Reference to the recipe |
| `user_id` | UUID | FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the history entry |
| `date_made` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Date and time when recipe was made |

**Retention note:** `recipe_history.recipe_id` is intentionally stored as a plain text identifier rather than an enforced foreign key so history survives recipe deletion.

### weekly_plans

Stores weekly meal plans for users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY (composite with week_date), FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the plan |
| `week_date` | DATE | PRIMARY KEY (composite with user_id) | Start date of the week (typically Monday) |
| `recipe_ids` | TEXT[] | NOT NULL, DEFAULT '{}' | Array of recipe IDs in the plan |
| `day_assignments` | JSONB | DEFAULT '{}' | Maps recipe_id to day_index (0-6) for the week. Example: `{"recipe-1": 0, "recipe-2": 3}` where 0 = Sunday, 1 = Monday, etc. |
| `scale` | NUMERIC | DEFAULT 1.0 | Scaling factor for recipe servings |
| `made_recipe_ids` | TEXT[] | DEFAULT '{}' | Recipe IDs marked as "made" for this specific week (for toggle state) |
| `generated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when plan was generated |

**Example day_assignments JSONB:**
```json
{
  "recipe-1": 0,
  "recipe-2": 3,
  "recipe-3": 5
}
```
This assigns recipe-1 to Sunday (0), recipe-2 to Wednesday (3), and recipe-3 to Friday (5).

**Note:** The primary key is a composite of `(user_id, week_date)` enforced by a unique index.

### shopping_list

Stores the user's shopping list state.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the shopping list |
| `items` | JSONB | DEFAULT '[]' | Array of shopping list items |
| `already_have` | JSONB | DEFAULT '[]' | Items marked as already owned |
| `excluded` | JSONB | DEFAULT '[]' | Items excluded from the list |
| `source_recipes` | TEXT[] | DEFAULT '{}' | Recipe IDs that generated this shopping list |
| `scale` | NUMERIC | DEFAULT 1.0 | Scaling factor applied to the list |
| `total_servings` | INTEGER | DEFAULT 0 | Total number of servings across all recipes |
| `custom_order` | BOOLEAN | DEFAULT FALSE | Whether the list has been manually reordered (disables auto-sorting) |
| `contribution_revision` | BIGINT | NOT NULL, DEFAULT 0 | Compare-and-swap revision for recipe contribution projection writes |
| `contribution_overrides` | JSONB | NOT NULL, DEFAULT '{}' | Manual quantity, presentation, ordering, and lifecycle overrides |
| `legacy_items_preserved` | BOOLEAN | NOT NULL, DEFAULT TRUE | Whether ambiguous pre-contribution JSON is conservatively retained |
| `generated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when list was generated |

**Shopping item JSONB structure:**
```json
[
  {
    "rowId": "01HV6Q2G7M9X3J7N8K4S5T6U7V",
    "item": "garlic",
    "amount": 2,
    "unit": "clove",
    "categoryKey": "produce",
    "categoryOrder": 1,
    "checked": false,
    "sources": [{ "recipeName": "Chicken Stir Fry" }]
  }
]
```

`rowId` is the stable identity contract for shopping rows across `items`,
`already_have`, and `excluded`. Client mutations, drag-and-drop ids, and
server RPCs must target rows by `rowId`, not by item name.
Every `shopping_list` update advances `contribution_revision` unless the
authoritative command already supplied the next revision. This makes
concurrent manual edits visible to the command's compare-and-swap retry.

### shopping_recipe_contributions

Stores the authoritative frozen quantitative snapshot for each active recipe
contribution. The primary key `(user_id, recipe_id)` makes same-recipe adds
replaceable and idempotent. `shopping_list` is the compatibility projection.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY, FOREIGN KEY â†’ `auth.users(id)` | Contribution owner |
| `recipe_id` | TEXT | PRIMARY KEY, FOREIGN KEY â†’ `recipes(id)` | Stable recipe contribution identity |
| `servings` | INTEGER | NOT NULL, > 0 | Frozen effective servings |
| `scale` | NUMERIC | NOT NULL, > 0 | Frozen scale used during generation |
| `normalization_version` | INTEGER | NOT NULL, > 0 | Generation/normalization contract version |
| `snapshot` | JSONB | NOT NULL object | Frozen generated contribution items and recipe display snapshot |
| `idempotency_key` | TEXT | NOT NULL | Last command identity that wrote the row |
| `created_at` | TIMESTAMPTZ | NOT NULL | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last replacement timestamp |

### recipe_shares

Stores cross-user recipe share requests and response state. Sharing is
copy-on-accept: recipient receives an independent recipe copy.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Share request ID |
| `sender_user_id` | UUID | NOT NULL, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | User sending the share |
| `sender_email` | TEXT | NOT NULL | Sender email snapshot for display/audit |
| `recipient_user_id` | UUID | NOT NULL, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | User receiving the share |
| `recipient_email` | TEXT | NOT NULL | Recipient email entered by sender |
| `source_recipe_id` | TEXT | NOT NULL | Sender-owned recipe ID at time of sharing |
| `source_recipe_snapshot` | JSONB | NOT NULL | Recipe content snapshot used to materialize recipient copy |
| `message` | TEXT | NULL, `char_length(message) <= 300` | Optional sender note |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'`, CHECK in (`pending`, `accepted`, `declined`, `canceled`) | Share lifecycle state |
| `accepted_recipe_id` | TEXT | NULL | Recipient recipe ID created on accept |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Share creation timestamp |
| `responded_at` | TIMESTAMPTZ | NULL | When recipient accepted/declined or sender canceled |

### plan_templates

Stores reusable meal plan templates for quick loading.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Template ID |
| `user_id` | UUID | NOT NULL, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the template |
| `name` | TEXT | NOT NULL | User-assigned template name |
| `recipe_ids` | TEXT[] | NOT NULL, DEFAULT '{}' | Recipe IDs in the template |
| `day_assignments` | JSONB | DEFAULT NULL | Map of recipe_id → day-of-week (0=Sun..6=Sat) |
| `category_selection` | JSONB | DEFAULT NULL | Category selection counts used to generate the plan |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | When the template was created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | When the template was last updated |

## Storage Buckets

### recipe-images

Public storage bucket for recipe images. Images are organized by user ID in folders.

**Bucket ID:** `recipe-images`

**Public Access:** Yes (read-only for public, full access for authenticated users)

**File Structure:** `{user_id}/{recipe_id}.{ext}`

**RLS Policies:**
- **Upload**: Users can only upload images to their own folder (`{user_id}/`)
- **View**: Users can view their own images; public read access is also enabled
- **Update**: Users can update their own images
- **Delete**: Users can delete their own images

**Supported Formats:** JPEG, JPG, PNG, WebP

**Max File Size:** 5MB (enforced client-side)

**Image Optimization:** Images are automatically compressed/resized to max 2000px width on upload if they exceed 1MB.

## Indexes

### recipes
- `idx_recipes_category` - Index on `category` for filtering by category
- `idx_recipes_favorite` - Partial index on `favorite` WHERE `favorite = TRUE` for quick favorite queries
- `idx_recipes_user_id` - Index on `user_id` for user-specific queries
- `idx_recipes_has_image` - Partial index on `image_url` WHERE `image_url IS NOT NULL` for recipes with images

### pantry_items
- `idx_pantry_items_user_id` - Index on `user_id` for user-specific queries
- `idx_pantry_items_user_id_item` - Index on `(user_id, item)` for pantry lookup and uniqueness enforcement

### user_config
- `idx_user_config_user_id` - Index on `user_id` for user-specific queries
- `idx_user_config_unique_user` - Unique index on `user_id` to ensure one config per user

### recipe_history
- `idx_history_recipe` - Index on `recipe_id` for recipe-specific history queries
- `idx_history_date` - Index on `date_made DESC` for chronological queries
- `idx_recipe_history_user_id` - Index on `user_id` for user-specific queries

### weekly_plans
- `idx_weekly_plans_user_id` - Index on `user_id` for user-specific queries
- `idx_weekly_plans_user_date` - Unique index on `(user_id, week_date)` for composite primary key

### shopping_list
- `idx_shopping_list_user_id` - Index on `user_id` for user-specific queries
- `idx_shopping_list_unique_user` - Unique index on `user_id` to ensure one list per user

### plan_templates
- `idx_plan_templates_user_id` - Index on `user_id` for user-specific queries

### recipe_shares
- `idx_recipe_shares_recipient_status_created` - Index on `(recipient_user_id, status, created_at DESC)` for inbox queries
- `idx_recipe_shares_sender_created` - Index on `(sender_user_id, created_at DESC)` for sent queries
- `idx_recipe_shares_pending_dedupe` - Partial unique index on `(sender_user_id, recipient_user_id, source_recipe_id)` WHERE `status = 'pending'`

## Row Level Security (RLS)

All tables have RLS enabled with user-specific policies that ensure users can only access their own data.

### Policies

All tables use the same pattern: users can only access rows where `auth.uid() = user_id`.

- **recipes**: `users_own_recipes` - Users can only access their own recipes
- **pantry_items**: `users_own_pantry` - Users can only access their own pantry items
- **user_config**: `users_own_config` - Users can only access their own config
- **recipe_history**: `users_own_history` - Users can only access their own history
- **weekly_plans**: `users_own_plans` - Users can only access their own plans
- **shopping_list**: `users_own_shopping` - Users can only access their own shopping list
- **recipe_shares**:
  - `users_own_recipe_shares_select` - Sender or recipient can read share rows
  - `users_create_recipe_shares` - Sender can insert rows with `sender_user_id = auth.uid()`
  - `recipients_respond_recipe_shares` - Recipient can move `pending` → `accepted/declined`
  - `senders_cancel_recipe_shares` - Sender can move `pending` → `canceled`

All policies use `FOR ALL` operations (SELECT, INSERT, UPDATE, DELETE) with:
- `USING (auth.uid() = user_id)` - For SELECT operations
- `WITH CHECK (auth.uid() = user_id)` - For INSERT/UPDATE operations

## Functions

### update_updated_at_column()

Automatically updates the `updated_at` timestamp when a row is modified.

**Returns:** `TRIGGER`

**Language:** `plpgsql`

**Usage:** Used by trigger on `recipes` table.

### handle_new_user()

Trusted `auth.users` insert trigger that creates the new account's `user_config`,
empty `shopping_list`, and three starter recipes. The target identity comes only
from `NEW.id`; there is no caller-selectable default-seeding RPC.

**Returns:** `TRIGGER`

**Language:** `plpgsql SECURITY DEFINER`

**Security:** Runs with elevated privileges, an empty `search_path`, a guard that
requires the `auth.users` insert trigger context, and no Data API execution grants.

**Error Handling:** Wraps recipe insertion in a BEGIN/EXCEPTION block to log errors as warnings without failing the user creation transaction.

### set_default_recipe_images()

Trigger function that sets a default storage path for recipe images when a new recipe is inserted with null/empty `image_url`. Matches the 8 default recipe slugs (e.g. `mac-and-cheese`, `beef-and-broccoli`); supports recipe IDs with UUID suffix (e.g. `mac-and-cheese-550e8400-e29b-41d4-a716-446655440000`) by stripping the suffix before matching.

**Returns:** `TRIGGER`

**Language:** `plpgsql`

**Usage:** BEFORE INSERT on `recipes`; sets `NEW.image_url` to path like `defaults/mac-and-cheese.webp`. Client resolves paths to public URLs via `getRecipeImageUrl()`.

### accept_recipe_share(p_share_id UUID)

Materializes a shared recipe snapshot into the recipient's `recipes` table and
marks the share as accepted. Function is idempotent and returns existing
`accepted_recipe_id` if called again after acceptance.

The accepted snapshot now includes recipe times, notes, and `instruction_groups`
alongside the legacy flat `instructions` payload.

**Parameters:**
- `p_share_id` (UUID) - Share request ID

**Returns:** `TEXT` (`accepted_recipe_id`)

**Language:** `plpgsql SECURITY DEFINER`

**Security:** Uses `auth.uid()` as the recipient identity, has an empty
`search_path`, and is executable only by `authenticated`.

### get_recipe_history_stats()

Returns per-recipe aggregate history for UI surfaces that only need counts and the most recent cook date.

**Returns:** `TABLE(recipe_id TEXT, times_made INTEGER, last_made TIMESTAMPTZ)`

**Language:** `plpgsql STABLE SECURITY INVOKER`

**Security:** Derives the owner from `auth.uid()`, rejects unauthenticated
execution, and remains subject to table RLS.

### Tag RPCs

`filter_recipes_by_tags(p_tags TEXT[])`, `rename_tag(p_old_tag TEXT, p_new_tag
TEXT)`, `merge_tags(p_source_tag TEXT, p_target_tag TEXT)`, and
`delete_tag(p_tag TEXT)` derive identity from `auth.uid()`. They are
`SECURITY INVOKER` functions with empty `search_path`, table RLS enabled, and
execution granted only to `authenticated`.

### toggle_shopping_item_checked(p_row_id TEXT)

Atomically toggles the `checked` flag for a shopping row identified by
`rowId` inside `shopping_list.items`. Uses the authenticated user from
`auth.uid()`.

**Parameters:**
- `p_row_id` (TEXT) - Stable shopping row identity

**Returns:** `TABLE(row_id TEXT, checked BOOLEAN, updated_at TIMESTAMPTZ)`

**Language:** `plpgsql`

### Recipe shopping contribution RPCs

`get_recipe_shopping_contribution_state()` returns the authenticated user's
shopping projection and contribution rows from one consistent database
snapshot. `apply_recipe_shopping_contribution_command(...)` locks that user's
shopping row, checks `contribution_revision`, validates recipe ownership,
deduplicates retries by idempotency key, replaces/removes contribution rows,
and commits the new compatibility projection in the same transaction.

The apply function is `SECURITY DEFINER` because authenticated clients have
read-only access to contribution rows. It derives identity only from
`auth.uid()`, uses an empty `search_path`, accepts no caller-selected user ID,
and is executable only by `authenticated`.

### move_shopping_item_to_pantry(p_row_id TEXT, p_pantry_qty NUMERIC, p_pantry_unit TEXT)

Atomically removes a shopping row identified by `rowId` from
`shopping_list.items`, appends it to `shopping_list.already_have`, and upserts
the normalized pantry item into `pantry_items`. Uses the authenticated user
from `auth.uid()`.

**Parameters:**
- `p_row_id` (TEXT) - Stable shopping row identity
- `p_pantry_qty` (NUMERIC) - Pantry quantity fallback when the row amount is null
- `p_pantry_unit` (TEXT) - Pantry unit fallback when the row unit is empty

**Returns:** `TABLE(removed_item JSONB, pantry_item JSONB, shopping_list_updated_at TIMESTAMPTZ, pantry_was_inserted BOOLEAN)`

**Language:** `plpgsql`

## Triggers

### update_recipes_updated_at

**Table:** `recipes`

**Event:** `BEFORE UPDATE`

**Function:** `update_updated_at_column()`

**Description:** Automatically updates the `updated_at` column to the current timestamp whenever a recipe is updated.

### on_auth_user_created

**Table:** `auth.users`

**Event:** `AFTER INSERT`

**Function:** `handle_new_user()`

**Description:** Automatically creates default recipes, user config, and shopping list when a new user signs up.

### set_default_recipe_images

**Table:** `recipes`

**Event:** `BEFORE INSERT`

**Function:** `set_default_recipe_images()`

**Description:** Sets default storage path for recipe images when `image_url` is null/empty, for the 8 default recipe slugs (supports ID with UUID suffix). Public URLs are resolved client-side.

## Relationships

```
auth.users (Supabase Auth)
  ├── recipes (user_id → auth.users.id)
  │   └── recipe_history (recipe_id → recipes.id)
  ├── pantry_items (user_id → auth.users.id)
  ├── user_config (user_id → auth.users.id)
  ├── weekly_plans (user_id → auth.users.id)
  ├── plan_templates (user_id → auth.users.id)
  ├── shopping_list (user_id → auth.users.id)
  └── recipe_shares (sender_user_id/recipient_user_id → auth.users.id)
```

`recipe_history.recipe_id` remains a logical link to recipes, but it is not enforced as a foreign key so historical rows are retained when recipes are deleted.

### Foreign Key Relationships

1. **recipes.user_id** → `auth.users(id)` ON DELETE CASCADE
2. **pantry_items.user_id** → `auth.users(id)` ON DELETE CASCADE
3. **user_config.user_id** → `auth.users(id)` ON DELETE CASCADE
4. **recipe_history.user_id** → `auth.users(id)` ON DELETE CASCADE
5. **recipe_history.recipe_id** → `recipes(id)` ON DELETE CASCADE
6. **weekly_plans.user_id** → `auth.users(id)` ON DELETE CASCADE
7. **shopping_list.user_id** → `auth.users(id)` ON DELETE CASCADE
8. **recipe_shares.sender_user_id** → `auth.users(id)` ON DELETE CASCADE
9. **recipe_shares.recipient_user_id** → `auth.users(id)` ON DELETE CASCADE

All enforced foreign keys use `ON DELETE CASCADE`, meaning if a user is deleted, all their associated data is automatically deleted.

`recipe_history.recipe_id` is intentionally excluded from the enforced foreign key list so recipe deletions do not erase historical reporting data.

## Migration History

The repository now uses a baseline-first bootstrap strategy:

1. **001_baseline.sql** - Canonical full schema snapshot for deterministic fresh bootstrap through the pantry row-id baseline cut on 2026-03-09.
2. **002_recipe_structure_parity.sql** - Added first-class recipe time fields, first-class recipe notes, additive grouped-instruction persistence, and share-acceptance parity for those fields.
3. **003_shopping_item_order_preferences.sql** - Added `shopping_item_order` to `user_config` for learned within-category shopping item order preferences.
4. **004_reconcile_production_schema_to_main.sql** - Guardedly reconciled the abandoned recipe-audit branch and restored canonical user-key constraints.
5. **005_secure_privileged_rpcs.sql** - Removed caller-selected user identities, dropped unsafe overloads, moved user RPCs to RLS-backed invoker execution, and hardened the remaining definer functions and grants.

Legacy notes:
- Historical migrations are preserved under `supabase/migrations/archive/2026-03-09-pre-028-squash/` for context and backward auditability.
- Fresh environments should start from the baseline and then apply only new incremental migrations added after it.
- Missing historical `001-011` incremental files are intentionally not reconstructed.

Pre-baseline historical evolution (for context only):

1. **001_initial_schema.sql** - Initial single-user schema with all core tables
2. **002_add_category_overrides.sql** - Added `category_overrides` to `user_config` for custom shopping list categorization
3. **003_add_made_recipe_ids.sql** - Added `made_recipe_ids` to `weekly_plans` to track which recipes were marked as "made" per week
4. **004_merge_steak_into_beef.sql** - Merged 'steak' category into 'beef' category
5. **005_multi_user_support.sql** - Added full multi-user support with `user_id` columns, updated RLS policies, and default recipes trigger
6. **006_fix_signup_trigger.sql** - Improved signup trigger error handling with explicit search_path and graceful error handling
7. **007_custom_categories.sql** - Added `custom_categories` and `category_order` to `user_config` for user-defined shopping categories and custom category ordering
8. **008_add_day_assignments.sql** - Added `day_assignments` JSONB column to `weekly_plans` to store recipe-to-day mappings for calendar view (enables cross-device persistence)
9. **009_planner_settings.sql** - Added `excluded_days`, `preferred_days`, and `auto_assign_days` to `user_config` for planner day placement rules and automatic day assignment
10. **010_add_recipe_images.sql** - Added `image_url` column to `recipes` table for storing recipe image URLs (Supabase Storage paths or external URLs)
11. **011_create_recipe_images_bucket.sql** - Created `recipe-images` storage bucket with RLS policies for secure user-specific image storage
12. **012_add_onboarding_completed_at.sql** - Added `onboarding_completed_at` to `user_config` for user-scoped onboarding state
13. **013_default_recipe_images.sql** - Added default recipe image mapping for new users and backfilled existing defaults
14. **014_default_recipe_images_uuid_suffix.sql** - Updated default image mapping to handle recipe ID UUID suffixes and backfilled existing records
15. **015_plan_templates.sql** - Added reusable meal plan templates table
16. **016_recipe_sharing.sql** - Added `recipe_shares` table, sharing RLS policies, and `accept_recipe_share()` copy-on-accept function
17. **017_add_enabled_planner_categories.sql** - Added planner category enable/disable settings
18. **018_tag_rpc_functions.sql** - Added bulk tag-management RPC functions
19. **020_filter_recipes_by_tags.sql** - Added OR-based tag filtering RPC for recipe searches
20. **021_recipe_history_stats_and_retention.sql** - Added aggregate history stats RPC and preserved history after recipe deletion
21. **022_atomic_toggle_shopping_item.sql** - Added atomic RPC for shopping item checked toggle with row lock + idempotent no-op return
22. **023_toggle_shopping_item_checked_auth_uid.sql** - Tightened shopping toggle RPC to use authenticated user context
23. **024_atomic_add_pantry_and_remove_shopping.sql** - Added atomic RPC for pantry add + shopping removal
24. **025_atomic_mark_recipe_made.sql** - Added atomic weekly made/unmade toggle RPC for planner/history consistency
25. **026_normalize_legacy_steak_defaults.sql** - Normalized known legacy default `steak` category payloads in `user_config` to canonical `beef`
26. **027_shopping_row_identity_rpc_parity.sql** - Updated shopping RPC contracts to target stable `rowId` identity instead of name-based matching
27. **028_pantry_item_ids.sql** - Added stable pantry row ids, preserved `(user_id, item)` uniqueness, and updated pantry/shopping RPC parity to return pantry row identity

## Query Examples

### Get all recipes for a user
```sql
SELECT * FROM recipes 
WHERE user_id = auth.uid() 
ORDER BY created_at DESC;
```

### Get recipes by category
```sql
SELECT * FROM recipes 
WHERE user_id = auth.uid() 
  AND category = 'chicken'
ORDER BY name;
```

### Get recipe history for last 30 days
```sql
SELECT r.*, rh.date_made
FROM recipes r
JOIN recipe_history rh ON r.id = rh.recipe_id
WHERE r.user_id = auth.uid()
  AND rh.date_made >= NOW() - INTERVAL '30 days'
ORDER BY rh.date_made DESC;
```

### Get current week's meal plan
```sql
SELECT * FROM weekly_plans
WHERE user_id = auth.uid()
  AND week_date = DATE_TRUNC('week', CURRENT_DATE)::DATE;
```

### Get user's shopping list
```sql
SELECT * FROM shopping_list
WHERE user_id = auth.uid();
```

### Get user's pantry items
```sql
SELECT item FROM pantry_items
WHERE user_id = auth.uid()
ORDER BY created_at DESC;
```

## Notes

- All timestamps use `TIMESTAMPTZ` (timezone-aware timestamps)
- All user-specific tables require `user_id` to be set for proper RLS enforcement
- The `recipes.ingredients` field uses JSONB for flexible ingredient storage
- The `shopping_list.items` field uses JSONB for flexible shopping list item storage
- `shopping_list` row payloads now use `rowId` as the stable identity field across `items`, `already_have`, and `excluded`
- Default recipes are automatically created for new users via the `on_auth_user_created` trigger
- Composite primary keys are enforced via unique indexes rather than traditional PRIMARY KEY constraints for tables that were migrated from single-user to multi-user

## Archived Migrations

Historical schema migrations superseded by the 2026-03-09 baseline cut are kept in `migrations/archive/2026-03-09-pre-028-squash/`.

One-time data fixes and inspection queries are also kept in `migrations/archive/`:
- `check-user-recipes.sql` - Data inspection query for debugging recipe ownership
- `migrate-bad-recipe-id.sql` - One-time fix for malformed recipe IDs

Archived files are not part of the active bootstrap chain and should not be re-run during normal `db reset` workflows.

## Migration Workflow Runbook

This section is the operational runbook for schema changes in this repository. It is intentionally explicit because the repo uses a squashed baseline and older linked projects may still carry pre-squash migration history.

### Normal Schema Change Workflow

1. Create a new incremental migration on top of the active chain.
   Example: `npx supabase migration new add_some_schema_change`
2. Apply and iterate locally first.
   Use `npx supabase start` and `npx supabase db reset --local` from the repo root so the full active chain rebuilds deterministically.
3. Validate the app against the local schema change.
   At minimum, run the relevant app flow plus `npm run typecheck` from `web/`. Add or run tests when the schema change affects behavior.
4. Regenerate local types from the local schema.
   From `web/`, run `npm run db:types:regen`.
5. Preflight the linked remote before pushing.
   From `web/`, run `npm run db:preflight`.
6. Push to the intentionally linked remote project.
   Run `npx supabase --workdir .. db push`.
7. Regenerate types from the linked remote after a successful push.
   From `web/`, run `npm run db:types:regen:linked`.
8. Re-run validation.
   At minimum, run `npm run typecheck` and the relevant tests from `web/`.

### Preflight Checklist Before `supabase db push`

- Run `cd web && npm run db:preflight`.
- Confirm the linked project/environment is the one you intend to change.
- Review `supabase migration list` output and verify local and remote entries line up row-for-row.
- Stop if a migration exists only locally, only remotely, or the IDs differ between columns.
- Stop if you do not understand why the migration list differs.
- Treat `supabase db push` as unsafe until the history mismatch is explained.

### How To Detect Migration History Drift

Migration history drift means the migration ledger in the linked remote does not match the active migration files in this repository.

Common drift signals:

- `supabase migration list` shows blank local or blank remote cells.
- The local and remote columns list different IDs on the same row.
- `supabase db push` refuses to proceed because remote migration versions do not match local migrations.
- A fresh local reset builds cleanly, but the linked remote reports extra historical versions that are not part of the active chain.

Concrete examples of when to stop and investigate:

- The repo shows only `001_baseline.sql` and `002_recipe_structure_parity.sql`, but the remote still lists pre-squash entries such as `012` through `028`.
- A teammate added a migration locally and you have not pulled it yet.
- You are linked to the wrong Supabase project or environment.
- Someone manually edited migration history or applied SQL outside the repo workflow.

### Squashed Baseline Repair Procedure

This repository's known special case is intentional baseline squashing.

Use this procedure only when all of the following are true:

- The repo's canonical active chain starts with `001_baseline.sql`.
- The linked remote schema state is already equivalent to that squashed baseline plus any active incremental migrations.
- The mismatch is explained by stale pre-squash migration history entries still recorded on the remote.

Approved repair workflow:

1. Run `supabase migration list` and confirm the mismatch is the expected squashed-baseline pattern.
2. Confirm the remote schema itself is the one you expect before changing migration history.
   Check the relevant tables, columns, functions, or constraints in Supabase before repair.
3. Mark the stale pre-squash remote history entries as reverted with `supabase migration repair --status reverted ...`.
   In the known March 2026 case, the stale entries were `012` through `028`.
4. Run `supabase migration list` again and confirm the linked remote now aligns with the active repo chain.
5. Only then run `supabase db push` if there is still an unapplied migration to push.

This updates migration bookkeeping. It does not apply missing SQL by itself.

### When `repair` Is Appropriate Vs Not Appropriate

`supabase migration repair` is appropriate when:

- The repository intentionally rewrote or squashed the canonical migration chain.
- The remote schema is already correct, but the remote migration history table is stale.
- You can explain every mismatched migration entry concretely.
- You verify schema state before and after the repair.

`supabase migration repair` is not appropriate when:

- You are using it as a generic force-fix for unexplained drift.
- The remote schema is actually missing tables, columns, indexes, RLS, or functions.
- You are unsure whether the linked project is the correct environment.
- Local and remote histories diverged because different SQL was applied, not because of an intentional squash.

If the reason for drift is not clear, stop. Investigate the schema state and migration history instead of rewriting the ledger.
`db:preflight` helps detect ledger drift, but it does not prove the remote schema contents are equivalent.

### Post-Migration Checklist

- Regenerate local or linked types, depending on the workflow stage.
  Use `cd web && npm run db:types:regen` for local parity and `cd web && npm run db:types:regen:linked` after a linked remote push.
- Run `cd web && npm run typecheck`.
- Run the relevant tests for the affected behavior.
- Verify the new database objects exist as intended in the target environment.
- If the schema change affects docs or operational assumptions, update this file in the same branch.

### Command Reference

- Local rebuild: `npx supabase start` then `npx supabase db reset --local`
- Preflight linked remote: `cd web && npm run db:preflight`
- Push linked remote: `npx supabase --workdir .. db push`
- Generate local types: `cd web && npm run db:types:regen`
- Generate linked remote types: `cd web && npm run db:types:regen:linked`
- Check generated type parity against committed baseline: `cd web && npm run db:types:check`

## Migration 008 planner-reference reconciliation invariant

Migration `008_reconcile_stale_planner_references.sql` is a forward-only, removal-only reconciliation that must complete before Stage 2 of recipe UUID identity migration. It does not change the `recipes` primary key, recipe UUID schema, application APIs, or planner behavior.

The permanent `private.planner_reference_reconciliation_audit` table is operator-only and stores non-sensitive evidence for the four approved active-field removals. Application roles have no schema, table, sequence, helper-function, or procedure privileges. The migration-specific `private.reconcile_stale_planner_reference_008` procedure is retained solely so isolated database contracts can exercise the exact production implementation; all application-role execution privileges are revoked.

The reconciliation invariant is: every recipe reference in `weekly_plans.recipe_ids`, every top-level `weekly_plans.day_assignments` key, and every value in `weekly_plans.made_recipe_ids` must resolve exactly to a recipe with the same owner. Run `supabase/verification/active_planner_reference_audit.sql` as an operator; it returns counts only and must report zero for all three fields before Stage 2 begins.

A clean reset is explicitly recognized only when auth users and all relevant application tables are pristine before seed execution. In that state migration 008 installs its guarded mechanism and skips production fingerprints; pgTAP then creates representative Ref-A/Ref-B/Ref-C fixtures and verifies the same reconciliation path. Any populated environment must satisfy the exact approved global counts and row/field fingerprints or the migration aborts.

## Migration 009 UUID-reference trigger authority

Migration `009_add_uuid_recipe_references.sql` adds UUID mirrors while the
deployed application still writes legacy recipe IDs. Migration 008 has already
revoked application-role access to `private`; consequently an invoker trigger
cannot call migration 009's private resolution helpers. The original invoker
model caused otherwise RLS-authorized authenticated writes to fail with
`insufficient_privilege`.

The final authority chain is:

```text
authenticated RLS-authorized write
-> postgres-owned SECURITY DEFINER trigger wrapper (search_path = '')
-> explicit NEW-row owner and identity validation
-> schema-qualified private helper
-> atomic NEW-row UUID mirror synchronization
```

Planner, template, history, share, shopping provenance, and shopping
contribution wrappers are `BEFORE INSERT OR UPDATE` row triggers. They update
`NEW` directly, include both legacy and UUID identity columns in their update
filters, reject caller-supplied mismatches, and do not issue recursive updates.
The single-owner wrappers require `auth.uid() = NEW.user_id`; the share wrapper
requires the authenticated principal to be the sender or recipient and validates
source and accepted-copy recipes against their separate owners. Direct
migration-owner setup and the nested trusted `auth.users` default-seeding path
are the only documented null-`auth.uid()` paths.

All wrappers are owned by `postgres`, have an empty search path, accept no
caller arguments, and expose no result beyond trigger semantics. `EXECUTE` is
revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. The same
roles retain no `USAGE` on `private` and no direct execution on resolution,
enrichment, validation, or ownership helpers. Trigger-mediated writes require
no application-role execute grant and remain subject to the original table RLS
policy.

Authenticated pgTAP contracts use two JWT principals plus anonymous and
migration-owner contexts. They prove same-owner compatibility and UUID parity
for every Stage 2A write category, cross-owner and unresolved active rejection,
historical nullable preservation, malformed/mismatched identity rejection,
direct helper denial, recipe creation, default seeding, and accepted-share and
contribution workflows. `privileged_function_guard.sql` enforces the authority
and catalog shape. CI must run this suite after a clean reset; green schema-only
tests are not a sufficient rollout signal.

Do not deploy migration 009 until the exact PR head passes the database suite,
generated-type drift, Stage 2A parity audit, active-reference audit, application
verification, and preview checks. Production must remain on 001-008 during PR
repair. Stage 2B is blocked until migration 009 is deployed separately and its
production parity audit passes.
