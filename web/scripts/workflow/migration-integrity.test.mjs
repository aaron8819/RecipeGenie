import { describe, expect, it } from "vitest"
import {
  classifyMigrationImpact,
  validateMigrationMetadata,
} from "./migration-integrity.mjs"

const filenames = [
  "001_baseline.sql",
  "002_recipe_structure_parity.sql",
  ...Array.from(
    { length: 11 },
    (_, index) => `${String(index + 3).padStart(3, "0")}_fixture.sql`,
  ),
  "014_add_recipe_yield_metadata.sql",
]
const trackedMigrationPaths = filenames.map(
  (filename) => `supabase/migrations/${filename}`,
)
const checksumRegistry = Object.fromEntries(
  filenames.map((filename) => [filename, "a".repeat(64)]),
)
const readme = `
Canonical bootstrap currently \`001_baseline.sql\` through
\`014_add_recipe_yield_metadata.sql\`.
`
const schema = `
### Current Active Migration Chain

${filenames.map((filename) => `- \`supabase/migrations/${filename}\``).join("\n")}

### Current State

The current authoritative chain ends at migration 014.
`

function fixture(overrides = {}) {
  return {
    trackedMigrationPaths,
    checksumRegistry,
    readme,
    schema,
    ...overrides,
  }
}

describe("migration documentation integrity", () => {
  it("accepts the current tracked and registered migration 014 endpoint", () => {
    const report = validateMigrationMetadata(fixture())

    expect(report.status).toBe("PASS")
    expect(report.activeFilename).toBe("014_add_recipe_yield_metadata.sql")
    expect(report.checks.every((check) => check.status === "PASS")).toBe(true)
  })

  it("rejects a nonexistent documented endpoint filename", () => {
    const report = validateMigrationMetadata(fixture({
      readme: readme.replace(
        "014_add_recipe_yield_metadata.sql",
        "015_does_not_exist.sql",
      ),
    }))

    expect(report.status).toBe("FAIL")
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "documented-active-endpoint",
      status: "FAIL",
      detail: expect.stringContaining("untracked"),
    }))
  })

  it("rejects an endpoint and checksum-registry disagreement", () => {
    const registry = { ...checksumRegistry }
    delete registry["014_add_recipe_yield_metadata.sql"]

    const report = validateMigrationMetadata(fixture({
      checksumRegistry: registry,
    }))

    expect(report.status).toBe("FAIL")
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "checksum-registry-coverage",
      detail: expect.stringContaining("missing: 014_add_recipe_yield_metadata.sql"),
    }))
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "documented-active-endpoint",
      detail: expect.stringContaining("absent from the checksum registry"),
    }))
  })

  it("rejects a missing tracked migration", () => {
    const report = validateMigrationMetadata(fixture({
      trackedMigrationPaths: trackedMigrationPaths.filter(
        (path) => !path.includes("002_recipe_structure_parity.sql"),
      ),
    }))

    expect(report.status).toBe("FAIL")
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "tracked-version-chain",
      status: "FAIL",
    }))
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "checksum-registry-coverage",
      detail: expect.stringContaining("stale: 002_recipe_structure_parity.sql"),
    }))
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "documented-active-chain",
      status: "FAIL",
    }))
  })

  it("rejects a stale checksum-registry entry", () => {
    const report = validateMigrationMetadata(fixture({
      checksumRegistry: {
        ...checksumRegistry,
        "015_removed_migration.sql": "b".repeat(64),
      },
    }))

    expect(report.status).toBe("FAIL")
    expect(report.checks).toContainEqual(expect.objectContaining({
      name: "checksum-registry-coverage",
      detail: expect.stringContaining("stale: 015_removed_migration.sql"),
    }))
  })
})

describe("migration PR impact", () => {
  it("distinguishes documentation-only references from migration-file changes", () => {
    const documentationOnly = classifyMigrationImpact(
      ["README.md", "docs/developer-workflow.md"],
      {
        "README.md": "Current tip: 014_add_recipe_yield_metadata.sql",
        "docs/developer-workflow.md": "No migration detail here.",
      },
    )
    const migrationChange = classifyMigrationImpact(
      ["README.md", "supabase/migrations/014_add_recipe_yield_metadata.sql"],
      { "README.md": "Current tip: 014_add_recipe_yield_metadata.sql" },
    )
    const toolingChange = classifyMigrationImpact(
      ["README.md", "web/scripts/workflow/example.mjs"],
      {
        "README.md": "Current tip: 014_add_recipe_yield_metadata.sql",
        "web/scripts/workflow/example.mjs": "const path = 'supabase/migrations/014_add_recipe_yield_metadata.sql'",
      },
    )

    expect(documentationOnly).toMatchObject({
      migrationFiles: [],
      documentationReferences: ["README.md"],
      migrationChanged: false,
      documentationOnly: true,
    })
    expect(migrationChange).toMatchObject({
      migrationFiles: ["supabase/migrations/014_add_recipe_yield_metadata.sql"],
      migrationChanged: true,
      documentationOnly: false,
    })
    expect(toolingChange).toMatchObject({
      documentationReferences: ["README.md"],
      toolingReferences: ["web/scripts/workflow/example.mjs"],
      migrationChanged: false,
      documentationOnly: false,
    })
  })
})
