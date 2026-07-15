import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const read = (path) => readFileSync(resolve(root, path), "utf8")
const failures = []

const forbiddenClientFiles = [
  "src/hooks/shopping/use-shopping-recipes.ts",
  "src/hooks/shopping/use-shopping-list.ts",
  "src/hooks/shopping/use-shopping-pending-actions.ts",
  "src/components/recipes/recipe-list.tsx",
  "src/components/planner/meal-planner.tsx",
]
const forbiddenPatterns = [
  /mergeShoppingItems/,
  /removeRecipeFromItems/,
  /removeRecipeByNameFromItems/,
  /generateShoppingList/,
  /useGenerateShoppingList/,
  /useSaveShoppingList/,
]

for (const file of forbiddenClientFiles) {
  const source = read(file)
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) failures.push(`${file} contains ${pattern}`)
  }
}

const commandRoute = read("src/app/api/shopping/recipe-contributions/route.ts")
if (!commandRoute.includes("apply_recipe_shopping_contribution_command")) {
  failures.push("authoritative route does not call the atomic contribution RPC")
}
if (!commandRoute.includes("generateShoppingList")) {
  failures.push("authoritative route does not own recipe contribution generation")
}

for (const file of [
  "src/components/recipes/recipe-list.tsx",
  "src/components/planner/meal-planner.tsx",
]) {
  if (!read(file).includes("useAddToShoppingList")) {
    failures.push(`${file} does not use the shared recipe shopping command`)
  }
}

const recipeHooks = read("src/hooks/use-recipes.ts")
if (!recipeHooks.includes('runRecipeContributionCommand("DELETE"')) {
  failures.push("recipe deletion can bypass authoritative contribution removal")
}

if (failures.length > 0) {
  console.error("Shopping contribution write guard failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Shopping contribution write guard passed.")
