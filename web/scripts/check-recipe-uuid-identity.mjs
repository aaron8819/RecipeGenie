import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8")
const failures = []

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
if (!/id: legacyId, recipe_uuid: id/.test(mapper)) {
  failures.push("Recipe row mapper does not map recipe_uuid -> Recipe.id and id -> legacyId")
}
if (!/id,\s*legacyId/.test(mapper)) {
  failures.push("Recipe mapper does not expose canonical and compatibility identities explicitly")
}

const recipeHooks = read("src/hooks/use-recipes.ts")
for (const required of [
  /\.eq\("recipe_uuid", id\)/,
  /recipeUuidWrite\(recipeUuid\)/,
  /mapRecipeRow/,
  /runRecipeContributionCommand\("DELETE"/,
  /rpc\("delete_recipe", \{ p_recipe_uuid: assertRecipeUuid\(id\) \}\)/,
]) {
  if (!required.test(recipeHooks)) failures.push(`recipe hook UUID seam missing: ${required}`)
}
for (const forbidden of [
  /sanitizeRecipeNameForStorage/,
  /\.eq\("id", id\)/,
  /from\("recipes"\)\.delete\(/,
]) {
  if (forbidden.test(recipeHooks)) failures.push(`recipe hooks retain legacy identity behavior: ${forbidden}`)
}

const activeLegacyIdUsers = [
  "src/hooks/use-recipes.ts",
  "src/hooks/use-planner.ts",
  "src/hooks/use-plan-templates.ts",
  "src/app/api/shopping/recipe-contributions/route.ts",
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

const contributionRoute = read("src/app/api/shopping/recipe-contributions/route.ts")
if (!contributionRoute.includes("apply_recipe_shopping_contribution_uuid_command")) {
  failures.push("shopping contribution route is not UUID-addressed")
}
if (/recipeNames/.test(contributionRoute) || /\.in\("name"/.test(contributionRoute)) {
  failures.push("shopping contribution route retains recipe-name identity resolution")
}
for (const forbidden of [
  /recipeIds:\s*input\.recipeIds/,
  /idempotencyKey:\s*input\.idempotencyKey/,
]) {
  if (forbidden.test(contributionRoute)) {
    failures.push(`shopping contribution logs expose raw identity metadata: ${forbidden}`)
  }
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
