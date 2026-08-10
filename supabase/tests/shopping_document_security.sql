begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(35);

insert into auth.users(id, email) values
  ('31000000-0000-4000-8000-000000000001', 'shopping-a@example.test'),
  ('32000000-0000-4000-8000-000000000002', 'shopping-b@example.test');

create temporary table shopping_v3_regression_fixture(document jsonb) on commit drop;
with ingredient_source as (
  select
    recipe_number,
    ingredient_ordinal,
    ((recipe_number - 1) * 24) + ingredient_ordinal as absolute_ordinal
  from generate_series(1, 4) as recipes(recipe_number)
  cross join generate_series(1, 24) as ingredients(ingredient_ordinal)
), ingredient_rows as (
  select
    recipe_number,
    ingredient_ordinal,
    absolute_ordinal,
    case absolute_ordinal
      when 1 then 'fresh cilantro'
      when 4 then 'kosher salt'
      when 5 then 'lemon'
      else 'fixture-item-' || absolute_ordinal
    end as purchase_key,
    'category-' || (((absolute_ordinal - 1) % 5) + 1) as category_key
  from ingredient_source
), recipe_rows as (
  select
    'recipe-' || recipe_number as recipe_id,
    jsonb_build_object(
      'recipeId', 'recipe-' || recipe_number,
      'recipeName', 'Anonymized production recipe ' || recipe_number,
      'selectedServings', recipe_number,
      'scaleV1', jsonb_build_object('numerator', recipe_number::text, 'denominator', '1'),
      'ingredients', jsonb_agg(
        jsonb_build_object(
          'purchaseKey', purchase_key,
          'aggregateKey', case absolute_ordinal
            when 1 then jsonb_build_array(
              'shopping-aggregate', 2, purchase_key,
              jsonb_build_array('legacy-conflict', 'legacy-group-a')
            )::text
            when 2 then jsonb_build_array(
              'shopping-aggregate', 2, purchase_key,
              jsonb_build_array('range', 'recipe-1', 'cup', '1', '1', '2', '1')
            )::text
            when 3 then jsonb_build_array(
              'shopping-aggregate', 2, purchase_key,
              jsonb_build_array('package', 'recipe-1', 'can', '15', '1', 'ounce')
            )::text
            else jsonb_build_array('shopping-aggregate', 2, purchase_key)::text
          end,
          'displayName', purchase_key,
          'quantity', case absolute_ordinal
            when 2 then '{
              "amount":null,
              "unit":"cup",
              "exactQuantityV1":{
                "version":1,"kind":"range","authored":"1-2","source":"authored",
                "start":{"numerator":"1","denominator":"1"},
                "end":{"numerator":"2","denominator":"1"},
                "startLexeme":"1","endLexeme":"2","separator":"-"
              },
              "exactAuthoredUnit":"cups"
            }'::jsonb
            when 3 then '{
              "amount":1,
              "unit":"can (15 ounce)",
              "exactQuantityV1":{
                "version":1,"kind":"exact","authored":"1","source":"authored",
                "value":{"numerator":"1","denominator":"1"},"lexeme":"1"
              },
              "exactPackageV1":{
                "version":1,
                "count":{
                  "version":1,"kind":"exact","authored":"1","source":"authored",
                  "value":{"numerator":"1","denominator":"1"},"lexeme":"1"
                },
                "size":{
                  "value":{"numerator":"15","denominator":"1"},
                  "lexeme":"15","unit":"ounce","authoredUnit":"oz"
                },
                "type":"can","authoredType":"can"
              },
              "exactAuthoredUnit":"can"
            }'::jsonb
            else '{"amount":1,"unit":"count"}'::jsonb
          end,
          'familyKey', case absolute_ordinal when 4 then 'salt' else purchase_key end,
          'preparation', case absolute_ordinal when 4 then '["kosher"]'::jsonb else '[]'::jsonb end,
          'purchaseUnit', case absolute_ordinal
            when 2 then 'cup'
            when 3 then 'can (15 ounce)'
            else 'count'
          end,
          'quantityKind', case absolute_ordinal
            when 2 then 'range'
            when 3 then 'package'
            else 'discrete'
          end,
          'defaultCategoryKey', category_key,
          'pantryMatchKeys', case absolute_ordinal
            when 4 then jsonb_build_array(purchase_key, 'salt')
            else jsonb_build_array(purchase_key)
          end,
          'familyMatchPolicy', case absolute_ordinal
            when 4 then '{"pantryFromGeneric":true,"exclusionEquivalent":true}'::jsonb
            else '{}'::jsonb
          end
        )
        || case when absolute_ordinal = 4
          then '{"exclusionFamily":"salt"}'::jsonb else '{}'::jsonb end
        || case when absolute_ordinal = 5
          then '{"citrusPrep":"juiced"}'::jsonb else '{}'::jsonb end
        order by ingredient_ordinal
      )
    ) as entry
  from ingredient_rows
  group by recipe_number
), ordering as (
  select jsonb_object_agg(category_key, purchase_keys order by category_key) as value
  from (
    select category_key, jsonb_agg(purchase_key order by absolute_ordinal) as purchase_keys
    from ingredient_rows
    group by category_key
  ) categories
)
insert into shopping_v3_regression_fixture(document)
select jsonb_build_object(
  'schemaVersion', 3,
  'recipeEntries', (select jsonb_object_agg(recipe_id, entry order by recipe_id) from recipe_rows),
  'manualItems', '[{
    "id":"manual-production-shape","displayName":"Anonymized manual item",
    "quantity":null,"categoryKey":"category-1","bucket":"items","checked":false
  }]'::jsonb,
  'itemOverrides', '{}'::jsonb,
  'preferences', jsonb_build_object(
    'categoryByIngredient', '{}'::jsonb,
    'customCategories', '[]'::jsonb,
    'categoryOrder', '[]'::jsonb,
    'ingredientOrderByCategory', (select value from ordering),
    'excludedIngredientKeys', '[]'::jsonb,
    'excludeSaltVariants', false,
    'excludeBlackPepperVariants', false
  )
);
grant select on shopping_v3_regression_fixture to authenticated;

