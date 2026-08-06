import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const isWindows = process.platform === "win32"
const spawnOptions = {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: isWindows,
}
const migrationSql = readFileSync(
  "../supabase/migrations/016_canonical_recipe_structure_cutover.sql",
  "utf8"
)
const cleanupSql = readFileSync(
  "../supabase/migrations/017_remove_legacy_recipe_structure.sql",
  "utf8"
)

function formatResult(result) {
  return [
    `status=${String(result.status)}`,
    `stdout:\n${result.stdout?.trim() || "<empty>"}`,
    `stderr:\n${result.stderr?.trim() || "<empty>"}`,
  ].join("\n")
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { ...spawnOptions, ...options })
}

function runSupabase(args, expectSuccess = true) {
  const result = run("npx", ["supabase", "--workdir", "..", ...args], {
    stdio: expectSuccess ? "inherit" : "pipe",
  })
  if (expectSuccess && (result.error || result.signal || result.status !== 0)) {
    throw new Error(`Supabase command failed\n${formatResult(result)}`)
  }
  return result
}

function databaseContainer() {
  const result = run("docker", [
    "ps",
    "--filter",
    "label=com.supabase.cli.project",
    "--format",
    "{{.Names}}",
  ], { shell: false })
  if (result.status !== 0) throw new Error(formatResult(result))
  const names = result.stdout.split(/\r?\n/).filter((name) => name.startsWith("supabase_db_"))
  if (names.length !== 1) throw new Error(`Expected one local Supabase database, found ${names.length}`)
  return names[0]
}

function psql(container, sql, expectSuccess = true) {
  const result = run("docker", [
    "exec", "-i", container, "psql", "-X", "-A", "-t",
    "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
  ], { shell: false, input: sql })
  if (expectSuccess && (result.error || result.signal || result.status !== 0)) {
    throw new Error(`Fixture SQL failed\n${formatResult(result)}`)
  }
  return result
}

const usersSql = `
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'cutover-a@example.test'),
  ('20000000-0000-0000-0000-000000000002', 'cutover-b@example.test')
on conflict (id) do nothing;
delete from public.recipe_shares;
delete from public.recipes;
`

const validFixtureSql = `${usersSql}
insert into public.recipes (
  id, user_id, name, category, servings, tags, ingredients, instructions,
  instruction_groups, notes, prep_time_minutes, cook_time_minutes, total_time_minutes
) values (
  'canonical-cutover-fixture',
  '10000000-0000-0000-0000-000000000001',
  'Canonical cutover fixture', 'test', 4, array['fixture'],
  '[
    {"item":"flour","amount":1,"unit":"cup","groupLabel":"Dough","originalText":"1 cup flour","modifier":"sifted","alternatives":["bread flour"]},
    {"item":"water","amount":0.5,"unit":"cup","groupLabel":"Dough","authoredUnit":"cups","quantityV1":{"version":1,"kind":"exact","value":{"numerator":"1","denominator":"2"},"authored":"1/2","lexeme":"1/2","source":"authored"}},
    {"item":"salt","amount":1,"unit":"tsp"},
    "kosher salt",
    {"item":"oil","amount":1,"unit":"tbsp","groupLabel":"Dough"}
  ]'::jsonb,
  array['Mix.', 'Rest.', 'Bake.'],
  '[{"label":"Dough","steps":["Mix.","Rest."]},{"label":"Finish","steps":["Bake."]}]'::jsonb,
  '["Keep covered."]'::jsonb, 10, 20, 30
);
insert into public.recipe_shares (
  id, sender_user_id, sender_email, recipient_user_id, recipient_email,
  source_recipe_id, source_recipe_snapshot
) values (
  'a1000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 'cutover-a@example.test',
  '20000000-0000-0000-0000-000000000002', 'cutover-b@example.test',
  'canonical-cutover-fixture',
  '{
    "name":"Canonical cutover fixture","category":"test","servings":4,"tags":["fixture"],
    "ingredients":[{"item":"flour","amount":1,"unit":"cup","groupLabel":"Dough","originalText":"1 cup flour"}],
    "instructions":["Mix.","Bake.","Notes:","Share tail."],
    "instruction_groups":[{"label":"Dough","steps":["Mix."]},{"label":"Finish","steps":["Bake."]}],
    "image_url":"","notes":null,"prep_time_minutes":10,"cook_time_minutes":20,"total_time_minutes":30,
    "yield_metadata":{"version":1,"authoredText":"4 servings","kind":"servings","scalingBasis":{"numerator":"4","denominator":"1"},"value":{"numerator":"4","denominator":"1"}}
  }'::jsonb
);
`

