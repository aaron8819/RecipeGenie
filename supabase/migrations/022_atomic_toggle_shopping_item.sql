-- Atomic toggle for shopping item checked state.
-- SECURITY INVOKER (default) ensures RLS policies are enforced per caller.
-- Single UPDATE statement prevents client-side read-modify-write races.

CREATE OR REPLACE FUNCTION public.toggle_shopping_item_checked(
  p_user_id UUID,
  p_item_name TEXT
)
RETURNS TABLE (
  user_id UUID,
  item_name TEXT,
  checked BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SET search_path = public
AS $$
  WITH updated AS (
    UPDATE public.shopping_list sl
    SET items = (
      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN lower(trim(elem->>'item')) = lower(trim(p_item_name)) THEN
              jsonb_set(
                elem,
                '{checked}',
                to_jsonb(NOT COALESCE((elem->>'checked')::boolean, FALSE)),
                TRUE
              )
            ELSE elem
          END
          ORDER BY ord
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(sl.items) WITH ORDINALITY AS e(elem, ord)
    )
    WHERE sl.user_id = p_user_id
      AND auth.uid() = p_user_id
    RETURNING
      sl.user_id,
      sl.items
  )
  SELECT
    u.user_id,
    p_item_name AS item_name,
    (
      SELECT COALESCE((elem->>'checked')::boolean, FALSE)
      FROM jsonb_array_elements(u.items) AS arr(elem)
      WHERE lower(trim(elem->>'item')) = lower(trim(p_item_name))
      LIMIT 1
    ) AS checked,
    NOW() AS updated_at
  FROM updated u;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_shopping_item_checked(UUID, TEXT) TO authenticated;
