-- Atomic Shopping persistence cutover to ShoppingDocumentV1.
-- The migration converts every owner in one transaction and raises before any
-- legacy object is dropped when a document cannot be represented safely.

begin;

lock table public.shopping_list in access exclusive mode;
lock table public.shopping_recipe_contributions in access exclusive mode;
lock table public.shopping_contribution_commands in access exclusive mode;
lock table public.user_config in access exclusive mode;

drop trigger if exists bump_shopping_contribution_revision_on_update
  on public.shopping_list;

alter table public.shopping_list
  add column document jsonb,
  add column content_revision bigint,
  add column updated_at timestamptz;

create function private.shopping_legacy_ingredient_key(p_item text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case regexp_replace(
    regexp_replace(lower(trim(coalesce(p_item, ''))), '\s+\(or\s+.+\)$', '', 'i'),
    '^[,[:space:]]+|[,[:space:];:]+$', '', 'g'
  )
    when 'onions' then 'onion'
    when 'lemons' then 'lemon'
    when 'limes' then 'lime'
    when 'eggs' then 'egg'
    when 'tomatoes' then 'tomato'
    when 'potatoes' then 'potato'
    else regexp_replace(
      regexp_replace(lower(trim(coalesce(p_item, ''))), '\s+\(or\s+.+\)$', '', 'i'),
      '\s+', ' ', 'g'
    )
  end;
$$;

create function private.shopping_legacy_aggregate_key(
  p_ingredient_key text,
  p_recipe_uuid uuid,
  p_item jsonb
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(p_item->>'structuredSourceKey', '') is not null then
      format(
        '["shopping-aggregate",1,%s,["legacy-structured",%s,%s]]',
        to_jsonb(p_ingredient_key)::text,
        to_jsonb(p_recipe_uuid::text)::text,
        to_jsonb(p_item->>'structuredSourceKey')::text
      )
    else format('["shopping-aggregate",1,%s]', to_jsonb(p_ingredient_key)::text)
  end;
$$;

create function private.shopping_scale_v1(p_scale numeric, p_exact jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
  v_digits integer;
begin
  if jsonb_typeof(p_exact) = 'object'
     and nullif(p_exact->>'numerator', '') is not null
     and nullif(p_exact->>'denominator', '') is not null then
    return jsonb_build_object(
      'numerator', p_exact->>'numerator',
      'denominator', p_exact->>'denominator'
    );
  end if;
  if p_scale is null or p_scale <= 0 then
    raise exception 'Shopping conversion failed: invalid contribution scale';
  end if;
  v_text := trim(trailing '.' from trim(trailing '0' from p_scale::text));
  if position('.' in v_text) = 0 then
    return jsonb_build_object('numerator', v_text, 'denominator', '1');
  end if;
  v_digits := length(split_part(v_text, '.', 2));
  return jsonb_build_object(
    'numerator', replace(v_text, '.', ''),
    'denominator', (10::numeric ^ v_digits)::bigint::text
  );
end;
$$;

create function private.convert_shopping_document_v1(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list public.shopping_list%rowtype;
  v_config public.user_config%rowtype;
  v_document jsonb;
  v_preferences jsonb;
  v_category_map jsonb := '{}'::jsonb;
  v_legacy_map jsonb := '{}'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_manual jsonb := '[]'::jsonb;
  v_overrides jsonb := '{}'::jsonb;
  v_order jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_ingredients jsonb;
  v_ingredient jsonb;
  v_quantity jsonb;
  v_row jsonb;
  v_sources jsonb;
  v_override jsonb;
  v_candidate text;
  v_mapped text;
  v_aggregate_key text;
  v_ingredient_key text;
  v_manual_id text;
  v_bucket text;
  v_base_bucket text;
  v_base_display text;
  v_base_category text;
  v_source_ids text[];
  v_citrus_preps text[];
  v_map_keys text[];
  v_additional jsonb;
  v_current_quantity jsonb;
  v_derived_quantity jsonb;
  v_contribution record;
  v_item record;
  v_rendered record;
  v_category record;
  v_active_key record;
  v_has_manual boolean;
  v_has_unknown boolean;
  v_has_config boolean;
begin
  select * into strict v_list
  from public.shopping_list
  where user_id = p_user_id;

  select * into v_config
  from public.user_config
  where user_id = p_user_id;
  v_has_config := found;

  if v_has_config and jsonb_typeof(coalesce(v_config.category_overrides, '{}'::jsonb)) <> 'object' then
    raise exception 'Shopping conversion failed: malformed preferences';
  end if;
  if v_has_config then
    for v_category in
      select key, value
      from jsonb_each_text(coalesce(v_config.category_overrides, '{}'::jsonb))
    loop
      v_category_map := jsonb_set(
        v_category_map,
        array[private.shopping_legacy_ingredient_key(v_category.key)],
        to_jsonb(v_category.value),
        true
      );
    end loop;
  end if;

  v_preferences := jsonb_build_object(
    'categoryByIngredient', v_category_map,
    'customCategories', case
      when v_has_config and jsonb_typeof(v_config.custom_categories) = 'array'
        then v_config.custom_categories else '[]'::jsonb end,
    'categoryOrder', case
      when v_has_config and jsonb_typeof(v_config.category_order) = 'array'
        then v_config.category_order else '[]'::jsonb end,
    'excludedIngredientKeys', coalesce((
      select jsonb_agg(private.shopping_legacy_ingredient_key(keyword) order by position)
      from unnest(case when v_has_config then coalesce(v_config.excluded_keywords, '{}'::text[])
        else '{}'::text[] end) with ordinality as excluded(keyword, position)
    ), '[]'::jsonb),
    'excludeSaltVariants', case when v_has_config then coalesce(v_config.exclude_salt_variants, false) else false end,
    'excludeBlackPepperVariants', case when v_has_config then coalesce(v_config.exclude_black_pepper_variants, false) else false end
  );

  v_document := jsonb_build_object(
    'schemaVersion', 1,
    'recipeEntries', '{}'::jsonb,
    'manualItems', '[]'::jsonb,
    'itemOverrides', '{}'::jsonb,
    'order', '[]'::jsonb,
    'preferences', v_preferences
  );

  for v_contribution in
    select contribution.*
    from public.shopping_recipe_contributions as contribution
    where contribution.user_id = p_user_id
    order by contribution.recipe_uuid
  loop
    if not exists (
      select 1 from public.recipes as recipe
      where recipe.user_id = p_user_id
        and recipe.recipe_uuid = v_contribution.recipe_uuid
    ) then
      raise exception 'Shopping conversion failed: invalid source recipe reference';
    end if;
    if v_contribution.normalization_version not in (1, 2)
       or jsonb_typeof(v_contribution.snapshot) <> 'object'
       or nullif(v_contribution.snapshot->>'recipeName', '') is null
       or jsonb_typeof(v_contribution.snapshot->'items') <> 'array'
       or v_contribution.servings <= 0
       or v_contribution.scale <= 0 then
      raise exception 'Shopping conversion failed: malformed contribution';
    end if;

    v_ingredients := '[]'::jsonb;
    for v_item in
      select item, position
      from jsonb_array_elements(v_contribution.snapshot->'items')
        with ordinality as frozen(item, position)
      order by position
    loop
      if jsonb_typeof(v_item.item) <> 'object'
         or nullif(v_item.item->>'item', '') is null
         or nullif(v_item.item->>'categoryKey', '') is null
         or coalesce(v_item.item->>'bucket', '') not in ('items', 'already_have', 'excluded')
         or coalesce(jsonb_typeof(v_item.item->'additionalAmounts'), 'array') <> 'array' then
        raise exception 'Shopping conversion failed: malformed contribution row';
      end if;
      v_ingredient_key := private.shopping_legacy_ingredient_key(v_item.item->>'item');
      if v_ingredient_key = '' then
        raise exception 'Shopping conversion failed: malformed contribution row';
      end if;
      v_aggregate_key := private.shopping_legacy_aggregate_key(
        v_ingredient_key,
        v_contribution.recipe_uuid,
        v_item.item
      );
      v_quantity := case
        when (v_item.item->'amount') is null
          and (v_item.item->'exactQuantityV1') is null
          and (v_item.item->'exactPackageV1') is null then null
        else jsonb_build_object(
          'amount', coalesce(v_item.item->'amount', 'null'::jsonb),
          'unit', coalesce(v_item.item->>'unit', '')
        )
          || case when v_item.item ? 'exactQuantityV1'
            then jsonb_build_object('exactQuantityV1', v_item.item->'exactQuantityV1')
            else '{}'::jsonb end
          || case when v_item.item ? 'exactPackageV1'
            then jsonb_build_object('exactPackageV1', v_item.item->'exactPackageV1')
            else '{}'::jsonb end
          || case when nullif(v_item.item->>'exactAuthoredUnit', '') is not null
            then jsonb_build_object('exactAuthoredUnit', v_item.item->>'exactAuthoredUnit')
            else '{}'::jsonb end
      end;
      v_ingredient := jsonb_build_object(
        'ingredientKey', v_ingredient_key,
        'aggregateKey', v_aggregate_key,
        'displayName', v_item.item->>'item',
        'quantity', v_quantity,
        'purchaseUnit', coalesce(v_item.item->>'unit', ''),
        'defaultCategoryKey', v_item.item->>'categoryKey',
        'pantryMatchKeys', jsonb_build_array(v_ingredient_key)
      );
      if v_ingredient_key in ('lemon', 'lime')
         and coalesce(v_item.item->>'unit', '') = 'count' then
        select coalesce(array_agg(distinct source->>'prepIntent') filter (
          where source->>'prepIntent' in ('juiced', 'zested')
        ), '{}'::text[])
          into v_citrus_preps
        from jsonb_array_elements(case
          when jsonb_typeof(v_item.item->'sources') = 'array'
            then v_item.item->'sources'
          else '[]'::jsonb
        end) as sources(source);
        if cardinality(v_citrus_preps) = 1 then
          v_ingredient := v_ingredient || jsonb_build_object(
            'citrusPrep', v_citrus_preps[1]
          );
        end if;
      end if;
      if coalesce(v_item.item->>'excludedBy', '') = 'Salt variants' then
        v_ingredient := v_ingredient || jsonb_build_object('exclusionFamily', 'salt');
      elsif coalesce(v_item.item->>'excludedBy', '') = 'Black pepper variants' then
        v_ingredient := v_ingredient || jsonb_build_object('exclusionFamily', 'black-pepper');
      end if;
      v_ingredients := v_ingredients || jsonb_build_array(v_ingredient);

      for v_additional in
        select amount
        from jsonb_array_elements(case when jsonb_typeof(v_item.item->'additionalAmounts') = 'array'
          then v_item.item->'additionalAmounts' else '[]'::jsonb end)
          as additional(amount)
      loop
        if jsonb_typeof(v_additional) <> 'object'
           or jsonb_typeof(v_additional->'amount') <> 'number'
           or jsonb_typeof(v_additional->'unit') <> 'string' then
          raise exception 'Shopping conversion failed: malformed contribution row';
        end if;
        v_ingredients := v_ingredients || jsonb_build_array(
          v_ingredient || jsonb_build_object(
            'quantity', jsonb_build_object(
              'amount', v_additional->'amount',
              'unit', v_additional->>'unit'
            ),
            'purchaseUnit', v_additional->>'unit'
          )
        );
      end loop;

      v_map_keys := array[
        v_ingredient_key,
        v_ingredient_key || '|category:' || (v_item.item->>'categoryKey')
      ];
      if nullif(v_item.item->>'structuredSourceKey', '') is not null then
        v_map_keys := array_append(v_map_keys, 'structured:' || (v_item.item->>'structuredSourceKey'));
      end if;
      if nullif(v_item.item->>'contributionKey', '') is not null then
        v_map_keys := array_append(v_map_keys, v_item.item->>'contributionKey');
      end if;
      foreach v_candidate in array v_map_keys loop
        v_mapped := v_legacy_map->>v_candidate;
        if v_mapped is not null and v_mapped <> v_aggregate_key then
          raise exception 'Shopping conversion failed: contribution identity collision';
        end if;
        v_legacy_map := jsonb_set(v_legacy_map, array[v_candidate], to_jsonb(v_aggregate_key), true);
      end loop;
    end loop;

    v_entry := jsonb_build_object(
      'recipeId', v_contribution.recipe_uuid::text,
      'recipeName', v_contribution.snapshot->>'recipeName',
      'selectedServings', v_contribution.servings,
      'scaleV1', private.shopping_scale_v1(
        v_contribution.scale,
        v_contribution.snapshot->'exactScaleV1'
      ),
      'ingredients', v_ingredients
    );
    v_document := jsonb_set(
      v_document,
      array['recipeEntries', v_contribution.recipe_uuid::text],
      v_entry,
      true
    );
  end loop;

  for v_rendered in
    select bucket, item, position
    from (
      select 'items'::text as bucket, item, position
      from jsonb_array_elements(coalesce(v_list.items, '[]'::jsonb))
        with ordinality as rows(item, position)
      union all
      select 'already_have', item, position
      from jsonb_array_elements(coalesce(v_list.already_have, '[]'::jsonb))
        with ordinality as rows(item, position)
      union all
      select 'excluded', item, position
      from jsonb_array_elements(coalesce(v_list.excluded, '[]'::jsonb))
        with ordinality as rows(item, position)
    ) as rendered
  loop
    v_row := v_rendered.item;
    v_bucket := v_rendered.bucket;
    if jsonb_typeof(v_row) <> 'object'
       or nullif(v_row->>'item', '') is null
       or nullif(v_row->>'categoryKey', '') is null
       or coalesce(jsonb_typeof(v_row->'additionalAmounts'), 'array') <> 'array' then
      raise exception 'Shopping conversion failed: malformed rendered row';
    end if;
    v_sources := coalesce(v_row->'sources', '[]'::jsonb);
    if jsonb_typeof(v_sources) <> 'array' then
      raise exception 'Shopping conversion failed: malformed rendered row';
    end if;
    select coalesce(array_agg(distinct source_id) filter (where source_id is not null), '{}'::text[]),
           bool_or(is_manual),
           bool_or(is_unknown)
      into v_source_ids, v_has_manual, v_has_unknown
    from (
      select
        coalesce(nullif(source->>'recipeUuid', ''),
          case when coalesce(source->>'recipeId', '') ~
            '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
            then source->>'recipeId' end) as source_id,
        coalesce(source->>'recipeName', '') = 'Manual'
          and nullif(source->>'recipeUuid', '') is null as is_manual,
        coalesce(source->>'recipeName', '') <> 'Manual'
          and coalesce(nullif(source->>'recipeUuid', ''),
            case when coalesce(source->>'recipeId', '') ~
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
              then source->>'recipeId' end) is null as is_unknown
      from jsonb_array_elements(v_sources) as sources(source)
    ) as classified;
    v_has_manual := coalesce(v_has_manual, false);
    v_has_unknown := coalesce(v_has_unknown, false);

    if cardinality(v_source_ids) > 0 then
      if v_has_manual or v_has_unknown or exists (
        select 1 from unnest(v_source_ids) as source_id
        where not (v_document->'recipeEntries' ? source_id)
      ) then
        raise exception 'Shopping conversion failed: mixed or invalid recipe provenance';
      end if;
    else
      if not (
        (jsonb_array_length(v_sources) > 0 and not v_has_unknown and v_has_manual)
        or (jsonb_array_length(v_sources) = 0 and v_list.legacy_items_preserved)
      ) then
        raise exception 'Shopping conversion failed: ambiguous legacy row';
      end if;
      if jsonb_array_length(coalesce(v_row->'additionalAmounts', '[]'::jsonb)) > 0 then
        raise exception 'Shopping conversion failed: explicit multi-part manual override';
      end if;
      v_manual_id := coalesce(
        nullif(v_row->>'rowId', ''),
        format('converted-%s-%s-%s', v_bucket, v_rendered.position,
          encode(convert_to(private.shopping_legacy_ingredient_key(v_row->>'item'), 'utf8'), 'hex'))
      );
      if exists (
        select 1 from jsonb_array_elements(v_manual) as manual(item)
        where manual.item->>'id' = v_manual_id
      ) then
        raise exception 'Shopping conversion failed: manual identity collision';
      end if;
      v_quantity := case
        when (v_row->'amount') is null
          and (v_row->'exactQuantityV1') is null
          and (v_row->'exactPackageV1') is null then null
        else jsonb_build_object(
          'amount', coalesce(v_row->'amount', 'null'::jsonb),
          'unit', coalesce(v_row->>'unit', '')
        )
          || case when v_row ? 'exactQuantityV1'
            then jsonb_build_object('exactQuantityV1', v_row->'exactQuantityV1')
            else '{}'::jsonb end
          || case when v_row ? 'exactPackageV1'
            then jsonb_build_object('exactPackageV1', v_row->'exactPackageV1')
            else '{}'::jsonb end
          || case when nullif(v_row->>'exactAuthoredUnit', '') is not null
            then jsonb_build_object('exactAuthoredUnit', v_row->>'exactAuthoredUnit')
            else '{}'::jsonb end
      end;
      v_manual := v_manual || jsonb_build_array(jsonb_build_object(
        'id', v_manual_id,
        'displayName', v_row->>'item',
        'quantity', v_quantity,
        'categoryKey', v_row->>'categoryKey',
        'bucket', v_bucket,
        'checked', coalesce((v_row->>'checked')::boolean, false)
      ));
      v_order := v_order || jsonb_build_array('manual:' || v_manual_id);
      continue;
    end if;

    v_aggregate_key := null;
    v_ingredient_key := private.shopping_legacy_ingredient_key(v_row->>'item');
    v_map_keys := array[
      nullif(v_row->>'contributionKey', ''),
      case when nullif(v_row->>'structuredSourceKey', '') is not null
        then 'structured:' || (v_row->>'structuredSourceKey') end,
      v_ingredient_key || '|category:' || (v_row->>'categoryKey'),
      v_ingredient_key
    ];
    foreach v_candidate in array v_map_keys loop
      if v_candidate is null then continue; end if;
      v_mapped := v_legacy_map->>v_candidate;
      if v_mapped is null then continue; end if;
      if v_aggregate_key is not null and v_aggregate_key <> v_mapped then
        raise exception 'Shopping conversion failed: rendered row identity is ambiguous';
      end if;
      v_aggregate_key := v_mapped;
    end loop;
    if v_aggregate_key is null then
      raise exception 'Shopping conversion failed: rendered row has no target aggregate';
    end if;
    if v_seen ? v_aggregate_key then
      raise exception 'Shopping conversion failed: rendered identity collision';
    end if;
    v_seen := jsonb_set(v_seen, array[v_aggregate_key], 'true'::jsonb, true);

    select ingredient->>'displayName',
           coalesce(v_preferences->'categoryByIngredient'->>(ingredient->>'ingredientKey'),
             ingredient->>'defaultCategoryKey')
      into v_base_display, v_base_category
    from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
    where ingredient->>'aggregateKey' = v_aggregate_key
    order by recipe_id
    limit 1;

    select case
      when bool_and(exists (
        select 1 from public.pantry_items as pantry
        where pantry.user_id = p_user_id
          and private.shopping_legacy_ingredient_key(pantry.item) = ingredient->>'ingredientKey'
      )) then 'already_have'
      when bool_and(v_preferences->'excludedIngredientKeys' ? (ingredient->>'ingredientKey'))
        then 'excluded'
      when (v_preferences->>'excludeSaltVariants')::boolean
        and bool_and(ingredient->>'exclusionFamily' = 'salt') then 'excluded'
      when (v_preferences->>'excludeBlackPepperVariants')::boolean
        and bool_and(ingredient->>'exclusionFamily' = 'black-pepper') then 'excluded'
      else 'items' end
      into v_base_bucket
    from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
    where ingredient->>'aggregateKey' = v_aggregate_key;

    v_override := '{}'::jsonb;
    if v_row->>'item' <> v_base_display then
      v_override := v_override || jsonb_build_object('displayName', v_row->>'item');
    end if;
    if v_row->>'categoryKey' <> v_base_category then
      v_override := v_override || jsonb_build_object('categoryKey', v_row->>'categoryKey');
    end if;
    if v_bucket <> coalesce(v_base_bucket, 'items') then
      v_override := v_override || jsonb_build_object('bucket', v_bucket);
    end if;
    if coalesce((v_row->>'checked')::boolean, false) then
      v_override := v_override || jsonb_build_object('checked', true);
    end if;

    v_derived_quantity := v_row->'derivedQuantity';
    if jsonb_typeof(v_derived_quantity) = 'object' then
      v_current_quantity := jsonb_build_object(
        'amount', coalesce(v_row->'amount', 'null'::jsonb),
        'unit', coalesce(v_row->>'unit', ''),
        'additionalAmounts', coalesce(v_row->'additionalAmounts', '[]'::jsonb)
      );
      v_derived_quantity := jsonb_build_object(
        'amount', coalesce(v_derived_quantity->'amount', 'null'::jsonb),
        'unit', coalesce(v_derived_quantity->>'unit', ''),
        'additionalAmounts', coalesce(v_derived_quantity->'additionalAmounts', '[]'::jsonb)
      );
      if v_current_quantity <> v_derived_quantity then
        if jsonb_array_length(coalesce(v_row->'additionalAmounts', '[]'::jsonb)) > 0 then
          raise exception 'Shopping conversion failed: explicit multi-part quantity override';
        end if;
        v_quantity := case
          when (v_row->'amount') is null
            and (v_row->'exactQuantityV1') is null
            and (v_row->'exactPackageV1') is null then 'null'::jsonb
          else jsonb_build_object(
            'amount', coalesce(v_row->'amount', 'null'::jsonb),
            'unit', coalesce(v_row->>'unit', '')
          )
            || case when v_row ? 'exactQuantityV1'
              then jsonb_build_object('exactQuantityV1', v_row->'exactQuantityV1')
              else '{}'::jsonb end
            || case when v_row ? 'exactPackageV1'
              then jsonb_build_object('exactPackageV1', v_row->'exactPackageV1')
              else '{}'::jsonb end
            || case when nullif(v_row->>'exactAuthoredUnit', '') is not null
              then jsonb_build_object('exactAuthoredUnit', v_row->>'exactAuthoredUnit')
              else '{}'::jsonb end
        end;
        v_override := v_override || jsonb_build_object('quantity', v_quantity);
      end if;
    end if;

    if v_override <> '{}'::jsonb then
      v_overrides := jsonb_set(v_overrides, array[v_aggregate_key], v_override, true);
    end if;
    v_order := v_order || jsonb_build_array('derived:' || v_aggregate_key);
  end loop;

  for v_active_key in
    select distinct ingredient->>'aggregateKey' as aggregate_key
    from jsonb_each(v_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
  loop
    if not (v_seen ? v_active_key.aggregate_key) then
      v_overrides := jsonb_set(
        v_overrides,
        array[v_active_key.aggregate_key],
        jsonb_build_object('suppressed', true),
        true
      );
    end if;
  end loop;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_document, '{manualItems}', v_manual, true),
      '{itemOverrides}', v_overrides, true
    ),
    '{order}', v_order, true
  );
end;
$$;

update public.shopping_list as shopping
set document = private.convert_shopping_document_v1(shopping.user_id),
    content_revision = shopping.contribution_revision,
    updated_at = coalesce(shopping.generated_at, now());

-- Conversion helpers depend on legacy columns and must be removed before the
-- physical legacy schema is dropped later in this transaction.
drop function private.convert_shopping_document_v1(uuid);
drop function private.shopping_scale_v1(numeric, jsonb);
drop function private.shopping_legacy_aggregate_key(text, uuid, jsonb);

alter table public.shopping_list
  alter column document set not null,
  alter column document set default
    '{"schemaVersion":1,"recipeEntries":{},"manualItems":[],"itemOverrides":{},"order":[],"preferences":{"categoryByIngredient":{},"customCategories":[],"categoryOrder":[],"excludedIngredientKeys":[],"excludeSaltVariants":false,"excludeBlackPepperVariants":false}}'::jsonb,
  alter column content_revision set not null,
  alter column content_revision set default 0,
  alter column updated_at set not null,
  alter column updated_at set default now();

create function public.is_shopping_document_v1(p_document jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_document) = 'object'
    and p_document->>'schemaVersion' = '1'
    and jsonb_typeof(p_document->'recipeEntries') = 'object'
    and jsonb_typeof(p_document->'manualItems') = 'array'
    and jsonb_typeof(p_document->'itemOverrides') = 'object'
    and jsonb_typeof(p_document->'order') = 'array'
    and jsonb_typeof(p_document->'preferences') = 'object'
    and (p_document - array[
      'schemaVersion', 'recipeEntries', 'manualItems', 'itemOverrides',
      'order', 'preferences'
    ]) = '{}'::jsonb;
$$;

alter function public.is_shopping_document_v1(jsonb) owner to postgres;

alter table public.shopping_list
  add constraint shopping_list_document_v1_check
  check (public.is_shopping_document_v1(document));

create function private.prune_shopping_document_v1(p_document jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with active_keys as (
    select distinct ingredient->>'aggregateKey' as aggregate_key
    from jsonb_each(p_document->'recipeEntries') as entries(recipe_id, entry)
    cross join lateral jsonb_array_elements(entry->'ingredients') as ingredients(ingredient)
  ), manual_ids as (
    select item->>'id' as manual_id
    from jsonb_array_elements(p_document->'manualItems') as manual(item)
  ), overrides as (
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) as value
    from jsonb_each(p_document->'itemOverrides')
    where key in (select aggregate_key from active_keys)
  ), ordered as (
    select coalesce(jsonb_agg(ref order by position), '[]'::jsonb) as value
    from jsonb_array_elements_text(p_document->'order')
      with ordinality as refs(ref, position)
    where (ref like 'derived:%' and substring(ref from 9) in
      (select aggregate_key from active_keys))
      or (ref like 'manual:%' and substring(ref from 8) in
        (select manual_id from manual_ids))
  )
  select jsonb_set(
    jsonb_set(p_document, '{itemOverrides}', overrides.value, true),
    '{order}', ordered.value, true
  )
  from overrides, ordered;
$$;

create function public.enforce_shopping_document_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'Shopping owner cannot change' using errcode = '23514';
  end if;
  if new.content_revision <> old.content_revision + 1 then
    raise exception 'Shopping content revision must advance exactly once'
      using errcode = '40001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger enforce_shopping_document_revision_on_update
before update on public.shopping_list
for each row execute function public.enforce_shopping_document_revision();

drop policy if exists users_own_shopping on public.shopping_list;
create policy users_read_own_shopping_document
on public.shopping_list for select to authenticated
using ((select auth.uid()) = user_id);
create policy users_update_own_shopping_document
on public.shopping_list for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all privileges on table public.shopping_list from public, anon, authenticated;
grant select on table public.shopping_list to authenticated;
grant update (document, content_revision) on table public.shopping_list to authenticated;
grant all privileges on table public.shopping_list to service_role;

create function public.move_shopping_document_item_to_pantry(
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
  if not public.is_shopping_document_v1(p_document) then
    raise exception 'invalid ShoppingDocumentV1' using errcode = '23514';
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

revoke all privileges on function public.move_shopping_document_item_to_pantry(
  bigint, jsonb, text, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.move_shopping_document_item_to_pantry(
  bigint, jsonb, text, numeric, text
) to authenticated;

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
    set document = private.prune_shopping_document_v1(v_document),
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

alter function public.delete_recipe(uuid) owner to postgres;
revoke all privileges on function public.delete_recipe(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_recipe(uuid) to authenticated;

drop function if exists public.move_shopping_item_to_pantry(text, numeric, text);
drop function if exists public.toggle_shopping_item_checked(text);
drop function if exists public.get_recipe_shopping_contribution_state();
drop function if exists public.apply_recipe_shopping_contribution_uuid_command(
  bigint, jsonb, uuid[], jsonb, jsonb, text, text
);
drop function if exists public.apply_recipe_shopping_contribution_command(
  bigint, jsonb, text[], jsonb, jsonb, text, text
);
drop function if exists public.bump_shopping_contribution_revision();

drop trigger if exists sync_shopping_list_recipe_uuids on public.shopping_list;
drop trigger if exists sync_shopping_contribution_recipe_uuid
  on public.shopping_recipe_contributions;
drop function if exists private.sync_shopping_list_recipe_uuids();
drop function if exists private.sync_shopping_contribution_recipe_uuid();
drop function if exists private.remove_recipe_source_from_items(jsonb, uuid, text);

drop table public.shopping_contribution_commands;
drop table public.shopping_recipe_contributions;

alter table public.shopping_list
  drop column items,
  drop column already_have,
  drop column excluded,
  drop column source_recipes,
  drop column source_recipe_uuids,
  drop column scale,
  drop column total_servings,
  drop column custom_order,
  drop column generated_at,
  drop column contribution_revision,
  drop column contribution_overrides,
  drop column legacy_items_preserved;

alter table public.user_config
  drop column category_overrides,
  drop column custom_categories,
  drop column category_order,
  drop column shopping_item_order,
  drop column excluded_keywords,
  drop column exclude_salt_variants,
  drop column exclude_black_pepper_variants;

drop function private.shopping_legacy_ingredient_key(text);
revoke all privileges on function public.is_shopping_document_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.is_shopping_document_v1(jsonb)
  to authenticated, service_role;
revoke all privileges on function private.prune_shopping_document_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.enforce_shopping_document_revision()
  from public, anon, authenticated, service_role;

commit;
