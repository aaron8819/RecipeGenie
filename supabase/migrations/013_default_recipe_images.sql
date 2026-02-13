-- Set default recipe images for new users and backfill existing defaults
-- Uses storage path so public URL is resolved client-side.

CREATE OR REPLACE FUNCTION public.set_default_recipe_images()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.image_url IS NULL OR NEW.image_url = '' THEN
    CASE NEW.id
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

DROP TRIGGER IF EXISTS set_default_recipe_images ON public.recipes;
CREATE TRIGGER set_default_recipe_images
BEFORE INSERT ON public.recipes
FOR EACH ROW
EXECUTE FUNCTION public.set_default_recipe_images();

-- Backfill existing default recipes that are missing images
UPDATE public.recipes
SET image_url = CASE id
  WHEN 'mac-and-cheese' THEN 'defaults/mac-and-cheese.webp'
  WHEN 'beef-and-broccoli' THEN 'defaults/beef-and-broccoli.webp'
  WHEN 'lamb-meatballs-gyros' THEN 'defaults/lamb-meatballs-gyros.webp'
  WHEN 'mediterranean-turkey-meatballs' THEN 'defaults/mediterranean-turkey-meatballs.webp'
  WHEN 'mexican-street-tacos-chicken' THEN 'defaults/mexican-street-tacos-chicken.webp'
  WHEN 'teriyaki-chicken-broccoli-bowls' THEN 'defaults/teriyaki-chicken-broccoli-bowls.webp'
  WHEN 'thai-basil-fried-rice' THEN 'defaults/thai-basil-fried-rice.webp'
  WHEN 'turkey-burger' THEN 'defaults/turkey-burger.webp'
  ELSE image_url
END
WHERE id IN (
  'mac-and-cheese',
  'beef-and-broccoli',
  'lamb-meatballs-gyros',
  'mediterranean-turkey-meatballs',
  'mexican-street-tacos-chicken',
  'teriyaki-chicken-broccoli-bowls',
  'thai-basil-fried-rice',
  'turkey-burger'
)
AND (image_url IS NULL OR image_url = '');
