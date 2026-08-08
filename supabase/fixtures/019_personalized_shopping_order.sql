-- Run against a database migrated through 018_shopping_document_cutover.sql.
insert into auth.users (id, email)
values ('01900000-0000-4000-8000-000000000001', 'shopping-v2-fixture@example.invalid');

insert into public.shopping_list (user_id, document, content_revision)
values (
  '01900000-0000-4000-8000-000000000001',
  '{
    "schemaVersion": 1,
    "recipeEntries": {
      "01910000-0000-4000-8000-000000000001": {
        "recipeId": "01910000-0000-4000-8000-000000000001",
        "recipeName": "Migration fixture",
        "selectedServings": 4,
        "scaleV1": {"numerator":"1","denominator":"1"},
        "ingredients": [
          {"ingredientKey":"apple","aggregateKey":"agg-apple-a","displayName":"apple","quantity":{"amount":1,"unit":"count"},"purchaseUnit":"count","defaultCategoryKey":"produce","pantryMatchKeys":["apple"]},
          {"ingredientKey":"milk","aggregateKey":"agg-milk","displayName":"milk","quantity":{"amount":1,"unit":"cup"},"purchaseUnit":"cup","defaultCategoryKey":"dairy","pantryMatchKeys":["milk"]},
          {"ingredientKey":"apple","aggregateKey":"agg-apple-b","displayName":"apples","quantity":{"amount":2,"unit":"count"},"purchaseUnit":"count","defaultCategoryKey":"produce","pantryMatchKeys":["apple"]},
          {"ingredientKey":"carrot","aggregateKey":"agg-carrot","displayName":"carrot","quantity":{"amount":1,"unit":"count"},"purchaseUnit":"count","defaultCategoryKey":"produce","pantryMatchKeys":["carrot"]},
          {"ingredientKey":"yellow onion","aggregateKey":"agg-yellow-onion","displayName":"Yellow Onion","quantity":{"amount":1,"unit":"count"},"purchaseUnit":"count","defaultCategoryKey":"produce","pantryMatchKeys":["yellow onion"]},
          {"ingredientKey":"tomato","aggregateKey":"agg-tomato","displayName":"Tomato","quantity":{"amount":1,"unit":"count"},"purchaseUnit":"count","defaultCategoryKey":"produce","pantryMatchKeys":["tomato"]}
        ]
      }
    },
    "manualItems": [
      {"id":"manual-paper","displayName":"Paper Towels","quantity":null,"categoryKey":"misc","bucket":"items","checked":false},
      {"id":"manual-modifiers","displayName":"red large onions","quantity":null,"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-plural-case","displayName":"  BANANAS  ","quantity":null,"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-evoo","displayName":"EVOO","quantity":null,"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-garlic","displayName":"chopped garlic cloves","quantity":null,"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-citrus","displayName":"lemon juice","quantity":{"amount":2,"unit":"tbsp"},"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-piece","displayName":"2 onions","quantity":{"amount":1,"unit":"piece"},"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-pieces","displayName":"2 onions","quantity":{"amount":2,"unit":"pieces"},"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-pc","displayName":"2 onions","quantity":{"amount":2,"unit":"pc"},"categoryKey":"pantry","bucket":"items","checked":false},
      {"id":"manual-pcs","displayName":"  2 ONIONS  ","quantity":{"amount":2,"unit":"pcs"},"categoryKey":"pantry","bucket":"items","checked":false}
    ],
    "itemOverrides": {
      "agg-apple-a": {"categoryKey":"custom_bulk"},
      "agg-carrot": {"suppressed":true}
    },
    "order": ["manual:manual-paper","derived:agg-apple-b","derived:agg-apple-a"],
    "preferences": {
      "categoryByIngredient": {},
      "customCategories": [{"id":"bulk","name":"Bulk","order":9}],
      "categoryOrder": ["custom_bulk","dairy","misc"],
      "excludedIngredientKeys": [],
      "excludeSaltVariants": false,
      "excludeBlackPepperVariants": false
    }
  }'::jsonb,
  7
)
on conflict (user_id) do update
set document = excluded.document,
    content_revision = public.shopping_list.content_revision + 1;

do $$
begin
  while (select content_revision from public.shopping_list
         where user_id = '01900000-0000-4000-8000-000000000001') < 7 loop
    update public.shopping_list
    set content_revision = content_revision + 1
    where user_id = '01900000-0000-4000-8000-000000000001';
  end loop;
end;
$$;

\ir ../migrations/019_personalized_shopping_order.sql

do $$
declare
  v_document jsonb;
begin
  select document into strict v_document
  from public.shopping_list
  where user_id = '01900000-0000-4000-8000-000000000001';

  if not public.is_shopping_document_v2(v_document) then
    raise exception 'fixture failed: migrated document is not ShoppingDocumentV2';
  end if;
  if v_document ? 'order' or v_document->>'schemaVersion' <> '2' then
    raise exception 'fixture failed: V1 row order or version survived migration';
  end if;
  if v_document->'preferences'->'ingredientOrderByCategory' <> jsonb_build_object(
    'misc', jsonb_build_array('paper towels'),
    'custom_bulk', jsonb_build_array('apple'),
    'dairy', jsonb_build_array('milk'),
    'produce', jsonb_build_array('yellow onion', 'tomato'),
    'pantry', jsonb_build_array(
      '2 onion',
      'banana',
      'garlic',
      'lemon',
      'extra virgin olive oil',
      'large red onion'
    )
  ) then
    raise exception 'fixture failed: reusable ingredient order was not seeded';
  end if;
  if v_document->'preferences'->'categoryByIngredient'->>'apple' <> 'custom_bulk' then
    raise exception 'fixture failed: derived category override was not absorbed';
  end if;
  if v_document->'itemOverrides' <> '{"agg-carrot":{"suppressed":true}}'::jsonb then
    raise exception 'fixture failed: V2 overrides retain competing category authority';
  end if;
  if (select content_revision from public.shopping_list
      where user_id = '01900000-0000-4000-8000-000000000001') <> 7 then
    raise exception 'fixture failed: schema migration changed the CAS revision';
  end if;
  if public.is_shopping_document_v2(v_document || jsonb_build_object(
    'order', jsonb_build_array('manual:manual-paper')
  )) then
    raise exception 'fixture failed: V2 accepted legacy row order';
  end if;
  if public.is_shopping_document_v2(jsonb_set(
    v_document,
    '{preferences,ingredientOrderByCategory,produce}',
    jsonb_build_array('apple'),
    true
  )) then
    raise exception 'fixture failed: V2 accepted one ingredient in two categories';
  end if;
end;
$$;
