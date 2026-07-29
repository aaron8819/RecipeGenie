-- Additive recipe yield metadata; historical ingredient JSON remains untouched.
begin;

alter table public.recipes
  add column yield_metadata jsonb;

comment on column public.recipes.yield_metadata is
  'Versioned authored yield, exact value or range, kind, and explicit scaling basis. The servings column remains the compatibility projection.';

create function private.recipe_quantity_rational_value(
  p_value jsonb,
  p_positive boolean default true,
  p_maximum numeric default 100000000
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_numerator numeric;
  v_denominator numeric;
begin
  if jsonb_typeof(p_value) <> 'object'
     or not (p_value ?& array['numerator', 'denominator'])
     or (select count(*) from jsonb_object_keys(p_value)) <> 2
     or jsonb_typeof(p_value->'numerator') <> 'string'
     or jsonb_typeof(p_value->'denominator') <> 'string'
     or (p_value->>'numerator') !~ '^-?[0-9]{1,12}$'
     or (p_value->>'denominator') !~ '^-?[0-9]{1,12}$' then
    return null;
  end if;

  v_numerator := (p_value->>'numerator')::numeric;
  v_denominator := (p_value->>'denominator')::numeric;
  if v_denominator = 0
     or abs(v_numerator) > 999999999999
     or abs(v_denominator) > 999999999999
     or (p_positive and v_numerator / v_denominator <= 0)
     or abs(v_numerator / v_denominator) > p_maximum then
    return null;
  end if;
  return v_numerator / v_denominator;
exception when others then
  return null;
end;
$$;

create function private.recipe_quantity_lexeme_value(p_lexeme text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
  v_value numeric;
  v_denominator numeric;
  v_fraction numeric;
begin
  if p_lexeme is null
     or length(p_lexeme) < 1
     or length(p_lexeme) > 64
     or p_lexeme ~ '[0-9]{13}' then
    return null;
  end if;

  v_match := regexp_match(p_lexeme, '^([0-9]+)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$');
  if v_match is not null then
    v_fraction := case v_match[2]
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
    end;
    v_value := coalesce(v_match[1], '0')::numeric + v_fraction;
  else
    v_match := regexp_match(
      p_lexeme,
      '^([0-9]+)[[:space:]]+([0-9]+)/([0-9]+)$'
    );
    if v_match is not null then
      v_denominator := v_match[3]::numeric;
      if v_denominator = 0 then return null; end if;
      v_value :=
        v_match[1]::numeric + v_match[2]::numeric / v_denominator;
    else
      v_match := regexp_match(p_lexeme, '^([0-9]+)/([0-9]+)$');
      if v_match is not null then
        v_denominator := v_match[2]::numeric;
        if v_denominator = 0 then return null; end if;
        v_value := v_match[1]::numeric / v_denominator;
      elsif p_lexeme ~ '^[0-9]+(?:\.[0-9]+)?$' then
        v_value := p_lexeme::numeric;
      else
        return null;
      end if;
    end if;
  end if;

  return case
    when v_value between 0 and 100000000 then v_value
    else null
  end;
exception when others then
  return null;
end;
$$;

create function private.recipe_quantity_normalize_unit(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(trim(p_unit))
    when 'teaspoon' then 'tsp' when 'teaspoons' then 'tsp'
    when 'tablespoon' then 'tbsp' when 'tablespoons' then 'tbsp'
    when 'cups' then 'cup' when 'c' then 'cup'
    when 'fluid ounce' then 'fl oz' when 'fluid ounces' then 'fl oz'
    when 'ounce' then 'oz' when 'ounces' then 'oz'
    when 'lbs' then 'lb' when 'pound' then 'lb' when 'pounds' then 'lb'
    when 'gallon' then 'gal' when 'gallons' then 'gal'
    when 'quart' then 'qt' when 'quarts' then 'qt'
    when 'pint' then 'pt' when 'pints' then 'pt'
    when 'ml' then 'mL' when 'milliliter' then 'mL'
    when 'milliliters' then 'mL'
    when 'l' then 'L' when 'liter' then 'L' when 'liters' then 'L'
    when 'gram' then 'g' when 'grams' then 'g'
    when 'kilogram' then 'kg' when 'kilograms' then 'kg'
    when 'cans' then 'can'
    when 'package' then 'package' when 'packages' then 'package'
    when 'pkg' then 'package' when 'pkgs' then 'package'
    when 'jars' then 'jar' when 'bottles' then 'bottle'
    when 'bags' then 'bag' when 'boxes' then 'box'
    when 'cloves' then 'clove' when 'heads' then 'head'
    when 'pieces' then 'piece' when 'pc' then 'piece' when 'pcs' then 'piece'
    when 'slices' then 'slice'
    when 'counts' then 'count' when 'whole' then 'count'
    when 'whole/count' then 'count' when 'whole item' then 'count'
    when 'whole items' then 'count'
    else lower(trim(p_unit))
  end
$$;

create function private.recipe_quantity_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_kind text;
  v_authored text;
  v_qualifier text;
  v_expected_qualifier text;
  v_match text[];
  v_value numeric;
  v_start numeric;
  v_end numeric;
  v_endpoint constant text :=
    '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)';
begin
  if jsonb_typeof(p_value) <> 'object'
     or jsonb_typeof(p_value->'version') <> 'number'
     or p_value->>'version' <> '1'
     or jsonb_typeof(p_value->'kind') <> 'string'
     or jsonb_typeof(p_value->'authored') <> 'string'
     or length(p_value->>'authored') not between 1 and 128
     or jsonb_typeof(p_value->'source') <> 'string'
     or p_value->>'source'
       not in ('authored', 'original-text', 'legacy-synthesized')
     or (
       p_value ? 'qualifier'
       and (
         jsonb_typeof(p_value->'qualifier') <> 'string'
         or p_value->>'qualifier'
           not in ('about', 'approximately', 'around')
       )
     ) then
    return false;
  end if;

  v_kind := p_value->>'kind';
  v_authored := p_value->>'authored';
  v_qualifier := p_value->>'qualifier';

  if v_kind = 'exact' then
    if not (p_value ?& array['value', 'lexeme'])
       or exists (
         select 1 from jsonb_object_keys(p_value) as key
         where key <> all(array[
           'version','kind','authored','source','qualifier','value','lexeme'
         ])
       )
       or jsonb_typeof(p_value->'lexeme') <> 'string' then
      return false;
    end if;
    v_match := regexp_match(
      v_authored,
      '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?('
        || v_endpoint || ')$',
      'i'
    );
    if v_match is null or v_match[2] <> p_value->>'lexeme' then
      return false;
    end if;
    v_expected_qualifier := case
      when v_match[1] is null then null
      when lower(v_match[1]) = 'around' then 'around'
      when lower(v_match[1]) like 'approx%' then 'approximately'
      else 'about'
    end;
    v_value := private.recipe_quantity_rational_value(p_value->'value');
    return v_expected_qualifier is not distinct from v_qualifier
      and v_value is not null
      and v_value = private.recipe_quantity_lexeme_value(p_value->>'lexeme');
  end if;

  if v_kind = 'range' then
    if not (p_value ?& array[
         'start','end','startLexeme','endLexeme','separator'
       ])
       or exists (
         select 1 from jsonb_object_keys(p_value) as key
         where key <> all(array[
           'version','kind','authored','source','qualifier','start','end',
           'startLexeme','endLexeme','separator'
         ])
       )
       or jsonb_typeof(p_value->'startLexeme') <> 'string'
       or jsonb_typeof(p_value->'endLexeme') <> 'string'
       or jsonb_typeof(p_value->'separator') <> 'string'
       or p_value->>'separator' not in ('-', '–', '—') then
      return false;
    end if;
    v_match := regexp_match(
      v_authored,
      '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?('
        || v_endpoint || ')[[:space:]]*([-–—])[[:space:]]*('
        || v_endpoint || ')$',
      'i'
    );
    if v_match is null
       or v_match[2] <> p_value->>'startLexeme'
       or v_match[3] <> p_value->>'separator'
       or v_match[4] <> p_value->>'endLexeme' then
      return false;
    end if;
    v_expected_qualifier := case
      when v_match[1] is null then null
      when lower(v_match[1]) = 'around' then 'around'
      when lower(v_match[1]) like 'approx%' then 'approximately'
      else 'about'
    end;
    v_start := private.recipe_quantity_rational_value(p_value->'start');
    v_end := private.recipe_quantity_rational_value(p_value->'end');
    return v_expected_qualifier is not distinct from v_qualifier
      and v_start is not null
      and v_end is not null
      and v_start <= v_end
      and v_start =
        private.recipe_quantity_lexeme_value(p_value->>'startLexeme')
      and v_end =
        private.recipe_quantity_lexeme_value(p_value->>'endLexeme');
  end if;

  if v_kind = 'qualitative' then
    return not (p_value ? 'qualifier')
      and not exists (
        select 1 from jsonb_object_keys(p_value) as key
        where key <> all(array['version','kind','authored','source'])
      )
      and v_authored ~* '^(as needed|to taste|a pinch|pinch|a dash|dash|a sprinkle|sprinkle|some)$';
  end if;

  if v_kind = 'unparsed' then
    return not (p_value ? 'qualifier')
      and not exists (
        select 1 from jsonb_object_keys(p_value) as key
        where key <> all(array['version','kind','authored','source','reason'])
      )
      and (
        not (p_value ? 'reason')
        or (
          jsonb_typeof(p_value->'reason') = 'string'
          and length(p_value->>'reason') between 1 and 256
        )
      )
      and regexp_match(
        v_authored,
        '^(?:(about|approx\.?|approximately|around)[[:space:]]+)?'
          || v_endpoint || '(?:[[:space:]]*[-–—][[:space:]]*'
          || v_endpoint || ')?$',
        'i'
      ) is null
      and v_authored !~* '^(as needed|to taste|a pinch|pinch|a dash|dash|a sprinkle|sprinkle|some)$';
  end if;

  return false;
exception when others then
  return false;
end;
$$;

create function private.recipe_package_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_size_value numeric;
  v_size_unit text;
  v_type text;
begin
  if jsonb_typeof(p_value) <> 'object'
     or not (p_value ?& array['version','count','size','type','authoredType'])
     or (select count(*) from jsonb_object_keys(p_value)) <> 5
     or jsonb_typeof(p_value->'version') <> 'number'
     or p_value->>'version' <> '1'
     or not private.recipe_quantity_is_valid(p_value->'count')
     or p_value->'count'->>'kind' not in ('exact', 'range')
     or jsonb_typeof(p_value->'size') <> 'object'
     or not (p_value->'size' ?& array['value','lexeme','unit','authoredUnit'])
     or (select count(*) from jsonb_object_keys(p_value->'size')) <> 4
     or jsonb_typeof(p_value->'size'->'lexeme') <> 'string'
     or jsonb_typeof(p_value->'size'->'unit') <> 'string'
     or jsonb_typeof(p_value->'size'->'authoredUnit') <> 'string'
     or jsonb_typeof(p_value->'type') <> 'string'
     or jsonb_typeof(p_value->'authoredType') <> 'string' then
    return false;
  end if;

  v_size_value :=
    private.recipe_quantity_rational_value(p_value->'size'->'value');
  v_size_unit := p_value->'size'->>'unit';
  v_type := p_value->>'type';
  return v_size_value is not null
    and v_size_value =
      private.recipe_quantity_lexeme_value(p_value->'size'->>'lexeme')
    and length(p_value->'size'->>'lexeme') between 1 and 64
    and length(v_size_unit) between 1 and 64
    and v_size_unit in (
      'tsp','tbsp','cup','fl oz','oz','lb','gal','qt','pt','mL','L','g','kg',
      'can','package','jar','bottle','bag','box','clove','head','piece','slice',
      'pinch','dash','count'
    )
    and private.recipe_quantity_normalize_unit(v_size_unit) = v_size_unit
    and length(p_value->'size'->>'authoredUnit') between 1 and 64
    and private.recipe_quantity_normalize_unit(
      p_value->'size'->>'authoredUnit'
    ) = v_size_unit
    and v_type in ('can','package','jar','bottle','bag','box')
    and length(p_value->>'authoredType') between 1 and 32
    and private.recipe_quantity_normalize_unit(
      p_value->>'authoredType'
    ) = v_type;
exception when others then
  return false;
end;
$$;

create function private.recipe_quantity_matches_legacy(
  p_quantity jsonb,
  p_amount jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
  v_endpoint constant text :=
    '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)';
begin
  if not private.recipe_quantity_is_valid(p_quantity) then return false; end if;
  if p_quantity->>'kind' in ('qualitative', 'unparsed') then
    return jsonb_typeof(p_amount) = 'null';
  end if;
  if p_quantity->>'kind' = 'exact' then
    if jsonb_typeof(p_amount) = 'number' then
      return abs((p_amount #>> '{}')::numeric) <= 100000000
        and (p_amount #>> '{}')::numeric =
          private.recipe_quantity_rational_value(p_quantity->'value');
    end if;
    return jsonb_typeof(p_amount) = 'string'
      and length(p_amount #>> '{}') <= 128
      and private.recipe_quantity_lexeme_value(p_amount #>> '{}') =
        private.recipe_quantity_rational_value(p_quantity->'value');
  end if;
  if jsonb_typeof(p_amount) <> 'string'
     or length(p_amount #>> '{}') > 128 then
    return false;
  end if;
  v_match := regexp_match(
    p_amount #>> '{}',
    '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?('
      || v_endpoint || ')[[:space:]]*[-–—][[:space:]]*('
      || v_endpoint || ')$',
    'i'
  );
  return v_match is not null
    and private.recipe_quantity_lexeme_value(v_match[1]) =
      private.recipe_quantity_rational_value(p_quantity->'start')
    and private.recipe_quantity_lexeme_value(v_match[2]) =
      private.recipe_quantity_rational_value(p_quantity->'end');
exception when others then
  return false;
end;
$$;

create function private.recipe_ingredient_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_quantity jsonb;
begin
  if jsonb_typeof(p_value) <> 'object'
     or not (p_value ?& array['item','amount','unit'])
     or exists (
       select 1 from jsonb_object_keys(p_value) as key
       where key <> all(array[
         'item','amount','unit','quantityV1','authoredUnit','packageV1',
         'shoppingCategory','groupLabel','modifier','alternatives','originalText'
       ])
     )
     or jsonb_typeof(p_value->'item') <> 'string'
     or length(p_value->>'item') > 512
     or nullif(trim(p_value->>'item'), '') is null
     or jsonb_typeof(p_value->'unit') <> 'string'
     or length(p_value->>'unit') > 64
     or jsonb_typeof(p_value->'amount') not in ('number','string','null')
     or (
       jsonb_typeof(p_value->'amount') = 'number'
       and abs((p_value->>'amount')::numeric) > 100000000
     )
     or (
       jsonb_typeof(p_value->'amount') = 'string'
       and length(p_value->>'amount') > 128
     ) then
    return false;
  end if;

  if exists (
    select 1
    from (values
      ('authoredUnit', 64),
      ('shoppingCategory', 128),
      ('groupLabel', 128),
      ('modifier', 256),
      ('originalText', 2048)
    ) as field(name, maximum)
    where p_value ? field.name
      and jsonb_typeof(p_value->field.name) <> 'null'
      and (
        jsonb_typeof(p_value->field.name) <> 'string'
        or length(p_value->>field.name) > field.maximum
      )
  ) then
    return false;
  end if;

  if p_value ? 'alternatives'
     and (
       jsonb_typeof(p_value->'alternatives') <> 'array'
       or jsonb_array_length(p_value->'alternatives') > 20
       or exists (
         select 1 from jsonb_array_elements(p_value->'alternatives') as entry
         where jsonb_typeof(entry) <> 'string'
            or length(entry #>> '{}') > 512
            or nullif(trim(entry #>> '{}'), '') is null
       )
     ) then
    return false;
  end if;

  if p_value ? 'quantityV1' then
    v_quantity := p_value->'quantityV1';
    if not private.recipe_quantity_is_valid(v_quantity)
       or not private.recipe_quantity_matches_legacy(
         v_quantity,
         p_value->'amount'
       )
       or (
         p_value ? 'authoredUnit'
         and nullif(p_value->>'authoredUnit', '') is not null
         and private.recipe_quantity_normalize_unit(p_value->>'authoredUnit')
           <> private.recipe_quantity_normalize_unit(p_value->>'unit')
       ) then
      return false;
    end if;
  end if;

  if p_value ? 'packageV1' then
    if v_quantity is null
       or not private.recipe_package_is_valid(p_value->'packageV1')
       or p_value->'packageV1'->'count' <> v_quantity then
      return false;
    end if;
  end if;
  return true;
exception when others then
  return false;
end;
$$;

create function private.recipe_yield_metadata_is_valid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
  v_kind text;
  v_label text;
  v_start numeric;
  v_end numeric;
  v_endpoint constant text :=
    '(?:[0-9]+[[:space:]]+[0-9]+/[0-9]+|[0-9]+[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]|[0-9]+/[0-9]+|[0-9]+(?:\.[0-9]+)?)';
begin
  if jsonb_typeof(p_value) <> 'object'
     or not (p_value ?& array['version','authoredText','kind','scalingBasis'])
     or exists (
       select 1 from jsonb_object_keys(p_value) as key
       where key <> all(array[
         'version','authoredText','kind','scalingBasis','value','range'
       ])
     )
     or jsonb_typeof(p_value->'version') <> 'number'
     or p_value->>'version' <> '1'
     or jsonb_typeof(p_value->'authoredText') <> 'string'
     or length(p_value->>'authoredText') not between 1 and 256
     or jsonb_typeof(p_value->'kind') <> 'string'
     or p_value->>'kind' not in ('servings','portions','items','other')
     or private.recipe_quantity_rational_value(
       p_value->'scalingBasis',
       true,
       10000
     ) is null
     or ((p_value ? 'value') = (p_value ? 'range')) then
    return false;
  end if;

  v_match := regexp_match(
    p_value->>'authoredText',
    '^(?:(?:about|approx\.?|approximately|around)[[:space:]]+)?('
      || v_endpoint || ')(?:[[:space:]]*([-–—])[[:space:]]*('
      || v_endpoint || '))?(?:[[:space:]]+(.+))?$',
    'i'
  );
  if v_match is null then return false; end if;
  v_label := lower(coalesce(v_match[4], ''));
  v_kind := case
    when v_label = ''
      or v_label ~ '(servings?|serves?|people|persons?)' then 'servings'
    when v_label ~ 'portions?' then 'portions'
    when v_label ~
      '(cookies?|items?|pieces?|rolls?|muffins?|cupcakes?|patties?|loaves?|bars?)'
      then 'items'
    else 'other'
  end;
  if v_kind <> p_value->>'kind' then return false; end if;

  if p_value ? 'value' then
    v_start := private.recipe_quantity_rational_value(
      p_value->'value',
      true,
      10000
    );
    return v_match[3] is null
      and v_start is not null
      and v_start = private.recipe_quantity_lexeme_value(v_match[1]);
  end if;

  if jsonb_typeof(p_value->'range') <> 'object'
     or not (p_value->'range' ?& array[
       'start','end','startLexeme','endLexeme','separator'
     ])
     or (select count(*) from jsonb_object_keys(p_value->'range')) <> 5
     or jsonb_typeof(p_value->'range'->'startLexeme') <> 'string'
     or jsonb_typeof(p_value->'range'->'endLexeme') <> 'string'
     or jsonb_typeof(p_value->'range'->'separator') <> 'string' then
    return false;
  end if;
  v_start := private.recipe_quantity_rational_value(
    p_value->'range'->'start',
    true,
    10000
  );
  v_end := private.recipe_quantity_rational_value(
    p_value->'range'->'end',
    true,
    10000
  );
  return v_match[3] is not null
    and v_start is not null
    and v_end is not null
    and v_start <= v_end
    and v_match[1] = p_value->'range'->>'startLexeme'
    and v_match[2] = p_value->'range'->>'separator'
    and v_match[3] = p_value->'range'->>'endLexeme'
    and v_start = private.recipe_quantity_lexeme_value(v_match[1])
    and v_end = private.recipe_quantity_lexeme_value(v_match[3]);
exception when others then
  return false;
end;
$$;

alter function private.recipe_quantity_rational_value(jsonb, boolean, numeric)
  owner to postgres;
alter function private.recipe_quantity_lexeme_value(text) owner to postgres;
alter function private.recipe_quantity_normalize_unit(text) owner to postgres;
alter function private.recipe_quantity_is_valid(jsonb) owner to postgres;
alter function private.recipe_package_is_valid(jsonb) owner to postgres;
alter function private.recipe_quantity_matches_legacy(jsonb, jsonb)
  owner to postgres;
alter function private.recipe_ingredient_is_valid(jsonb) owner to postgres;
alter function private.recipe_yield_metadata_is_valid(jsonb) owner to postgres;

revoke all privileges on function
  private.recipe_quantity_rational_value(jsonb, boolean, numeric),
  private.recipe_quantity_lexeme_value(text),
  private.recipe_quantity_normalize_unit(text),
  private.recipe_quantity_is_valid(jsonb),
  private.recipe_package_is_valid(jsonb),
  private.recipe_quantity_matches_legacy(jsonb, jsonb),
  private.recipe_ingredient_is_valid(jsonb),
  private.recipe_yield_metadata_is_valid(jsonb)
from public, anon, authenticated, service_role;

create or replace function public.accept_recipe_share(p_share_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_share public.recipe_shares%rowtype;
  v_new_recipe_uuid uuid := gen_random_uuid();
  v_name text;
  v_category text;
  v_servings integer;
  v_tags text[];
  v_instructions text[];
begin
  if v_user_id is null then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select *
  into v_share
  from public.recipe_shares
  where id = p_share_id
    and recipient_user_id = v_user_id
  for update;

  if not found then raise exception 'Share not found'; end if;
  if v_share.status = 'accepted' and v_share.accepted_recipe_uuid is not null then
    return v_share.accepted_recipe_uuid;
  end if;
  if v_share.status <> 'pending' then
    raise exception 'Share is no longer pending';
  end if;

  if v_share.source_recipe_snapshot = '{}'::jsonb then
    v_name := 'Shared Recipe';
    v_category := 'uncategorized';
    v_servings := 4;
  else
  if jsonb_typeof(v_share.source_recipe_snapshot) <> 'object' then
    raise exception 'Invalid recipe snapshot';
  end if;
  if not (v_share.source_recipe_snapshot ? 'name')
     or not (v_share.source_recipe_snapshot ? 'category')
     or not (v_share.source_recipe_snapshot ? 'servings')
     or jsonb_typeof(v_share.source_recipe_snapshot->'name') <> 'string'
     or length(v_share.source_recipe_snapshot->>'name') > 512
     or nullif(trim(v_share.source_recipe_snapshot->>'name'), '') is null
     or jsonb_typeof(v_share.source_recipe_snapshot->'category') <> 'string'
     or length(v_share.source_recipe_snapshot->>'category') > 128
     or nullif(trim(v_share.source_recipe_snapshot->>'category'), '') is null
     or jsonb_typeof(v_share.source_recipe_snapshot->'servings') <> 'number'
     or (v_share.source_recipe_snapshot->>'servings') !~ '^(?:[1-9][0-9]{0,3}|10000)$' then
    raise exception 'Invalid recipe snapshot';
  end if;
  if not (v_share.source_recipe_snapshot ? 'tags')
     or not (v_share.source_recipe_snapshot ? 'ingredients')
     or not (v_share.source_recipe_snapshot ? 'instructions')
     or jsonb_typeof(v_share.source_recipe_snapshot->'tags') <> 'array'
     or jsonb_array_length(v_share.source_recipe_snapshot->'tags') > 100
     or jsonb_typeof(v_share.source_recipe_snapshot->'ingredients') <> 'array'
     or jsonb_array_length(v_share.source_recipe_snapshot->'ingredients') > 500
     or jsonb_typeof(v_share.source_recipe_snapshot->'instructions') <> 'array'
     or jsonb_array_length(v_share.source_recipe_snapshot->'instructions') > 2000 then
    raise exception 'Invalid recipe snapshot';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_share.source_recipe_snapshot->'tags') as entry
    where jsonb_typeof(entry) <> 'string'
       or length(entry #>> '{}') > 128
  ) or exists (
    select 1
    from jsonb_array_elements(v_share.source_recipe_snapshot->'instructions') as entry
    where jsonb_typeof(entry) <> 'string'
       or length(entry #>> '{}') > 10000
  ) or exists (
    select 1
    from jsonb_array_elements(v_share.source_recipe_snapshot->'ingredients') as ingredient
    where not private.recipe_ingredient_is_valid(ingredient)
  ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'yield_metadata'
     and jsonb_typeof(v_share.source_recipe_snapshot->'yield_metadata') not in ('object', 'null') then
    raise exception 'Invalid recipe snapshot';
  end if;
  if jsonb_typeof(v_share.source_recipe_snapshot->'yield_metadata') = 'object'
     and not private.recipe_yield_metadata_is_valid(
       v_share.source_recipe_snapshot->'yield_metadata'
     ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'image_url'
     and jsonb_typeof(v_share.source_recipe_snapshot->'image_url') not in ('string', 'null') then
    raise exception 'Invalid recipe snapshot';
  end if;
  if exists (
    select 1
    from unnest(array['prep_time_minutes', 'cook_time_minutes', 'total_time_minutes']) as field_name
    where v_share.source_recipe_snapshot ? field_name
      and jsonb_typeof(v_share.source_recipe_snapshot->field_name) <> 'null'
      and (
        jsonb_typeof(v_share.source_recipe_snapshot->field_name) <> 'number'
        or (v_share.source_recipe_snapshot->>field_name) !~ '^[0-9]{1,9}$'
      )
  ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'notes'
     and jsonb_typeof(v_share.source_recipe_snapshot->'notes') <> 'array' then
    raise exception 'Invalid recipe snapshot';
  end if;
  if jsonb_typeof(v_share.source_recipe_snapshot->'notes') = 'array'
     and (
       jsonb_array_length(v_share.source_recipe_snapshot->'notes') > 2000
       or exists (
         select 1
         from jsonb_array_elements(v_share.source_recipe_snapshot->'notes') as entry
         where jsonb_typeof(entry) <> 'string'
            or length(entry #>> '{}') > 10000
       )
     ) then
    raise exception 'Invalid recipe snapshot';
  end if;
  if v_share.source_recipe_snapshot ? 'instruction_groups'
     and jsonb_typeof(v_share.source_recipe_snapshot->'instruction_groups')
       not in ('array', 'null') then
    raise exception 'Invalid recipe snapshot';
  end if;

  v_name := trim(v_share.source_recipe_snapshot->>'name');
  v_category := trim(v_share.source_recipe_snapshot->>'category');
  v_servings := (v_share.source_recipe_snapshot->>'servings')::integer;
  end if;

  select coalesce(array_agg(value), '{}'::text[])
  into v_tags
  from jsonb_array_elements_text(
    coalesce(v_share.source_recipe_snapshot->'tags', '[]'::jsonb)
  );

  select coalesce(array_agg(value), '{}'::text[])
  into v_instructions
  from jsonb_array_elements_text(
    coalesce(v_share.source_recipe_snapshot->'instructions', '[]'::jsonb)
  );

  insert into public.recipes(
    id,
    recipe_uuid,
    user_id,
    name,
    category,
    servings,
    yield_metadata,
    favorite,
    tags,
    ingredients,
    instructions,
    image_url,
    prep_time_minutes,
    cook_time_minutes,
    total_time_minutes,
    notes,
    instruction_groups
  ) values (
    v_new_recipe_uuid::text,
    v_new_recipe_uuid,
    v_user_id,
    v_name,
    v_category,
    v_servings,
    v_share.source_recipe_snapshot->'yield_metadata',
    false,
    v_tags,
    coalesce(v_share.source_recipe_snapshot->'ingredients', '[]'::jsonb),
    v_instructions,
    nullif(trim(v_share.source_recipe_snapshot->>'image_url'), ''),
    nullif(v_share.source_recipe_snapshot->>'prep_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'cook_time_minutes', '')::integer,
    nullif(v_share.source_recipe_snapshot->>'total_time_minutes', '')::integer,
    coalesce(v_share.source_recipe_snapshot->'notes', '[]'::jsonb),
    v_share.source_recipe_snapshot->'instruction_groups'
  );

  update public.recipe_shares
  set
    status = 'accepted',
    accepted_recipe_uuid = v_new_recipe_uuid,
    responded_at = now()
  where id = v_share.id;

  return v_new_recipe_uuid;
end;
$$;

alter function public.accept_recipe_share(uuid) owner to postgres;
revoke all privileges on function public.accept_recipe_share(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_recipe_share(uuid) to authenticated;

commit;
