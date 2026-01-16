-- Add category_overrides column to user_config
-- This stores user's preferences for item categorization (e.g., "sun dried tomatoes" -> "pantry")

ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS category_overrides JSONB DEFAULT '{}';

-- Add a comment to explain the column
COMMENT ON COLUMN user_config.category_overrides IS 'User category overrides for shopping list items. Maps item names (lowercase) to category keys.';
