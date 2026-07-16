import fs from "node:fs"
import path from "node:path"

const root = process.cwd()
const migrationPath = path.join(
  root,
  "..",
  "supabase",
  "migrations",
  "007_add_recipe_uuid_identity.sql"
)
const migration = fs.readFileSync(migrationPath, "utf8")
const referenceMigrationPath = path.join(
  root,
  "..",
  "supabase",
  "migrations",
  "009_add_uuid_recipe_references.sql"
)
const referenceMigration = fs.readFileSync(referenceMigrationPath, "utf8")

const requiredContracts = [
  /recipe_uuid uuid/,
  /alter column recipe_uuid set default gen_random_uuid\(\)/,
  /add constraint recipes_recipe_uuid_key unique \(recipe_uuid\)/,
  /create trigger prevent_recipe_uuid_update/,
]

for (const contract of requiredContracts) {
  if (!contract.test(migration)) {
    throw new Error(`Recipe UUID migration contract missing: ${contract}`)
  }
}

const requiredReferenceContracts = [
  /add column recipe_uuids uuid\[\]/,
  /add column day_assignment_recipe_uuids jsonb/,
  /add column made_recipe_uuids uuid\[\]/,
  /add column recipe_uuid uuid;/,
  /add column source_recipe_uuid uuid/,
  /add column accepted_recipe_uuid uuid/,
  /add column source_recipe_uuids uuid\[\]/,
  /shopping_recipe_contributions_user_recipe_uuid_key/,
  /active recipe reference is unresolved or belongs to another user/,
  /create trigger sync_weekly_plan_recipe_uuids/,
  /create trigger sync_shopping_contribution_recipe_uuid/,
]

for (const contract of requiredReferenceContracts) {
  if (!contract.test(referenceMigration)) {
    throw new Error(`Recipe UUID reference contract missing: ${contract}`)
  }
}

const sourceRoot = path.join(root, "src")
const allowed = new Set([
  path.join(sourceRoot, "types", "database.generated.ts"),
])
const forbiddenAssignment = /\b(?:recipe_uuid|recipe_uuids|day_assignment_recipe_uuids|made_recipe_uuids|source_recipe_uuid|accepted_recipe_uuid|source_recipe_uuids)\s*:/

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      visit(fullPath)
      continue
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name) || allowed.has(fullPath)) continue
    if (forbiddenAssignment.test(fs.readFileSync(fullPath, "utf8"))) {
      throw new Error(
        `Production code must not switch to UUID reference writes during Stage 2A: ${path.relative(root, fullPath)}`
      )
    }
  }
}

visit(sourceRoot)
console.log("Recipe UUID Stage 2A identity and reference guard passed.")
