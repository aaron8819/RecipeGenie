-- Replace list-specific row ordering with reusable ingredient ordering.
begin;

create function private.shopping_known_noun_v1(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text := coalesce(p_value, '');
begin
  return case v_value
    when 'chicken breasts' then 'chicken breast'
    when 'chicken thighs' then 'chicken thigh'
    when 'egg whites' then 'egg white'
    when 'evoo' then 'extra virgin olive oil'
    when 'garlic cloves' then 'garlic'
    else regexp_replace(
      v_value,
      '\m(apples|bananas|carrots|eggs|lemons|limes|mushrooms|onions|peppers|potatoes|tomatoes)$',
      case substring(v_value from '\m([[:alpha:]]+)$')
        when 'apples' then 'apple'
        when 'bananas' then 'banana'
        when 'carrots' then 'carrot'
        when 'eggs' then 'egg'
        when 'lemons' then 'lemon'
        when 'limes' then 'lime'
        when 'mushrooms' then 'mushroom'
        when 'onions' then 'onion'
        when 'peppers' then 'pepper'
        when 'potatoes' then 'potato'
        when 'tomatoes' then 'tomato'
        else substring(v_value from '\m([[:alpha:]]+)$')
      end
    )
  end;
end;
$$;

create function private.shopping_display_sort_key_v1(p_item text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text;
begin
  -- Exact SQL counterpart of normalizeItemName(), used only for V1 fallback.
  v_value := lower(trim(coalesce(p_item, '')));
  v_value := translate(v_value, U&'\2013\2014', '--');
  v_value := regexp_replace(v_value, '[[:space:]]+', ' ', 'g');
  v_value := regexp_replace(v_value, '^[,[:space:]]+|[,[:space:];:]+$', '', 'g');
  v_value := regexp_replace(
    v_value,
    '\mextra[[:space:]-]+virgin olive oil\M',
    'olive oil',
    'g'
  );
  v_value := regexp_replace(v_value, '\mevoo\M', 'olive oil', 'g');
  v_value := regexp_replace(v_value, '\myellow onions?\M', 'onion', 'g');
  v_value := regexp_replace(v_value, '\mwhite onions?\M', 'onion', 'g');
  v_value := regexp_replace(v_value, '\monions\M', 'onion', 'g');
  v_value := regexp_replace(v_value, '\mgarlic cloves?\M', 'garlic', 'g');
  return trim(regexp_replace(v_value, '[[:space:]]+', ' ', 'g'));
end;
$$;

create function private.shopping_v1_ordering_key(
  p_item text,
  p_quantity jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value text;
  v_syntax text;
  v_words text[];
  v_identity_modifiers text[] := '{}'::text[];
  v_first text;
  v_last text;
  v_phrase text;
  v_consumed boolean;
  v_unit text;
  v_match text[];
  v_amount numeric;
  v_modifier_prefix text;
begin
  -- Runtime first applies normalizeShoppingSyntax() for purchase patterns.
  v_syntax := lower(trim(coalesce(p_item, '')));
  v_syntax := translate(v_syntax, U&'\2013\2014', '--');
  v_syntax := regexp_replace(v_syntax, '[[:space:]]+', ' ', 'g');
  v_syntax := regexp_replace(
    v_syntax,
    '^[,[:space:]]+|[,[:space:];:]+$',
    '',
    'g'
  );

  v_unit := lower(trim(coalesce(p_quantity->>'unit', '')));
  v_unit := regexp_replace(v_unit, '[[:space:]]+', ' ', 'g');
  v_unit := case v_unit
    when 'teaspoon' then 'tsp' when 'teaspoons' then 'tsp'
    when 'tablespoon' then 'tbsp' when 'tablespoons' then 'tbsp'
    when 'cups' then 'cup' when 'c' then 'cup'
    when 'fluid ounce' then 'fl oz' when 'fluid ounces' then 'fl oz'
    when 'milliliter' then 'ml' when 'milliliters' then 'ml'
    when 'piece' then 'piece' when 'pieces' then 'piece'
    when 'pc' then 'piece' when 'pcs' then 'piece'
    when 'whole' then 'count' when 'wholes' then 'count'
    when 'whole/count' then 'count'
    when 'whole item' then 'count' when 'whole items' then 'count'
    when 'counts' then 'count'
    else v_unit
  end;

  v_match := regexp_match(v_syntax, '^(?:fresh )?(lemon|lime) (juice|zest)$');
  if v_match is not null
     and coalesce((p_quantity->>'amount')::numeric, 0) <> 0
     and v_unit in ('tbsp', 'tsp', 'cup', 'fl oz', 'ml') then
    return v_match[1];
  end if;

  v_match := regexp_match(
    v_syntax,
    '^(\d+(?:\.\d+)?|\d+/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) ([a-z ]+?) (?:fresh )?(lemon|lime) (juice|zest)$'
  );
  if v_match is not null then
    v_amount := case v_match[1]
      when 'one' then 1 when 'two' then 2 when 'three' then 3
      when 'four' then 4 when 'five' then 5 when 'six' then 6
      when 'seven' then 7 when 'eight' then 8 when 'nine' then 9
      when 'ten' then 10 when 'eleven' then 11 when 'twelve' then 12
      else case
        when v_match[1] ~ '^\d+/\d+$' then
          split_part(v_match[1], '/', 1)::numeric /
            nullif(split_part(v_match[1], '/', 2)::numeric, 0)
        else v_match[1]::numeric
      end
    end;
    v_phrase := lower(trim(v_match[2]));
    v_phrase := case v_phrase
      when 'teaspoon' then 'tsp' when 'teaspoons' then 'tsp'
      when 'tablespoon' then 'tbsp' when 'tablespoons' then 'tbsp'
      when 'cups' then 'cup' when 'c' then 'cup'
      when 'fluid ounce' then 'fl oz' when 'fluid ounces' then 'fl oz'
      when 'milliliter' then 'ml' when 'milliliters' then 'ml'
      else v_phrase
    end;
    if coalesce(v_amount, 0) <> 0
       and v_phrase in ('tbsp', 'tsp', 'cup', 'fl oz', 'ml') then
      return v_match[3];
    end if;
  end if;

  v_match := regexp_match(
    v_syntax,
    '^juice (?:of|from) (?:(?:\d+(?:\.\d+)?|\d+/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) )?(limes?|lemons?)$'
  );
  if v_match is not null then
    return case when v_match[1] like 'lime%' then 'lime' else 'lemon' end;
  end if;
  v_match := regexp_match(
    v_syntax,
    '^zest (?:of|from) (?:(?:\d+(?:\.\d+)?|\d+/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) )?(?:one )?(limes?|lemons?)$'
  );
  if v_match is not null then
    return case when v_match[1] like 'lime%' then 'lime' else 'lemon' end;
  end if;

  if v_unit = '' or v_unit = 'count' then
    v_match := regexp_match(
      v_syntax,
      '^(?:\d+(?:\.\d+)?|\d+/\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (limes?|lemons?|onions?)(?:,? (?:juiced|zested|diced|chopped|minced|sliced|wedges|cut into wedges))?$'
    );
    if v_match is not null then
      return case
        when v_match[1] like 'lime%' then 'lime'
        when v_match[1] like 'lemon%' then 'lemon'
        else 'onion'
      end;
    end if;
    v_match := regexp_match(
      v_syntax,
      '^(limes?|lemons?|onions?),? (?:juiced|zested|diced|chopped|minced|sliced|wedges|cut into wedges)$'
    );
    if v_match is not null then
      return case
        when v_match[1] like 'lime%' then 'lime'
        when v_match[1] like 'lemon%' then 'lemon'
        else 'onion'
      end;
    end if;
    if v_syntax ~ '^(diced|chopped|minced|sliced) onions?$' then
      return 'onion';
    end if;
    if v_syntax in ('lime', 'limes') then return 'lime'; end if;
    if v_syntax in ('lemon', 'lemons') then return 'lemon'; end if;
    if v_syntax in ('onion', 'onions') then return 'onion'; end if;
  end if;

  -- Exact SQL counterpart of canonicalizeShoppingIngredient().mergeKey.
  v_value := lower(normalize(coalesce(p_item, ''), NFKC));
  v_value := replace(replace(v_value, U&'\2018', ''''), U&'\2019', '''');
  v_value := translate(v_value, U&'\2010\2011\2012\2013\2014\2015', '------');
  v_value := regexp_replace(v_value, '([a-z])-([a-z])', '\1 \2', 'g');
  v_value := regexp_replace(v_value, '[;,]+', ' ', 'g');
  v_value := regexp_replace(v_value, '^[[:space:].:]+|[[:space:].:]+$', '', 'g');
  v_value := trim(regexp_replace(v_value, '[[:space:]]+', ' ', 'g'));
  v_value := private.shopping_known_noun_v1(v_value);
  v_words := regexp_split_to_array(v_value, ' ');

  loop
    exit when cardinality(v_words) = 0;
    v_consumed := false;
    v_first := v_words[1];
    v_last := v_words[cardinality(v_words)];

    if v_first in ('chopped', 'diced', 'grated', 'minced', 'sliced', 'optional') then
      v_words := v_words[2:cardinality(v_words)];
      v_consumed := true;
    else
      v_phrase := case
        when cardinality(v_words) >= 2 and v_words[1] = 'extra' and v_words[2] = 'large'
          then 'extra large'
        when cardinality(v_words) >= 2 and v_words[1] = 'extra' and v_words[2] = 'virgin'
          then 'extra virgin'
        when cardinality(v_words) >= 2 and v_words[1] = 'sun' and v_words[2] = 'dried'
          then 'sun dried'
        else null
      end;
      if v_phrase is not null then
        if not v_phrase = any(v_identity_modifiers) then
          v_identity_modifiers := array_append(v_identity_modifiers, v_phrase);
        end if;
        v_words := v_words[3:cardinality(v_words)];
        v_consumed := true;
      elsif v_first in (
        'boneless','canned','dried','evaporated','fresh','frozen','green',
        'kosher','large','medium','pickled','powdered','quail','red',
        'skinless','small','smoked','white','whole','yellow'
      ) then
        if not v_first = any(v_identity_modifiers) then
          v_identity_modifiers := array_append(v_identity_modifiers, v_first);
        end if;
        v_words := v_words[2:cardinality(v_words)];
        v_consumed := true;
      end if;
    end if;

    if cardinality(v_words) > 0 and
       v_last in ('chopped', 'diced', 'grated', 'minced', 'sliced', 'optional') then
      v_words := v_words[1:cardinality(v_words) - 1];
      v_consumed := true;
    end if;
    exit when not v_consumed;
  end loop;

  v_value := private.shopping_known_noun_v1(array_to_string(v_words, ' '));
  select coalesce(string_agg(modifier, ' ' order by modifier collate "C"), '')
    into v_modifier_prefix
  from unnest(v_identity_modifiers) as modifiers(modifier);
  return trim(concat(v_modifier_prefix, case when v_modifier_prefix = '' then '' else ' ' end, v_value));
end;
$$;

create function private.shopping_category_rank_v2(
  p_preferences jsonb,
  p_category_key text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select position::numeric
      from jsonb_array_elements_text(p_preferences->'categoryOrder')
        with ordinality as preferred(category_key, position)
      where preferred.category_key = p_category_key
    ),
    case p_category_key
      when 'produce' then 1001
      when 'deli' then 1002
      when 'bakery' then 1003
      when 'protein' then 1004
      when 'dairy' then 1005
      when 'pantry' then 1006
      when 'frozen' then 1007
      when 'misc' then 1008
      else 2000 + coalesce((
        select (category->>'order')::numeric
        from jsonb_array_elements(p_preferences->'customCategories') as custom(category)
        where 'custom_' || (category->>'id') = p_category_key
      ), 999999)
    end
  );
$$;

create function private.upgrade_shopping_document_v2(p_document jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_document jsonb;
  v_preferences jsonb;
  v_category_map jsonb;
  v_overrides jsonb := '{}'::jsonb;
  v_override record;
  v_override_value jsonb;
  v_ingredient record;
  v_aggregate_key text;
  v_ordering_key text;
  v_display_name text;
  v_category_key text;
  v_manual jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_ref text;
  v_seen text[] := '{}'::text[];
  v_ingredient_order jsonb := '{}'::jsonb;
begin
  if not public.is_shopping_document_v1(p_document) then
    raise exception 'invalid ShoppingDocumentV1' using errcode = '23514';
  end if;

  v_preferences := p_document->'preferences';
  v_category_map := v_preferences->'categoryByIngredient';
  for v_override in
    select key, value from jsonb_each(p_document->'itemOverrides')
  loop
    if nullif(v_override.value->>'categoryKey', '') is not null then
      for v_ingredient in
        select distinct ingredient->>'ingredientKey' as ingredient_key
        from jsonb_each(p_document->'recipeEntries') as entries(recipe_id, entry)
        cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
        where ingredient->>'aggregateKey' = v_override.key
      loop
        v_category_map := jsonb_set(
          v_category_map,
          array[v_ingredient.ingredient_key],
          to_jsonb(v_override.value->>'categoryKey'),
          true
        );
      end loop;
    end if;
    v_override_value := v_override.value - 'categoryKey';
    if v_override_value <> '{}'::jsonb then
      v_overrides := jsonb_set(
        v_overrides,
        array[v_override.key],
        v_override_value,
        true
      );
    end if;
  end loop;
  v_preferences := jsonb_set(v_preferences, '{categoryByIngredient}', v_category_map, true)
    || jsonb_build_object('ingredientOrderByCategory', '{}'::jsonb);
  v_document := jsonb_build_object(
    'schemaVersion', 2,
    'recipeEntries', p_document->'recipeEntries',
    'manualItems', p_document->'manualItems',
    'itemOverrides', v_overrides,
    'preferences', v_preferences
  );

  for v_aggregate_key in
    select distinct ingredient->>'aggregateKey'
    from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
  loop
    v_override_value := v_overrides->v_aggregate_key;
    if coalesce((v_override_value->>'suppressed')::boolean, false) then
      continue;
    end if;

    select ingredient->>'ingredientKey',
           coalesce(v_override_value->>'displayName', ingredient->>'displayName')
      into strict v_ordering_key, v_display_name
    from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients')
      with ordinality as ingredients(ingredient, position)
    where ingredient->>'aggregateKey' = v_aggregate_key
    order by recipe_id, position
    limit 1;

    select category_key into strict v_category_key
    from (
      select coalesce(
        v_category_map->>(ingredient->>'ingredientKey'),
        ingredient->>'defaultCategoryKey'
      ) as category_key,
      count(*) as occurrences
      from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
      cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
      where ingredient->>'aggregateKey' = v_aggregate_key
      group by 1
    ) as categories
    order by occurrences desc,
      private.shopping_category_rank_v2(v_preferences, category_key),
      category_key
    limit 1;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'rowRef', 'derived:' || v_aggregate_key,
      'orderingKey', v_ordering_key,
      'displayName', v_display_name,
      'categoryKey', v_category_key
    ));
  end loop;

  for v_manual in
    select value from jsonb_array_elements(v_document->'manualItems')
  loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'rowRef', 'manual:' || (v_manual->>'id'),
      'orderingKey', private.shopping_v1_ordering_key(
        v_manual->>'displayName',
        v_manual->'quantity'
      ),
      'displayName', v_manual->>'displayName',
      'categoryKey', v_manual->>'categoryKey'
    ));
  end loop;

  for v_ref in
    select value from jsonb_array_elements_text(p_document->'order')
  loop
    select value into v_row
    from jsonb_array_elements(v_rows) as rows(value)
    where value->>'rowRef' = v_ref
    limit 1;
    if v_row is null or v_row->>'orderingKey' = any(v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_row->>'orderingKey');
    v_category_key := v_row->>'categoryKey';
    v_ingredient_order := jsonb_set(
      v_ingredient_order,
      array[v_category_key],
      coalesce(v_ingredient_order->v_category_key, '[]'::jsonb)
        || jsonb_build_array(v_row->>'orderingKey'),
      true
    );
  end loop;

  -- Runtime fallback is identity-group first, using normalizeItemName() as
  -- the representative display key, then deterministic identity/row ties.
  for v_row in
    with identity_groups as (
      select
        value->>'orderingKey' as ordering_key,
        value->>'categoryKey' as category_key,
        min(private.shopping_display_sort_key_v1(value->>'displayName')
          collate "C") as display_sort_key,
        min(value->>'rowRef' collate "C") as row_ref
      from jsonb_array_elements(v_rows) as rows(value)
      group by value->>'orderingKey', value->>'categoryKey'
    ), assigned_groups as (
      select distinct on (ordering_key)
        ordering_key,
        category_key,
        display_sort_key,
        row_ref
      from identity_groups
      order by ordering_key,
        private.shopping_category_rank_v2(v_preferences, category_key),
        display_sort_key collate "C",
        row_ref collate "C"
    )
    select jsonb_build_object(
      'orderingKey', ordering_key,
      'categoryKey', category_key
    )
    from assigned_groups
    order by private.shopping_category_rank_v2(v_preferences, category_key),
      display_sort_key collate "C",
      ordering_key collate "C",
      row_ref collate "C"
  loop
    if v_row->>'orderingKey' = any(v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_row->>'orderingKey');
    v_category_key := v_row->>'categoryKey';
    v_ingredient_order := jsonb_set(
      v_ingredient_order,
      array[v_category_key],
      coalesce(v_ingredient_order->v_category_key, '[]'::jsonb)
        || jsonb_build_array(v_row->>'orderingKey'),
      true
    );
  end loop;

  return jsonb_set(
    v_document,
    '{preferences,ingredientOrderByCategory}',
    v_ingredient_order,
    true
  );
end;
$$;

create function public.is_shopping_document_v2(p_document jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_ingredient jsonb;
  v_manual jsonb;
  v_override record;
  v_category record;
  v_custom jsonb;
  v_category_order record;
  v_ref text;
  v_aggregate_keys text[] := '{}'::text[];
  v_seen text[] := '{}'::text[];
begin
  if jsonb_typeof(p_document) <> 'object'
     or (p_document - array[
       'schemaVersion','recipeEntries','manualItems','itemOverrides','preferences'
     ]) <> '{}'::jsonb
     or not (p_document ?& array[
       'schemaVersion','recipeEntries','manualItems','itemOverrides','preferences'
     ])
     or p_document->'schemaVersion' <> '2'::jsonb
     or jsonb_typeof(p_document->'recipeEntries') <> 'object'
     or jsonb_typeof(p_document->'manualItems') <> 'array'
     or jsonb_typeof(p_document->'itemOverrides') <> 'object'
     or jsonb_typeof(p_document->'preferences') <> 'object' then
    return false;
  end if;

  for v_entry in select key, value from jsonb_each(p_document->'recipeEntries') loop
    if trim(v_entry.key) = ''
       or jsonb_typeof(v_entry.value) <> 'object'
       or (v_entry.value - array['recipeId','recipeName','selectedServings','scaleV1','ingredients']) <> '{}'::jsonb
       or not (v_entry.value ?& array['recipeId','recipeName','selectedServings','scaleV1','ingredients'])
       or v_entry.value->>'recipeId' <> v_entry.key
       or jsonb_typeof(v_entry.value->'recipeName') <> 'string'
       or trim(v_entry.value->>'recipeName') = ''
       or jsonb_typeof(v_entry.value->'selectedServings') <> 'number'
       or (v_entry.value->>'selectedServings')::numeric <= 0
       or not private.is_shopping_rational_v1(v_entry.value->'scaleV1', true)
       or jsonb_typeof(v_entry.value->'ingredients') <> 'array' then
      return false;
    end if;

    for v_ingredient in select value from jsonb_array_elements(v_entry.value->'ingredients') loop
      if jsonb_typeof(v_ingredient) <> 'object'
         or (v_ingredient - array[
           'ingredientKey','aggregateKey','displayName','quantity','purchaseUnit',
           'defaultCategoryKey','pantryMatchKeys','exclusionFamily','citrusPrep'
         ]) <> '{}'::jsonb
         or not (v_ingredient ?& array[
           'ingredientKey','aggregateKey','displayName','quantity','purchaseUnit',
           'defaultCategoryKey','pantryMatchKeys'
         ])
         or jsonb_typeof(v_ingredient->'ingredientKey') <> 'string'
         or trim(v_ingredient->>'ingredientKey') = ''
         or jsonb_typeof(v_ingredient->'aggregateKey') <> 'string'
         or trim(v_ingredient->>'aggregateKey') = ''
         or jsonb_typeof(v_ingredient->'displayName') <> 'string'
         or trim(v_ingredient->>'displayName') = ''
         or not private.is_shopping_persisted_quantity_v1(v_ingredient->'quantity')
         or jsonb_typeof(v_ingredient->'purchaseUnit') <> 'string'
         or jsonb_typeof(v_ingredient->'defaultCategoryKey') <> 'string'
         or trim(v_ingredient->>'defaultCategoryKey') = ''
         or jsonb_typeof(v_ingredient->'pantryMatchKeys') <> 'array'
         or jsonb_array_length(v_ingredient->'pantryMatchKeys') = 0
         or exists (
           select 1 from jsonb_array_elements(v_ingredient->'pantryMatchKeys') as match(value)
           where jsonb_typeof(value) <> 'string' or trim(value #>> '{}') = ''
         )
         or (select count(*) from jsonb_array_elements_text(v_ingredient->'pantryMatchKeys')) <>
            (select count(distinct value) from jsonb_array_elements_text(v_ingredient->'pantryMatchKeys') as matches(value))
         or (v_ingredient ? 'exclusionFamily' and v_ingredient->>'exclusionFamily' not in ('salt','black-pepper'))
         or (v_ingredient ? 'citrusPrep' and (
           v_ingredient->>'citrusPrep' not in ('juiced','zested')
           or v_ingredient->>'ingredientKey' not in ('lemon','lime')
           or v_ingredient->>'purchaseUnit' <> 'count'
         )) then
        return false;
      end if;
      v_aggregate_keys := array_append(v_aggregate_keys, v_ingredient->>'aggregateKey');
    end loop;
  end loop;

  if exists (
    select 1
    from jsonb_each(p_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
    group by ingredient->>'aggregateKey'
    having count(distinct ingredient->>'ingredientKey') <> 1
  ) then
    return false;
  end if;

  v_seen := '{}'::text[];
  for v_manual in select value from jsonb_array_elements(p_document->'manualItems') loop
    if jsonb_typeof(v_manual) <> 'object'
       or (v_manual - array['id','displayName','quantity','categoryKey','bucket','checked']) <> '{}'::jsonb
       or not (v_manual ?& array['id','displayName','quantity','categoryKey','bucket','checked'])
       or jsonb_typeof(v_manual->'id') <> 'string'
       or trim(v_manual->>'id') = ''
       or v_manual->>'id' = any(v_seen)
       or jsonb_typeof(v_manual->'displayName') <> 'string'
       or trim(v_manual->>'displayName') = ''
       or not private.is_shopping_persisted_quantity_v1(v_manual->'quantity')
       or jsonb_typeof(v_manual->'categoryKey') <> 'string'
       or trim(v_manual->>'categoryKey') = ''
       or v_manual->>'bucket' not in ('items','already_have','excluded')
       or jsonb_typeof(v_manual->'checked') <> 'boolean' then
      return false;
    end if;
    v_seen := array_append(v_seen, v_manual->>'id');
  end loop;

  for v_override in select key, value from jsonb_each(p_document->'itemOverrides') loop
    if not (v_override.key = any(v_aggregate_keys))
       or jsonb_typeof(v_override.value) <> 'object'
       or v_override.value = '{}'::jsonb
       or (v_override.value - array['displayName','quantity','bucket','checked','suppressed']) <> '{}'::jsonb
       or (v_override.value ? 'displayName' and (
         jsonb_typeof(v_override.value->'displayName') <> 'string'
         or trim(v_override.value->>'displayName') = ''
       ))
       or (v_override.value ? 'quantity'
         and not private.is_shopping_persisted_quantity_v1(v_override.value->'quantity'))
       or (v_override.value ? 'bucket' and v_override.value->>'bucket' not in ('items','already_have','excluded'))
       or (v_override.value ? 'checked' and jsonb_typeof(v_override.value->'checked') <> 'boolean')
       or (v_override.value ? 'suppressed' and v_override.value->'suppressed' <> 'true'::jsonb) then
      return false;
    end if;
  end loop;

  if ((p_document->'preferences') - array[
       'categoryByIngredient','customCategories','categoryOrder',
       'ingredientOrderByCategory','excludedIngredientKeys',
       'excludeSaltVariants','excludeBlackPepperVariants'
     ]) <> '{}'::jsonb
     or not (p_document->'preferences' ?& array[
       'categoryByIngredient','customCategories','categoryOrder',
       'ingredientOrderByCategory','excludedIngredientKeys',
       'excludeSaltVariants','excludeBlackPepperVariants'
     ])
     or jsonb_typeof(p_document->'preferences'->'categoryByIngredient') <> 'object'
     or jsonb_typeof(p_document->'preferences'->'customCategories') <> 'array'
     or jsonb_typeof(p_document->'preferences'->'categoryOrder') <> 'array'
     or jsonb_typeof(p_document->'preferences'->'ingredientOrderByCategory') <> 'object'
     or jsonb_typeof(p_document->'preferences'->'excludedIngredientKeys') <> 'array'
     or jsonb_typeof(p_document->'preferences'->'excludeSaltVariants') <> 'boolean'
     or jsonb_typeof(p_document->'preferences'->'excludeBlackPepperVariants') <> 'boolean'
     or exists (
       select 1 from jsonb_each(p_document->'preferences'->'categoryByIngredient') as category(key, value)
       where trim(key) = '' or jsonb_typeof(value) <> 'string' or trim(value #>> '{}') = ''
     ) then
    return false;
  end if;

  v_seen := '{}'::text[];
  for v_custom in select value from jsonb_array_elements(p_document->'preferences'->'customCategories') loop
    if jsonb_typeof(v_custom) <> 'object'
       or (v_custom - array['id','name','order']) <> '{}'::jsonb
       or not (v_custom ?& array['id','name','order'])
       or jsonb_typeof(v_custom->'id') <> 'string'
       or trim(v_custom->>'id') = ''
       or v_custom->>'id' = any(v_seen)
       or jsonb_typeof(v_custom->'name') <> 'string'
       or trim(v_custom->>'name') = ''
       or jsonb_typeof(v_custom->'order') <> 'number' then
      return false;
    end if;
    v_seen := array_append(v_seen, v_custom->>'id');
  end loop;

  foreach v_ref in array array['categoryOrder','excludedIngredientKeys'] loop
    if exists (
      select 1 from jsonb_array_elements(p_document->'preferences'->v_ref) as item(value)
      where jsonb_typeof(value) <> 'string' or trim(value #>> '{}') = ''
    ) or (select count(*) from jsonb_array_elements_text(p_document->'preferences'->v_ref)) <>
         (select count(distinct value) from jsonb_array_elements_text(p_document->'preferences'->v_ref) as items(value)) then
      return false;
    end if;
  end loop;

  v_seen := '{}'::text[];
  for v_category_order in
    select key, value
    from jsonb_each(p_document->'preferences'->'ingredientOrderByCategory')
  loop
    if trim(v_category_order.key) = ''
       or jsonb_typeof(v_category_order.value) <> 'array'
       or exists (
         select 1 from jsonb_array_elements(v_category_order.value) as item(value)
         where jsonb_typeof(value) <> 'string' or trim(value #>> '{}') = ''
       )
       or (select count(*) from jsonb_array_elements_text(v_category_order.value)) <>
          (select count(distinct value) from jsonb_array_elements_text(v_category_order.value) as items(value)) then
      return false;
    end if;
    for v_ref in select value from jsonb_array_elements_text(v_category_order.value) loop
      if v_ref = any(v_seen) then
        return false;
      end if;
      v_seen := array_append(v_seen, v_ref);
    end loop;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

alter function public.is_shopping_document_v2(jsonb) owner to postgres;
revoke all privileges on function public.is_shopping_document_v2(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.is_shopping_document_v2(jsonb)
  to authenticated, service_role;

alter table public.shopping_list
  drop constraint shopping_list_document_v1_check;

alter table public.shopping_list
  disable trigger enforce_shopping_document_revision_on_update;
update public.shopping_list
set document = private.upgrade_shopping_document_v2(document);
alter table public.shopping_list
  enable trigger enforce_shopping_document_revision_on_update;

alter table public.shopping_list
  alter column document set default
    '{"schemaVersion":2,"recipeEntries":{},"manualItems":[],"itemOverrides":{},"preferences":{"categoryByIngredient":{},"customCategories":[],"categoryOrder":[],"ingredientOrderByCategory":{},"excludedIngredientKeys":[],"excludeSaltVariants":false,"excludeBlackPepperVariants":false}}'::jsonb,
  add constraint shopping_list_document_v2_check
    check (public.is_shopping_document_v2(document));

alter function private.prune_shopping_document_v1(jsonb)
  rename to prune_shopping_document_v2;
create or replace function private.prune_shopping_document_v2(p_document jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with active_keys as (
    select distinct ingredient->>'aggregateKey' as aggregate_key
    from jsonb_each(p_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
  ), overrides as (
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) as value
    from jsonb_each(p_document->'itemOverrides')
    where key in (select aggregate_key from active_keys)
  )
  select jsonb_set(p_document, '{itemOverrides}', overrides.value, true)
  from overrides;
$$;

create or replace function public.move_shopping_document_item_to_pantry(
  p_expected_revision bigint,
  p_document jsonb,
  p_item text,
  p_pantry_qty numeric,
  p_pantry_unit text
)
returns table(
  document jsonb,
  content_revision bigint,
  updated_at timestamptz,
  pantry_item jsonb,
  pantry_was_inserted boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_pantry public.pantry_items%rowtype;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not public.is_shopping_document_v2(p_document) then
    raise exception 'invalid ShoppingDocumentV2' using errcode = '23514';
  end if;

  update public.shopping_list as shopping
  set document = p_document,
      content_revision = p_expected_revision + 1
  where shopping.user_id = v_user_id
    and shopping.content_revision = p_expected_revision
  returning shopping.document, shopping.content_revision, shopping.updated_at
    into document, content_revision, updated_at;
  if not found then
    raise exception 'Shopping content revision conflict' using errcode = '40001';
  end if;

  insert into public.pantry_items (user_id, item)
  values (v_user_id, lower(trim(p_item)))
  on conflict (user_id, item) do nothing
  returning * into v_pantry;
  pantry_was_inserted := found;
  if not pantry_was_inserted then
    select * into v_pantry
    from public.pantry_items as pantry
    where pantry.user_id = v_user_id
      and pantry.item = lower(trim(p_item));
  end if;
  pantry_item := to_jsonb(v_pantry)
    || jsonb_build_object(
      'amount', p_pantry_qty,
      'unit', nullif(p_pantry_unit, '')
    );
  return next;
end;
$$;

create or replace function public.delete_recipe(p_recipe_uuid uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_legacy_id text;
  v_deleted uuid;
  v_document jsonb;
  v_previous_deletion_setting text := coalesce(
    current_setting('recipe_genie.recipe_deletion', true), ''
  );
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select recipe.id into v_legacy_id
  from public.recipes as recipe
  where recipe.user_id = v_user_id and recipe.recipe_uuid = p_recipe_uuid
  for update;
  if v_legacy_id is null then
    raise exception 'recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  perform 1 from public.weekly_plans as plan
  where plan.user_id = v_user_id and (
    p_recipe_uuid = any(plan.recipe_uuids) or v_legacy_id = any(plan.recipe_ids)
    or plan.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(plan.day_assignments, '{}'::jsonb) ? v_legacy_id
    or p_recipe_uuid = any(plan.made_recipe_uuids)
    or v_legacy_id = any(plan.made_recipe_ids)
  ) order by plan.week_date for update;
  perform 1 from public.plan_templates as template
  where template.user_id = v_user_id and (
    p_recipe_uuid = any(template.recipe_uuids) or v_legacy_id = any(template.recipe_ids)
    or template.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(template.day_assignments, '{}'::jsonb) ? v_legacy_id
  ) order by template.id for update;
  select document into v_document
  from public.shopping_list
  where user_id = v_user_id
  for update;

  perform set_config('recipe_genie.recipe_deletion', 'on', true);
  update public.weekly_plans as plan
  set recipe_uuids = private.remove_recipe_uuid_from_array(plan.recipe_uuids, p_recipe_uuid),
      day_assignment_recipe_uuids = coalesce(plan.day_assignment_recipe_uuids, '{}'::jsonb)
        - p_recipe_uuid::text,
      made_recipe_uuids = private.remove_recipe_uuid_from_array(plan.made_recipe_uuids, p_recipe_uuid)
  where plan.user_id = v_user_id and (
    p_recipe_uuid = any(plan.recipe_uuids) or v_legacy_id = any(plan.recipe_ids)
    or plan.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(plan.day_assignments, '{}'::jsonb) ? v_legacy_id
    or p_recipe_uuid = any(plan.made_recipe_uuids)
    or v_legacy_id = any(plan.made_recipe_ids)
  );
  update public.plan_templates as template
  set recipe_uuids = private.remove_recipe_uuid_from_array(template.recipe_uuids, p_recipe_uuid),
      day_assignment_recipe_uuids = coalesce(template.day_assignment_recipe_uuids, '{}'::jsonb)
        - p_recipe_uuid::text
  where template.user_id = v_user_id and (
    p_recipe_uuid = any(template.recipe_uuids) or v_legacy_id = any(template.recipe_ids)
    or template.day_assignment_recipe_uuids ? p_recipe_uuid::text
    or coalesce(template.day_assignments, '{}'::jsonb) ? v_legacy_id
  );
  if v_document->'recipeEntries' ? p_recipe_uuid::text then
    v_document := jsonb_set(
      v_document,
      '{recipeEntries}',
      (v_document->'recipeEntries') - p_recipe_uuid::text,
      true
    );
    update public.shopping_list
    set document = private.prune_shopping_document_v2(v_document),
        content_revision = content_revision + 1
    where user_id = v_user_id;
  end if;
  delete from public.recipes as recipe
  where recipe.user_id = v_user_id and recipe.recipe_uuid = p_recipe_uuid
  returning recipe.recipe_uuid into v_deleted;
  if v_deleted is null then
    raise exception 'recipe UUID is unresolved or belongs to another user'
      using errcode = '23503';
  end if;
  perform set_config('recipe_genie.recipe_deletion', v_previous_deletion_setting, true);
  return v_deleted;
end;
$$;

drop function private.upgrade_shopping_document_v2(jsonb);
drop function private.shopping_v1_ordering_key(text, jsonb);
drop function private.shopping_display_sort_key_v1(text);
drop function private.shopping_known_noun_v1(text);
drop function private.shopping_category_rank_v2(jsonb, text);
drop function public.is_shopping_document_v1(jsonb);

revoke all privileges on function private.prune_shopping_document_v2(jsonb)
  from public, anon, authenticated, service_role;

commit;
