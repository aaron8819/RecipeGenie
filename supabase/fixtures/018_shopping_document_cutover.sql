\set ON_ERROR_STOP on
\set VERBOSITY terse

-- First prove that one ambiguous legacy row aborts the entire migration.
insert into auth.users (id, email) values
  ('01800000-0000-4000-8000-000000000001', 'migration-018-ambiguous@example.test');

insert into public.shopping_list (
  user_id, items, legacy_items_preserved, contribution_revision
) values (
  '01800000-0000-4000-8000-000000000001',
  '[{"item":"ambiguous fixture item","amount":1,"unit":"count","categoryKey":"misc","categoryOrder":0,"sources":[]}]'::jsonb,
  false,
  11
)
on conflict (user_id) do update set
  items = excluded.items,
  legacy_items_preserved = excluded.legacy_items_preserved,
  contribution_revision = excluded.contribution_revision;

\set ON_ERROR_STOP off
\ir ../migrations/018_shopping_document_cutover.sql
\set ON_ERROR_STOP on

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'shopping_list'
      and column_name = 'document'
  ) then
    raise exception 'fixture failed: ambiguous migration did not roll back document column';
  end if;
  if to_regclass('public.shopping_recipe_contributions') is null
     or to_regclass('public.shopping_contribution_commands') is null then
    raise exception 'fixture failed: ambiguous migration did not roll back legacy tables';
  end if;
  if not exists (
    select 1 from public.shopping_list
    where user_id = '01800000-0000-4000-8000-000000000001'
      and contribution_revision = 11
  ) then
    raise exception 'fixture failed: ambiguous migration did not preserve legacy row';
  end if;
end $$;

delete from auth.users where id = '01800000-0000-4000-8000-000000000001';

-- Then exercise representative, deterministically convertible pre-018 state.
insert into auth.users (id, email) values
  ('01800000-0000-4000-8000-000000000002', 'migration-018-valid@example.test');

insert into public.recipes (id, user_id, name, category, recipe_uuid) values
  ('migration-018-recipe-a', '01800000-0000-4000-8000-000000000002',
    'Migration fixture recipe A', 'fixture', '01800000-0000-4000-8000-00000000000a'),
  ('migration-018-recipe-b', '01800000-0000-4000-8000-000000000002',
    'Migration fixture recipe B', 'fixture', '01800000-0000-4000-8000-00000000000b');

insert into public.shopping_recipe_contributions (
  user_id, recipe_id, recipe_uuid, servings, scale,
  normalization_version, snapshot, idempotency_key
) values
  (
    '01800000-0000-4000-8000-000000000002',
    'migration-018-recipe-a',
    '01800000-0000-4000-8000-00000000000a',
    4,
    1,
    2,
    '{
      "recipeName":"Migration fixture recipe A",
      "exactScaleV1":{"numerator":"1","denominator":"1"},
      "items":[
        {
          "item":"milk","amount":1,"unit":"cup","categoryKey":"dairy",
          "bucket":"items","additionalAmounts":[{"amount":8,"unit":"oz"}],
          "exactQuantityV1":{"kind":"single","value":{"numerator":"1","denominator":"1"}},
          "sources":[{"recipeUuid":"01800000-0000-4000-8000-00000000000a","recipeName":"Migration fixture recipe A","originalItem":"milk"}]
        },
        {
          "item":"lemon","amount":2,"unit":"count","categoryKey":"produce",
          "bucket":"items","additionalAmounts":[],
          "exactQuantityV1":{"kind":"single","value":{"numerator":"2","denominator":"1"}},
          "sources":[{"recipeUuid":"01800000-0000-4000-8000-00000000000a","recipeName":"Migration fixture recipe A","originalItem":"lemon juice","prepIntent":"juiced"}]
        }
      ]
    }'::jsonb,
    'migration-018-fixture-a'
  ),
  (
    '01800000-0000-4000-8000-000000000002',
    'migration-018-recipe-b',
    '01800000-0000-4000-8000-00000000000b',
    4,
    1,
    2,
    '{
      "recipeName":"Migration fixture recipe B",
      "exactScaleV1":{"numerator":"1","denominator":"1"},
      "items":[
        {
          "item":"milk","amount":2,"unit":"cup","categoryKey":"dairy",
          "bucket":"items","additionalAmounts":[],
          "sources":[{"recipeUuid":"01800000-0000-4000-8000-00000000000b","recipeName":"Migration fixture recipe B","originalItem":"milk"}]
        }
      ]
    }'::jsonb,
    'migration-018-fixture-b'
  );

