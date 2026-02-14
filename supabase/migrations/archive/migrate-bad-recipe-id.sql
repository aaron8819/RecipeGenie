-- Migration script to fix the pretzel recipe with invalid ID
-- Run this in Supabase SQL Editor

-- IMPORTANT: This migration will:
-- 1. Create a new recipe with a proper sanitized ID
-- 2. Copy all data from the old recipe
-- 3. Update any references in other tables (recipe_history, weekly_plans)
-- 4. Delete the old recipe with the bad ID

DO $$
DECLARE
  old_id TEXT := 'here''s-a-classic-bavarian-style-soft-pretzel-recipe-(laugenbrezeln)-that-skips-the-traditional-lye-bath-entirely.-instead,-it-uses-a-simple-baking-soda-bath-(the-most-common-safe-substitute-for-home-cooks)-to-get-that-signature-golden-brown-crust,-chewy-texture,-and-authentic-pretzel-flavor.-this-version-is-adapted-from-popular-german-inspired-recipes-and-yields-about-10–12-medium-pretzels.';
  new_id TEXT := 'bavarian-style-soft-pretzel-laugenbrezeln';
  target_user_id UUID := 'fe78a660-188d-47d2-a26c-9a503df08dce';
BEGIN
  RAISE NOTICE 'Starting migration for recipe ID: %', old_id;

  -- Step 1: Show the problematic recipe before migration
  RAISE NOTICE 'Old recipe details:';
  PERFORM id, name, LENGTH(id) as id_length
  FROM recipes
  WHERE user_id = target_user_id
    AND id = old_id;

  -- Step 2: Create the new recipe with proper ID
  INSERT INTO recipes (
    id,
    user_id,
    name,
    category,
    servings,
    favorite,
    tags,
    ingredients,
    instructions,
    image_url,
    created_at,
    updated_at
  )
  SELECT
    new_id as id,
    user_id,
    name,
    category,
    servings,
    favorite,
    tags,
    ingredients,
    instructions,
    image_url,
    created_at,
    updated_at
  FROM recipes
  WHERE user_id = target_user_id
    AND id = old_id
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Created new recipe with ID: %', new_id;

  -- Step 3: Update recipe_history references (if any)
  UPDATE recipe_history
  SET recipe_id = new_id
  WHERE user_id = target_user_id
    AND recipe_id = old_id;

  RAISE NOTICE 'Updated recipe_history references';

  -- Step 4: Update weekly_plans.recipe_ids array
  UPDATE weekly_plans
  SET recipe_ids = array_replace(recipe_ids, old_id, new_id)
  WHERE user_id = target_user_id
    AND old_id = ANY(recipe_ids);

  RAISE NOTICE 'Updated weekly_plans.recipe_ids array';

  -- Step 5: Update weekly_plans.day_assignments JSONB
  UPDATE weekly_plans
  SET day_assignments = (
    SELECT jsonb_object_agg(
      CASE WHEN key = old_id THEN new_id ELSE key END,
      value
    )
    FROM jsonb_each(day_assignments)
  )
  WHERE user_id = target_user_id
    AND day_assignments ? old_id;

  RAISE NOTICE 'Updated weekly_plans.day_assignments';

  -- Step 6: Update weekly_plans.made_recipe_ids array
  UPDATE weekly_plans
  SET made_recipe_ids = array_replace(made_recipe_ids, old_id, new_id)
  WHERE user_id = target_user_id
    AND old_id = ANY(made_recipe_ids);

  RAISE NOTICE 'Updated weekly_plans.made_recipe_ids';

  -- Step 7: Delete the old recipe with bad ID
  DELETE FROM recipes
  WHERE user_id = target_user_id
    AND id = old_id;

  RAISE NOTICE 'Deleted old recipe with bad ID';

  -- Step 8: Verify the migration
  RAISE NOTICE 'Verification - new recipe:';
  PERFORM id, name, LENGTH(id) as id_length, image_url
  FROM recipes
  WHERE user_id = target_user_id
    AND id = new_id;

  RAISE NOTICE 'Migration completed successfully!';
END $$;

-- Final verification query
SELECT
  id,
  name,
  LENGTH(id) as id_length,
  category,
  image_url,
  created_at
FROM recipes
WHERE user_id = 'fe78a660-188d-47d2-a26c-9a503df08dce'
  AND (id LIKE '%bavarian%' OR name LIKE '%Bavarian%')
ORDER BY created_at DESC;
