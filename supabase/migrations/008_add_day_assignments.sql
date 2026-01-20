-- Migration: Add day_assignments column to weekly_plans
-- This stores which day of the week each recipe is assigned to
-- Format: JSONB object mapping recipe_id -> day_index (0-6, where 0 = Sunday)

ALTER TABLE weekly_plans
ADD COLUMN IF NOT EXISTS day_assignments JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN weekly_plans.day_assignments IS 'Maps recipe_id to day_index (0-6) for the week. Example: {"recipe-1": 0, "recipe-2": 3}';
