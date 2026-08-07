import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8")
const failures = []
const sourceFiles = fs
  .readdirSync(path.join(root, "src"), { recursive: true })
  .filter((file) => typeof file === "string" && /\.[cm]?[jt]sx?$/.test(file))
  .map((file) => `src/${file.replaceAll("\\", "/")}`)

const migration = read("../supabase/migrations/010_enable_uuid_application_identity.sql")
for (const contract of [
  /create function public\.resolve_recipe_identity/,
  /create function private\.resolve_owned_recipe_legacy_array/,
  /create function public\.apply_recipe_shopping_contribution_uuid_command/,
  /create function public\.toggle_weekly_recipe_made\(\s*p_recipe_uuid uuid/,
  /legacy recipe alias is immutable/,
  /accepted_recipe_uuid = v_new_recipe_uuid/,
]) {
  if (!contract.test(migration)) {
    failures.push(`migration 010 contract missing: ${contract}`)
  }
}

const madeStateRepair = read("../supabase/migrations/011_fix_uuid_made_state_date_contract.sql")
for (const contract of [
  /p_recipe_uuid uuid,\s*p_week_date date,\s*p_made boolean,/,
  /drop function public\.toggle_weekly_recipe_made\(uuid, text, boolean, timestamptz\)/,
  /grant execute on function public\.toggle_weekly_recipe_made\(uuid, date, boolean, timestamptz\)\s*to authenticated/,
]) {
  if (!contract.test(madeStateRepair)) {
    failures.push(`migration 011 made-state contract missing: ${contract}`)
  }
}

const enforcement = read("../supabase/migrations/012_enforce_uuid_active_recipe_writes.sql")
for (const contract of [
  /alter table public\.recipes alter column recipe_uuid drop default/,
  /create trigger enforce_recipe_uuid_insert/,
  /drop function public\.toggle_weekly_recipe_made\(text, text, boolean, timestamptz\)/,
  /revoke all privileges on function public\.apply_recipe_shopping_contribution_command/,
  /create function public\.delete_recipe\(p_recipe_uuid uuid\)/,
  /update public\.weekly_plans as plan[\s\S]*private\.remove_recipe_uuid_from_array/,
  /update public\.plan_templates as template[\s\S]*day_assignment_recipe_uuids/,
  /delete from public\.shopping_recipe_contributions as contribution/,
  /perform set_config\('recipe_genie\.recipe_deletion', 'on', true\)/,
  /create table private\.recipe_identity_compat_usage/,
  /create function public\.get_recipe_identity_compat_usage\(\)/,
  /raise exception 'weekly plan recipe UUIDs are required'/,
  /raise exception 'template recipe UUIDs are required'/,
  /raise exception 'active recipe history UUID is required'/,
  /raise exception 'active share source UUID is required'/,
  /raise exception 'shopping contribution recipe UUID is required'/,
]) {
  if (!contract.test(enforcement)) {
    failures.push(`migration 012 enforcement contract missing: ${contract}`)
  }
}

const mapper = read("src/lib/recipe-identity.ts")
if (
  !/id:\s*legacyId,\s*recipe_uuid:\s*id/.test(mapper) &&
  !/id:\s*row\.recipe_uuid,\s*legacyId:\s*row\.id/.test(mapper)
) {
  failures.push("Recipe row mapper does not map recipe_uuid -> Recipe.id and id -> legacyId")
}
if (!/const id = assertRecipeUuid\(recipeUuid\)[\s\S]*return \{[\s\S]*\bid,[\s\S]*recipe_uuid: id/.test(mapper)) {
  failures.push("Recipe creation does not persist the temporary matching UUID/text compatibility pair")
}
if (
  !/id,\s*legacyId/.test(mapper) &&
  !/id:\s*row\.recipe_uuid,\s*legacyId:\s*row\.id/.test(mapper)
) {
  failures.push("Recipe mapper does not expose canonical and compatibility identities explicitly")
}

const recipeHooks = read("src/hooks/use-recipes.ts")
for (const required of [
  /\.eq\("recipe_uuid", id\)/,
  /recipeUuidWrite\(recipeUuid\)/,
  /mapRecipeRow/,
  /deleteRecipeByUuid\([\s\S]*getSupabase\(\),[\s\S]*id,[\s\S]*user!\.id/,
]) {
  if (!required.test(recipeHooks)) failures.push(`recipe hook UUID seam missing: ${required}`)
}

const deletionAdapter = read("src/lib/recipe-deletion.ts")
for (const required of [
  /candidate\.code === "PGRST202"/,
  /candidate\.message === MISSING_DELETE_RECIPE_RPC_MESSAGE/,
  /candidate\.details === MISSING_DELETE_RECIPE_RPC_DETAILS/,
  /rpc\("delete_recipe", \{ p_recipe_uuid: id \}\)/,
  /\.eq\("recipe_uuid", recipeUuid\)/,
  /\.eq\("user_id", ownerUserId\)/,
  /client\.from\("weekly_plans"\)/,
  /client\.from\("plan_templates"\)/,
  /Migration011DeletionPartialFailureError/,
]) {
  if (!required.test(deletionAdapter)) {
    failures.push(`recipe deletion compatibility contract missing: ${required}`)
  }
}
for (const forbidden of [
  /from\("recipes"\)[\s\S]{0,200}\.eq\("id",/,
  /message\.includes\(/,
  /catch\s*\(/,
]) {
  if (forbidden.test(deletionAdapter)) {
    failures.push(`recipe deletion adapter has unsafe fallback behavior: ${forbidden}`)
  }
}

for (const file of sourceFiles) {
  const source = read(file)
  if (file !== "src/lib/recipe-deletion.ts" && /rpc\("delete_recipe"/.test(source)) {
    failures.push(`${file} bypasses the recipe deletion compatibility adapter`)
  }
}
for (const forbidden of [
  /sanitizeRecipeNameForStorage/,
  /\.eq\("id", id\)/,
  /from\("recipes"\)\.delete\(/,
]) {
  if (forbidden.test(recipeHooks)) failures.push(`recipe hooks retain legacy identity behavior: ${forbidden}`)
}

const activeLegacyIdUsers = [
  "src/hooks/use-planner.ts",
  "src/hooks/use-plan-templates.ts",
  "src/app/api/recipe-shares/route.ts",
  "src/lib/query-keys.ts",
]
for (const file of activeLegacyIdUsers) {
  if (/\blegacyId\b/.test(read(file))) {
    failures.push(`${file} uses Recipe.legacyId in an active application seam`)
  }
}

const dialog = read("src/components/recipes/recipe-dialog.tsx")
if (/sanitizeRecipeNameForStorage/.test(dialog) || !/pendingCreateUuidRef/.test(dialog)) {
  failures.push("recipe dialog does not allocate and reuse a name-independent UUID")
}

const keys = read("src/lib/query-keys.ts")
for (const required of [/recipeKeyId/, /historyKeys =/, /shareKeys =/, /"recipe", recipeKeyId/]) {
  if (!required.test(keys)) failures.push(`UUID query-key guard missing: ${required}`)
}

const planner = read("src/hooks/use-planner.ts")
for (const required of [
  /recipe_uuids:/,
  /day_assignment_recipe_uuids:/,
  /made_recipe_uuids:/,
  /p_recipe_uuid:/,
  /p_made: !isMadeForWeek/,
  /\.in\("recipe_uuid", recipeIds\)/,
]) {
  if (!required.test(planner)) failures.push(`planner UUID contract missing: ${required}`)
}

const templates = read("src/hooks/use-plan-templates.ts")
for (const required of [/recipe_uuids: recipeIds/, /day_assignment_recipe_uuids:/]) {
  if (!required.test(templates)) failures.push(`template UUID contract missing: ${required}`)
}

const shareRoute = read("src/app/api/recipe-shares/route.ts")
if (!shareRoute.includes("source_recipe_uuid") || !shareRoute.includes("assertRecipeUuid")) {
  failures.push("share creation is not UUID-addressed and validated")
}

if (failures.length > 0) {
  console.error("Recipe UUID Stage 2C guard failed:")
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log("Recipe UUID Stage 2C active-write guard passed.")
