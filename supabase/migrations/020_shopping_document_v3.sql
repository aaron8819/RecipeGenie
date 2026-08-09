-- Add application-level ShoppingDocumentV3 while retaining V2 rows for
-- lossless, lazy upgrade by the application. This compatibility phase keeps
-- the V2 column default so the prior application remains safe during rollout.
begin;

create function public.is_shopping_document_v3(p_document jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_ingredient jsonb;
  v_aggregate jsonb;
  v_compat jsonb;
  v_compat_ingredients jsonb;
begin
  if jsonb_typeof(p_document) <> 'object'
     or p_document->'schemaVersion' <> '3'::jsonb
     or jsonb_typeof(p_document->'recipeEntries') <> 'object' then
    return false;
  end if;

  v_compat := jsonb_set(p_document, '{schemaVersion}', '2'::jsonb, false);
  for v_entry in
    select key, value from jsonb_each(p_document->'recipeEntries')
  loop
    if jsonb_typeof(v_entry.value->'ingredients') <> 'array' then
      return false;
    end if;
    v_compat_ingredients := '[]'::jsonb;

    for v_ingredient in
      select value from jsonb_array_elements(v_entry.value->'ingredients')
    loop
      if jsonb_typeof(v_ingredient) <> 'object'
         or (v_ingredient - array[
           'purchaseKey','aggregateKey','displayName','quantity','familyKey',
           'preparation','purchaseUnit','quantityKind','defaultCategoryKey',
           'pantryMatchKeys','familyMatchPolicy','exclusionFamily','citrusPrep'
         ]) <> '{}'::jsonb
         or not (v_ingredient ?& array[
           'purchaseKey','aggregateKey','displayName','quantity','familyKey',
           'preparation','purchaseUnit','quantityKind','defaultCategoryKey',
           'pantryMatchKeys','familyMatchPolicy'
         ])
         or jsonb_typeof(v_ingredient->'purchaseKey') <> 'string'
         or trim(v_ingredient->>'purchaseKey') = ''
         or jsonb_typeof(v_ingredient->'aggregateKey') <> 'string'
         or trim(v_ingredient->>'aggregateKey') = ''
         or jsonb_typeof(v_ingredient->'familyKey') <> 'string'
         or trim(v_ingredient->>'familyKey') = ''
         or jsonb_typeof(v_ingredient->'preparation') <> 'array'
         or exists (
           select 1 from jsonb_array_elements(v_ingredient->'preparation') as prep(value)
           where jsonb_typeof(value) <> 'string' or trim(value #>> '{}') = ''
         )
         or (select count(*) from jsonb_array_elements_text(v_ingredient->'preparation')) <>
            (select count(distinct value) from jsonb_array_elements_text(v_ingredient->'preparation') as prep(value))
         or v_ingredient->>'quantityKind' not in (
           'continuous','discrete','package','range','qualitative'
         )
         or jsonb_typeof(v_ingredient->'familyMatchPolicy') <> 'object'
         or (v_ingredient->'familyMatchPolicy' - array[
           'pantryFromGeneric','exclusionEquivalent'
         ]) <> '{}'::jsonb
         or exists (
           select 1
           from jsonb_each(v_ingredient->'familyMatchPolicy') as policy(key, value)
           where jsonb_typeof(value) <> 'boolean'
         )
         or not exists (
           select 1
           from jsonb_array_elements_text(v_ingredient->'pantryMatchKeys') as match(value)
           where value = v_ingredient->>'purchaseKey'
         ) then
        return false;
      end if;

      v_aggregate := (v_ingredient->>'aggregateKey')::jsonb;
      if jsonb_typeof(v_aggregate) <> 'array'
         or v_aggregate->>0 <> 'shopping-aggregate'
         or v_aggregate->>1 <> '2'
         or v_aggregate->>2 <> v_ingredient->>'purchaseKey' then
        return false;
      end if;

      v_compat_ingredients := v_compat_ingredients || jsonb_build_array(
        jsonb_build_object(
          'ingredientKey', v_ingredient->'purchaseKey',
          'aggregateKey', v_ingredient->'aggregateKey',
          'displayName', v_ingredient->'displayName',
          'quantity', v_ingredient->'quantity',
          'purchaseUnit', v_ingredient->'purchaseUnit',
          'defaultCategoryKey', v_ingredient->'defaultCategoryKey',
          'pantryMatchKeys', v_ingredient->'pantryMatchKeys'
        )
        || case when v_ingredient ? 'exclusionFamily'
          then jsonb_build_object('exclusionFamily', v_ingredient->'exclusionFamily')
          else '{}'::jsonb end
        || case when v_ingredient ? 'citrusPrep'
          then jsonb_build_object('citrusPrep', v_ingredient->'citrusPrep')
          else '{}'::jsonb end
      );
    end loop;

    v_compat := jsonb_set(
      v_compat,
      array['recipeEntries', v_entry.key, 'ingredients'],
      v_compat_ingredients,
      false
    );
  end loop;

  return public.is_shopping_document_v2(v_compat);
exception when others then
  return false;
end;
$$;

alter function public.is_shopping_document_v3(jsonb) owner to postgres;
revoke all privileges on function public.is_shopping_document_v3(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.is_shopping_document_v3(jsonb)
  to authenticated, service_role;

alter table public.shopping_list
  drop constraint shopping_list_document_v2_check;

alter table public.shopping_list
  add constraint shopping_list_document_v3_compatibility_check
    check (
      public.is_shopping_document_v2(document)
      or public.is_shopping_document_v3(document)
    );

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
  if not (
    public.is_shopping_document_v2(p_document)
    or public.is_shopping_document_v3(p_document)
  ) then
    raise exception 'invalid Shopping document' using errcode = '23514';
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

commit;
