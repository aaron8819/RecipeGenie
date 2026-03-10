-- Canonical baseline schema for deterministic bootstrapping.
-- This file is the source-of-truth starting point for fresh environments.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.recipes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  servings INTEGER NOT NULL DEFAULT 4,
  favorite BOOLEAN DEFAULT FALSE,
  tags TEXT[] DEFAULT '{}',
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  instructions TEXT[] NOT NULL DEFAULT '{}',
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pantry_items (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, item)
);

CREATE TABLE IF NOT EXISTS public.user_config (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  categories TEXT[] DEFAULT ARRAY['chicken', 'beef', 'turkey', 'lamb', 'vegetarian'],
  default_selection JSONB DEFAULT '{"chicken":2,"beef":1,"turkey":1,"lamb":1,"vegetarian":1}'::jsonb,
  excluded_keywords TEXT[] DEFAULT '{}',
  history_exclusion_days INTEGER DEFAULT 7,
  week_start_day INTEGER DEFAULT 1,
  onboarding_completed_at TIMESTAMPTZ DEFAULT NULL,
  category_overrides JSONB DEFAULT '{}'::jsonb,
  custom_categories JSONB DEFAULT '[]'::jsonb,
  category_order JSONB DEFAULT NULL,
  excluded_days INTEGER[] DEFAULT '{}',
  preferred_days INTEGER[] DEFAULT NULL,
  auto_assign_days BOOLEAN DEFAULT TRUE,
  enabled_planner_categories TEXT[] DEFAULT NULL
);

COMMENT ON COLUMN public.user_config.enabled_planner_categories IS
  'Categories enabled for meal planner Quick Meal Mix. NULL = all categories enabled (default). Empty array = no categories enabled.';

CREATE TABLE IF NOT EXISTS public.recipe_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_made TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.weekly_plans (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_date DATE NOT NULL,
  recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  day_assignments JSONB DEFAULT '{}'::jsonb,
  scale NUMERIC DEFAULT 1.0,
  made_recipe_ids TEXT[] DEFAULT '{}',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, week_date)
);

CREATE TABLE IF NOT EXISTS public.shopping_list (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  items JSONB DEFAULT '[]'::jsonb,
  already_have JSONB DEFAULT '[]'::jsonb,
  excluded JSONB DEFAULT '[]'::jsonb,
  source_recipes TEXT[] DEFAULT '{}',
  scale NUMERIC DEFAULT 1.0,
  total_servings INTEGER DEFAULT 0,
  custom_order BOOLEAN DEFAULT FALSE,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.plan_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  recipe_ids TEXT[] NOT NULL DEFAULT '{}',
  day_assignments JSONB DEFAULT NULL,
  category_selection JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.recipe_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  recipient_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  source_recipe_id TEXT NOT NULL,
  source_recipe_snapshot JSONB NOT NULL,
  message TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  accepted_recipe_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ NULL,
  CONSTRAINT recipe_shares_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'canceled')),
  CONSTRAINT recipe_shares_no_self_share_check
    CHECK (sender_user_id <> recipient_user_id),
  CONSTRAINT recipe_shares_message_length_check
    CHECK (message IS NULL OR char_length(message) <= 300)
);

