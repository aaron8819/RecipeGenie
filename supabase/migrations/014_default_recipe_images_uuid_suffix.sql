-- Fix default recipe image mapping for ID suffixes
-- Handles recipe IDs like <slug>-<uuid>

CREATE OR REPLACE FUNCTION public.set_default_recipe_images()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  base_id text;
BEGIN
  IF NEW.image_url IS NULL OR NEW.image_url = '' THEN
    base_id := regexp_replace(
      NEW.id,
      '-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
      ''
    );

    CASE base_id
      WHEN 'mac-and-cheese' THEN NEW.image_url := 'defaults/mac-and-cheese.webp';
      WHEN 'beef-and-broccoli' THEN NEW.image_url := 'defaults/beef-and-broccoli.webp';
      WHEN 'lamb-meatballs-gyros' THEN NEW.image_url := 'defaults/lamb-meatballs-gyros.webp';
      WHEN 'mediterranean-turkey-meatballs' THEN NEW.image_url := 'defaults/mediterranean-turkey-meatballs.webp';
      WHEN 'mexican-street-tacos-chicken' THEN NEW.image_url := 'defaults/mexican-street-tacos-chicken.webp';
      WHEN 'teriyaki-chicken-broccoli-bowls' THEN NEW.image_url := 'defaults/teriyaki-chicken-broccoli-bowls.webp';
      WHEN 'thai-basil-fried-rice' THEN NEW.image_url := 'defaults/thai-basil-fried-rice.webp';
      WHEN 'turkey-burger' THEN NEW.image_url := 'defaults/turkey-burger.webp';
      ELSE
        NULL;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$;

-- Backfill existing default recipes that are missing images (ID includes uuid suffix)
UPDATE public.recipes
SET image_url = CASE
  WHEN id LIKE 'mac-and-cheese-%' THEN 'defaults/mac-and-cheese.webp'
  WHEN id LIKE 'beef-and-broccoli-%' THEN 'defaults/beef-and-broccoli.webp'
  WHEN id LIKE 'lamb-meatballs-gyros-%' THEN 'defaults/lamb-meatballs-gyros.webp'
  WHEN id LIKE 'mediterranean-turkey-meatballs-%' THEN 'defaults/mediterranean-turkey-meatballs.webp'
  WHEN id LIKE 'mexican-street-tacos-chicken-%' THEN 'defaults/mexican-street-tacos-chicken.webp'
  WHEN id LIKE 'teriyaki-chicken-broccoli-bowls-%' THEN 'defaults/teriyaki-chicken-broccoli-bowls.webp'
  WHEN id LIKE 'thai-basil-fried-rice-%' THEN 'defaults/thai-basil-fried-rice.webp'
  WHEN id LIKE 'turkey-burger-%' THEN 'defaults/turkey-burger.webp'
  ELSE image_url
END
WHERE (image_url IS NULL OR image_url = '')
AND (
  id LIKE 'mac-and-cheese-%' OR
  id LIKE 'beef-and-broccoli-%' OR
  id LIKE 'lamb-meatballs-gyros-%' OR
  id LIKE 'mediterranean-turkey-meatballs-%' OR
  id LIKE 'mexican-street-tacos-chicken-%' OR
  id LIKE 'teriyaki-chicken-broccoli-bowls-%' OR
  id LIKE 'thai-basil-fried-rice-%' OR
  id LIKE 'turkey-burger-%'
);
