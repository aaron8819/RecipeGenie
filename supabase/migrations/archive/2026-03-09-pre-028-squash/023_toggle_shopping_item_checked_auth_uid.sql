-- Harden shopping check-off RPC by deriving user id from auth context.
-- Keep SECURITY INVOKER (default) so caller RLS applies.

DROP FUNCTION IF EXISTS public.toggle_shopping_item_checked(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.toggle_shopping_item_checked(
  p_item_name TEXT
)
RETURNS TABLE (
  item_name TEXT,
  checked BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_match_ord BIGINT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT MIN(e.ord)
  INTO v_match_ord
  FROM public.shopping_list sl
  CROSS JOIN LATERAL jsonb_array_elements(sl.items) WITH ORDINALITY AS e(elem, ord)
  WHERE sl.user_id = v_user_id
    AND e.elem->>'item' = p_item_name;

  IF v_match_ord IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH updated AS (
    UPDATE public.shopping_list sl
    SET items = (
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN e.ord = v_match_ord THEN
              jsonb_set(
                e.elem,
                '{checked}',
                to_jsonb(NOT COALESCE((e.elem->>'checked')::boolean, FALSE)),
                TRUE
              )
            ELSE e.elem
          END
          ORDER BY e.ord
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(sl.items) WITH ORDINALITY AS e(elem, ord)
    ),
    generated_at = NOW()
    WHERE sl.user_id = v_user_id
    RETURNING sl.items, sl.generated_at
  )
  SELECT
    p_item_name AS item_name,
    (
      SELECT COALESCE((e.elem->>'checked')::boolean, FALSE)
      FROM jsonb_array_elements(u.items) WITH ORDINALITY AS e(elem, ord)
      WHERE e.ord = v_match_ord
      LIMIT 1
    ) AS checked,
    u.generated_at AS updated_at
  FROM updated u;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_shopping_item_checked(TEXT) TO authenticated;
