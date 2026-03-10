


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."accept_recipe_share"("p_share_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_share public.recipe_shares%rowtype;
  v_name text;
  v_category text;
  v_servings integer;
  v_image_url text;
  v_tags text[];
  v_instructions text[];
  v_ingredients jsonb;
  v_base_id text;
  v_new_recipe_id text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select *
  into v_share
  from public.recipe_shares
  where id = p_share_id
    and recipient_user_id = v_user_id
  for update;

  if not found then
    raise exception 'Share not found';
  end if;

  if v_share.status = 'accepted' and v_share.accepted_recipe_id is not null then
    return v_share.accepted_recipe_id;
  end if;

  if v_share.status <> 'pending' then
    raise exception 'Share is no longer pending';
  end if;

  v_name := coalesce(nullif(trim(v_share.source_recipe_snapshot->>'name'), ''), 'Shared Recipe');
  v_category := coalesce(
    nullif(trim(v_share.source_recipe_snapshot->>'category'), ''),
    'uncategorized'
  );
  v_servings := coalesce((v_share.source_recipe_snapshot->>'servings')::integer, 4);
  v_image_url := nullif(trim(v_share.source_recipe_snapshot->>'image_url'), '');
  v_ingredients := coalesce(v_share.source_recipe_snapshot->'ingredients', '[]'::jsonb);

  select coalesce(array_agg(value), '{}'::text[])
  into v_tags
  from jsonb_array_elements_text(
    coalesce(v_share.source_recipe_snapshot->'tags', '[]'::jsonb)
  );

  select coalesce(array_agg(value), '{}'::text[])
  into v_instructions
  from jsonb_array_elements_text(
    coalesce(v_share.source_recipe_snapshot->'instructions', '[]'::jsonb)
  );

  v_base_id := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_id := trim(both '-' from v_base_id);
  if v_base_id = '' then
    v_base_id := 'shared-recipe';
  end if;
  v_new_recipe_id := v_base_id || '-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into public.recipes (
    id,
    user_id,
    name,
    category,
    servings,
    favorite,
    tags,
    ingredients,
    instructions,
    image_url
  )
  values (
    v_new_recipe_id,
    v_user_id,
    v_name,
    v_category,
    v_servings,
    false,
    v_tags,
    v_ingredients,
    v_instructions,
    v_image_url
  );

  update public.recipe_shares
  set
    status = 'accepted',
    accepted_recipe_id = v_new_recipe_id,
    responded_at = now()
  where id = v_share.id;

  return v_new_recipe_id;
end;
$$;


