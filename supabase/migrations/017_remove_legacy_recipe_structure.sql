begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $cleanup_prerequisites$
begin
  if to_regclass('public.recipes') is null
     or to_regclass('public.recipe_shares') is null then
    raise exception 'canonical recipe cleanup requires the post-016 tables';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipes'
      and (
        (column_name = 'ingredients' and data_type = 'jsonb' and is_nullable = 'NO')
        or (column_name = 'instructions' and data_type = 'ARRAY'
          and udt_name = '_text' and is_nullable = 'NO')
        or (column_name = 'instruction_groups' and data_type = 'jsonb')
        or (column_name = 'ingredient_sections' and data_type = 'jsonb'
          and is_nullable = 'NO')
        or (column_name = 'instruction_sections' and data_type = 'jsonb'
          and is_nullable = 'NO')
      )
  ) <> 5 then
    raise exception 'canonical recipe cleanup requires the exact post-016 columns';
  end if;

  if to_regprocedure('private.recipe_ingredient_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_share_snapshot_is_valid(jsonb)') is null
     or to_regprocedure('private.recipe_ingredient_sections_from_legacy(jsonb)') is null
     or to_regprocedure('private.recipe_ingredient_sections_flatten(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_from_flat(text[])') is null
     or to_regprocedure('private.recipe_instruction_sections_from_groups(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_flatten(jsonb)') is null
     or to_regprocedure('private.recipe_notes_from_legacy(jsonb,text[])') is null
     or to_regprocedure('private.recipe_instruction_groups_are_valid(jsonb)') is null
     or to_regprocedure('public.accept_recipe_share(uuid)') is null
     or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'canonical recipe cleanup requires the exact post-016 functions';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = 'public.recipes'::regclass
      and conname in (
        'recipes_ingredient_sections_valid',
        'recipes_instruction_sections_valid'
      )
  ) <> 2 then
    raise exception 'canonical recipe cleanup requires the post-016 constraints';
  end if;

  if exists (
    select 1
    from public.recipes
    where not private.recipe_ingredient_sections_are_valid(ingredient_sections)
       or not private.recipe_instruction_sections_are_valid(instruction_sections)
  ) then
    raise exception 'canonical recipe cleanup found invalid canonical recipes';
  end if;

  if exists (
    select 1
    from public.recipe_shares
    where not private.recipe_share_snapshot_is_valid(source_recipe_snapshot)
  ) then
    raise exception 'canonical recipe cleanup found invalid canonical shares';
  end if;
end;
$cleanup_prerequisites$;

alter table public.recipes
  drop column ingredients,
  drop column instructions,
  drop column instruction_groups;

drop function private.recipe_ingredient_sections_from_legacy(jsonb);
drop function private.recipe_ingredient_sections_flatten(jsonb);
drop function private.recipe_instruction_sections_from_flat(text[]);
drop function private.recipe_instruction_sections_from_groups(jsonb);
drop function private.recipe_instruction_sections_flatten(jsonb);
drop function private.recipe_notes_from_legacy(jsonb, text[]);
drop function private.recipe_instruction_groups_are_valid(jsonb);

do $cleanup_postconditions$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipes'
      and column_name in ('ingredients', 'instructions', 'instruction_groups')
  ) then
    raise exception 'canonical recipe cleanup left legacy columns behind';
  end if;

  if to_regprocedure('private.recipe_ingredient_sections_from_legacy(jsonb)') is not null
     or to_regprocedure('private.recipe_ingredient_sections_flatten(jsonb)') is not null
     or to_regprocedure('private.recipe_instruction_sections_from_flat(text[])') is not null
     or to_regprocedure('private.recipe_instruction_sections_from_groups(jsonb)') is not null
     or to_regprocedure('private.recipe_instruction_sections_flatten(jsonb)') is not null
     or to_regprocedure('private.recipe_notes_from_legacy(jsonb,text[])') is not null
     or to_regprocedure('private.recipe_instruction_groups_are_valid(jsonb)') is not null then
    raise exception 'canonical recipe cleanup left conversion helpers behind';
  end if;

  if exists (
    select 1
    from public.recipes
    where not private.recipe_ingredient_sections_are_valid(ingredient_sections)
       or not private.recipe_instruction_sections_are_valid(instruction_sections)
  ) or exists (
    select 1
    from public.recipe_shares
    where not private.recipe_share_snapshot_is_valid(source_recipe_snapshot)
  ) then
    raise exception 'canonical recipe cleanup postcondition failed';
  end if;
end;
$cleanup_postconditions$;

comment on column public.recipes.ingredient_sections is
  'Authoritative ordered ingredient sections; the only persisted ingredient structure.';
comment on column public.recipes.instruction_sections is
  'Authoritative ordered instruction sections; the only persisted instruction structure.';

commit;
