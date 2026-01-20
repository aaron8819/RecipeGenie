-- Add support for custom shopping categories and category ordering
-- Migration: 007_custom_categories.sql

-- Add custom_categories column for user-defined categories
-- Format: [{ "id": "uuid", "name": "Asian Market", "order": 9 }]
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS custom_categories JSONB DEFAULT '[]'::jsonb;

-- Add category_order column for custom category ordering
-- Format: ["produce", "dairy", "protein", ...] or null for default order
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS category_order JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN user_config.custom_categories IS 'User-defined shopping categories: [{ "id": "uuid", "name": "Category Name", "order": number }]';
COMMENT ON COLUMN user_config.category_order IS 'Custom order for all categories (array of category keys), null uses default order';
