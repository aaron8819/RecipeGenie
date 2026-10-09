begin;

-- Compare authored quantities exactly: decimal division rounds recurring fractions,
-- and adding a whole number can change PostgreSQL numeric's result scale.
create function private.recipe_quantity_lexeme_matches_rational(
  p_lexeme text,
  p_value jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_match text[];
  v_numerator numeric;
  v_denominator numeric := 1;
  v_fraction_numerator numeric;
begin
  -- Reuse the established grammar, length, magnitude and rational shape limits.
  if private.recipe_quantity_lexeme_value(p_lexeme) is null
     or private.recipe_quantity_rational_value(p_value) is null then
    return false;
  end if;

  v_match := regexp_match(p_lexeme, '^([0-9]+)?([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$');
  if v_match is not null then
    v_fraction_numerator := case v_match[2]
      when '½' then 1 when '⅓' then 1 when '⅔' then 2
      when '¼' then 1 when '¾' then 3
      when '⅕' then 1 when '⅖' then 2 when '⅗' then 3 when '⅘' then 4
      when '⅙' then 1 when '⅚' then 5
      when '⅛' then 1 when '⅜' then 3 when '⅝' then 5 when '⅞' then 7
    end;
    v_denominator := case v_match[2]
      when '½' then 2 when '⅓' then 3 when '⅔' then 3
      when '¼' then 4 when '¾' then 4
      when '⅕' then 5 when '⅖' then 5 when '⅗' then 5 when '⅘' then 5
      when '⅙' then 6 when '⅚' then 6
      else 8
    end;
    v_numerator := coalesce(v_match[1], '0')::numeric * v_denominator
      + v_fraction_numerator;
  else
    v_match := regexp_match(p_lexeme, '^([0-9]+)[[:space:]]+([0-9]+)/([0-9]+)$');
    if v_match is not null then
      v_denominator := v_match[3]::numeric;
      v_numerator := v_match[1]::numeric * v_denominator + v_match[2]::numeric;
    else
      v_match := regexp_match(p_lexeme, '^([0-9]+)/([0-9]+)$');
      if v_match is not null then
        v_numerator := v_match[1]::numeric;
        v_denominator := v_match[2]::numeric;
      else
        -- Finite decimals are exact numerics; scale by their power of ten.
        v_denominator := power(10::numeric, length(split_part(p_lexeme, '.', 2)));
        v_numerator := p_lexeme::numeric * v_denominator;
      end if;
    end if;
  end if;

  return v_numerator * (p_value->>'denominator')::numeric
    = (p_value->>'numerator')::numeric * v_denominator;
exception when others then
  return false;
end;
$$;

revoke all on function private.recipe_quantity_lexeme_matches_rational(text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.recipe_quantity_is_valid(p_value jsonb)
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
     or not (p_value ?& array['version','kind','authored','source'])
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
      and private.recipe_quantity_lexeme_matches_rational(
        p_value->>'lexeme', p_value->'value'
      );
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
      and private.recipe_quantity_lexeme_matches_rational(
        p_value->>'startLexeme', p_value->'start'
      )
      and private.recipe_quantity_lexeme_matches_rational(
        p_value->>'endLexeme', p_value->'end'
      );
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

create or replace function private.recipe_quantity_matches_legacy(
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
      v_match := regexp_match(
        p_quantity->>'lexeme', '^([0-9]+)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])$'
      );
      return abs((p_amount #>> '{}')::numeric) <= 100000000
        -- JSON compatibility numbers use JavaScript's binary64 division.
        -- Keep exact equality in that representation; never use a tolerance.
        and (p_amount #>> '{}')::double precision =
          case when v_match is not null then
            -- The existing client adds the whole part for Unicode mixed forms.
            v_match[1]::double precision
              + private.recipe_quantity_lexeme_value(v_match[2])::double precision
          else
            (p_quantity->'value'->>'numerator')::double precision
              / (p_quantity->'value'->>'denominator')::double precision
          end;
    end if;
    return jsonb_typeof(p_amount) = 'string'
      and length(p_amount #>> '{}') <= 128
      and private.recipe_quantity_lexeme_matches_rational(
        p_amount #>> '{}', p_quantity->'value'
      );
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
    and private.recipe_quantity_lexeme_matches_rational(
      v_match[1], p_quantity->'start'
    )
    and private.recipe_quantity_lexeme_matches_rational(
      v_match[2], p_quantity->'end'
    );
exception when others then
  return false;
end;
$$;

create or replace function private.recipe_yield_metadata_is_valid(p_value jsonb)
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
      and private.recipe_quantity_lexeme_matches_rational(v_match[1], p_value->'value');
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
    and private.recipe_quantity_lexeme_matches_rational(v_match[1], p_value->'range'->'start')
    and private.recipe_quantity_lexeme_matches_rational(v_match[3], p_value->'range'->'end');
exception when others then
  return false;
end;
$$;

commit;