CREATE INDEX IF NOT EXISTS idx_recipes_category ON public.recipes(category);
CREATE INDEX IF NOT EXISTS idx_recipes_user_id ON public.recipes(user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON public.recipes(favorite) WHERE favorite = TRUE;
CREATE INDEX IF NOT EXISTS idx_recipes_has_image ON public.recipes(image_url) WHERE image_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pantry_items_user_id ON public.pantry_items(user_id);
CREATE INDEX IF NOT EXISTS idx_user_config_user_id ON public.user_config(user_id);
CREATE INDEX IF NOT EXISTS idx_history_recipe ON public.recipe_history(recipe_id);
CREATE INDEX IF NOT EXISTS idx_history_date ON public.recipe_history(date_made DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_history_user_id ON public.recipe_history(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_plans_user_id ON public.weekly_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_shopping_list_user_id ON public.shopping_list(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_templates_user_id ON public.plan_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_recipe_shares_recipient_status_created
  ON public.recipe_shares (recipient_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipe_shares_sender_created
  ON public.recipe_shares (sender_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_shares_pending_dedupe
  ON public.recipe_shares (sender_user_id, recipient_user_id, source_recipe_id)
  WHERE status = 'pending';

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopping_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_own_recipes ON public.recipes;
CREATE POLICY users_own_recipes ON public.recipes
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_pantry ON public.pantry_items;
CREATE POLICY users_own_pantry ON public.pantry_items
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_config ON public.user_config;
CREATE POLICY users_own_config ON public.user_config
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_history ON public.recipe_history;
CREATE POLICY users_own_history ON public.recipe_history
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_plans ON public.weekly_plans;
CREATE POLICY users_own_plans ON public.weekly_plans
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_shopping ON public.shopping_list;
CREATE POLICY users_own_shopping ON public.shopping_list
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_templates ON public.plan_templates;
CREATE POLICY users_own_templates ON public.plan_templates
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS users_own_recipe_shares_select ON public.recipe_shares;
CREATE POLICY users_own_recipe_shares_select
  ON public.recipe_shares FOR SELECT
  USING (auth.uid() = sender_user_id OR auth.uid() = recipient_user_id);

DROP POLICY IF EXISTS users_create_recipe_shares ON public.recipe_shares;
CREATE POLICY users_create_recipe_shares
  ON public.recipe_shares FOR INSERT
  WITH CHECK (auth.uid() = sender_user_id);

DROP POLICY IF EXISTS recipients_respond_recipe_shares ON public.recipe_shares;
CREATE POLICY recipients_respond_recipe_shares
  ON public.recipe_shares FOR UPDATE
  USING (auth.uid() = recipient_user_id AND status = 'pending')
  WITH CHECK (
    auth.uid() = recipient_user_id
    AND status IN ('accepted', 'declined')
    AND responded_at IS NOT NULL
  );

DROP POLICY IF EXISTS senders_cancel_recipe_shares ON public.recipe_shares;
CREATE POLICY senders_cancel_recipe_shares
  ON public.recipe_shares FOR UPDATE
  USING (auth.uid() = sender_user_id AND status = 'pending')
  WITH CHECK (
    auth.uid() = sender_user_id
    AND status = 'canceled'
    AND responded_at IS NOT NULL
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recipe-images',
  'recipe-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can upload own recipe images" ON storage.objects;
CREATE POLICY "Users can upload own recipe images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recipe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own recipe images" ON storage.objects;
CREATE POLICY "Users can update own recipe images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'recipe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'recipe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own recipe images" ON storage.objects;
CREATE POLICY "Users can delete own recipe images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'recipe-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Recipe images are publicly readable" ON storage.objects;
CREATE POLICY "Recipe images are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recipe-images');

CREATE OR REPLACE FUNCTION public.set_default_recipe_images()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  base_id TEXT;
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
      ELSE NULL;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_default_recipe_images ON public.recipes;
CREATE TRIGGER set_default_recipe_images
BEFORE INSERT ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.set_default_recipe_images();

DROP TRIGGER IF EXISTS update_recipes_updated_at ON public.recipes;
CREATE TRIGGER update_recipes_updated_at
BEFORE UPDATE ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_plan_templates_updated_at ON public.plan_templates;
CREATE TRIGGER update_plan_templates_updated_at
BEFORE UPDATE ON public.plan_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.insert_default_recipes_for_user(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.accept_recipe_share(p_share_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_share public.recipe_shares%rowtype;
  v_name TEXT;
  v_category TEXT;
  v_servings INTEGER;
  v_image_url TEXT;
  v_tags TEXT[];
  v_instructions TEXT[];
  v_ingredients JSONB;
  v_base_id TEXT;
  v_new_recipe_id TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_share
  FROM public.recipe_shares
  WHERE id = p_share_id
    AND recipient_user_id = v_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share not found';
  END IF;

  IF v_share.status = 'accepted' AND v_share.accepted_recipe_id IS NOT NULL THEN
    RETURN v_share.accepted_recipe_id;
  END IF;

  IF v_share.status <> 'pending' THEN
    RAISE EXCEPTION 'Share is no longer pending';
  END IF;

  v_name := coalesce(nullif(trim(v_share.source_recipe_snapshot->>'name'), ''), 'Shared Recipe');
  v_category := coalesce(nullif(trim(v_share.source_recipe_snapshot->>'category'), ''), 'uncategorized');
  v_servings := coalesce((v_share.source_recipe_snapshot->>'servings')::integer, 4);
  v_image_url := nullif(trim(v_share.source_recipe_snapshot->>'image_url'), '');
  v_ingredients := coalesce(v_share.source_recipe_snapshot->'ingredients', '[]'::jsonb);

  SELECT coalesce(array_agg(value), '{}'::text[])
  INTO v_tags
  FROM jsonb_array_elements_text(coalesce(v_share.source_recipe_snapshot->'tags', '[]'::jsonb));

  SELECT coalesce(array_agg(value), '{}'::text[])
  INTO v_instructions
  FROM jsonb_array_elements_text(coalesce(v_share.source_recipe_snapshot->'instructions', '[]'::jsonb));

  v_base_id := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
  v_base_id := trim(both '-' from v_base_id);
  IF v_base_id = '' THEN
    v_base_id := 'shared-recipe';
  END IF;
  v_new_recipe_id := v_base_id || '-' || substring(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO public.recipes (
    id, user_id, name, category, servings, favorite, tags, ingredients, instructions, image_url
  )
  VALUES (
    v_new_recipe_id, v_user_id, v_name, v_category, v_servings, false, v_tags, v_ingredients, v_instructions, v_image_url
  );

  UPDATE public.recipe_shares
  SET status = 'accepted', accepted_recipe_id = v_new_recipe_id, responded_at = now()
  WHERE id = v_share.id;

  RETURN v_new_recipe_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_recipe_share(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rename_tag(p_user_id UUID, p_old_tag TEXT, p_new_tag TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE recipes
  SET tags = array_replace(tags, p_old_tag, p_new_tag)
  WHERE user_id = p_user_id
    AND p_old_tag = ANY(tags);
$$;

CREATE OR REPLACE FUNCTION public.delete_tag(p_user_id UUID, p_tag TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE recipes
  SET tags = array_remove(tags, p_tag)
  WHERE user_id = p_user_id
    AND p_tag = ANY(tags);
$$;

CREATE OR REPLACE FUNCTION public.merge_tags(p_user_id UUID, p_source_tag TEXT, p_target_tag TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE recipes
  SET tags = ARRAY(
    SELECT DISTINCT unnest(array_replace(tags, p_source_tag, p_target_tag))
  )
  WHERE user_id = p_user_id
    AND p_source_tag = ANY(tags);
$$;

CREATE OR REPLACE FUNCTION public.filter_recipes_by_tags(p_user_id UUID, p_tags TEXT[])
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

CREATE OR REPLACE FUNCTION public.get_recipe_history_stats(p_user_id UUID)
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
