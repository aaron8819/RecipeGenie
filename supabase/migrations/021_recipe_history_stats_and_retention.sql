-- Aggregated recipe history stats for UI surfaces that only need counts + last-made.
CREATE OR REPLACE FUNCTION get_recipe_history_stats(p_user_id UUID)
RETURNS TABLE (
  recipe_id TEXT,
  times_made INTEGER,
  last_made TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    rh.recipe_id,
    COUNT(*)::INTEGER AS times_made,
    MAX(rh.date_made) AS last_made
  FROM recipe_history rh
  WHERE rh.user_id = p_user_id
  GROUP BY rh.recipe_id
  ORDER BY MAX(rh.date_made) DESC;
$$;

-- Preserve historical records when a recipe is deleted.
DO $$
DECLARE
  recipe_history_fk_name TEXT;
BEGIN
  SELECT conname
  INTO recipe_history_fk_name
  FROM pg_constraint
  WHERE conrelid = 'public.recipe_history'::regclass
    AND contype = 'f'
    AND confrelid = 'public.recipes'::regclass;

  IF recipe_history_fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.recipe_history DROP CONSTRAINT %I',
      recipe_history_fk_name
    );
  END IF;
END
$$;
