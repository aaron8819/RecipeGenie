-- Migration: Merge 'steak' category into 'beef'
-- All recipes with category 'steak' become 'beef'
-- User config is updated to remove 'steak' and ensure 'beef' exists

-- ============================================================================
-- 1. Update all recipes with category 'steak' to 'beef'
-- ============================================================================
UPDATE recipes
SET category = 'beef'
WHERE category = 'steak';

-- ============================================================================
-- 2. Update user_config to merge steak into beef
-- ============================================================================
UPDATE user_config
SET 
  -- Remove 'steak' from categories array, add 'beef' if not present
  categories = (
    SELECT ARRAY(
      SELECT DISTINCT unnest
      FROM unnest(
        array_cat(
          array_remove(categories, 'steak'),
          ARRAY['beef']
        )
      )
      ORDER BY unnest
    )
  ),
  -- Update default_selection: combine steak count into beef, remove steak key
  default_selection = (
    CASE 
      WHEN default_selection ? 'steak' THEN
        (default_selection - 'steak') || 
        jsonb_build_object(
          'beef', 
          COALESCE((default_selection->>'beef')::int, 0) + 
          COALESCE((default_selection->>'steak')::int, 0)
        )
      ELSE
        default_selection
    END
  )
WHERE id = 1;
