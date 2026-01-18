# Recipe Genie - Supabase Database Schema Documentation

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
- [Indexes](#indexes)
- [Row Level Security (RLS)](#row-level-security-rls)
- [Functions](#functions)
- [Triggers](#triggers)
- [Relationships](#relationships)

## Overview

The Recipe Genie database is designed for multi-user support with complete data isolation between users. All tables include a `user_id` column that references `auth.users(id)`, and Row Level Security (RLS) policies ensure users can only access their own data.

The schema supports:
- Recipe storage with ingredients and instructions
- Pantry item management
- User configuration and preferences
- Recipe history tracking
- Weekly meal planning
- Shopping list generation

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
| `ingredients` | JSONB | NOT NULL, DEFAULT '[]' | Array of ingredient objects with `item`, `unit`, and `amount` |
| `instructions` | TEXT[] | NOT NULL, DEFAULT '{}' | Array of instruction steps |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when recipe was created |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when recipe was last updated |

**Example ingredient JSONB structure:**
```json
[
  {
    "item": "chicken thighs",
    "unit": "lbs",
    "amount": 1.5
  },
  {
    "item": "garlic",
    "unit": "cloves",
    "amount": 3
  }
]
```

### pantry_items

Stores items in the user's pantry.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `item` | TEXT | PRIMARY KEY (composite with user_id) | Pantry item name |
| `user_id` | UUID | FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the pantry item |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when item was added |

**Note:** The primary key is a composite of `(user_id, item)` enforced by a unique index.

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
| `category_overrides` | JSONB | DEFAULT '{}' | User-defined category overrides for shopping list items (maps item names to category keys) |

**Example category_overrides JSONB:**
```json
{
  "sun dried tomatoes": "pantry",
  "olive oil": "pantry"
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

### weekly_plans

Stores weekly meal plans for users.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | UUID | PRIMARY KEY (composite with week_date), FOREIGN KEY → `auth.users(id)` ON DELETE CASCADE | Owner of the plan |
| `week_date` | DATE | PRIMARY KEY (composite with user_id) | Start date of the week (typically Monday) |
| `recipe_ids` | TEXT[] | NOT NULL, DEFAULT '{}' | Array of recipe IDs in the plan |
| `scale` | NUMERIC | DEFAULT 1.0 | Scaling factor for recipe servings |
| `made_recipe_ids` | TEXT[] | DEFAULT '{}' | Recipe IDs marked as "made" for this specific week (for toggle state) |
| `generated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when plan was generated |

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
| `generated_at` | TIMESTAMPTZ | DEFAULT NOW() | Timestamp when list was generated |

## Indexes

### recipes
- `idx_recipes_category` - Index on `category` for filtering by category
- `idx_recipes_favorite` - Partial index on `favorite` WHERE `favorite = TRUE` for quick favorite queries
- `idx_recipes_user_id` - Index on `user_id` for user-specific queries

### pantry_items
- `idx_pantry_items_user_id` - Index on `user_id` for user-specific queries
- `idx_pantry_items_user_item` - Unique index on `(user_id, item)` for composite primary key

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

All policies use `FOR ALL` operations (SELECT, INSERT, UPDATE, DELETE) with:
- `USING (auth.uid() = user_id)` - For SELECT operations
- `WITH CHECK (auth.uid() = user_id)` - For INSERT/UPDATE operations

## Functions

### update_updated_at_column()

Automatically updates the `updated_at` timestamp when a row is modified.

**Returns:** `TRIGGER`

**Language:** `plpgsql`

**Usage:** Used by trigger on `recipes` table.

### insert_default_recipes_for_user(p_user_id UUID)

Inserts default recipes for a new user when they sign up. Creates 9 default recipes:
1. 4-Ingredient Mac & Cheese (vegetarian)
2. Beef and Broccoli (beef, favorite)
3. Lamb Meatball Gyros (lamb)
4. Mediterranean Meatballs (turkey, favorite)
5. Mexican Street Tacos (chicken, favorite)
6. Teriyaki Chicken and Broccoli Rice Bowls (chicken, favorite)
7. Thai Basil Fried Rice (chicken, favorite)
8. Turkey Burger (turkey)

Also creates default `user_config` and empty `shopping_list` for the user.

**Parameters:**
- `p_user_id` (UUID) - The user ID to create recipes for

**Returns:** `void`

**Language:** `plpgsql SECURITY DEFINER`

**Security:** Runs with elevated privileges to insert data for any user.

### handle_new_user()

Trigger function that calls `insert_default_recipes_for_user()` when a new user is created in `auth.users`. Includes error handling to ensure user creation succeeds even if default recipe insertion fails.

**Returns:** `TRIGGER`

**Language:** `plpgsql SECURITY DEFINER`

**Security:** Runs with elevated privileges with explicit `SET search_path = public`.

**Error Handling:** Wraps recipe insertion in a BEGIN/EXCEPTION block to log errors as warnings without failing the user creation transaction.

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

## Relationships

```
auth.users (Supabase Auth)
  ├── recipes (user_id → auth.users.id)
  │   └── recipe_history (recipe_id → recipes.id)
  ├── pantry_items (user_id → auth.users.id)
  ├── user_config (user_id → auth.users.id)
  ├── weekly_plans (user_id → auth.users.id)
  └── shopping_list (user_id → auth.users.id)
```

### Foreign Key Relationships

1. **recipes.user_id** → `auth.users(id)` ON DELETE CASCADE
2. **pantry_items.user_id** → `auth.users(id)` ON DELETE CASCADE
3. **user_config.user_id** → `auth.users(id)` ON DELETE CASCADE
4. **recipe_history.user_id** → `auth.users(id)` ON DELETE CASCADE
5. **recipe_history.recipe_id** → `recipes(id)` ON DELETE CASCADE
6. **weekly_plans.user_id** → `auth.users(id)` ON DELETE CASCADE
7. **shopping_list.user_id** → `auth.users(id)` ON DELETE CASCADE

All foreign keys use `ON DELETE CASCADE`, meaning if a user is deleted, all their associated data is automatically deleted.

## Migration History

The schema has evolved through the following migrations:

1. **001_initial_schema.sql** - Initial single-user schema with all core tables
2. **002_add_category_overrides.sql** - Added `category_overrides` to `user_config` for custom shopping list categorization
3. **003_add_made_recipe_ids.sql** - Added `made_recipe_ids` to `weekly_plans` to track which recipes were marked as "made" per week
4. **004_merge_steak_into_beef.sql** - Merged 'steak' category into 'beef' category
5. **005_multi_user_support.sql** - Added full multi-user support with `user_id` columns, updated RLS policies, and default recipes trigger
6. **006_fix_signup_trigger.sql** - Improved signup trigger error handling with explicit search_path and graceful error handling

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
- Default recipes are automatically created for new users via the `on_auth_user_created` trigger
- Composite primary keys are enforced via unique indexes rather than traditional PRIMARY KEY constraints for tables that were migrated from single-user to multi-user
