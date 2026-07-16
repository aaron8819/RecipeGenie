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

const sourceRoot = path.join(root, "src")
const allowed = new Set([
  path.join(sourceRoot, "types", "database.generated.ts"),
])
const forbiddenAssignment = /\brecipe_uuid\s*:/

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
        `Production code must not assign canonical recipe UUIDs during Stage 1: ${path.relative(root, fullPath)}`
      )
    }
  }
}

visit(sourceRoot)
console.log("Recipe UUID Stage 1 identity guard passed.")