insert into public.user_config (
  user_id, category_overrides, custom_categories, category_order,
  shopping_item_order, excluded_keywords,
  exclude_salt_variants, exclude_black_pepper_variants
) values (
  '01800000-0000-4000-8000-000000000002',
  '{"milk":"dairy"}'::jsonb,
  '[{"key":"household","label":"Household"}]'::jsonb,
  '["produce","dairy","pantry","household"]'::jsonb,
  '{"manual:manual-paper":"0","milk":"1","lemon":"2"}'::jsonb,
  array['anchovy'],
  true,
  false
)
on conflict (user_id) do update set
  category_overrides = excluded.category_overrides,
  custom_categories = excluded.custom_categories,
  category_order = excluded.category_order,
  shopping_item_order = excluded.shopping_item_order,
  excluded_keywords = excluded.excluded_keywords,
  exclude_salt_variants = excluded.exclude_salt_variants,
  exclude_black_pepper_variants = excluded.exclude_black_pepper_variants;

insert into public.shopping_list (
  user_id, items, source_recipes, source_recipe_uuids, contribution_revision,
  contribution_overrides, legacy_items_preserved
) values (
  '01800000-0000-4000-8000-000000000002',
  '[
    {
      "rowId":"manual-paper","item":"paper towels","amount":1,"unit":"pack",
      "categoryKey":"household","categoryOrder":0,"checked":false,
      "additionalAmounts":[],"sources":[{"recipeName":"Manual"}]
    },
    {
      "item":"milk","amount":3,"unit":"cup","categoryKey":"dairy",
      "categoryOrder":1,"checked":false,"additionalAmounts":[{"amount":8,"unit":"oz"}],
      "derivedQuantity":{"amount":3,"unit":"cup","additionalAmounts":[{"amount":8,"unit":"oz"}]},
      "sources":[
        {"recipeUuid":"01800000-0000-4000-8000-00000000000a","recipeName":"Migration fixture recipe A"},
        {"recipeUuid":"01800000-0000-4000-8000-00000000000b","recipeName":"Migration fixture recipe B"}
      ]
    },
    {
      "item":"lemons","amount":3,"unit":"count","categoryKey":"pantry",
      "categoryOrder":2,"checked":true,"additionalAmounts":[],
      "exactQuantityV1":{"kind":"single","value":{"numerator":"3","denominator":"1"}},
      "derivedQuantity":{"amount":2,"unit":"count","additionalAmounts":[]},
      "sources":[{"recipeUuid":"01800000-0000-4000-8000-00000000000a","recipeName":"Migration fixture recipe A","prepIntent":"juiced"}]
    }
  ]'::jsonb,
  array['migration-018-recipe-a', 'migration-018-recipe-b'],
  array['01800000-0000-4000-8000-00000000000a'::uuid,
        '01800000-0000-4000-8000-00000000000b'::uuid],
  7,
  '{}'::jsonb,
  true
)
on conflict (user_id) do update set
  items = excluded.items,
  source_recipes = excluded.source_recipes,
  source_recipe_uuids = excluded.source_recipe_uuids,
  contribution_revision = excluded.contribution_revision,
  contribution_overrides = excluded.contribution_overrides,
  legacy_items_preserved = excluded.legacy_items_preserved;

