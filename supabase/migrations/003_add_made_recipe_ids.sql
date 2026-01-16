-- Add made_recipe_ids to weekly_plans for week-specific "made" tracking
-- This tracks which recipes have been marked as "made" for each specific week

ALTER TABLE weekly_plans
ADD COLUMN IF NOT EXISTS made_recipe_ids TEXT[] DEFAULT '{}';

-- Add comment explaining the column
COMMENT ON COLUMN weekly_plans.made_recipe_ids IS 'Recipe IDs marked as "made" for this specific week (for toggle state)';
