-- Atomic weekly planner made/unmade toggle.
-- One RPC updates recipe_history and weekly_plans in a single transaction.

DROP FUNCTION IF EXISTS public.toggle_weekly_recipe_made(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION public.toggle_weekly_recipe_made(
  p_recipe_id TEXT,
  p_week_date TEXT,
  p_is_made_for_week BOOLEAN,
  p_date_made TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  action TEXT,
  recipe_id TEXT,
  week_date TEXT,
  made_recipe_ids TEXT[],
  history_date_made TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_week_date DATE;
  v_made_recipe_ids TEXT[];
  v_history_date TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_week_date := p_week_date::date;

  SELECT wp.made_recipe_ids
  INTO v_made_recipe_ids
  FROM public.weekly_plans wp
  WHERE wp.user_id = v_user_id
    AND wp.week_date = v_week_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'weekly plan not found';
  END IF;

  IF p_is_made_for_week THEN
    WITH latest AS (
      SELECT rh.id
      FROM public.recipe_history rh
      WHERE rh.user_id = v_user_id
        AND rh.recipe_id = p_recipe_id
      ORDER BY rh.date_made DESC, rh.id DESC
      LIMIT 1
    )
    DELETE FROM public.recipe_history rh
    USING latest
    WHERE rh.id = latest.id;

    UPDATE public.weekly_plans wp
    SET made_recipe_ids = array_remove(COALESCE(wp.made_recipe_ids, '{}'::text[]), p_recipe_id)
    WHERE wp.user_id = v_user_id
      AND wp.week_date = v_week_date
    RETURNING wp.made_recipe_ids
    INTO v_made_recipe_ids;

    action := 'unmarked';
    recipe_id := p_recipe_id;
    week_date := v_week_date::text;
    made_recipe_ids := COALESCE(v_made_recipe_ids, '{}'::text[]);
    history_date_made := NULL;

    RETURN NEXT;
    RETURN;
  END IF;

  v_history_date := COALESCE(p_date_made, NOW());

  INSERT INTO public.recipe_history (user_id, recipe_id, date_made)
  VALUES (v_user_id, p_recipe_id, v_history_date);

  UPDATE public.weekly_plans wp
  SET made_recipe_ids = CASE
    WHEN p_recipe_id = ANY(COALESCE(wp.made_recipe_ids, '{}'::text[])) THEN COALESCE(wp.made_recipe_ids, '{}'::text[])
    ELSE array_append(COALESCE(wp.made_recipe_ids, '{}'::text[]), p_recipe_id)
  END
  WHERE wp.user_id = v_user_id
    AND wp.week_date = v_week_date
  RETURNING wp.made_recipe_ids
  INTO v_made_recipe_ids;

  action := 'marked';
  recipe_id := p_recipe_id;
  week_date := v_week_date::text;
  made_recipe_ids := COALESCE(v_made_recipe_ids, '{}'::text[]);
  history_date_made := v_history_date;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_weekly_recipe_made(TEXT, TEXT, BOOLEAN, TIMESTAMPTZ) TO authenticated;
