# Recipe Genie - Supabase Database Schema Documentation

> **When to read:** You're adding/modifying tables, columns, indexes, RLS policies, triggers, migrations, or storage buckets.

*Last updated: 2026-08-09*

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
  - [plan_templates](#plan_templates)
- [Storage Buckets](#storage-buckets)
  - [recipe-images](#recipe-images)
- [Indexes](#indexes)
- [Row Level Security (RLS)](#row-level-security-rls)
- [Functions](#functions)
- [Triggers](#triggers)
- [Relationships](#relationships)
- [Migration History](#migration-history)
- [Migration Workflow Runbook](#migration-workflow-runbook)

## Overview

The Recipe Genie database is designed for multi-user support with data
isolation between users. User-owned tables carry `user_id`; recipe shares use
sender and recipient owner columns. Row Level Security (RLS) and guarded RPCs
enforce those ownership boundaries.

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
- `supabase/migrations/004_reconcile_production_schema_to_main.sql`
- `supabase/migrations/005_secure_privileged_rpcs.sql`
- `supabase/migrations/006_authoritative_shopping_contributions.sql`
- `supabase/migrations/007_add_recipe_uuid_identity.sql`
- `supabase/migrations/008_reconcile_stale_planner_references.sql`
- `supabase/migrations/009_add_uuid_recipe_references.sql`
- `supabase/migrations/010_enable_uuid_application_identity.sql`
- `supabase/migrations/011_fix_uuid_made_state_date_contract.sql`
- `supabase/migrations/012_enforce_uuid_active_recipe_writes.sql`
- `supabase/migrations/013_allow_uuid_shopping_contribution_replacement.sql`
- `supabase/migrations/014_add_recipe_yield_metadata.sql`
- `supabase/migrations/015_add_shopping_exclusion_settings.sql`
- `supabase/migrations/016_canonical_recipe_structure_cutover.sql`
- `supabase/migrations/017_remove_legacy_recipe_structure.sql`
- `supabase/migrations/018_shopping_document_cutover.sql`
- `supabase/migrations/019_personalized_shopping_order.sql`
- `supabase/migrations/020_shopping_document_v3.sql`

The active chain is the complete set of regular SQL files currently tracked
directly in `supabase/migrations/`. Fresh resets apply all 20 in filename order.
Archived files are not replacement migrations and are not part of that chain.

### Current Recipe Identity and Compatibility

- `recipes.recipe_uuid` is the canonical application identity.
- Active application reads, writes, planner/template references, sharing,
  history, Shopping document recipe entries, and deletion use UUID identity.
- `recipes.id` remains the physical text primary key. Text reference
  columns/arrays and JSON keys remain as derived or validated compatibility
  mirrors while Stage 3 has not run.
- Unresolved historical recipe evidence may retain a text alias with nullable
  UUID linkage. No UUID is invented for a deleted or unresolved recipe.
- Migration 013 historically preserved UUID authority for the contribution
  model that migration 018 removes.
- Migration 014 adds versioned authored-yield metadata and hardens shared
  snapshot acceptance with private, non-executable structured quantity,
  package, rational, unit, and yield validators while preserving the numeric
  servings projection.
- Migration 015 historically added Shopping exclusions to `user_config`;
  migration 018 moves them into Shopping document preferences.
- Migration `016` atomically backfills canonical ordered ingredient
  and instruction sections, converts share snapshots, and switches privileged
  recipe creation/acceptance to canonical fields.
- Migration `017` removes the superseded physical recipe-structure columns and
  migration-only conversion functions. Canonical sections remain the only
  persisted recipe structure.
- Migration `018` atomically converts legacy Shopping state into one canonical
  document with one CAS revision, then removes contribution-era persistence.
- Migration `019` upgrades Shopping documents to V2, converts current row order
  into reusable ingredient-key sequences, and removes row references as a
  durable ordering authority.
- Migration `020` adds strict V3 ingredient-semantics validation while retaining
  V2 rows and the V2 database default for a safe, phased application upgrade.
  A later, separate migration may switch the default after the V3-capable
  application is confirmed live.

Stage 3 physical-key promotion and compatibility removal are not complete.

### Historical Baseline-Squash Drift Context

A prior `supabase db push` failure was caused by migration history drift, not
by a bad SQL migration:

- The repository's active chain was rewritten to start from the squashed `001_baseline.sql`.
- The linked remote still had pre-squash migration history entries recorded for older incremental files such as `012` through `028`.
- `supabase db push` compares local migration history to the remote migration history table before applying new SQL.
- At that time local history exposed only the early baseline-forward files,
  while the remote still reported stale pre-squash entries, so the CLI treated
  the histories as divergent and refused to continue.
- Repairing those stale remote history entries to `reverted`, then rerunning `supabase db push`, aligned the migration ledger with the intentionally squashed repo state.

The schema supports:
- Recipe storage with canonical ingredient and instruction sections, notes, and images
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
| `id` | TEXT | PRIMARY KEY | Physical legacy compatibility key; active application identity is `recipe_uuid` |
| `recipe_uuid` | UUID | NOT NULL, UNIQUE, immutable | Canonical recipe identity required for active application writes |
| `user_id` | UUID | FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the recipe |
| `name` | TEXT | NOT NULL | Recipe name |
| `category` | TEXT | NOT NULL | Recipe category (e.g., 'chicken', 'beef', 'turkey', 'lamb', 'vegetarian') |
| `servings` | INTEGER | NOT NULL, DEFAULT 4 | Number of servings |
| `favorite` | BOOLEAN | DEFAULT FALSE | Whether recipe is marked as favorite |
| `tags` | TEXT[] | DEFAULT '{}' | Array of tags for the recipe |
| `prep_time_minutes` | INTEGER | NULL | Optional prep time in minutes |
| `cook_time_minutes` | INTEGER | NULL | Optional cook time in minutes |
| `total_time_minutes` | INTEGER | NULL | Optional total time in minutes |
| `ingredient_sections` | JSONB | NOT NULL, DEFAULT '[]', validated | Canonical ordered ingredient sections |
| `instruction_sections` | JSONB | NOT NULL, DEFAULT '[]', validated | Canonical ordered instruction sections |
| `notes` | JSONB | NOT NULL, DEFAULT '[]' | Array of recipe note strings |
| `image_url` | TEXT | NULL | URL or path to recipe image (Supabase Storage path or external URL) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when recipe was created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when recipe was last updated |

**Canonical ingredient-section JSONB structure:**
```json
[
  {
    "label": "Sauce",
    "ingredients": [
      {
        "item": "Greek yogurt (or sour cream)",
        "unit": "cup",
        "amount": 0.5,
        "alternatives": ["sour cream"],
        "originalText": "½ cup Greek yogurt or sour cream"
      }
    ]
  }
]
```

Section order and ingredient order are authoritative. Labels are `string | null`,
duplicate labels are allowed, every stored section is nonempty, and canonical
ingredient objects cannot contain `groupLabel`.

**Canonical instruction-section JSONB structure:**
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

Top-level empty arrays are valid. Section order and step order are authoritative;
every stored section is nonempty. There is no alternate persisted recipe
structure or dual-write path.

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
| `history_exclusion_days` | INTEGER | DEFAULT 7 | Number of days to exclude recently made recipes |
| `week_start_day` | INTEGER | DEFAULT 1 | Day of week that starts the meal plan (1 = Monday) |
| `onboarding_completed_at` | TIMESTAMPTZ | DEFAULT NULL | Timestamp when the user completed onboarding |
| `excluded_days` | INTEGER[] | DEFAULT '{}' | Day indices (0-6) to exclude from meal placement. 0=Sunday, 1=Monday, etc. |
| `preferred_days` | INTEGER[] | DEFAULT NULL | Preferred day indices (0-6) for meal placement, or null for no preference |
| `auto_assign_days` | BOOLEAN | DEFAULT TRUE | Whether to automatically assign days to recipes when generating a meal plan |

Canonical default planner categories are: `chicken`, `beef`, `turkey`, `lamb`,
`vegetarian`. The baseline includes the normalization formerly introduced by
the archived pre-baseline migration
`026_normalize_legacy_steak_defaults.sql`.

### recipe_history

Tracks when recipes were made by users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | SERIAL | PRIMARY KEY | Auto-incrementing history entry ID |
| `recipe_id` | TEXT | NOT NULL, DEFAULT `''` | Historical compatibility alias; not an enforced foreign key |
| `recipe_uuid` | UUID | NULL | Canonical linkage for live/resolvable history; nullable for unresolved historical evidence |
| `user_id` | UUID | FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the history entry |
| `date_made` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Date and time when recipe was made |

**Retention note:** `recipe_history.recipe_id` is intentionally stored as a plain text identifier rather than an enforced foreign key so history survives recipe deletion.

### weekly_plans

Stores weekly meal plans for users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY (composite with week_date), FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the plan |
| `week_date` | DATE | PRIMARY KEY (composite with user_id) | Start date of the week (typically Monday) |
| `recipe_ids` | TEXT[] | NOT NULL, DEFAULT '{}' | Derived compatibility membership |
| `day_assignments` | JSONB | DEFAULT '{}' | Derived compatibility assignment map |
| `recipe_uuids` | UUID[] | NOT NULL, DEFAULT '{}' | Canonical ordered recipe membership |
| `day_assignment_recipe_uuids` | JSONB | NOT NULL, DEFAULT '{}' | Canonical UUID-keyed day assignments |
| `scale` | NUMERIC | DEFAULT 1.0 | Scaling factor for recipe servings |
| `made_recipe_ids` | TEXT[] | DEFAULT '{}' | Derived compatibility made-state membership |
| `made_recipe_uuids` | UUID[] | NOT NULL, DEFAULT '{}' | Canonical made-state membership |
| `generated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when plan was generated |

**Compatibility `day_assignments` example:**
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

Stores one canonical Shopping document per user. Recipe-derived rows are
projected from document recipe entries and live Pantry state; rendered buckets
are not persisted.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the shopping list |
| `document` | JSONB | NOT NULL, validated as `ShoppingDocumentV2` or `ShoppingDocumentV3` during lazy upgrade; compatibility-phase default is V2 | Recipe entries, manual items, explicit overrides, semantic keys, and reusable Shopping preferences |
| `content_revision` | BIGINT | NOT NULL, DEFAULT 0 | Compare-and-swap revision; every write advances exactly once |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last successful document write |

**Document outline:**
```json
{
  "schemaVersion": 2,
  "recipeEntries": {},
  "manualItems": [],
  "itemOverrides": {},
  "preferences": {
    "categoryByIngredient": {},
    "customCategories": [],
    "categoryOrder": [],
    "ingredientOrderByCategory": {},
    "excludedIngredientKeys": [],
    "excludeSaltVariants": false,
    "excludeBlackPepperVariants": false
  }
}
```

Stable rendered row references are `manual:<id>` or
`derived:<aggregateKey>` and are never persisted ordering identity. Reusable
category order lives in `categoryOrder`; reusable within-category order lives
in `ingredientOrderByCategory` as globally unique purchase-key sequences.
Recipe ingredients persist separate purchase and family keys plus explicit
Pantry/exclusion policy. Existing V2 rows remain valid until the application
upgrades them on a normal write; no migration rewrites stored user documents.
The application creates and writes V3 documents, while migration 020 retains
the V2 database default so the prior application remains compatible during the
schema-first rollout.

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
| `source_recipe_id` | TEXT | NOT NULL | Derived sender-owned compatibility identity |
| `source_recipe_uuid` | UUID | NULL | Canonical sender-owned recipe identity for active shares |
| `source_recipe_snapshot` | JSONB | NOT NULL | Canonical recipe snapshot with `ingredient_sections` and `instruction_sections` used to materialize the recipient copy |
| `message` | TEXT | NULL, `char_length(message) <= 300` | Optional sender note |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'`, CHECK in (`pending`, `accepted`, `declined`, `canceled`) | Share lifecycle state |
| `accepted_recipe_id` | TEXT | NULL | Derived recipient compatibility identity created on accept |
| `accepted_recipe_uuid` | UUID | NULL | Canonical recipient-owned identity created on accept |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Share creation timestamp |
| `responded_at` | TIMESTAMPTZ | NULL | When recipient accepted/declined or sender canceled |

### plan_templates

Stores reusable meal plan templates for quick loading.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Template ID |
| `user_id` | UUID | NOT NULL, FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the template |
| `name` | TEXT | NOT NULL | User-assigned template name |
| `recipe_ids` | TEXT[] | NOT NULL, DEFAULT '{}' | Derived compatibility membership |
| `day_assignments` | JSONB | DEFAULT NULL | Derived compatibility assignment map |
| `recipe_uuids` | UUID[] | NOT NULL, DEFAULT '{}' | Canonical ordered recipe membership |
| `day_assignment_recipe_uuids` | JSONB | NOT NULL, DEFAULT '{}' | Canonical UUID-keyed day assignments |
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
- **shopping_list**: authenticated users can select their own row and update
  only `document` plus `content_revision`; insert/delete remain trigger/service operations
- **recipe_shares**:
  - `users_own_recipe_shares_select` - Sender or recipient can read share rows
  - `users_create_recipe_shares` - Sender can insert rows with `sender_user_id = auth.uid()`
  - `recipients_respond_recipe_shares` - Recipient can move `pending` → `declined`
  - `senders_cancel_recipe_shares` - Sender can move `pending` → `canceled`

Ordinary user-owned table policies use owner checks equivalent to
`auth.uid() = user_id`. Shares use sender/recipient-specific policies, and
Shopping writes are column-scoped and revision-guarded. Authenticated
table updates on shares are limited to `status` and `responded_at`; accepted
state and acceptance metadata can only be written by `accept_recipe_share()`.

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
marks the share as accepted. Function is idempotent and returns the canonical
`accepted_recipe_uuid` if called again after acceptance.

Accepted snapshots carry canonical ingredient and instruction sections, recipe
times, notes, and yield metadata. Legacy structure keys and `{}` snapshots are
rejected. The security-definer function validates the complete snapshot,
creates the recipe with canonical columns only, and writes accepted state and
metadata in one transaction.

**Parameters:**
- `p_share_id` (UUID) - Share request ID

**Returns:** `TEXT` (canonical recipe UUID serialized for the API contract)

**Language:** `plpgsql SECURITY DEFINER`

**Security:** Uses `auth.uid()` as the recipient identity, has an empty
`search_path`, and is executable only by `authenticated`.

### get_recipe_history_stats()

Returns per-recipe aggregate history for UI surfaces that only need counts and the most recent cook date.

**Returns:** `TABLE(recipe_id TEXT, times_made INTEGER, last_made TIMESTAMPTZ)`;
the API-facing `recipe_id` value is the canonical recipe UUID serialized as
text.

**Language:** `plpgsql STABLE SECURITY INVOKER`

**Security:** Derives the owner from `auth.uid()`, rejects unauthenticated
execution, and remains subject to table RLS.

### Tag RPCs

`filter_recipes_by_tags(p_tags TEXT[])`, `rename_tag(p_old_tag TEXT, p_new_tag
TEXT)`, `merge_tags(p_source_tag TEXT, p_target_tag TEXT)`, and
`delete_tag(p_tag TEXT)` derive identity from `auth.uid()`. They are
`SECURITY INVOKER` functions with empty `search_path`, table RLS enabled, and
execution granted only to `authenticated`.

### Shopping document writes

Ordinary Shopping mutations are authenticated, RLS-protected table updates
that match `content_revision` and supply its next value. The revision trigger
requires an exact increment of one. The client refetches and replays once when
the conditional update returns no row.

### UUID recipe identity RPCs

- `delete_recipe(p_recipe_uuid UUID)` atomically detaches active
  planner/template/shopping references and deletes the owned recipe.
- `toggle_weekly_recipe_made(p_recipe_uuid UUID, p_week_date DATE, ...)`
  updates canonical weekly made state and history.
- `resolve_recipe_identity(p_recipe_uuid UUID, p_legacy_id TEXT)` is a measured
  same-owner compatibility seam; normal UUID commands do not use the alias
  path.
- `get_recipe_identity_compat_usage()` exposes only the aggregate compatibility
  counter used to evaluate future Stage 3 cleanup.

### move_shopping_document_item_to_pantry(...)

Atomically applies a Shopping document CAS and inserts the normalized Pantry
item. Uses the authenticated user from `auth.uid()` and fails with SQLSTATE
`40001` when the expected revision is stale.

**Parameters:**
- `p_expected_revision` (BIGINT) - Expected document revision
- `p_document` (JSONB) - Replayed next Shopping document
- `p_item` (TEXT) - Normalized Pantry identity source
- `p_pantry_qty` (NUMERIC) - Pantry quantity fallback when the row amount is null
- `p_pantry_unit` (TEXT) - Pantry unit fallback when the row unit is empty

**Returns:** the updated document/revision plus Pantry row and insertion status

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
  │   └── shopping_recipe_contributions
  │       ├── recipe_id → recipes.id (compatibility)
  │       └── recipe_uuid → recipes.recipe_uuid (canonical)
  ├── pantry_items (user_id → auth.users.id)
  ├── user_config (user_id → auth.users.id)
  ├── recipe_history (user_id → auth.users.id)
  ├── weekly_plans (user_id → auth.users.id)
  ├── plan_templates (user_id → auth.users.id)
  ├── shopping_list (user_id → auth.users.id)
  └── recipe_shares (sender_user_id/recipient_user_id → auth.users.id)
```

`recipe_history.recipe_id` remains a logical link to recipes, but it is not enforced as a foreign key so historical rows are retained when recipes are deleted.

### Foreign Key Relationships

- User-owned tables reference `auth.users(id)` with `ON DELETE CASCADE`;
  `recipe_shares` uses both `sender_user_id` and `recipient_user_id`.
- Planner/template arrays, JSON assignment keys, and
  share/history UUID columns are synchronized identity fields rather than
  ordinary scalar foreign keys.
- `recipe_history.recipe_id` is intentionally not an enforced foreign key, so
  recipe deletion does not erase historical reporting data.

## Migration History

The repository now uses a baseline-first bootstrap strategy:

1. **001_baseline.sql** - Canonical full schema snapshot for deterministic fresh bootstrap through the pantry row-id baseline cut on 2026-03-09.
2. **002_recipe_structure_parity.sql** - Added first-class recipe time fields, first-class recipe notes, additive grouped-instruction persistence, and share-acceptance parity for those fields.
3. **003_shopping_item_order_preferences.sql** - Added `shopping_item_order` to `user_config` for learned within-category shopping item order preferences.
4. **004_reconcile_production_schema_to_main.sql** - Guardedly reconciled the abandoned recipe-audit branch and restored canonical user-key constraints.
5. **005_secure_privileged_rpcs.sql** - Removed caller-selected user identities, dropped unsafe overloads, moved user RPCs to RLS-backed invoker execution, and hardened the remaining definer functions and grants.
6. **006_authoritative_shopping_contributions.sql** - Added authoritative shopping contribution commands and projection guards.
7. **007_add_recipe_uuid_identity.sql** - Added permanent recipe UUID identity.
8. **008_reconcile_stale_planner_references.sql** - Reconciled approved stale active planner references.
9. **009_add_uuid_recipe_references.sql** - Added UUID reference mirrors and compatibility synchronization.
10. **010_enable_uuid_application_identity.sql** - Enabled UUID-first application writes while preserving legacy-first compatibility.
11. **011_fix_uuid_made_state_date_contract.sql** - Replaced the defective UUID/text made-state RPC with the canonical UUID/date command and retained the authenticated legacy overload.
12. **012_enforce_uuid_active_recipe_writes.sql** - Required UUID authority for active recipe writes, derived compatibility mirrors, and added UUID-coordinated recipe deletion.
13. **013_allow_uuid_shopping_contribution_replacement.sql** - Preserved UUID authority for content-only replacement of an existing contribution identity pair.
14. **014_add_recipe_yield_metadata.sql** - Added versioned authored-yield metadata and deep, atomic shared-snapshot validation for all copied recipe fields, including bounded instruction groups and images, exact quantities, ranges, packages, units, and yield metadata. Private validators are execution-revoked and the authenticated acceptance RPC rejects the whole snapshot before any recipient recipe or share-state mutation.
15. **015_add_shopping_exclusion_settings.sql** - Added the non-null, default-false Salt-variant and Black-pepper-variant shopping exclusion settings to `user_config`.
16. **016_canonical_recipe_structure_cutover.sql** - Atomically converted recipes and share snapshots to ordered canonical sections, added strict CHECK constraints, replaced canonical share acceptance and new-user seed writes, and froze the old structure columns as unsynchronized evidence for the removal slice.
17. **017_remove_legacy_recipe_structure.sql** - Removed the frozen recipe structure columns and migration-only converters after the section-only cutover, preserving canonical content and validators.
18. **018_shopping_document_cutover.sql** - Atomically converted Shopping state to `ShoppingDocumentV1`, installed the single-revision CAS contract and Pantry bridge, and removed contribution-era tables, columns, RPCs, and Shopping fields from `user_config`.
19. **019_personalized_shopping_order.sql** - Upgraded Shopping state to `ShoppingDocumentV2`, seeded reusable ingredient order from V1 row order plus deterministic fallback, absorbed derived category overrides, and installed strict V2 validation.
20. **020_shopping_document_v3.sql** - Added strict V3 semantic validation, preserved V2 compatibility and the V2 database default for a schema-first rollout, and updated the Pantry bridge to accept either version.

Historical baseline notes:
- Historical migrations are preserved under `supabase/migrations/archive/2026-03-09-pre-028-squash/` for context and backward auditability.
- Fresh environments apply the baseline and every tracked active incremental
  migration through `020`. The archived pre-baseline sequence is not replayed.
- Historical numbering describes the schema evolution incorporated into the
  baseline; it does not identify missing active migrations.

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
SELECT recipe_uuid, name, category, servings, ingredient_sections,
       instruction_sections, notes, image_url, created_at, updated_at
FROM recipes
WHERE user_id = auth.uid() 
ORDER BY created_at DESC;
```

### Get recipes by category
```sql
SELECT recipe_uuid, name, category, servings, ingredient_sections,
       instruction_sections, notes, image_url, created_at, updated_at
FROM recipes
WHERE user_id = auth.uid() 
  AND category = 'chicken'
ORDER BY name;
```

### Get recipe history for last 30 days
```sql
SELECT r.*, rh.date_made
FROM recipes r
JOIN recipe_history rh ON r.recipe_uuid = rh.recipe_uuid
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
- User-owned tables require their owner columns to be set for proper RLS
  enforcement; shares require sender and recipient ownership
- Recipe ingredient and instruction structure is stored only in the validated
  `ingredient_sections` and `instruction_sections` JSONB columns
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
   From `web/`, run `npm run db:preflight`. For a separately reviewed
   single-migration rollout, pass the exact pending tail explicitly, for
   example `npm run db:preflight -- --expected-pending 016`.
6. Push to the intentionally linked remote project.
   Run `npx supabase --workdir .. db push`.
7. Regenerate types from the linked remote after a successful push.
   From `web/`, run `npm run db:types:regen:linked`.
8. Re-run validation.
   At minimum, run `npm run typecheck` and the relevant tests from `web/`.

### Preflight Checklist Before `supabase db push`

- Run `cd web && npm run db:preflight`.
- Confirm the linked project/environment is the one you intend to change.
- Review `supabase migration list` output and verify local and remote entries
  line up row-for-row. Preflight also verifies every active local SQL file
  against the reviewed `supabase/migration-checksums.json` registry. This
  registry is a local-file integrity guard only. `supabase migration list`
  provides version alignment, not remote checksums, names, or statement
  metadata, so `db:preflight` does not claim to verify those remote fields.
- Stop if a migration exists only locally, only remotely, or the IDs differ
  between columns. The only exception is an explicitly supplied
  `--expected-pending VERSION` that identifies exactly one known local tail
  migration.
- Treat a missing, malformed, duplicate, unknown, non-tail, or mismatched
  expected-pending value as invalid configuration, not permission to proceed.
- Supply the exception only as an explicit current-command argv option:
  `npm run db:preflight -- --expected-pending VERSION`. Environment variables,
  `.npmrc`, npm configuration, package configuration, and positional values do
  not authorize a pending migration.
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

- The repository's tracked active chain and remote ledger do not align
  row-for-row after accounting for the documented baseline squash.
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
Its expected-pending option is a narrow ledger/readiness assertion and never
grants migration authorization.

The migration-specific `Backup-RecipeGenieProduction.ps1 -PreflightOnly`
workflow independently queries the connected ledger for the exact expected
version set and runs the commit-bound, read-only SQL preflight against remote
schema and data invariants. Neither that workflow nor `db:preflight` compares a
remote checksum to the local SQL file or treats remote name/statement metadata
as a file-integrity proof.

`supabase/migration-checksums.json` must exactly cover the active migration
directory. Add a reviewed checksum entry with each new migration; never update
an existing entry merely to make preflight pass.

### Post-Migration Checklist

- Regenerate local or linked types, depending on the workflow stage.
  Use `cd web && npm run db:types:regen` for local parity and `cd web && npm run db:types:regen:linked` after a linked remote push.
- Run `cd web && npm run typecheck`.
- Run the relevant tests for the affected behavior.
- Verify the new database objects exist as intended in the target environment.
- If the schema change affects docs or operational assumptions, update this file in the same branch.

### Command Reference

- Local rebuild: `npx supabase start` then `npx supabase db reset --local`
- Preflight aligned linked remote: `cd web && npm run db:preflight`
- Preflight one reviewed pending tail migration:
  `cd web && npm run db:preflight -- --expected-pending <version>`
- Push linked remote: `npx supabase --workdir .. db push`
- Generate local types: `cd web && npm run db:types:regen`
- Generate linked remote types: `cd web && npm run db:types:regen:linked`
- Check generated type parity against committed baseline: `cd web && npm run db:types:check`

## Historical Identity-Migration Implementation Notes

The following sections preserve implementation and rollout reasoning for
migrations 008 and 009. Statements about what "must deploy next," production
being on an older migration, or a later stage being blocked describe the state
when those migrations were reviewed. They are not current rollout
instructions. The current authoritative chain ends at migration 020, and the
current compatibility state is documented near the top of this file.

### Migration 008 planner-reference reconciliation invariant

Migration `008_reconcile_stale_planner_references.sql` is a forward-only, removal-only reconciliation that must complete before Stage 2 of recipe UUID identity migration. It does not change the `recipes` primary key, recipe UUID schema, application APIs, or planner behavior.

The permanent `private.planner_reference_reconciliation_audit` table is operator-only and stores non-sensitive evidence for the four approved active-field removals. Application roles have no schema, table, sequence, helper-function, or procedure privileges. The migration-specific `private.reconcile_stale_planner_reference_008` procedure is retained solely so isolated database contracts can exercise the exact production implementation; all application-role execution privileges are revoked.

The reconciliation invariant is: every recipe reference in `weekly_plans.recipe_ids`, every top-level `weekly_plans.day_assignments` key, and every value in `weekly_plans.made_recipe_ids` must resolve exactly to a recipe with the same owner. Run `supabase/verification/active_planner_reference_audit.sql` as an operator; it returns counts only and must report zero for all three fields before Stage 2 begins.

A clean reset is explicitly recognized only when auth users and all relevant application tables are pristine before seed execution. In that state migration 008 installs its guarded mechanism and skips production fingerprints; pgTAP then creates representative Ref-A/Ref-B/Ref-C fixtures and verifies the same reconciliation path. Any populated environment must satisfy the exact approved global counts and row/field fingerprints or the migration aborts.

### Migration 009 UUID-reference trigger authority

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
