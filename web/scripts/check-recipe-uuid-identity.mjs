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
]) {
  if (!required.test(recipeHooks)) failures.push(`recipe hook UUID seam missing: ${required}`)
}
for (const forbidden of [
  /sanitizeRecipeNameForStorage/,
  /\.eq\("id", id\)/,
]) {
  if (forbidden.test(recipeHooks)) failures.push(`recipe hooks retain legacy identity behavior: ${forbidden}`)
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
  console.error("Recipe UUID Stage 2B guard failed:")
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log("Recipe UUID Stage 2B application identity guard passed.")