\ir ../migrations/018_shopping_document_cutover.sql

do $$
declare
  v_document jsonb;
  v_milk_key text;
  v_lemon_key text;
begin
  select document into strict v_document
  from public.shopping_list
  where user_id = '01800000-0000-4000-8000-000000000002';

  if not public.is_shopping_document_v1(v_document) then
    raise exception 'fixture failed: converted document is not ShoppingDocumentV1';
  end if;
  if (select content_revision from public.shopping_list
      where user_id = '01800000-0000-4000-8000-000000000002') <> 7 then
    raise exception 'fixture failed: contribution revision was not preserved';
  end if;
  if (select count(*) from jsonb_each(v_document->'recipeEntries')) <> 2
     or jsonb_array_length(v_document->'manualItems') <> 1
     or jsonb_array_length(v_document->'order') <> 3 then
    raise exception 'fixture failed: recipe/manual/order counts changed';
  end if;

  select ingredient->>'aggregateKey' into v_milk_key
  from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
  cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
  where ingredient->>'ingredientKey' = 'milk'
  group by ingredient->>'aggregateKey'
  having count(distinct recipe_id) = 2 and count(*) = 3;
  if v_milk_key is null then
    raise exception 'fixture failed: merged multi-source/multi-quantity milk identity changed';
  end if;

  select ingredient->>'aggregateKey' into v_lemon_key
  from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
  cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
  where ingredient->>'ingredientKey' = 'lemon'
    and ingredient->>'citrusPrep' = 'juiced'
    and ingredient->'quantity'->'exactQuantityV1' =
      '{"kind":"single","value":{"numerator":"2","denominator":"1"}}'::jsonb;
  if v_lemon_key is null then
    raise exception 'fixture failed: citrus prep or exact quantity provenance was lost';
  end if;

  if v_document->'manualItems'->0->>'id' <> 'manual-paper'
     or (v_document->'itemOverrides'->v_lemon_key->>'checked')::boolean is not true
     or v_document->'itemOverrides'->v_lemon_key->>'categoryKey' <> 'pantry'
     or v_document->'itemOverrides'->v_lemon_key->'quantity'->>'amount' <> '3' then
    raise exception 'fixture failed: manual/check/category/quantity intent was lost';
  end if;
  if v_document->'preferences'->'categoryOrder' <>
       '["produce","dairy","pantry","household"]'::jsonb
     or v_document->'preferences'->'customCategories' <>
       '[{"key":"household","label":"Household"}]'::jsonb
     or v_document->'preferences'->'excludedIngredientKeys' <> '["anchovy"]'::jsonb
     or (v_document->'preferences'->>'excludeSaltVariants')::boolean is not true then
    raise exception 'fixture failed: Shopping preferences were lost';
  end if;
  if v_document->'order' <> jsonb_build_array(
    'manual:manual-paper', 'derived:' || v_milk_key, 'derived:' || v_lemon_key
  ) then
    raise exception 'fixture failed: user ordering was lost';
  end if;

  if to_regclass('public.shopping_recipe_contributions') is not null
     or to_regclass('public.shopping_contribution_commands') is not null then
    raise exception 'fixture failed: legacy contribution tables remain';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'shopping_list' and column_name in (
        'items', 'already_have', 'excluded', 'source_recipes',
        'source_recipe_uuids', 'contribution_revision',
        'contribution_overrides', 'legacy_items_preserved'
      )) or
      (table_name = 'user_config' and column_name in (
        'category_overrides', 'custom_categories', 'category_order',
        'shopping_item_order', 'excluded_keywords',
        'exclude_salt_variants', 'exclude_black_pepper_variants'
      ))
    )
  ) then
    raise exception 'fixture failed: legacy Shopping columns remain';
  end if;
end $$;

select 'migration 018 populated fixture passed' as result;
