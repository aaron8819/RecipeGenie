-- Migration: Add planner settings to user_config
-- Migration: 009_planner_settings.sql

-- Add excluded_days column for day exclusion rules
-- Format: Array of day indices (0-6, where 0 = Sunday, 1 = Monday, etc.)
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS excluded_days INTEGER[] DEFAULT '{}'::integer[];

-- Add preferred_days column for preferred day placement
-- Format: Array of day indices (0-6) or null for no preference
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS preferred_days INTEGER[] DEFAULT NULL;

-- Add auto_assign_days column to control automatic day assignment
-- Format: Boolean, true = automatically assign days on generation
ALTER TABLE user_config
ADD COLUMN IF NOT EXISTS auto_assign_days BOOLEAN DEFAULT TRUE;

-- Add comments for documentation
COMMENT ON COLUMN user_config.excluded_days IS 'Day indices (0-6) to exclude from meal placement. 0=Sunday, 1=Monday, etc.';
COMMENT ON COLUMN user_config.preferred_days IS 'Preferred day indices (0-6) for meal placement, or null for no preference';
COMMENT ON COLUMN user_config.auto_assign_days IS 'Whether to automatically assign days to recipes when generating a meal plan';