const successAssertionsSql = `
do $$
declare
  v_recipe public.recipes%rowtype;
  v_snapshot jsonb;
begin
  select * into strict v_recipe from public.recipes where id = 'canonical-cutover-fixture';
  if jsonb_array_length(v_recipe.ingredient_sections) <> 3
     or v_recipe.ingredient_sections #>> '{0,label}' <> 'Dough'
     or jsonb_array_length(v_recipe.ingredient_sections #> '{0,ingredients}') <> 2
     or (v_recipe.ingredient_sections #> '{0,ingredients,0}') ? 'groupLabel'
     or v_recipe.ingredient_sections #>> '{0,ingredients,0,originalText}' <> '1 cup flour'
     or v_recipe.ingredient_sections #>> '{0,ingredients,1,quantityV1,value,numerator}' <> '1'
     or v_recipe.ingredient_sections #>> '{1,label}' is not null
     or v_recipe.ingredient_sections #>> '{1,ingredients,1,item}' <> 'kosher salt'
     or v_recipe.ingredient_sections #>> '{1,ingredients,1,originalText}' <> 'kosher salt'
     or v_recipe.ingredient_sections #>> '{2,label}' <> 'Dough'
  then raise exception 'ingredient conversion assertion failed'; end if;
  if v_recipe.instruction_sections <> '[{"label":"Dough","steps":["Mix.","Rest."]},{"label":"Finish","steps":["Bake."]}]'::jsonb
     or v_recipe.notes <> '["Keep covered."]'::jsonb
     or v_recipe.ingredients #>> '{0,groupLabel}' <> 'Dough'
  then raise exception 'recipe preservation assertion failed'; end if;

  select source_recipe_snapshot into strict v_snapshot
  from public.recipe_shares where id = 'a1000000-0000-0000-0000-000000000001';
  if v_snapshot ?| array['ingredients','instructions','instruction_groups']
     or not (v_snapshot ?& array['ingredient_sections','instruction_sections'])
     or v_snapshot #>> '{ingredient_sections,0,label}' <> 'Dough'
     or v_snapshot #>> '{instruction_sections,1,label}' <> 'Finish'
     or v_snapshot #>> '{notes,0}' <> 'Share tail.'
     or v_snapshot #>> '{yield_metadata,authoredText}' <> '4 servings'
  then raise exception 'share conversion assertion failed'; end if;
end;
$$;
`

const captureCanonicalStateSql = `
create temporary table expected_recipe_content as
select recipe_uuid, ingredient_sections, instruction_sections, notes
from public.recipes;

create temporary table expected_share_content as
select id, source_recipe_snapshot
from public.recipe_shares;
`

