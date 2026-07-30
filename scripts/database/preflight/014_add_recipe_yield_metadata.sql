\set ON_ERROR_STOP on

-- Read-only, count-only preflight for migration 014. This emits no customer data.
begin transaction read only;

do $migration_014_preflight$
declare
  actual_versions text[];
  expected_versions constant text[] := array[
    '001','002','003','004','005','006','007','008','009','010','011','012','013'
  ];
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'authoritative migration ledger is missing';
  end if;

  select array_agg(version order by version)
    into actual_versions
  from supabase_migrations.schema_migrations;
  if actual_versions is distinct from expected_versions then
    raise exception 'remote migration ledger must be exactly 001 through 013 and migration 014 must be absent';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recipes'
      and column_name = 'yield_metadata'
  ) then
    raise exception 'recipes.yield_metadata already exists';
  end if;

  if to_regprocedure('public.accept_recipe_share(uuid)') is null then
    raise exception 'expected recipe-share acceptance function is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'accept_recipe_share'
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']
  ) then
    raise exception 'recipe-share acceptance function security contract is incompatible with migration 014';
  end if;

  if not has_table_privilege(
    'authenticated',
    'public.recipe_shares',
    'UPDATE'
  ) or not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'recipe_shares'
      and policyname = 'recipients_respond_recipe_shares'
      and cmd = 'UPDATE'
      and qual like '%pending%'
      and with_check like '%accepted%'
      and with_check like '%declined%'
  ) then
    raise exception 'recipient recipe-share update predecessor is incompatible with migration 014';
  end if;

  if exists (
    select 1
    from public.recipe_shares
    where status = 'pending'
      and source_recipe_snapshot <> '{}'::jsonb
      and (
        jsonb_typeof(source_recipe_snapshot) is distinct from 'object'
        or not (
          source_recipe_snapshot ?& array[
            'name','category','servings','tags','ingredients','instructions'
          ]
        )
        or jsonb_typeof(source_recipe_snapshot->'name')
          is distinct from 'string'
        or length(source_recipe_snapshot->>'name') not between 1 and 512
        or nullif(trim(source_recipe_snapshot->>'name'), '') is null
        or jsonb_typeof(source_recipe_snapshot->'category')
          is distinct from 'string'
        or length(source_recipe_snapshot->>'category') not between 1 and 128
        or nullif(trim(source_recipe_snapshot->>'category'), '') is null
        or jsonb_typeof(source_recipe_snapshot->'servings')
          is distinct from 'number'
        or (source_recipe_snapshot->>'servings')
          !~ '^(?:[1-9][0-9]{0,3}|10000)$'
        or jsonb_typeof(source_recipe_snapshot->'tags')
          is distinct from 'array'
        or case
          when jsonb_typeof(source_recipe_snapshot->'tags') = 'array'
            then jsonb_array_length(source_recipe_snapshot->'tags') > 100
          else false
        end
        or jsonb_typeof(source_recipe_snapshot->'ingredients')
          is distinct from 'array'
        or case
          when jsonb_typeof(source_recipe_snapshot->'ingredients') = 'array'
            then jsonb_array_length(
              source_recipe_snapshot->'ingredients'
            ) > 500
          else false
        end
        or jsonb_typeof(source_recipe_snapshot->'instructions')
          is distinct from 'array'
        or case
          when jsonb_typeof(source_recipe_snapshot->'instructions') = 'array'
            then jsonb_array_length(
              source_recipe_snapshot->'instructions'
            ) > 2000
          else false
        end
      )
  ) then
    raise exception 'pending recipe-share snapshots are incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'tags') = 'array'
          then share.source_recipe_snapshot->'tags'
        else '[]'::jsonb
      end
    ) as entry
    where share.status = 'pending'
      and (
        jsonb_typeof(entry) <> 'string'
        or length(entry #>> '{}') > 128
        or nullif(trim(entry #>> '{}'), '') is null
      )
  ) or exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'instructions') = 'array'
          then share.source_recipe_snapshot->'instructions'
        else '[]'::jsonb
      end
    ) as entry
    where share.status = 'pending'
      and (
        jsonb_typeof(entry) <> 'string'
        or length(entry #>> '{}') > 10000
        or nullif(trim(entry #>> '{}'), '') is null
      )
  ) then
    raise exception 'pending recipe-share strings are incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    where share.status = 'pending'
      and (
        (
          share.source_recipe_snapshot ? 'image_url'
          and jsonb_typeof(share.source_recipe_snapshot->'image_url')
            not in ('string', 'null')
        )
        or (
          jsonb_typeof(share.source_recipe_snapshot->'image_url') = 'string'
          and length(share.source_recipe_snapshot->>'image_url') > 8192
        )
        or exists (
          select 1
          from unnest(array[
            'prep_time_minutes', 'cook_time_minutes', 'total_time_minutes'
          ]) as field_name
          where share.source_recipe_snapshot ? field_name
            and jsonb_typeof(
              share.source_recipe_snapshot->field_name
            ) <> 'null'
            and (
              jsonb_typeof(
                share.source_recipe_snapshot->field_name
              ) <> 'number'
              or (share.source_recipe_snapshot->>field_name)
                !~ '^[0-9]{1,9}$'
            )
        )
        or (
          share.source_recipe_snapshot ? 'notes'
          and jsonb_typeof(share.source_recipe_snapshot->'notes')
            not in ('array', 'null')
        )
        or (
          jsonb_typeof(share.source_recipe_snapshot->'notes') = 'array'
          and jsonb_array_length(
            share.source_recipe_snapshot->'notes'
          ) > 2000
        )
      )
  ) or exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'notes') = 'array'
          then share.source_recipe_snapshot->'notes'
        else '[]'::jsonb
      end
    ) as entry
    where share.status = 'pending'
      and (
        jsonb_typeof(entry) <> 'string'
        or length(entry #>> '{}') > 10000
        or nullif(trim(entry #>> '{}'), '') is null
      )
  ) then
    raise exception 'pending recipe-share optional fields are incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    where share.status = 'pending'
      and share.source_recipe_snapshot ? 'instruction_groups'
      and jsonb_typeof(
        share.source_recipe_snapshot->'instruction_groups'
      ) not in ('array', 'null')
  ) or exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          share.source_recipe_snapshot->'instruction_groups'
        ) = 'array'
          then share.source_recipe_snapshot->'instruction_groups'
        else '[]'::jsonb
      end
    ) as group_value
    where share.status = 'pending'
      and (
        jsonb_typeof(group_value) <> 'object'
        or not (group_value ? 'steps')
        or exists (
          select 1 from jsonb_object_keys(group_value) as key
          where key <> all(array['label', 'steps'])
        )
        or (
          group_value ? 'label'
          and (
            jsonb_typeof(group_value->'label') <> 'string'
            or length(group_value->>'label') not between 1 and 128
            or nullif(trim(group_value->>'label'), '') is null
          )
        )
        or jsonb_typeof(group_value->'steps') <> 'array'
      )
  ) or exists (
    select 1
    from public.recipe_shares as share
    where share.status = 'pending'
      and jsonb_typeof(
        share.source_recipe_snapshot->'instruction_groups'
      ) = 'array'
      and (
        jsonb_array_length(
          share.source_recipe_snapshot->'instruction_groups'
        ) > 500
        or (
          select coalesce(sum(jsonb_array_length(group_value->'steps')), 0)
          from jsonb_array_elements(
            share.source_recipe_snapshot->'instruction_groups'
          ) as group_value
          where jsonb_typeof(group_value) = 'object'
            and jsonb_typeof(group_value->'steps') = 'array'
        ) > 2000
      )
  ) or exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(
          share.source_recipe_snapshot->'instruction_groups'
        ) = 'array'
          then share.source_recipe_snapshot->'instruction_groups'
        else '[]'::jsonb
      end
    ) as group_value
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(group_value->'steps') = 'array'
          then group_value->'steps'
        else '[]'::jsonb
      end
    ) as step_value
    where share.status = 'pending'
      and (
        jsonb_typeof(step_value) <> 'string'
        or length(step_value #>> '{}') > 10000
        or nullif(trim(step_value #>> '{}'), '') is null
      )
  ) then
    raise exception 'pending recipe-share instruction groups are incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'ingredients') = 'array'
          then share.source_recipe_snapshot->'ingredients'
        else '[]'::jsonb
      end
    ) as ingredient
    where share.status = 'pending'
      and (
        jsonb_typeof(ingredient) <> 'object'
        or not (ingredient ?& array['item','amount','unit'])
        or exists (
          select 1 from jsonb_object_keys(ingredient) as key
          where key <> all(array[
            'item','amount','unit','quantityV1','authoredUnit','packageV1',
            'shoppingCategory','groupLabel','modifier','alternatives',
            'originalText'
          ])
        )
        or jsonb_typeof(ingredient->'item') <> 'string'
        or length(ingredient->>'item') > 512
        or nullif(trim(ingredient->>'item'), '') is null
        or jsonb_typeof(ingredient->'unit') <> 'string'
        or length(ingredient->>'unit') > 64
        or jsonb_typeof(ingredient->'amount')
          not in ('number','string','null')
        or (
          jsonb_typeof(ingredient->'amount') = 'number'
          and abs((ingredient->>'amount')::numeric) > 100000000
        )
        or (
          jsonb_typeof(ingredient->'amount') = 'string'
          and length(ingredient->>'amount') > 128
        )
        or exists (
          select 1
          from (values
            ('authoredUnit', 64),
            ('shoppingCategory', 128),
            ('groupLabel', 128),
            ('modifier', 256),
            ('originalText', 2048)
          ) as field(name, maximum)
          where ingredient ? field.name
            and jsonb_typeof(ingredient->field.name) <> 'null'
            and (
              jsonb_typeof(ingredient->field.name) <> 'string'
              or length(ingredient->>field.name) > field.maximum
            )
        )
        or (
          ingredient ? 'alternatives'
          and (
            jsonb_typeof(ingredient->'alternatives') <> 'array'
            or jsonb_array_length(ingredient->'alternatives') > 20
            or exists (
              select 1
              from jsonb_array_elements(
                case
                  when jsonb_typeof(ingredient->'alternatives') = 'array'
                    then ingredient->'alternatives'
                  else '[]'::jsonb
                end
              ) as alternative
              where jsonb_typeof(alternative) <> 'string'
                or length(alternative #>> '{}') > 512
                or nullif(trim(alternative #>> '{}'), '') is null
            )
          )
        )
        or (
          ingredient ? 'quantityV1'
          and (
            jsonb_typeof(ingredient->'quantityV1') <> 'object'
            or not (
              ingredient->'quantityV1'
              ?& array['version','kind','authored','source']
            )
            or jsonb_typeof(ingredient->'quantityV1'->'version') <> 'number'
            or ingredient->'quantityV1'->>'version' <> '1'
            or jsonb_typeof(ingredient->'quantityV1'->'kind') <> 'string'
            or ingredient->'quantityV1'->>'kind'
              not in ('exact','range','qualitative','unparsed')
            or jsonb_typeof(ingredient->'quantityV1'->'authored') <> 'string'
            or length(ingredient->'quantityV1'->>'authored')
              not between 1 and 128
            or jsonb_typeof(ingredient->'quantityV1'->'source') <> 'string'
            or ingredient->'quantityV1'->>'source'
              not in ('authored','original-text','legacy-synthesized')
            or (
              ingredient->'quantityV1' ? 'qualifier'
              and (
                jsonb_typeof(
                  ingredient->'quantityV1'->'qualifier'
                ) <> 'string'
                or ingredient->'quantityV1'->>'qualifier'
                  not in ('about','approximately','around')
              )
            )
          )
        )
      )
  ) then
    raise exception 'pending recipe-share ingredients are incompatible with migration 014 validation';
  end if;

  if exists (
    with quantities as (
      select ingredient->'quantityV1' as quantity
      from public.recipe_shares as share
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(
            share.source_recipe_snapshot->'ingredients'
          ) = 'array'
            then share.source_recipe_snapshot->'ingredients'
          else '[]'::jsonb
        end
      ) as ingredient
      where share.status = 'pending'
        and ingredient ? 'quantityV1'
    )
    select 1
    from quantities
    where case quantity->>'kind'
      when 'exact' then
        not (quantity ?& array['value','lexeme'])
        or exists (
          select 1 from jsonb_object_keys(quantity) as key
          where key <> all(array[
            'version','kind','authored','source','qualifier','value','lexeme'
          ])
        )
        or jsonb_typeof(quantity->'lexeme') <> 'string'
        or regexp_match(
          quantity->>'authored',
          '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ) is null
        or (regexp_match(
          quantity->>'authored',
          '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ))[2] is distinct from quantity->>'lexeme'
        or case
          when (regexp_match(
            quantity->>'authored',
            '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?',
            'i'
          ))[1] is null then null
          when lower((regexp_match(
            quantity->>'authored',
            '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?',
            'i'
          ))[1]) = 'around' then 'around'
          when lower((regexp_match(
            quantity->>'authored',
            '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?',
            'i'
          ))[1]) like 'approx%' then 'approximately'
          else 'about'
        end is distinct from quantity->>'qualifier'
      when 'range' then
        not (quantity ?& array[
          'start','end','startLexeme','endLexeme','separator'
        ])
        or exists (
          select 1 from jsonb_object_keys(quantity) as key
          where key <> all(array[
            'version','kind','authored','source','qualifier','start','end',
            'startLexeme','endLexeme','separator'
          ])
        )
        or jsonb_typeof(quantity->'startLexeme') <> 'string'
        or jsonb_typeof(quantity->'endLexeme') <> 'string'
        or jsonb_typeof(quantity->'separator') <> 'string'
        or quantity->>'separator' not in ('-','–','—')
        or regexp_match(
          quantity->>'authored',
          '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))[[:space:]]*([-–—])[[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ) is null
        or (regexp_match(
          quantity->>'authored',
          '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))[[:space:]]*([-–—])[[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ))[2] is distinct from quantity->>'startLexeme'
        or (regexp_match(
          quantity->>'authored',
          '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))[[:space:]]*([-–—])[[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ))[3] is distinct from quantity->>'separator'
        or (regexp_match(
          quantity->>'authored',
          '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))[[:space:]]*([-–—])[[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ))[4] is distinct from quantity->>'endLexeme'
        or case
          when (regexp_match(
            quantity->>'authored',
            '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?',
            'i'
          ))[1] is null then null
          when lower((regexp_match(
            quantity->>'authored',
            '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?',
            'i'
          ))[1]) = 'around' then 'around'
          when lower((regexp_match(
            quantity->>'authored',
            '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?',
            'i'
          ))[1]) like 'approx%' then 'approximately'
          else 'about'
        end is distinct from quantity->>'qualifier'
      when 'qualitative' then
        quantity ? 'qualifier'
        or exists (
          select 1 from jsonb_object_keys(quantity) as key
          where key <> all(array['version','kind','authored','source'])
        )
        or quantity->>'authored'
          !~* '^(as needed|to taste|a pinch|pinch|a dash|dash|a sprinkle|sprinkle|some)$'
      when 'unparsed' then
        quantity ? 'qualifier'
        or exists (
          select 1 from jsonb_object_keys(quantity) as key
          where key <> all(array[
            'version','kind','authored','source','reason'
          ])
        )
        or (
          quantity ? 'reason'
          and (
            jsonb_typeof(quantity->'reason') <> 'string'
            or length(quantity->>'reason') not between 1 and 256
          )
        )
        or quantity->>'authored'
          ~* '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)(?:[[:space:]]*[-–—][[:space:]]*(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))?$'
        or quantity->>'authored'
          ~* '^(as needed|to taste|a pinch|pinch|a dash|dash|a sprinkle|sprinkle|some)$'
      else true
    end
  ) then
    raise exception 'pending recipe-share quantities are incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'ingredients') = 'array'
          then share.source_recipe_snapshot->'ingredients'
        else '[]'::jsonb
      end
    ) as ingredient
    where share.status = 'pending'
      and ingredient ? 'packageV1'
      and (
        not (ingredient ? 'quantityV1')
        or jsonb_typeof(ingredient->'packageV1') <> 'object'
        or not (ingredient->'packageV1' ?& array[
          'version','count','size','type','authoredType'
        ])
        or (
          select count(*)
          from jsonb_object_keys(ingredient->'packageV1')
        ) <> 5
        or jsonb_typeof(ingredient->'packageV1'->'version') <> 'number'
        or ingredient->'packageV1'->>'version' <> '1'
        or ingredient->'packageV1'->'count'
          is distinct from ingredient->'quantityV1'
        or ingredient->'quantityV1'->>'kind' not in ('exact','range')
        or jsonb_typeof(ingredient->'packageV1'->'size') <> 'object'
        or not (ingredient->'packageV1'->'size' ?& array[
          'value','lexeme','unit','authoredUnit'
        ])
        or (
          select count(*)
          from jsonb_object_keys(ingredient->'packageV1'->'size')
        ) <> 4
        or jsonb_typeof(
          ingredient->'packageV1'->'size'->'lexeme'
        ) <> 'string'
        or length(
          ingredient->'packageV1'->'size'->>'lexeme'
        ) not between 1 and 64
        or jsonb_typeof(
          ingredient->'packageV1'->'size'->'unit'
        ) <> 'string'
        or ingredient->'packageV1'->'size'->>'unit' not in (
          'tsp','tbsp','cup','fl oz','oz','lb','gal','qt','pt','mL','L','g',
          'kg','can','package','jar','bottle','bag','box','clove','head',
          'piece','slice','pinch','dash','count'
        )
        or jsonb_typeof(
          ingredient->'packageV1'->'size'->'authoredUnit'
        ) <> 'string'
        or length(
          ingredient->'packageV1'->'size'->>'authoredUnit'
        ) not between 1 and 64
        or jsonb_typeof(ingredient->'packageV1'->'type') <> 'string'
        or ingredient->'packageV1'->>'type'
          not in ('can','package','jar','bottle','bag','box')
        or jsonb_typeof(
          ingredient->'packageV1'->'authoredType'
        ) <> 'string'
        or length(
          ingredient->'packageV1'->>'authoredType'
        ) not between 1 and 32
      )
  ) then
    raise exception 'pending recipe-share packages are incompatible with migration 014 validation';
  end if;

  if exists (
    with ingredients as (
      select ingredient
      from public.recipe_shares as share
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(
            share.source_recipe_snapshot->'ingredients'
          ) = 'array'
            then share.source_recipe_snapshot->'ingredients'
          else '[]'::jsonb
        end
      ) as ingredient
      where share.status = 'pending'
    ),
    yields as (
      select share.source_recipe_snapshot->'yield_metadata' as metadata
      from public.recipe_shares as share
      where share.status = 'pending'
        and jsonb_typeof(
          share.source_recipe_snapshot->'yield_metadata'
        ) = 'object'
    ),
    endpoints as (
      select
        ingredient->'quantityV1'->'value' as rational,
        ingredient->'quantityV1'->>'lexeme' as lexeme,
        100000000::numeric as maximum
      from ingredients
      where ingredient->'quantityV1'->>'kind' = 'exact'
      union all
      select
        ingredient->'quantityV1'->'value',
        ingredient->>'amount',
        100000000::numeric
      from ingredients
      where ingredient->'quantityV1'->>'kind' = 'exact'
        and jsonb_typeof(ingredient->'amount') in ('number','string')
      union all
      select
        ingredient->'quantityV1'->'start',
        ingredient->'quantityV1'->>'startLexeme',
        100000000::numeric
      from ingredients
      where ingredient->'quantityV1'->>'kind' = 'range'
      union all
      select
        ingredient->'quantityV1'->'end',
        ingredient->'quantityV1'->>'endLexeme',
        100000000::numeric
      from ingredients
      where ingredient->'quantityV1'->>'kind' = 'range'
      union all
      select
        ingredient->'quantityV1'->'start',
        (regexp_match(
          ingredient->>'amount',
          '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))[[:space:]]*[-–—][[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ))[1],
        100000000::numeric
      from ingredients
      where ingredient->'quantityV1'->>'kind' = 'range'
      union all
      select
        ingredient->'quantityV1'->'end',
        (regexp_match(
          ingredient->>'amount',
          '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))[[:space:]]*[-–—][[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))$',
          'i'
        ))[2],
        100000000::numeric
      from ingredients
      where ingredient->'quantityV1'->>'kind' = 'range'
      union all
      select
        ingredient->'packageV1'->'size'->'value',
        ingredient->'packageV1'->'size'->>'lexeme',
        100000000::numeric
      from ingredients
      where ingredient ? 'packageV1'
      union all
      select metadata->'scalingBasis', null, 10000::numeric
      from yields
      union all
      select
        metadata->'value',
        (regexp_match(
          metadata->>'authoredText',
          '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))',
          'i'
        ))[1],
        10000::numeric
      from yields
      where metadata ? 'value'
      union all
      select
        metadata->'range'->'start',
        metadata->'range'->>'startLexeme',
        10000::numeric
      from yields
      where metadata ? 'range'
      union all
      select
        metadata->'range'->'end',
        metadata->'range'->>'endLexeme',
        10000::numeric
      from yields
      where metadata ? 'range'
    ),
    parsed as (
      select
        rational,
        lexeme,
        maximum,
        case
          when jsonb_typeof(rational) <> 'object' then null
          when not (rational ?& array['numerator','denominator'])
            or (select count(*) from jsonb_object_keys(rational)) <> 2
            or jsonb_typeof(rational->'numerator') <> 'string'
            or jsonb_typeof(rational->'denominator') <> 'string'
            or rational->>'numerator' !~ '^-?[0-9]{1,12}$'
            or rational->>'denominator' !~ '^-?[0-9]{1,12}$'
            then null
          when (rational->>'denominator')::numeric = 0 then null
          when abs((rational->>'numerator')::numeric) > 999999999999
            or abs((rational->>'denominator')::numeric) > 999999999999
            then null
          else
            (rational->>'numerator')::numeric
              / (rational->>'denominator')::numeric
        end as rational_value,
        case
          when lexeme is null then null
          when length(lexeme) not between 1 and 64
            or lexeme ~ '[0-9]{13}' then null
          when lexeme ~ '^[0-9]+(?:\.[0-9]+)?$'
            then lexeme::numeric
          when lexeme ~ '^[0-9]+/[0-9]+$'
            and split_part(lexeme, '/', 2)::numeric <> 0
            then split_part(lexeme, '/', 1)::numeric
              / split_part(lexeme, '/', 2)::numeric
          when lexeme ~ '^[0-9]+[[:space:]]+[0-9]+/[0-9]+$'
            and split_part(split_part(lexeme, ' ', 2), '/', 2)::numeric <> 0
            then split_part(lexeme, ' ', 1)::numeric
              + split_part(split_part(lexeme, ' ', 2), '/', 1)::numeric
                / split_part(split_part(lexeme, ' ', 2), '/', 2)::numeric
          when lexeme
            ~ '^[0-9]*[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]$'
            then coalesce(
              nullif(left(lexeme, length(lexeme) - 1), ''),
              '0'
            )::numeric + case right(lexeme, 1)
              when '½' then 1::numeric / 2
              when '⅓' then 1::numeric / 3
              when '⅔' then 2::numeric / 3
              when '¼' then 1::numeric / 4
              when '¾' then 3::numeric / 4
              when '⅕' then 1::numeric / 5
              when '⅖' then 2::numeric / 5
              when '⅗' then 3::numeric / 5
              when '⅘' then 4::numeric / 5
              when '⅙' then 1::numeric / 6
              when '⅚' then 5::numeric / 6
              when '⅛' then 1::numeric / 8
              when '⅜' then 3::numeric / 8
              when '⅝' then 5::numeric / 8
              when '⅞' then 7::numeric / 8
            end
          else null
        end as lexeme_value
      from endpoints
    )
    select 1
    from parsed
    where rational_value is null
      or rational_value <= 0
      or abs(rational_value) > maximum
      or (
        lexeme is not null
        and (
          lexeme_value is null
          or lexeme_value <> rational_value
        )
      )
  ) then
    raise exception 'pending recipe-share rational metadata is incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(share.source_recipe_snapshot->'ingredients') = 'array'
          then share.source_recipe_snapshot->'ingredients'
        else '[]'::jsonb
      end
    ) as ingredient
    where share.status = 'pending'
      and ingredient ? 'quantityV1'
      and (
        (
          ingredient->'quantityV1'->>'kind' = 'exact'
          and jsonb_typeof(ingredient->'amount')
            not in ('number','string')
        )
        or (
          ingredient->'quantityV1'->>'kind' = 'range'
          and (
            jsonb_typeof(ingredient->'amount') <> 'string'
            or regexp_match(
              ingredient->>'amount',
              '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)[[:space:]]*[-–—][[:space:]]*(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)$',
              'i'
            ) is null
          )
        )
        or (
          ingredient->'quantityV1'->>'kind'
            in ('qualitative','unparsed')
          and jsonb_typeof(ingredient->'amount') <> 'null'
        )
        or (
          ingredient->'quantityV1'->>'kind' = 'range'
          and (
            (ingredient->'quantityV1'->'start'->>'numerator')::numeric
              / (ingredient->'quantityV1'->'start'->>'denominator')::numeric
            >
            (ingredient->'quantityV1'->'end'->>'numerator')::numeric
              / (ingredient->'quantityV1'->'end'->>'denominator')::numeric
          )
        )
      )
  ) then
    raise exception 'pending recipe-share quantity projections are incompatible with migration 014 validation';
  end if;

  if exists (
    with ingredients as (
      select ingredient
      from public.recipe_shares as share
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(
            share.source_recipe_snapshot->'ingredients'
          ) = 'array'
            then share.source_recipe_snapshot->'ingredients'
          else '[]'::jsonb
        end
      ) as ingredient
      where share.status = 'pending'
    ),
    unit_pairs as (
      select
        ingredient->>'authoredUnit' as authored,
        ingredient->>'unit' as canonical
      from ingredients
      where ingredient ? 'quantityV1'
        and ingredient ? 'authoredUnit'
        and nullif(ingredient->>'authoredUnit', '') is not null
      union all
      select
        ingredient->'packageV1'->'size'->>'authoredUnit',
        ingredient->'packageV1'->'size'->>'unit'
      from ingredients
      where ingredient ? 'packageV1'
      union all
      select
        ingredient->'packageV1'->>'authoredType',
        ingredient->'packageV1'->>'type'
      from ingredients
      where ingredient ? 'packageV1'
    ),
    normalized as (
      select
        case lower(trim(authored))
          when 'teaspoon' then 'tsp' when 'teaspoons' then 'tsp'
          when 'tablespoon' then 'tbsp' when 'tablespoons' then 'tbsp'
          when 'cups' then 'cup' when 'c' then 'cup'
          when 'fluid ounce' then 'fl oz'
          when 'fluid ounces' then 'fl oz'
          when 'ounce' then 'oz' when 'ounces' then 'oz'
          when 'lbs' then 'lb' when 'pound' then 'lb'
          when 'pounds' then 'lb'
          when 'gallon' then 'gal' when 'gallons' then 'gal'
          when 'quart' then 'qt' when 'quarts' then 'qt'
          when 'pint' then 'pt' when 'pints' then 'pt'
          when 'ml' then 'mL' when 'milliliter' then 'mL'
          when 'milliliters' then 'mL'
          when 'l' then 'L' when 'liter' then 'L' when 'liters' then 'L'
          when 'gram' then 'g' when 'grams' then 'g'
          when 'kilogram' then 'kg' when 'kilograms' then 'kg'
          when 'cans' then 'can'
          when 'packages' then 'package' when 'pkg' then 'package'
          when 'pkgs' then 'package'
          when 'jars' then 'jar' when 'bottles' then 'bottle'
          when 'bags' then 'bag' when 'boxes' then 'box'
          when 'cloves' then 'clove' when 'heads' then 'head'
          when 'pieces' then 'piece' when 'pc' then 'piece'
          when 'pcs' then 'piece' when 'slices' then 'slice'
          when 'counts' then 'count' when 'whole' then 'count'
          when 'whole/count' then 'count' when 'whole item' then 'count'
          when 'whole items' then 'count'
          else lower(trim(authored))
        end as authored,
        case lower(trim(canonical))
          when 'teaspoon' then 'tsp' when 'teaspoons' then 'tsp'
          when 'tablespoon' then 'tbsp' when 'tablespoons' then 'tbsp'
          when 'cups' then 'cup' when 'c' then 'cup'
          when 'fluid ounce' then 'fl oz'
          when 'fluid ounces' then 'fl oz'
          when 'ounce' then 'oz' when 'ounces' then 'oz'
          when 'lbs' then 'lb' when 'pound' then 'lb'
          when 'pounds' then 'lb'
          when 'gallon' then 'gal' when 'gallons' then 'gal'
          when 'quart' then 'qt' when 'quarts' then 'qt'
          when 'pint' then 'pt' when 'pints' then 'pt'
          when 'ml' then 'mL' when 'milliliter' then 'mL'
          when 'milliliters' then 'mL'
          when 'l' then 'L' when 'liter' then 'L' when 'liters' then 'L'
          when 'gram' then 'g' when 'grams' then 'g'
          when 'kilogram' then 'kg' when 'kilograms' then 'kg'
          when 'cans' then 'can'
          when 'packages' then 'package' when 'pkg' then 'package'
          when 'pkgs' then 'package'
          when 'jars' then 'jar' when 'bottles' then 'bottle'
          when 'bags' then 'bag' when 'boxes' then 'box'
          when 'cloves' then 'clove' when 'heads' then 'head'
          when 'pieces' then 'piece' when 'pc' then 'piece'
          when 'pcs' then 'piece' when 'slices' then 'slice'
          when 'counts' then 'count' when 'whole' then 'count'
          when 'whole/count' then 'count' when 'whole item' then 'count'
          when 'whole items' then 'count'
          else lower(trim(canonical))
        end as canonical
      from unit_pairs
    )
    select 1 from normalized
    where authored is distinct from canonical
  ) then
    raise exception 'pending recipe-share units are incompatible with migration 014 validation';
  end if;

  if exists (
    select 1
    from public.recipe_shares as share
    where share.status = 'pending'
      and share.source_recipe_snapshot ? 'yield_metadata'
      and (
        jsonb_typeof(share.source_recipe_snapshot->'yield_metadata')
          not in ('object','null')
        or (
          jsonb_typeof(
            share.source_recipe_snapshot->'yield_metadata'
          ) = 'object'
          and (
            not (
              share.source_recipe_snapshot->'yield_metadata'
              ?& array['version','authoredText','kind','scalingBasis']
            )
            or exists (
              select 1
              from jsonb_object_keys(
                share.source_recipe_snapshot->'yield_metadata'
              ) as key
              where key <> all(array[
                'version','authoredText','kind','scalingBasis','value','range'
              ])
            )
            or jsonb_typeof(
              share.source_recipe_snapshot->'yield_metadata'->'version'
            ) <> 'number'
            or share.source_recipe_snapshot->'yield_metadata'->>'version'
              <> '1'
            or jsonb_typeof(
              share.source_recipe_snapshot->'yield_metadata'->'authoredText'
            ) <> 'string'
            or length(
              share.source_recipe_snapshot->'yield_metadata'->>'authoredText'
            ) not between 1 and 256
            or jsonb_typeof(
              share.source_recipe_snapshot->'yield_metadata'->'kind'
            ) <> 'string'
            or share.source_recipe_snapshot->'yield_metadata'->>'kind'
              not in ('servings','portions','items','other')
            or (
              (
                share.source_recipe_snapshot->'yield_metadata' ? 'value'
              ) = (
                share.source_recipe_snapshot->'yield_metadata' ? 'range'
              )
            )
          )
        )
      )
  ) then
    raise exception 'pending recipe-share yield metadata is incompatible with migration 014 validation';
  end if;

  if exists (
    with metadata as (
      select
        share.source_recipe_snapshot->'yield_metadata' as value,
        regexp_match(
          share.source_recipe_snapshot->'yield_metadata'->>'authoredText',
          '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?))(?:[[:space:]]*([-–—])[[:space:]]*((?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)))?(?:[[:space:]]+(.+))?$',
          'i'
        ) as matched
      from public.recipe_shares as share
      where share.status = 'pending'
        and jsonb_typeof(
          share.source_recipe_snapshot->'yield_metadata'
        ) = 'object'
    )
    select 1
    from metadata
    where matched is null
      or value->>'kind' is distinct from case
        when lower(coalesce(matched[4], '')) = ''
          or lower(coalesce(matched[4], ''))
            ~ '(servings?|serves?|people|persons?)'
          then 'servings'
        when lower(coalesce(matched[4], '')) ~ 'portions?'
          then 'portions'
        when lower(coalesce(matched[4], ''))
          ~ '(cookies?|items?|pieces?|rolls?|muffins?|cupcakes?|patties?|loaves?|bars?)'
          then 'items'
        else 'other'
      end
      or (
        value ? 'value'
        and matched[3] is not null
      )
      or (
        value ? 'range'
        and (
          matched[3] is null
          or jsonb_typeof(value->'range') <> 'object'
          or not (value->'range' ?& array[
            'start','end','startLexeme','endLexeme','separator'
          ])
          or (
            select count(*) from jsonb_object_keys(value->'range')
          ) <> 5
          or jsonb_typeof(value->'range'->'startLexeme') <> 'string'
          or jsonb_typeof(value->'range'->'endLexeme') <> 'string'
          or jsonb_typeof(value->'range'->'separator') <> 'string'
          or matched[1] is distinct from value->'range'->>'startLexeme'
          or matched[2] is distinct from value->'range'->>'separator'
          or matched[3] is distinct from value->'range'->>'endLexeme'
          or (
            (value->'range'->'start'->>'numerator')::numeric
              / (value->'range'->'start'->>'denominator')::numeric
            >
            (value->'range'->'end'->>'numerator')::numeric
              / (value->'range'->'end'->>'denominator')::numeric
          )
        )
      )
  ) then
    raise exception 'pending recipe-share yield semantics are incompatible with migration 014 validation';
  end if;
end
$migration_014_preflight$;

rollback;
