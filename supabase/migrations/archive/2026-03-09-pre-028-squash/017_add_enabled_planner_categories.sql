-- Add enabled_planner_categories to user_config
-- Default: NULL means all categories are enabled (backward compatible)
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS enabled_planner_categories TEXT[] DEFAULT NULL;

-- Comment explaining the field
COMMENT ON COLUMN user_config.enabled_planner_categories IS
  'Categories enabled for meal planner Quick Meal Mix. NULL = all categories enabled (default). Empty array = no categories enabled.';