const cleanupAssertionsSql = `
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes'
      and column_name in ('ingredients', 'instructions', 'instruction_groups')
  ) then raise exception 'cleanup left legacy recipe columns behind'; end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes'
      and column_name = 'ingredient_sections'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes'
      and column_name = 'instruction_sections'
  ) then raise exception 'cleanup removed canonical recipe columns'; end if;

  if to_regprocedure('private.recipe_ingredient_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_instruction_sections_are_valid(jsonb)') is null
     or to_regprocedure('private.recipe_share_snapshot_is_valid(jsonb)') is null then
    raise exception 'cleanup removed canonical validators';
  end if;

  if to_regprocedure('private.recipe_ingredient_sections_from_legacy(jsonb)') is not null
     or to_regprocedure('private.recipe_instruction_sections_from_flat(text[])') is not null
     or to_regprocedure('private.recipe_instruction_sections_from_groups(jsonb)') is not null
     or to_regprocedure('private.recipe_notes_from_legacy(jsonb,text[])') is not null then
    raise exception 'cleanup retained conversion-only functions';
  end if;

  if exists (
    (select recipe_uuid, ingredient_sections, instruction_sections, notes
     from public.recipes
     except table expected_recipe_content)
    union all
    (table expected_recipe_content
     except select recipe_uuid, ingredient_sections, instruction_sections, notes
     from public.recipes)
  ) then raise exception 'cleanup changed canonical recipe content'; end if;

  if exists (
    (select id, source_recipe_snapshot from public.recipe_shares
     except table expected_share_content)
    union all
    (table expected_share_content
     except select id, source_recipe_snapshot from public.recipe_shares)
  ) then raise exception 'cleanup changed canonical share content'; end if;
end;
$$;
`

const invalidFixtureSql = `${usersSql}
insert into public.recipes (
  id, user_id, name, category, servings, tags, ingredients, instructions, instruction_groups
) values (
  'canonical-cutover-conflict',
  '10000000-0000-0000-0000-000000000001',
  'Conflict fixture', 'test', 4, '{}'::text[],
  '[{"item":"water","amount":1,"unit":"cup"}]'::jsonb,
  array['Cook.'], '[{"steps":["Bake."]}]'::jsonb
);
`

const rollbackAssertionsSql = `
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes'
      and column_name in ('ingredient_sections', 'instruction_sections')
  ) then raise exception 'failed migration left canonical columns behind'; end if;
  if (select instructions from public.recipes where id = 'canonical-cutover-conflict') <> array['Cook.']
  then raise exception 'failed migration changed the fixture'; end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '016'
  ) then raise exception 'failed migration was recorded'; end if;
end;
$$;
`

const cleanupPrerequisiteAssertionsSql = `
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes'
      and column_name in ('ingredient_sections', 'instruction_sections')
  ) then raise exception 'failed cleanup changed the pre-016 schema'; end if;
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'recipes'
      and column_name in ('ingredients', 'instructions', 'instruction_groups')
  ) <> 3 then raise exception 'failed cleanup removed legacy columns'; end if;
end;
$$;
`

let restoredLatest = false
try {
  runSupabase(["db", "reset", "--local", "--version", "015", "--no-seed"])
  let container = databaseContainer()
  const cleanupRejected = psql(container, cleanupSql, false)
  if (
    cleanupRejected.status === 0 ||
    !`${cleanupRejected.stdout}\n${cleanupRejected.stderr}`.includes(
      "canonical recipe cleanup requires the exact post-016 columns"
    )
  ) {
    throw new Error(
      `Expected the pre-016 schema to reject cleanup\n${formatResult(cleanupRejected)}`
    )
  }
  psql(container, cleanupPrerequisiteAssertionsSql)

  psql(container, invalidFixtureSql)
  const rejected = psql(container, migrationSql, false)
  if (rejected.status === 0 || !`${rejected.stdout}\n${rejected.stderr}`.includes("conflicting legacy instruction representations")) {
    throw new Error(`Expected the conflicting fixture to reject the migration\n${formatResult(rejected)}`)
  }
  psql(container, rollbackAssertionsSql)

  psql(container, validFixtureSql)
  psql(container, migrationSql)
  psql(container, successAssertionsSql)
  psql(
    container,
    `${captureCanonicalStateSql}\n${cleanupSql}\n${cleanupAssertionsSql}`
  )

  runSupabase(["db", "reset", "--local", "--no-seed"])
  restoredLatest = true
} finally {
  if (!restoredLatest) runSupabase(["db", "reset", "--local", "--no-seed"])
}

console.log("Canonical recipe-structure cutover and cleanup fixtures passed.")
