-- Check recipes for user fe78a660-188d-47d2-a26c-9a503df08dce
-- Run this in Supabase SQL Editor

-- 1. Overview: All recipes with name lengths
SELECT
  id,
  name,
  LENGTH(name) as name_length,
  category,
  image_url,
  created_at,
  updated_at
FROM recipes
WHERE user_id = 'fe78a660-188d-47d2-a26c-9a503df08dce'
ORDER BY LENGTH(name) DESC;

-- 2. Summary statistics
SELECT
  COUNT(*) as total_recipes,
  ROUND(AVG(LENGTH(name))::numeric, 1) as avg_name_length,
  MIN(LENGTH(name)) as min_name_length,
  MAX(LENGTH(name)) as max_name_length,
  COUNT(CASE WHEN LENGTH(name) > 80 THEN 1 END) as names_over_80_chars,
  COUNT(CASE WHEN LENGTH(name) > 150 THEN 1 END) as names_over_150_chars
FROM recipes
WHERE user_id = 'fe78a660-188d-47d2-a26c-9a503df08dce';

-- 3. Find recipes with very long names (potential parser bug victims)
SELECT
  id,
  LEFT(name, 200) as name_preview,
  LENGTH(name) as name_length,
  category,
  created_at
FROM recipes
WHERE user_id = 'fe78a660-188d-47d2-a26c-9a503df08dce'
  AND LENGTH(name) > 100
ORDER BY LENGTH(name) DESC;

-- 4. Check for the specific pretzel recipe pattern
SELECT
  id,
  name,
  LENGTH(name) as name_length,
  category,
  created_at
FROM recipes
WHERE user_id = 'fe78a660-188d-47d2-a26c-9a503df08dce'
  AND (
    LOWER(name) LIKE '%bavarian%pretzel%'
    OR LOWER(name) LIKE '%laugenbrezeln%'
    OR LOWER(name) LIKE '%baking soda bath%'
  );

-- 5. Check if any recipes have images (and what the storage paths look like)
SELECT
  id,
  LEFT(name, 50) as name_preview,
  image_url,
  CASE
    WHEN image_url IS NULL THEN 'No image'
    WHEN image_url LIKE '%supabase%' THEN 'Supabase Storage'
    ELSE 'External URL'
  END as image_source
FROM recipes
WHERE user_id = 'fe78a660-188d-47d2-a26c-9a503df08dce'
ORDER BY created_at DESC;