select extensions.has_column('public', 'shopping_list', 'document', 'Shopping has one canonical document column');
select extensions.has_column('public', 'shopping_list', 'content_revision', 'Shopping has one CAS revision column');
select extensions.ok(to_regclass('public.shopping_recipe_contributions') is null
  and to_regclass('public.shopping_contribution_commands') is null, 'legacy contribution tables are gone');
select extensions.ok(to_regprocedure('public.apply_recipe_shopping_contribution_uuid_command(bigint,jsonb,uuid[],jsonb,jsonb,text,text)') is null
  and to_regprocedure('public.move_shopping_item_to_pantry(text,numeric,text)') is null, 'legacy Shopping RPCs are gone');

set local role authenticated;
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select extensions.is((select count(*)::integer from public.shopping_list), 1, 'RLS exposes only the owned document');
select extensions.is((select content_revision from public.shopping_list), 0::bigint, 'new documents start at revision zero');
select extensions.ok(
  (select public.is_shopping_document_v2(document) from public.shopping_list),
  'compatibility-phase defaults remain V2 for the old application'
);
select extensions.ok(
  (select not public.is_shopping_document_v3(document) from public.shopping_list),
  'compatibility-phase defaults do not expose V3 to the old application'
);
select extensions.ok(public.is_shopping_document_v2(
  '{"schemaVersion":2,"recipeEntries":{},"manualItems":[],"itemOverrides":{},"preferences":{"categoryByIngredient":{},"customCategories":[],"categoryOrder":[],"ingredientOrderByCategory":{},"excludedIngredientKeys":[],"excludeSaltVariants":false,"excludeBlackPepperVariants":false}}'::jsonb
), 'V2 remains valid during lazy application upgrade');
select extensions.ok(
  (select
    (select count(*) from jsonb_object_keys(document->'recipeEntries')) = 4
    and (select count(*)
      from jsonb_each(document->'recipeEntries') entry
      cross join lateral jsonb_array_elements(entry.value->'ingredients')) = 96
    and jsonb_array_length(document->'manualItems') = 1
    and (select count(*) from jsonb_object_keys(
      document#>'{preferences,ingredientOrderByCategory}')) = 5
    from shopping_v3_regression_fixture),
  'the anonymized regression fixture preserves the production 4/96/1/5 shape'
);
select extensions.ok(
  (select public.is_shopping_document_v3(document) from shopping_v3_regression_fixture),
  'the exact production-derived non-empty V3 shape is accepted'
);
select extensions.ok(
  (select public.is_shopping_document_v3(document)
    and (document#>>'{recipeEntries,recipe-1,ingredients,0,aggregateKey}')::jsonb->3->>0 = 'legacy-conflict'
    from shopping_v3_regression_fixture),
  'a conflict-preserved V3 aggregate identity is accepted'
);
select extensions.ok(
  (select public.is_shopping_document_v3(document)
    and document#>>'{recipeEntries,recipe-1,ingredients,1,quantityKind}' = 'range'
    and document#>>'{recipeEntries,recipe-1,ingredients,2,quantityKind}' = 'package'
    from shopping_v3_regression_fixture),
  'structured range and package V3 ingredients are accepted'
);
select extensions.ok(
  (select public.is_shopping_document_v3(document)
    and jsonb_array_length(document->'manualItems') = 1
    and (select count(*) from jsonb_object_keys(
      document#>'{preferences,ingredientOrderByCategory}')) = 5
    from shopping_v3_regression_fixture),
  'manual rows and production category ordering remain accepted'
);
select extensions.ok(
  (select not public.is_shopping_document_v3(
    document #- '{recipeEntries,recipe-1,ingredients,0,familyKey}'
  ) from shopping_v3_regression_fixture),
  'V3 ingredients missing a required field reject'
);
select extensions.ok(
  (select not public.is_shopping_document_v3(jsonb_set(
    document,
    '{recipeEntries,recipe-1,ingredients,0,aggregateKey}',
    to_jsonb('["shopping-aggregate",1,"fresh cilantro"]'::text)
  )) from shopping_v3_regression_fixture),
  'V3 aggregate keys with the wrong version reject'
);
select extensions.ok(
  (select not public.is_shopping_document_v3(jsonb_set(
    document,
    '{recipeEntries,recipe-1,ingredients,0,pantryMatchKeys}',
    '["different-item"]'::jsonb
  )) from shopping_v3_regression_fixture),
  'V3 Pantry match keys must contain the purchase key'
);
select extensions.ok(
  (select not public.is_shopping_document_v3(jsonb_set(
    document,
    '{recipeEntries,recipe-1,ingredients,0}',
    (document#>'{recipeEntries,recipe-1,ingredients,0}') || '{"runtime":{}}'::jsonb
  )) from shopping_v3_regression_fixture),
  'unexpected persisted V3 ingredient fields reject'
);
select extensions.lives_ok($$
  update public.shopping_list set
    document = (select document from shopping_v3_regression_fixture),
    content_revision = 1
  where user_id = auth.uid() and content_revision = 0
$$, 'the V2-to-V3 lazy-upgrade persistence path accepts the production shape');
select extensions.ok(
  (select public.is_shopping_document_v3(document) from public.shopping_list),
  'the compatibility schema accepts V3 application writes'
);
select extensions.is((select content_revision from public.shopping_list), 1::bigint, 'a write advances the revision once');
select extensions.throws_ok($$ update public.shopping_list set content_revision = 3 where user_id = auth.uid() $$,
  '40001', 'Shopping content revision must advance exactly once', 'skipped revisions reject');
select extensions.throws_ok($$ update public.shopping_list set document = '{"schemaVersion":2}'::jsonb, content_revision = 2 where user_id = auth.uid() $$,
  '23514', null, 'malformed documents reject');
select extensions.throws_ok($$
  update public.shopping_list
  set document = jsonb_set(
        document,
        '{preferences,customCategories}',
        '[{"key":"household","label":"Household"}]'::jsonb
      ),
      content_revision = 2
  where user_id = auth.uid()
$$, '23514', null, 'nested application-invalid documents reject');
select extensions.lives_ok($$
  update public.shopping_list set content_revision = 1
  where user_id = '32000000-0000-4000-8000-000000000002'
$$, 'a cross-owner update is safely filtered by RLS');
select set_config('request.jwt.claim.sub', '32000000-0000-4000-8000-000000000002', true);
select extensions.lives_ok($$
  select * from public.move_shopping_document_item_to_pantry(0,
    (select document from public.shopping_list where user_id = auth.uid()),
    'V2 bridge item', 1, 'count')
$$, 'the Pantry bridge continues to accept V2 documents');
select extensions.ok(
  (select content_revision = 1 from public.shopping_list)
  and exists (select 1 from public.pantry_items where user_id = auth.uid() and item = 'v2 bridge item'),
  'the V2 Pantry bridge advances once without changing the document version'
);
select set_config('request.jwt.claim.sub', '31000000-0000-4000-8000-000000000001', true);
select extensions.lives_ok($$
  select * from public.move_shopping_document_item_to_pantry(1,
    (select document from public.shopping_list where user_id = auth.uid()), 'Apples', 2, 'count')
$$, 'the Pantry move accepts the current revision');
select extensions.ok((select content_revision = 2 from public.shopping_list)
  and exists (select 1 from public.pantry_items where user_id = auth.uid() and item = 'apples'),
  'the Pantry move advances Shopping and inserts Pantry atomically');
select extensions.throws_ok($$
  select * from public.move_shopping_document_item_to_pantry(1,
    (select document from public.shopping_list where user_id = auth.uid()), 'bananas', 1, 'count')
$$, '40001', 'Shopping content revision conflict', 'a stale Pantry move fails closed');
select extensions.ok(not exists (select 1 from public.pantry_items where user_id = auth.uid() and item = 'bananas'),
  'a conflicted Pantry move has no partial write');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok($$ select count(*) from public.shopping_list $$,
  '42501', 'permission denied for table shopping_list', 'anonymous reads are not granted');
select extensions.throws_ok($$ select public.is_shopping_document_v2('{}'::jsonb) $$,
  '42501', 'permission denied for function is_shopping_document_v2', 'anonymous validator execution is not granted');
select extensions.throws_ok($$ select public.is_shopping_document_v3('{}'::jsonb) $$,
  '42501', 'permission denied for function is_shopping_document_v3', 'anonymous V3 validator execution is not granted');
select extensions.throws_ok($$ select * from public.move_shopping_document_item_to_pantry(0, '{}'::jsonb, 'onion', 1, 'count') $$,
  '42501', 'permission denied for function move_shopping_document_item_to_pantry', 'anonymous Pantry moves are not executable');

select * from extensions.finish();
rollback;
