\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

-- Read-only, aggregate-only structural preflight for canonical recipe sections.
-- Production usage must supply the expected project ref:
--   psql "$DATABASE_URL" -v expected_project_ref=eyaoahwzixqetjgfghsh -f <this-file>
-- A dependency-free synthetic path is available with:
--   psql -v canonical_recipe_structure_fixture_mode=1 -f <this-file>
-- Add -v canonical_recipe_structure_fixture_failure=1 to prove nonzero,
-- fail-closed handling for a conflicting row.
-- Neither path selects or emits recipe content, row identities, or user data.

set default_transaction_read_only = on;

\if :{?canonical_recipe_structure_fixture_mode}
  \echo 'canonical recipe structure preflight: synthetic fixture mode'
\else
  \if :{?expected_project_ref}
  \else
    do $fatal$ begin
      raise exception 'expected_project_ref is required';
    end $fatal$;
  \endif

  select :'expected_project_ref' = 'eyaoahwzixqetjgfghsh'
    as expected_project_identity_matches \gset
  \if :expected_project_identity_matches
  \else
    do $fatal$ begin
      raise exception 'expected_project_ref does not identify Recipe Genie production';
    end $fatal$;
  \endif

  do $guards$
  declare
    actual_versions text[];
    expected_versions constant text[] := array[
      '001','002','003','004','005','006','007','008','009','010','011',
      '012','013','014','015'
    ];
  begin
    if to_regclass('supabase_migrations.schema_migrations') is null then
      raise exception 'authoritative migration ledger is missing';
    end if;
    select array_agg(version order by version)
      into actual_versions
    from supabase_migrations.schema_migrations;
    if actual_versions is distinct from expected_versions then
      raise exception 'migration ledger must be exactly 001 through 015';
    end if;
    if to_regclass('public.recipes') is null
       or to_regclass('public.recipe_shares') is null then
      raise exception 'required Recipe Genie tables are missing';
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'recipes'
        and column_name = 'ingredients' and data_type = 'jsonb'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'recipes'
        and column_name = 'instructions' and data_type = 'ARRAY'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'recipes'
        and column_name = 'instruction_groups' and data_type = 'jsonb'
    ) then
      raise exception 'legacy recipe structure columns do not match Slice A';
    end if;
    if to_regprocedure('private.recipe_ingredient_is_valid(jsonb)') is null
       or to_regprocedure(
         'private.recipe_instruction_groups_are_valid(jsonb)'
       ) is null
       or to_regprocedure(
         'private.recipe_share_snapshot_is_valid(jsonb)'
       ) is null then
      raise exception 'required immutable structural validators are missing';
    end if;
  end
  $guards$;
\endif

begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

with
\if :{?canonical_recipe_structure_fixture_mode}
recipe_source(row_key, ingredients, instructions, notes, instruction_groups) as (
  values
    (1, '[{"item":"salt","amount":1,"unit":"tsp"}]'::jsonb,
      '["Mix."]'::jsonb, '[]'::jsonb, null::jsonb),
    (2, '[{"item":"a","amount":1,"unit":"cup","groupLabel":"Sauce"},
          {"item":"b","amount":1,"unit":"cup","groupLabel":"Sauce"},
          {"item":"c","amount":1,"unit":"cup","groupLabel":"Filling"},
          {"item":"d","amount":1,"unit":"cup","groupLabel":"Sauce"}]'::jsonb,
      '["First.","Second."]'::jsonb, '[]'::jsonb,
      '[{"label":"Method","steps":["First.","Second."]}]'::jsonb),
    (3, '[]'::jsonb, '["Prep:","Chop.","Notes:","Keep cold."]'::jsonb,
      '[]'::jsonb, null::jsonb),
    (4, '[{"item":"oil","amount":1,"unit":"tbsp"}]'::jsonb,
      '[]'::jsonb, '["Use fresh oil."]'::jsonb,
      '[{"label":"Finish","steps":["Serve."]}]'::jsonb),
    (5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, null::jsonb)
