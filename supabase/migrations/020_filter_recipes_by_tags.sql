-- RPC function for OR-logic tag filtering.
-- Supabase .contains() uses AND (all tags must match); the && operator
-- returns rows where the tags column overlaps with p_tags (any match).
-- This replaces the client-side filter loop in useRecipes() when tags are selected.

CREATE OR REPLACE FUNCTION filter_recipes_by_tags(p_user_id UUID, p_tags TEXT[])
RETURNS SETOF recipes
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM recipes
  WHERE user_id = p_user_id
    AND tags && p_tags
  ORDER BY name ASC;
$$;
