-- Align shopping RPC identity contracts with stable ShoppingItem.rowId.

DROP FUNCTION IF EXISTS public.toggle_shopping_item_checked(TEXT);
DROP FUNCTION IF EXISTS public.move_shopping_item_to_pantry(TEXT, INTEGER, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION public.toggle_shopping_item_checked(
  p_row_id TEXT
)
RETURNS TABLE (
  row_id TEXT,
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
    AND COALESCE(e.elem->>'rowId', '') = p_row_id;

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
    p_row_id AS row_id,
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

CREATE OR REPLACE FUNCTION public.move_shopping_item_to_pantry(
  p_row_id TEXT,
  p_pantry_qty NUMERIC,
  p_pantry_unit TEXT
)
RETURNS TABLE (
  removed_item JSONB,
  pantry_item JSONB,
  shopping_list_updated_at TIMESTAMPTZ,
  pantry_was_inserted BOOLEAN
)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_items JSONB;
  v_already_have JSONB;
  v_updated_already_have JSONB;
  v_target JSONB;
  v_updated_at TIMESTAMPTZ;
  v_normalized_item TEXT;
  v_pantry_created_at TIMESTAMPTZ;
  v_inserted BOOLEAN;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT sl.items, sl.already_have
  INTO v_items, v_already_have
  FROM public.shopping_list sl
  WHERE sl.user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shopping list not found';
  END IF;

  SELECT e.elem
  INTO v_target
  FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(elem, ord)
  WHERE COALESCE(e.elem->>'rowId', '') = p_row_id
  LIMIT 1;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'shopping row not found';
  END IF;

  v_updated_already_have := COALESCE(v_already_have, '[]'::jsonb);
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_updated_already_have) AS ah(elem)
    WHERE COALESCE(ah.elem->>'rowId', '') = p_row_id
  ) THEN
    v_updated_already_have := v_updated_already_have || jsonb_build_array(v_target);
  END IF;

  UPDATE public.shopping_list sl
  SET items = (
      SELECT COALESCE(
        jsonb_agg(e.elem ORDER BY e.ord),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(elem, ord)
      WHERE COALESCE(e.elem->>'rowId', '') <> p_row_id
    ),
    already_have = v_updated_already_have,
    generated_at = NOW()
  WHERE sl.user_id = v_user_id
  RETURNING sl.generated_at
  INTO v_updated_at;

  v_normalized_item := lower(trim(COALESCE(v_target->>'item', '')));

  WITH inserted AS (
    INSERT INTO public.pantry_items (user_id, item)
    VALUES (v_user_id, v_normalized_item)
    ON CONFLICT (user_id, item) DO NOTHING
    RETURNING created_at
  )
  SELECT
    COALESCE((SELECT i.created_at FROM inserted i LIMIT 1), p.created_at) AS pantry_created_at,
    EXISTS(SELECT 1 FROM inserted) AS was_inserted
  INTO v_pantry_created_at, v_inserted
  FROM public.pantry_items p
  WHERE p.user_id = v_user_id
    AND p.item = v_normalized_item
  LIMIT 1;

  removed_item := jsonb_strip_nulls(
    jsonb_build_object(
      'rowId', v_target->>'rowId',
      'item', v_target->>'item',
      'amount', v_target->'amount',
      'unit', v_target->>'unit',
      'categoryKey', v_target->>'categoryKey',
      'categoryOrder', v_target->'categoryOrder'
    )
  );

  pantry_item := jsonb_strip_nulls(
    jsonb_build_object(
      'user_id', v_user_id,
      'item', v_normalized_item,
      'created_at', v_pantry_created_at,
      'amount', COALESCE(v_target->'amount', to_jsonb(p_pantry_qty)),
      'unit', COALESCE(NULLIF(v_target->>'unit', ''), NULLIF(p_pantry_unit, ''))
    )
  );

  shopping_list_updated_at := v_updated_at;
  pantry_was_inserted := v_inserted;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_shopping_item_checked(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_shopping_item_to_pantry(TEXT, NUMERIC, TEXT) TO authenticated;