\if :{?canonical_recipe_structure_fixture_failure}
  union all select
    6, '[]'::jsonb, '["Legacy."]'::jsonb, '[]'::jsonb,
    '[{"label":"Method","steps":["Current."]}]'::jsonb
\endif
),
share_source(row_key, status, snapshot) as (
  values
    (1, 'accepted', '{"ingredients":[],"instructions":[]}'::jsonb),
    (2, 'accepted', '{"ingredients":[],"instructions":[]}'::jsonb),
    (3, 'accepted', '{"ingredients":[],"instructions":[]}'::jsonb),
    (4, 'pending', '{"ingredients":[],"instructions":[]}'::jsonb)
),
\else
recipe_source as (
  select
    row_number() over () as row_key,
    ingredients,
    to_jsonb(instructions) as instructions,
    notes,
    instruction_groups
  from public.recipes
),
share_source as (
  select
    row_number() over () as row_key,
    status,
    source_recipe_snapshot as snapshot
  from public.recipe_shares
),
\endif
ingredient_items as (
  select recipe.row_key, item.value as ingredient, item.ordinality
  from recipe_source as recipe
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(recipe.ingredients) = 'array'
      then recipe.ingredients else '[]'::jsonb end
  ) with ordinality as item(value, ordinality)
),
ingredient_checks as (
  select
    item.*,
    case
      when jsonb_typeof(ingredient) = 'string' then
        length(ingredient #>> '{}') between 1 and 2048
        and nullif(trim(ingredient #>> '{}'), '') is not null
      when jsonb_typeof(ingredient) = 'object' then
\if :{?canonical_recipe_structure_fixture_mode}
        ingredient ?& array['item','amount','unit']
        and jsonb_typeof(ingredient->'item') = 'string'
        and nullif(trim(ingredient->>'item'), '') is not null
        and length(ingredient->>'item') <= 512
        and jsonb_typeof(ingredient->'unit') = 'string'
        and length(ingredient->>'unit') <= 64
        and jsonb_typeof(ingredient->'amount') in ('number','string','null')
\else
        private.recipe_ingredient_is_valid(ingredient - 'groupLabel')
\endif
        and (
          not (ingredient ? 'groupLabel')
          or jsonb_typeof(ingredient->'groupLabel') = 'null'
          or (
            jsonb_typeof(ingredient->'groupLabel') = 'string'
            and length(trim(ingredient->>'groupLabel')) <= 128
          )
        )
      else false
    end as is_valid,
    case
      when jsonb_typeof(ingredient) = 'object'
           and ingredient ? 'groupLabel'
           and jsonb_typeof(ingredient->'groupLabel') = 'string'
           and nullif(trim(ingredient->>'groupLabel'), '') is not null
        then trim(ingredient->>'groupLabel')
      else null
    end as normalized_label,
    jsonb_typeof(ingredient) = 'object'
      and ingredient ? 'groupLabel'
      and (
        jsonb_typeof(ingredient->'groupLabel') = 'null'
        or jsonb_typeof(ingredient->'groupLabel') not in ('string','null')
        or (
          jsonb_typeof(ingredient->'groupLabel') = 'string'
          and (
            nullif(trim(ingredient->>'groupLabel'), '') is null
            or length(trim(ingredient->>'groupLabel')) > 128
          )
        )
      ) as invalid_group_label
  from ingredient_items as item
),
ingredient_run_marks as (
  select
    checks.*,
    case when normalized_label is not distinct from lag(normalized_label)
      over (partition by row_key order by ordinality)
      then 0 else 1 end as starts_run
  from ingredient_checks as checks
),
ingredient_runs as (
  select row_key, normalized_label, sum(starts_run) over (
    partition by row_key order by ordinality
  ) as run_number
  from ingredient_run_marks
),
ingredient_run_summary as (
  select
    row_key,
    count(distinct run_number) as run_count,
    count(distinct run_number) filter (
      where normalized_label is null
    ) as unlabeled_run_count,
    count(distinct run_number) filter (
      where normalized_label is not null
    ) as labeled_run_count
  from ingredient_runs
  group by row_key
),
ingredient_repeated_labels as (
  select row_key, normalized_label, count(distinct run_number) as run_count
  from ingredient_runs
  group by row_key, normalized_label
),
flat_lines as (
  select
    recipe.row_key,
    line.value,
    line.ordinality,
    case when jsonb_typeof(line.value) = 'string'
      then trim(line.value #>> '{}') else null end as text
  from recipe_source as recipe
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(recipe.instructions) = 'array'
      then recipe.instructions else '[]'::jsonb end
  ) with ordinality as line(value, ordinality)
),
flat_note_boundaries as (
  select row_key, min(ordinality) filter (
    where lower(regexp_replace(text, '[:\-–—]+$', '')) = 'notes'
  ) as notes_ordinality
  from flat_lines
  group by row_key
),
flat_step_rows as (
  select
    line.row_key,
    line.ordinality,
    regexp_replace(
      line.text,
      '^\s*(?:[0-9]+[.)]|[-*•])\s+',
      ''
    ) as step
  from flat_lines as line
  left join flat_note_boundaries as notes using (row_key)
  where jsonb_typeof(line.value) = 'string'
    and line.text <> ''
    and (notes.notes_ordinality is null or line.ordinality < notes.notes_ordinality)
    and not (
      right(line.text, 1) = ':'
      and lower(regexp_replace(line.text, '[:\-–—]+$', '')) <> 'notes'
      and cardinality(regexp_split_to_array(
        regexp_replace(line.text, ':\s*$', ''), '\s+'
      )) between 1 and 6
      and line.text !~ '[.!?(),0-9]'
    )
),
flat_normalized as (
  select
    recipe.row_key,
    coalesce(array_agg(step.step order by step.ordinality)
      filter (where step.step is not null and step.step <> ''), array[]::text[])
      as steps
  from recipe_source as recipe
  left join flat_step_rows as step using (row_key)
  group by recipe.row_key
),
group_entries as (
  select recipe.row_key, entry.value as group_value, entry.ordinality
  from recipe_source as recipe
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(recipe.instruction_groups) = 'array'
      then recipe.instruction_groups else '[]'::jsonb end
  ) with ordinality as entry(value, ordinality)
),
group_step_rows as (
  select
    entry.row_key,
    entry.ordinality as group_ordinality,
    step.ordinality as step_ordinality,
    step.value,
    case when jsonb_typeof(step.value) = 'string'
      then trim(step.value #>> '{}') else null end as step
  from group_entries as entry
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(entry.group_value->'steps') = 'array'
      then entry.group_value->'steps' else '[]'::jsonb end
  ) with ordinality as step(value, ordinality)
),
group_normalized as (
  select
    recipe.row_key,
    coalesce(array_agg(steps.step order by steps.group_ordinality,
      steps.step_ordinality) filter (
        where steps.step is not null and steps.step <> ''
      ), array[]::text[]) as steps,
    count(distinct steps.group_ordinality) filter (
      where steps.step is not null and steps.step <> ''
    ) as nonempty_group_count
  from recipe_source as recipe
  left join group_step_rows as steps using (row_key)
  group by recipe.row_key
),
group_labels as (
  select
    entry.row_key,
    entry.ordinality,
    nullif(trim(entry.group_value->>'label'), '') as label
  from group_entries as entry
  where exists (
    select 1 from group_step_rows as step
    where step.row_key = entry.row_key
      and step.group_ordinality = entry.ordinality
      and step.step is not null and step.step <> ''
  )
),
group_label_runs as (
  select labels.*, case when label is not distinct from lag(label) over (
    partition by row_key order by ordinality
  ) then 0 else 1 end as starts_run
  from group_labels as labels
),
group_label_run_numbers as (
  select
    runs.*,
    sum(starts_run) over (partition by row_key order by ordinality) as run_number
  from group_label_runs as runs
),
recipe_checks as (
  select
    recipe.*,
    jsonb_typeof(recipe.ingredients) <> 'array'
      or jsonb_array_length(case when jsonb_typeof(recipe.ingredients) = 'array'
        then recipe.ingredients else '[]'::jsonb end) > 500
      or exists (select 1 from ingredient_checks as item
        where item.row_key = recipe.row_key and not item.is_valid) as ingredient_invalid,
    jsonb_typeof(recipe.instructions) <> 'array'
      or jsonb_array_length(case when jsonb_typeof(recipe.instructions) = 'array'
        then recipe.instructions else '[]'::jsonb end) > 2000
      or exists (select 1 from flat_lines as line
        where line.row_key = recipe.row_key and (
          jsonb_typeof(line.value) <> 'string'
          or length(line.value #>> '{}') > 10000
        )) as flat_instruction_invalid,
    jsonb_typeof(recipe.notes) <> 'array'
      or jsonb_array_length(case when jsonb_typeof(recipe.notes) = 'array'
        then recipe.notes else '[]'::jsonb end) > 2000
      or exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(recipe.notes) = 'array'
            then recipe.notes else '[]'::jsonb end
        ) as note(value)
        where jsonb_typeof(note.value) <> 'string'
          or length(note.value #>> '{}') > 10000
          or nullif(trim(note.value #>> '{}'), '') is null
      ) as notes_invalid,
    jsonb_typeof(recipe.instruction_groups) not in ('array','null')
      or (
        jsonb_typeof(recipe.instruction_groups) = 'array'
        and (
          jsonb_array_length(recipe.instruction_groups) > 500
          or exists (
            select 1 from group_entries as entry
            where entry.row_key = recipe.row_key and (
              jsonb_typeof(entry.group_value) <> 'object'
              or not (entry.group_value ? 'steps')
              or exists (select 1 from jsonb_object_keys(entry.group_value) as key
                where key not in ('label','steps'))
              or (entry.group_value ? 'label' and (
                jsonb_typeof(entry.group_value->'label') not in ('string','null')
                or length(trim(entry.group_value->>'label')) > 128
              ))
              or jsonb_typeof(entry.group_value->'steps') <> 'array'
            )
          )
          or exists (
            select 1 from group_step_rows as step
            where step.row_key = recipe.row_key and (
              jsonb_typeof(step.value) <> 'string'
              or length(step.value #>> '{}') > 10000
            )
          )
          or (select count(*) from group_step_rows as step
            where step.row_key = recipe.row_key
              and step.step is not null and step.step <> '') > 2000
        )
      ) as instruction_groups_invalid
  from recipe_source as recipe
),
classified as (
  select
    checks.*,
    flat.steps as normalized_flat_steps,
    grouped.steps as normalized_group_steps,
    grouped.nonempty_group_count,
    case
      when grouped.nonempty_group_count > 0 and flat.steps = grouped.steps
        then 'equivalent-dual'
      when grouped.nonempty_group_count > 0 and cardinality(flat.steps) = 0
        then 'grouped-only'
      when grouped.nonempty_group_count > 0 then 'conflicting-dual'
      when cardinality(flat.steps) > 0 then 'flat-only'
      else 'empty'
    end as instruction_class
  from recipe_checks as checks
  join flat_normalized as flat using (row_key)
  join group_normalized as grouped using (row_key)
),
share_flat_steps as (
  select
    share.row_key,
    coalesce(array_agg(regexp_replace(
      trim(line.value #>> '{}'),
      '^\s*(?:[0-9]+[.)]|[-*•])\s+',
      ''
    ) order by line.ordinality) filter (
      where jsonb_typeof(line.value) = 'string'
        and nullif(trim(line.value #>> '{}'), '') is not null
        and line.ordinality < coalesce((
          select min(note.ordinality)
          from jsonb_array_elements(share.snapshot->'instructions')
            with ordinality as note(value, ordinality)
          where jsonb_typeof(note.value) = 'string'
            and lower(regexp_replace(
              trim(note.value #>> '{}'), '[:\-–—]+$', ''
            )) = 'notes'
        ), 2147483647)
        and not (
          right(trim(line.value #>> '{}'), 1) = ':'
          and lower(regexp_replace(
            trim(line.value #>> '{}'), '[:\-–—]+$', ''
          )) <> 'notes'
          and cardinality(regexp_split_to_array(regexp_replace(
            trim(line.value #>> '{}'), ':\s*$', ''
          ), '\s+')) between 1 and 6
          and trim(line.value #>> '{}') !~ '[.!?(),0-9]'
        )
    ), array[]::text[]) as steps
  from share_source as share
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(share.snapshot->'instructions') = 'array'
      then share.snapshot->'instructions' else '[]'::jsonb end
  ) with ordinality as line(value, ordinality)
  group by share.row_key, share.snapshot
),
share_group_steps as (
  select
    share.row_key,
    coalesce(array_agg(trim(step.value #>> '{}') order by group_entry.ordinality,
      step.ordinality) filter (
        where jsonb_typeof(step.value) = 'string'
          and nullif(trim(step.value #>> '{}'), '') is not null
      ), array[]::text[]) as steps,
    count(distinct group_entry.ordinality) filter (
      where jsonb_typeof(step.value) = 'string'
        and nullif(trim(step.value #>> '{}'), '') is not null
    ) as nonempty_group_count
  from share_source as share
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(share.snapshot->'instruction_groups') = 'array'
      then share.snapshot->'instruction_groups' else '[]'::jsonb end
  ) with ordinality as group_entry(value, ordinality)
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(group_entry.value->'steps') = 'array'
      then group_entry.value->'steps' else '[]'::jsonb end
  ) with ordinality as step(value, ordinality)
  group by share.row_key
),
share_instruction_summary as (
  select
    share.row_key,
    coalesce(flat.steps, array[]::text[]) as flat_steps,
    coalesce(grouped.steps, array[]::text[]) as group_steps,
    coalesce(grouped.nonempty_group_count, 0) as nonempty_group_count
  from share_source as share
  left join share_flat_steps as flat using (row_key)
  left join share_group_steps as grouped using (row_key)
),
share_checks as (
  select
    share.*,
    case
      when jsonb_typeof(snapshot) <> 'object' or snapshot = '{}'::jsonb
        then false
      when jsonb_typeof(snapshot->'ingredients') <> 'array'
        or jsonb_typeof(snapshot->'instructions') <> 'array' then false
\if :{?canonical_recipe_structure_fixture_mode}
      else true
\else
      else private.recipe_share_snapshot_is_valid(snapshot)
\endif
        and not (
          instructions.nonempty_group_count > 0
          and instructions.flat_steps is distinct from instructions.group_steps
        )
    end as convertible
  from share_source as share
  join share_instruction_summary as instructions using (row_key)
),
summary as (
  select jsonb_build_object(
    'total_recipe_rows', (select count(*) from classified),
    'rows_cannot_convert_without_remediation', (select count(*) from classified
      where ingredient_invalid or flat_instruction_invalid or notes_invalid
        or instruction_groups_invalid or instruction_class = 'conflicting-dual'),
    'entirely_empty_recipe_rows', (select count(*) from classified
      where ingredients = '[]'::jsonb
        and cardinality(normalized_flat_steps) = 0
        and nonempty_group_count = 0),
    'ingredient_rows_using_current_flat_column', (select count(*) from classified
      where jsonb_typeof(ingredients) = 'array'),
    'ingredient_rows_without_labels', (select count(*) from classified as recipe
      where not exists (select 1 from ingredient_checks as item
        where item.row_key = recipe.row_key and item.normalized_label is not null)),
    'ingredient_rows_with_labels', (select count(*) from classified as recipe
      where exists (select 1 from ingredient_checks as item
        where item.row_key = recipe.row_key and item.normalized_label is not null)),
    'ingredient_rows_all_labeled', (select count(*) from classified as recipe
      where exists (select 1 from ingredient_checks as item
        where item.row_key = recipe.row_key)
        and not exists (select 1 from ingredient_checks as item
          where item.row_key = recipe.row_key and item.normalized_label is null)),
    'ingredient_rows_mixed_labels', (select count(*) from classified as recipe
      where exists (select 1 from ingredient_checks as item
        where item.row_key = recipe.row_key and item.normalized_label is not null)
        and exists (select 1 from ingredient_checks as item
          where item.row_key = recipe.row_key and item.normalized_label is null)),
    'malformed_ingredient_top_levels', (select count(*) from recipe_source
      where jsonb_typeof(ingredients) <> 'array'),
    'malformed_ingredient_items', (select count(*) from ingredient_checks
      where not is_valid and jsonb_typeof(ingredient) <> 'null'),
    'unexpected_null_ingredient_items', (select count(*) from ingredient_checks
      where jsonb_typeof(ingredient) = 'null'),
    'legacy_string_ingredient_items', (select count(*) from ingredient_checks
      where jsonb_typeof(ingredient) = 'string'),
    'invalid_group_label_properties', (select count(*) from ingredient_checks
      where invalid_group_label),
    'nonconsecutive_repeated_ingredient_label_rows', (select count(distinct row_key)
      from ingredient_repeated_labels where normalized_label is not null
        and run_count > 1),
    'repeated_unlabeled_run_rows', (select count(distinct row_key)
      from ingredient_repeated_labels where normalized_label is null
        and run_count > 1),
    'total_derived_ingredient_runs', coalesce((select sum(run_count)
      from ingredient_run_summary), 0),
    'derived_unlabeled_ingredient_runs', coalesce((select sum(unlabeled_run_count)
      from ingredient_run_summary), 0),
    'derived_labeled_ingredient_runs', coalesce((select sum(labeled_run_count)
      from ingredient_run_summary), 0),
    'flat_only_instruction_rows', (select count(*) from classified
      where instruction_class = 'flat-only'),
    'grouped_only_instruction_rows', (select count(*) from classified
      where instruction_class = 'grouped-only'),
    'equivalent_dual_instruction_rows', (select count(*) from classified
      where instruction_class = 'equivalent-dual'),
    'conflicting_dual_instruction_rows', (select count(*) from classified
      where instruction_class = 'conflicting-dual'),
    'empty_instruction_rows', (select count(*) from classified
      where instruction_class = 'empty'),
    'null_instruction_group_rows', (select count(*) from recipe_source
      where instruction_groups is null),
    'json_null_instruction_group_rows', (select count(*) from recipe_source
      where jsonb_typeof(instruction_groups) = 'null'),
    'empty_instruction_group_arrays', (select count(*) from recipe_source
      where instruction_groups = '[]'::jsonb),
    'malformed_instruction_group_rows', (select count(*) from classified
      where instruction_groups_invalid),
    'null_flat_instruction_items', (select count(*) from flat_lines
      where jsonb_typeof(value) = 'null'),
    'blank_flat_instruction_items', (select count(*) from flat_lines
      where jsonb_typeof(value) = 'string' and text = ''),
    'empty_instruction_group_objects', (select count(*) from group_entries as entry
      where not exists (select 1 from group_step_rows as step
        where step.row_key = entry.row_key
          and step.group_ordinality = entry.ordinality
          and step.step is not null and step.step <> '')),
    'repeated_instruction_label_rows', (select count(*) from (
      select row_key from group_labels where label is not null group by row_key
      having count(*) > count(distinct label)
    ) as repeated_instruction_labels),
    'consecutive_repeated_instruction_label_rows', (select count(distinct row_key)
      from group_label_runs where label is not null and starts_run = 0),
    'nonconsecutive_repeated_instruction_label_rows', (select count(*) from (
      select row_key, label from group_label_run_numbers
      where label is not null
      group by row_key, label
      having count(distinct run_number) > 1
    ) as repeated_instruction_label_runs),
    'legacy_notes_marker_rows', (select count(*) from flat_note_boundaries
      where notes_ordinality is not null),
    'legacy_flat_instruction_label_rows', (select count(distinct row_key)
      from flat_lines where text is not null and right(text, 1) = ':'
        and lower(regexp_replace(text, '[:\-–—]+$', '')) <> 'notes'
        and cardinality(regexp_split_to_array(
          regexp_replace(text, ':\s*$', ''), '\s+'
        )) between 1 and 6
        and text !~ '[.!?(),0-9]'),
    'nonempty_notes_rows', (select count(*) from recipe_source
      where jsonb_typeof(notes) = 'array' and jsonb_array_length(notes) > 0),
    'empty_notes_rows', (select count(*) from recipe_source
      where notes = '[]'::jsonb),
    'malformed_notes_rows', (select count(*) from classified where notes_invalid),
    'share_rows', (select count(*) from share_checks),
    'convertible_share_snapshots', (select count(*) from share_checks
      where convertible),
    'pending_convertible_share_snapshots', (select count(*) from share_checks
      where status = 'pending' and convertible),
    'malformed_or_unsupported_share_snapshots', (select count(*) from share_checks
      where not convertible),
    'legacy_empty_share_snapshots', (select count(*) from share_checks
      where snapshot = '{}'::jsonb),
    'ingredient_serialized_bytes', coalesce((select sum(octet_length(ingredients::text))
      from recipe_source), 0),
    'flat_instruction_serialized_bytes', coalesce((select sum(octet_length(instructions::text))
      from recipe_source), 0),
    'grouped_instruction_serialized_bytes', coalesce((select sum(octet_length(
      instruction_groups::text)) from recipe_source), 0),
    'share_snapshot_serialized_bytes', coalesce((select sum(octet_length(snapshot::text))
      from share_source), 0)
  ) as result,
  not exists (
    select 1 from classified
    where ingredient_invalid or flat_instruction_invalid or notes_invalid
      or instruction_groups_invalid or instruction_class = 'conflicting-dual'
  ) and not exists (
    select 1 from share_checks where not convertible
  ) as preflight_pass
)
select result, preflight_pass from summary \gset canonical_structure_

select :'canonical_structure_result'::jsonb;

\if :{?canonical_recipe_structure_fixture_mode}
  \if :{?canonical_recipe_structure_fixture_failure}
    select
      (:'canonical_structure_result'::jsonb->>'total_recipe_rows')::integer = 6
      and (:'canonical_structure_result'::jsonb
        ->>'conflicting_dual_instruction_rows')::integer = 1
      and (:'canonical_structure_result'::jsonb
        ->>'rows_cannot_convert_without_remediation')::integer = 1
      as canonical_structure_fixture_matches \gset
  \else
    select
      (:'canonical_structure_result'::jsonb->>'total_recipe_rows')::integer = 5
      and (:'canonical_structure_result'::jsonb
        ->>'rows_cannot_convert_without_remediation')::integer = 0
      and (:'canonical_structure_result'::jsonb
        ->>'flat_only_instruction_rows')::integer = 2
      and (:'canonical_structure_result'::jsonb
        ->>'grouped_only_instruction_rows')::integer = 1
      and (:'canonical_structure_result'::jsonb
        ->>'equivalent_dual_instruction_rows')::integer = 1
      and (:'canonical_structure_result'::jsonb
        ->>'conflicting_dual_instruction_rows')::integer = 0
      and (:'canonical_structure_result'::jsonb
        ->>'entirely_empty_recipe_rows')::integer = 1
      and (:'canonical_structure_result'::jsonb
        ->>'nonconsecutive_repeated_ingredient_label_rows')::integer = 1
      and (:'canonical_structure_result'::jsonb
        ->>'convertible_share_snapshots')::integer = 4
      and (:'canonical_structure_result'::jsonb
        ->>'pending_convertible_share_snapshots')::integer = 1
      as canonical_structure_fixture_matches \gset
  \endif
  \if :canonical_structure_fixture_matches
  \else
    rollback;
    do $fatal$ begin
      raise exception 'canonical recipe structure synthetic fixture counts drifted';
    end $fatal$;
  \endif
\endif

\if :canonical_structure_preflight_pass
  rollback;
\else
  rollback;
  do $fatal$ begin
    raise exception 'canonical recipe structure preflight found malformed or conflicting rows';
  end $fatal$;
\endif