ALTER FUNCTION "public"."accept_recipe_share"("p_share_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_tag"("p_user_id" "uuid", "p_tag" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE recipes
  SET tags = array_remove(tags, p_tag)
  WHERE user_id = p_user_id
    AND p_tag = ANY(tags);
$$;


ALTER FUNCTION "public"."delete_tag"("p_user_id" "uuid", "p_tag" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" NOT NULL,
    "servings" integer DEFAULT 4 NOT NULL,
    "favorite" boolean DEFAULT false,
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "ingredients" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "instructions" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."recipes" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."filter_recipes_by_tags"("p_user_id" "uuid", "p_tags" "text"[]) RETURNS SETOF "public"."recipes"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT * FROM recipes
  WHERE user_id = p_user_id
    AND tags && p_tags
  ORDER BY name ASC;
$$;


ALTER FUNCTION "public"."filter_recipes_by_tags"("p_user_id" "uuid", "p_tags" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_recipe_history_stats"("p_user_id" "uuid") RETURNS TABLE("recipe_id" "text", "times_made" integer, "last_made" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."get_recipe_history_stats"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  BEGIN
    PERFORM public.insert_default_recipes_for_user(NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Could not insert defaults for user %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_default_recipes_for_user"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.user_config (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.shopping_list (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.recipes (id, user_id, name, category, servings, favorite, tags, ingredients, instructions)
  VALUES
    (
      'mac-and-cheese-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      p_user_id,
      '4-Ingredient Mac & Cheese',
      'vegetarian',
      4,
      false,
      ARRAY['default'],
      '[{"item":"elbow macaroni","unit":"oz","amount":8},{"item":"milk","unit":"cup","amount":2},{"item":"cheddar cheese","unit":"cups","amount":2}]'::jsonb,
      ARRAY['Boil pasta.', 'Warm milk.', 'Stir in cheese.', 'Combine and serve.']
    ),
    (
      'beef-and-broccoli-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      p_user_id,
      'Beef and Broccoli',
      'beef',
      4,
      true,
      ARRAY['default'],
      '[{"item":"beef","unit":"lb","amount":1},{"item":"broccoli","unit":"cups","amount":3}]'::jsonb,
      ARRAY['Sear beef.', 'Stir-fry broccoli.', 'Combine with sauce.']
    ),
    (
      'turkey-burger-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8),
      p_user_id,
      'Turkey Burger',
      'turkey',
      4,
      false,
      ARRAY['default'],
      '[{"item":"ground turkey","unit":"lb","amount":1}]'::jsonb,
      ARRAY['Form patties.', 'Cook until done.', 'Serve with toppings.']
    )
  ON CONFLICT (id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."insert_default_recipes_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_tags"("p_user_id" "uuid", "p_source_tag" "text", "p_target_tag" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE recipes
  SET tags = ARRAY(
    SELECT DISTINCT unnest(array_replace(tags, p_source_tag, p_target_tag))
  )
  WHERE user_id = p_user_id
    AND p_source_tag = ANY(tags);
$$;


ALTER FUNCTION "public"."merge_tags"("p_user_id" "uuid", "p_source_tag" "text", "p_target_tag" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."move_shopping_item_to_pantry"("p_row_id" "text", "p_pantry_qty" numeric, "p_pantry_unit" "text") RETURNS TABLE("removed_item" "jsonb", "pantry_item" "jsonb", "shopping_list_updated_at" timestamp with time zone, "pantry_was_inserted" boolean)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_items JSONB;
  v_already_have JSONB;
  v_updated_already_have JSONB;
  v_target JSONB;
  v_updated_at TIMESTAMPTZ;
  v_normalized_item TEXT;
  v_pantry_id UUID;
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
    RETURNING id, created_at
  )
  SELECT
    COALESCE((SELECT i.id FROM inserted i LIMIT 1), p.id) AS pantry_id,
    COALESCE((SELECT i.created_at FROM inserted i LIMIT 1), p.created_at) AS pantry_created_at,
    EXISTS(SELECT 1 FROM inserted) AS was_inserted
  INTO v_pantry_id, v_pantry_created_at, v_inserted
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
      'id', v_pantry_id,
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


ALTER FUNCTION "public"."move_shopping_item_to_pantry"("p_row_id" "text", "p_pantry_qty" numeric, "p_pantry_unit" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rename_tag"("p_user_id" "uuid", "p_old_tag" "text", "p_new_tag" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  UPDATE recipes
  SET tags = array_replace(tags, p_old_tag, p_new_tag)
  WHERE user_id = p_user_id
    AND p_old_tag = ANY(tags);
$$;


ALTER FUNCTION "public"."rename_tag"("p_user_id" "uuid", "p_old_tag" "text", "p_new_tag" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_default_recipe_images"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $_$
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
$_$;


ALTER FUNCTION "public"."set_default_recipe_images"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_shopping_item_checked"("p_row_id" "text") RETURNS TABLE("row_id" "text", "checked" boolean, "updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."toggle_shopping_item_checked"("p_row_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_weekly_recipe_made"("p_recipe_id" "text", "p_week_date" "text", "p_is_made_for_week" boolean, "p_date_made" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("action" "text", "recipe_id" "text", "week_date" "text", "made_recipe_ids" "text"[], "history_date_made" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."toggle_weekly_recipe_made"("p_recipe_id" "text", "p_week_date" "text", "p_is_made_for_week" boolean, "p_date_made" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pantry_items" (
    "user_id" "uuid" NOT NULL,
    "item" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL
);


ALTER TABLE "public"."pantry_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plan_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "recipe_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "day_assignments" "jsonb",
    "category_selection" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."plan_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recipe_history" (
    "id" bigint NOT NULL,
    "recipe_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "date_made" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."recipe_history" OWNER TO "postgres";


ALTER TABLE "public"."recipe_history" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."recipe_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."recipe_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sender_user_id" "uuid" NOT NULL,
    "sender_email" "text" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "source_recipe_id" "text" NOT NULL,
    "source_recipe_snapshot" "jsonb" NOT NULL,
    "message" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "accepted_recipe_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    CONSTRAINT "recipe_shares_message_length_check" CHECK ((("message" IS NULL) OR ("char_length"("message") <= 300))),
    CONSTRAINT "recipe_shares_no_self_share_check" CHECK (("sender_user_id" <> "recipient_user_id")),
    CONSTRAINT "recipe_shares_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'canceled'::"text"])))
);


ALTER TABLE "public"."recipe_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shopping_list" (
    "user_id" "uuid" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb",
    "already_have" "jsonb" DEFAULT '[]'::"jsonb",
    "excluded" "jsonb" DEFAULT '[]'::"jsonb",
    "source_recipes" "text"[] DEFAULT '{}'::"text"[],
    "scale" numeric DEFAULT 1.0,
    "total_servings" integer DEFAULT 0,
    "custom_order" boolean DEFAULT false,
    "generated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."shopping_list" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_config" (
    "user_id" "uuid" NOT NULL,
    "categories" "text"[] DEFAULT ARRAY['chicken'::"text", 'beef'::"text", 'turkey'::"text", 'lamb'::"text", 'vegetarian'::"text"],
    "default_selection" "jsonb" DEFAULT '{"beef": 1, "lamb": 1, "turkey": 1, "chicken": 2, "vegetarian": 1}'::"jsonb",
    "excluded_keywords" "text"[] DEFAULT '{}'::"text"[],
    "history_exclusion_days" integer DEFAULT 7,
    "week_start_day" integer DEFAULT 1,
    "onboarding_completed_at" timestamp with time zone,
    "category_overrides" "jsonb" DEFAULT '{}'::"jsonb",
    "custom_categories" "jsonb" DEFAULT '[]'::"jsonb",
    "category_order" "jsonb",
    "excluded_days" integer[] DEFAULT '{}'::integer[],
    "preferred_days" integer[],
    "auto_assign_days" boolean DEFAULT true,
    "enabled_planner_categories" "text"[]
);


ALTER TABLE "public"."user_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_config"."enabled_planner_categories" IS 'Categories enabled for meal planner Quick Meal Mix. NULL = all categories enabled (default). Empty array = no categories enabled.';



CREATE TABLE IF NOT EXISTS "public"."weekly_plans" (
    "user_id" "uuid" NOT NULL,
    "week_date" "date" NOT NULL,
    "recipe_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "day_assignments" "jsonb" DEFAULT '{}'::"jsonb",
    "scale" numeric DEFAULT 1.0,
    "made_recipe_ids" "text"[] DEFAULT '{}'::"text"[],
    "generated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weekly_plans" OWNER TO "postgres";


ALTER TABLE ONLY "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_user_id_item_key" UNIQUE ("user_id", "item");



ALTER TABLE ONLY "public"."plan_templates"
    ADD CONSTRAINT "plan_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipe_history"
    ADD CONSTRAINT "recipe_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipe_shares"
    ADD CONSTRAINT "recipe_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shopping_list"
    ADD CONSTRAINT "shopping_list_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."user_config"
    ADD CONSTRAINT "user_config_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_pkey" PRIMARY KEY ("user_id", "week_date");



CREATE INDEX "idx_history_date" ON "public"."recipe_history" USING "btree" ("date_made" DESC);



CREATE INDEX "idx_history_recipe" ON "public"."recipe_history" USING "btree" ("recipe_id");



CREATE INDEX "idx_pantry_items_user_id" ON "public"."pantry_items" USING "btree" ("user_id");



CREATE INDEX "idx_pantry_items_user_id_item" ON "public"."pantry_items" USING "btree" ("user_id", "item");



CREATE INDEX "idx_plan_templates_user_id" ON "public"."plan_templates" USING "btree" ("user_id");



CREATE INDEX "idx_recipe_history_user_id" ON "public"."recipe_history" USING "btree" ("user_id");



CREATE UNIQUE INDEX "idx_recipe_shares_pending_dedupe" ON "public"."recipe_shares" USING "btree" ("sender_user_id", "recipient_user_id", "source_recipe_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_recipe_shares_recipient_status_created" ON "public"."recipe_shares" USING "btree" ("recipient_user_id", "status", "created_at" DESC);



CREATE INDEX "idx_recipe_shares_sender_created" ON "public"."recipe_shares" USING "btree" ("sender_user_id", "created_at" DESC);



CREATE INDEX "idx_recipes_category" ON "public"."recipes" USING "btree" ("category");



CREATE INDEX "idx_recipes_favorite" ON "public"."recipes" USING "btree" ("favorite") WHERE ("favorite" = true);



CREATE INDEX "idx_recipes_has_image" ON "public"."recipes" USING "btree" ("image_url") WHERE ("image_url" IS NOT NULL);



CREATE INDEX "idx_recipes_user_id" ON "public"."recipes" USING "btree" ("user_id");



CREATE INDEX "idx_shopping_list_user_id" ON "public"."shopping_list" USING "btree" ("user_id");



CREATE INDEX "idx_user_config_user_id" ON "public"."user_config" USING "btree" ("user_id");



CREATE INDEX "idx_weekly_plans_user_id" ON "public"."weekly_plans" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "set_default_recipe_images" BEFORE INSERT ON "public"."recipes" FOR EACH ROW EXECUTE FUNCTION "public"."set_default_recipe_images"();



CREATE OR REPLACE TRIGGER "update_plan_templates_updated_at" BEFORE UPDATE ON "public"."plan_templates" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



CREATE OR REPLACE TRIGGER "update_recipes_updated_at" BEFORE UPDATE ON "public"."recipes" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at_column"();



ALTER TABLE ONLY "public"."pantry_items"
    ADD CONSTRAINT "pantry_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."plan_templates"
    ADD CONSTRAINT "plan_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_history"
    ADD CONSTRAINT "recipe_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_shares"
    ADD CONSTRAINT "recipe_shares_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipe_shares"
    ADD CONSTRAINT "recipe_shares_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recipes"
    ADD CONSTRAINT "recipes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shopping_list"
    ADD CONSTRAINT "shopping_list_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_config"
    ADD CONSTRAINT "user_config_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weekly_plans"
    ADD CONSTRAINT "weekly_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."pantry_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."plan_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipe_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipe_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recipes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recipients_respond_recipe_shares" ON "public"."recipe_shares" FOR UPDATE USING ((("auth"."uid"() = "recipient_user_id") AND ("status" = 'pending'::"text"))) WITH CHECK ((("auth"."uid"() = "recipient_user_id") AND ("status" = ANY (ARRAY['accepted'::"text", 'declined'::"text"])) AND ("responded_at" IS NOT NULL)));



CREATE POLICY "senders_cancel_recipe_shares" ON "public"."recipe_shares" FOR UPDATE USING ((("auth"."uid"() = "sender_user_id") AND ("status" = 'pending'::"text"))) WITH CHECK ((("auth"."uid"() = "sender_user_id") AND ("status" = 'canceled'::"text") AND ("responded_at" IS NOT NULL)));



ALTER TABLE "public"."shopping_list" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_create_recipe_shares" ON "public"."recipe_shares" FOR INSERT WITH CHECK (("auth"."uid"() = "sender_user_id"));



CREATE POLICY "users_own_config" ON "public"."user_config" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_own_history" ON "public"."recipe_history" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_own_pantry" ON "public"."pantry_items" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_own_plans" ON "public"."weekly_plans" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_own_recipe_shares_select" ON "public"."recipe_shares" FOR SELECT USING ((("auth"."uid"() = "sender_user_id") OR ("auth"."uid"() = "recipient_user_id")));



CREATE POLICY "users_own_recipes" ON "public"."recipes" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_own_shopping" ON "public"."shopping_list" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_own_templates" ON "public"."plan_templates" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."weekly_plans" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































GRANT ALL ON FUNCTION "public"."accept_recipe_share"("p_share_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_recipe_share"("p_share_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_recipe_share"("p_share_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_tag"("p_user_id" "uuid", "p_tag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_tag"("p_user_id" "uuid", "p_tag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_tag"("p_user_id" "uuid", "p_tag" "text") TO "service_role";



GRANT ALL ON TABLE "public"."recipes" TO "anon";
GRANT ALL ON TABLE "public"."recipes" TO "authenticated";
GRANT ALL ON TABLE "public"."recipes" TO "service_role";



GRANT ALL ON FUNCTION "public"."filter_recipes_by_tags"("p_user_id" "uuid", "p_tags" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."filter_recipes_by_tags"("p_user_id" "uuid", "p_tags" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."filter_recipes_by_tags"("p_user_id" "uuid", "p_tags" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_recipe_history_stats"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_recipe_history_stats"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_recipe_history_stats"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_default_recipes_for_user"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_default_recipes_for_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_default_recipes_for_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_tags"("p_user_id" "uuid", "p_source_tag" "text", "p_target_tag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_tags"("p_user_id" "uuid", "p_source_tag" "text", "p_target_tag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_tags"("p_user_id" "uuid", "p_source_tag" "text", "p_target_tag" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."move_shopping_item_to_pantry"("p_row_id" "text", "p_pantry_qty" numeric, "p_pantry_unit" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."move_shopping_item_to_pantry"("p_row_id" "text", "p_pantry_qty" numeric, "p_pantry_unit" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."move_shopping_item_to_pantry"("p_row_id" "text", "p_pantry_qty" numeric, "p_pantry_unit" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."rename_tag"("p_user_id" "uuid", "p_old_tag" "text", "p_new_tag" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."rename_tag"("p_user_id" "uuid", "p_old_tag" "text", "p_new_tag" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."rename_tag"("p_user_id" "uuid", "p_old_tag" "text", "p_new_tag" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_default_recipe_images"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_default_recipe_images"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_default_recipe_images"() TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_shopping_item_checked"("p_row_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_shopping_item_checked"("p_row_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_shopping_item_checked"("p_row_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_weekly_recipe_made"("p_recipe_id" "text", "p_week_date" "text", "p_is_made_for_week" boolean, "p_date_made" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_weekly_recipe_made"("p_recipe_id" "text", "p_week_date" "text", "p_is_made_for_week" boolean, "p_date_made" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_weekly_recipe_made"("p_recipe_id" "text", "p_week_date" "text", "p_is_made_for_week" boolean, "p_date_made" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at_column"() TO "service_role";


















GRANT ALL ON TABLE "public"."pantry_items" TO "anon";
GRANT ALL ON TABLE "public"."pantry_items" TO "authenticated";
GRANT ALL ON TABLE "public"."pantry_items" TO "service_role";



GRANT ALL ON TABLE "public"."plan_templates" TO "anon";
GRANT ALL ON TABLE "public"."plan_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."plan_templates" TO "service_role";



GRANT ALL ON TABLE "public"."recipe_history" TO "anon";
GRANT ALL ON TABLE "public"."recipe_history" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."recipe_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."recipe_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."recipe_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."recipe_shares" TO "anon";
GRANT ALL ON TABLE "public"."recipe_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."recipe_shares" TO "service_role";



GRANT ALL ON TABLE "public"."shopping_list" TO "anon";
GRANT ALL ON TABLE "public"."shopping_list" TO "authenticated";
GRANT ALL ON TABLE "public"."shopping_list" TO "service_role";



GRANT ALL ON TABLE "public"."user_config" TO "anon";
GRANT ALL ON TABLE "public"."user_config" TO "authenticated";
GRANT ALL ON TABLE "public"."user_config" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_plans" TO "anon";
GRANT ALL ON TABLE "public"."weekly_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_plans" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();



CREATE POLICY "Recipe images are publicly readable" ON "storage"."objects" FOR SELECT USING (("bucket_id" = 'recipe-images'::"text"));



CREATE POLICY "Users can delete own recipe images" ON "storage"."objects" FOR DELETE TO "authenticated" USING ((("bucket_id" = 'recipe-images'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "Users can update own recipe images" ON "storage"."objects" FOR UPDATE TO "authenticated" USING ((("bucket_id" = 'recipe-images'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text"))) WITH CHECK ((("bucket_id" = 'recipe-images'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



CREATE POLICY "Users can upload own recipe images" ON "storage"."objects" FOR INSERT TO "authenticated" WITH CHECK ((("bucket_id" = 'recipe-images'::"text") AND (("storage"."foldername"("name"))[1] = ("auth"."uid"())::"text")));



