import { readFileSync } from "node:fs"

const runtimeFiles = [
  "src/hooks/use-recipes.ts",
  "src/lib/recipe-identity.ts",
  "src/lib/recipe-sharing.ts",
  "src/lib/shopping-list.ts",
  "src/components/recipes/recipe-detail-page.tsx",
  "src/components/recipes/recipe-dialog.defaults.ts",
  "src/app/api/recipe-shares/route.ts",
  "src/app/api/recipe-shares/[id]/accept/route.ts",
  "src/app/api/shopping/recipe-contributions/route.ts",
  "scripts/bootstrap-local-e2e.mjs",
  "scripts/operational/audit-checks.mjs",
  "scripts/operational/production-checks.mjs",
]

const forbidden = [
  { label: "legacy grouped-instruction column/property", pattern: /\binstruction_groups\b/ },
  { label: "legacy recipe ingredient read", pattern: /\b(?:recipe|row|snapshot|payload)\.ingredients\b/ },
  { label: "legacy recipe instruction read", pattern: /\b(?:recipe|row|snapshot|payload)\.instructions\b/ },
  { label: "removed ingredient regrouping helper", pattern: /\bgetRecipeIngredientGroups\b/ },
  { label: "removed instruction regrouping helper", pattern: /\bgetRecipeInstructionGroups\b/ },
  { label: "wildcard recipe select", pattern: /\.from\(["']recipes["']\)[\s\S]{0,120}?\.select\(["']\*["']\)/ },
  { label: "legacy persisted ingredient column", pattern: /\br\.ingredients\b|select\s+recipe_uuid,\s*ingredients\b/ },
]

const failures = []
for (const file of runtimeFiles) {
  const source = readFileSync(file, "utf8")
  for (const rule of forbidden) {
    if (rule.pattern.test(source)) failures.push(`${file}: ${rule.label}`)
  }
}

if (failures.length > 0) {
  console.error("Canonical recipe-structure runtime gate failed:\n" + failures.join("\n"))
  process.exit(1)
}

console.log(`Canonical recipe-structure runtime gate passed for ${runtimeFiles.length} boundary files.`)
