\set ON_ERROR_STOP on

-- Aggregate-only predecessor and stored-data compatibility gate. Installs nothing.
begin transaction read only;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_ledger text;
  v_invalid bigint;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'authoritative migration ledger is missing';
  end if;
  select string_agg(version, ',' order by version) into v_ledger
  from supabase_migrations.schema_migrations;
  if v_ledger is distinct from
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017,018,019,020,021,022,023,024,025,026,027,028,029,030,031,032' then
    raise exception 'migration 033 requires the exact ledger 001 through 032 with 033 absent';
  end if;
  if to_regclass('public.recipes') is null
     or to_regclass('public.recipe_shares') is null then
    raise exception 'migration 033 requires canonical recipe and share tables';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'recipes' and column_name in
          ('ingredient_sections','instruction_sections') and data_type = 'jsonb'
          and is_nullable = 'NO')
        or (table_name = 'recipes' and column_name = 'yield_metadata'
          and data_type = 'jsonb' and is_nullable = 'YES')
        or (table_name = 'recipe_shares' and column_name = 'source_recipe_snapshot'
          and data_type = 'jsonb' and is_nullable = 'NO')
      )) <> 4 then
    raise exception 'migration 033 canonical column metadata mismatch';
  end if;
  if to_regprocedure('private.recipe_ingredient_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_share_snapshot_is_valid(jsonb)') is null
     or to_regprocedure('private.recipe_quantity_lexeme_value(text)') is null
     or to_regprocedure('private.recipe_quantity_rational_value(jsonb,boolean,numeric)') is null then
    raise exception 'migration 033 canonical validators are missing';
  end if;
  if to_regprocedure('private.recipe_quantity_lexeme_matches_rational(text,jsonb)') is not null then
    raise exception 'migration 033 exact comparison helper already exists';
  end if;
  if exists (
    select 1 from (values
      ('private.recipe_quantity_is_valid(jsonb)', '46692e7441bace5d4aa0d88a4b1947a891f43ce4e748c59bbd85fbee769cf758'),
      ('private.recipe_quantity_matches_legacy(jsonb,jsonb)', 'd7e3b0266aa2cc026a9db3b60f53a013b0fb252cc6deaded2328465eed7a53a1'),
      ('private.recipe_yield_metadata_is_valid(jsonb)', '6baf3dbebb71dd01bae1fb0185905cb3391327d180aff51d1471c57d79d52688')
    ) as expected(signature, source_sha256)
    left join pg_catalog.pg_proc p on p.oid = to_regprocedure(expected.signature)
    left join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid is null
       or encode(sha256(convert_to(replace(p.prosrc, E'\r\n', E'\n'), 'UTF8')), 'hex')
          is distinct from expected.source_sha256
       or pg_get_userbyid(p.proowner) is distinct from 'postgres'
       or l.lanname is distinct from 'plpgsql'
       or p.provolatile is distinct from 'i'
       or p.prosecdef
       or p.proconfig is distinct from array['search_path=""']::text[]
       or p.prorettype <> 'boolean'::regtype
       or p.proretset
       or exists (
         select 1 from pg_catalog.aclexplode(coalesce(p.proacl,
           pg_catalog.acldefault('f', p.proowner))) acl
         where acl.grantee <> p.proowner or acl.grantor <> p.proowner
           or acl.privilege_type <> 'EXECUTE' or acl.is_grantable
       )
  ) then
    raise exception 'migration 033 predecessor function source or attributes mismatch';
  end if;
  if (select count(*) from pg_catalog.pg_constraint
      where conrelid = 'public.recipes'::regclass and contype = 'c'
        and convalidated and not connoinherit and (
          (conname = 'recipes_ingredient_sections_valid'
            and pg_get_expr(conbin, conrelid) = 'private.recipe_ingredient_sections_are_valid(ingredient_sections)')
          or (conname = 'recipes_instruction_sections_valid'
            and pg_get_expr(conbin, conrelid) = 'private.recipe_instruction_sections_are_valid(instruction_sections)')
        )) <> 2 then
    raise exception 'migration 033 canonical constraint metadata mismatch';
  end if;

  -- Complete baseline validators run before any array expansion or numeric cast.
  if exists (select 1 from public.recipes
    where private.recipe_ingredient_sections_are_valid(ingredient_sections) is not true
       or private.recipe_instruction_sections_are_valid(instruction_sections) is not true
       or (yield_metadata is not null
           and private.recipe_yield_metadata_is_valid(yield_metadata) is not true)) then
    raise exception 'migration 033 found invalid existing canonical recipes';
  end if;
  if exists (select 1 from public.recipe_shares
    where private.recipe_share_snapshot_is_valid(source_recipe_snapshot) is not true) then
    raise exception 'migration 033 found invalid existing canonical share snapshots';
  end if;

  -- The candidate changes only endpoint equality and numeric legacy projections.
  -- Existing shape/grammar/bounds/order checks above remain the prerequisite.
  with documents as materialized (
    select ingredient_sections as sections, yield_metadata as yield_value
    from public.recipes
    union all
    select source_recipe_snapshot->'ingredient_sections',
      nullif(source_recipe_snapshot->'yield_metadata', 'null'::jsonb)
    from public.recipe_shares
  ), ingredients as materialized (
    select ingredient from documents
    cross join lateral jsonb_array_elements(sections) section
    cross join lateral jsonb_array_elements(section->'ingredients') ingredient
  ), quantities as materialized (
    select ingredient->'quantityV1' as q, ingredient->'amount' as amount
    from ingredients where ingredient ? 'quantityV1'
  ), yield_matches as materialized (
    select yield_value as y, regexp_match(yield_value->>'authoredText',
      '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?('
      || '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)'
      || ')(?:[[:space:]]*([–—-])[[:space:]]*('
      || '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)'
      || '))?(?:[[:space:]]+(.+))?$', 'i') as m
    from documents where yield_value is not null
  ), legacy_ranges as materialized (
    select q, regexp_match(amount #>> '{}',
      '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?('
      || '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)'
      || ')[[:space:]]*[–—-][[:space:]]*('
      || '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)'
      || ')$', 'i') as m
    from quantities where q->>'kind' = 'range'
  ), endpoints as materialized (
    select q->>'lexeme' as lexeme, q->'value' as rational
    from quantities where q->>'kind' = 'exact'
    union all select q->>'startLexeme', q->'start' from quantities where q->>'kind' = 'range'
    union all select q->>'endLexeme', q->'end' from quantities where q->>'kind' = 'range'
    union all select amount #>> '{}', q->'value' from quantities
      where q->>'kind' = 'exact' and jsonb_typeof(amount) = 'string'
    union all select m[1], q->'start' from legacy_ranges
    union all select m[2], q->'end' from legacy_ranges
    union all select m[1], y->'value' from yield_matches where y ? 'value'
    union all select m[1], y->'range'->'start' from yield_matches where y ? 'range'
    union all select m[3], y->'range'->'end' from yield_matches where y ? 'range'
  ), parsed as materialized (
    select *, regexp_match(lexeme, '^([0-9]+)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$') as u,
      regexp_match(lexeme, '^([0-9]+)[[:space:]]+([0-9]+)/([0-9]+)$') as mixed,
      regexp_match(lexeme, '^([0-9]+)/([0-9]+)$') as fraction
    from endpoints
  ), fractions as materialized (
    select *, case when u is not null then
      case u[2] when '½' then 2 when '⅓' then 3 when '⅔' then 3
        when '¼' then 4 when '¾' then 4
        when '⅕' then 5 when '⅖' then 5 when '⅗' then 5 when '⅘' then 5
        when '⅙' then 6 when '⅚' then 6 else 8 end::numeric
      when mixed is not null then mixed[3]::numeric
      when fraction is not null then fraction[2]::numeric
      else power(10::numeric, length(split_part(lexeme, '.', 2))) end as d,
      case u[2] when '½' then 1 when '⅓' then 1 when '⅔' then 2
        when '¼' then 1 when '¾' then 3
        when '⅕' then 1 when '⅖' then 2 when '⅗' then 3 when '⅘' then 4
        when '⅙' then 1 when '⅚' then 5
        when '⅛' then 1 when '⅜' then 3 when '⅝' then 5 when '⅞' then 7 end::numeric as unicode_n
    from parsed
  ), exact_values as materialized (
    select *, case when u is not null then coalesce(u[1], '0')::numeric * d + unicode_n
      when mixed is not null then mixed[1]::numeric * d + mixed[2]::numeric
      when fraction is not null then fraction[1]::numeric
      else lexeme::numeric * d end as n from fractions
  ), numeric_amounts as materialized (
    select q, amount, regexp_match(q->>'lexeme', '^([0-9]+)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$') as u
    from quantities where q->>'kind' = 'exact' and jsonb_typeof(amount) = 'number'
  ), failures as (
    select 1 from exact_values
    where private.recipe_quantity_lexeme_value(lexeme) is null
      or private.recipe_quantity_rational_value(rational) is null
      or n * (rational->>'denominator')::numeric
         is distinct from (rational->>'numerator')::numeric * d
    union all
    select 1 from numeric_amounts
    where abs((amount #>> '{}')::numeric) > 100000000
       or (amount #>> '{}')::double precision is distinct from
         case when u is not null then u[1]::double precision
           + private.recipe_quantity_lexeme_value(u[2])::double precision
         else (q->'value'->>'numerator')::double precision
           / (q->'value'->>'denominator')::double precision end
  )
  select count(*) into v_invalid from failures;
  if v_invalid <> 0 then
    raise exception 'migration 033 candidate stored-data compatibility failed (% comparisons)', v_invalid;
  end if;
  raise notice 'migration 033 predecessor and stored-data compatibility PASS';
end;
$preflight$;

rollback;
