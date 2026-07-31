import { describe, expect, it } from "vitest"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import {
  classifyMigrationImpact,
  parseMigrationIntegrityArgs,
  validateMigrationMetadata,
} from "./migration-integrity.mjs"
import { resolveTrustedNpmCli } from "./verification.mjs"

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

  it.each([
    [
      "migration renamed out",
      [{ filename: "archive/014.sql", previous_filename: "supabase/migrations/014_add_recipe_yield_metadata.sql", status: "renamed" }],
      true,
    ],
    [
      "migration renamed in",
      [{ filename: "supabase/migrations/015_added.sql", previous_filename: "drafts/015_added.sql", status: "renamed" }],
      true,
    ],
    [
      "migration renamed within",
      [{ filename: "supabase/migrations/014_renamed.sql", previous_filename: "supabase/migrations/014_add_recipe_yield_metadata.sql", status: "renamed" }],
      true,
    ],
    [
      "deleted migration",
      [{ filename: "supabase/migrations/014_add_recipe_yield_metadata.sql", status: "removed" }],
      true,
    ],
    [
      "copied migration",
      [{ filename: "supabase/migrations/015_copy.sql", previous_filename: "supabase/migrations/014_add_recipe_yield_metadata.sql", status: "copied" }],
      true,
    ],
    [
      "ordinary unrelated rename",
      [{ filename: "docs/new.md", previous_filename: "docs/old.md", status: "renamed", patch: "@@ -1 +1 @@\n-old\n+ordinary prose" }],
      false,
    ],
  ])("classifies %s using source and destination paths", (_label, files, expected) => {
    const result = classifyMigrationImpact(files)
    expect(result.migrationChanged).toBe(expected)
    expect(result.potentiallyImpactful).toBe(expected)
  })

  it.each([
    ["registry delete", [{ filename: "supabase/migration-checksums.json", status: "removed" }]],
    ["registry rename", [{ filename: "archive/checksums.json", previous_filename: "supabase/migration-checksums.json", status: "renamed" }]],
    ["schema authority", [{ filename: "supabase/SCHEMA.md", status: "modified", patch: "migration 014" }]],
    ["README endpoint", [{ filename: "README.md", status: "modified", patch: "014_add_recipe_yield_metadata.sql" }]],
  ])("treats %s as migration-sensitive impact", (_label, files) => {
    expect(classifyMigrationImpact(files).potentiallyImpactful).toBe(true)
  })

  it.each([
    ["developer workflow deletion", [{ filename: "docs/developer-workflow.md", status: "removed" }]],
    ["migration implementation without patch", [{ filename: "web/scripts/workflow/migration-integrity.mjs", status: "modified" }]],
    ["migration tests without patch", [{ filename: "web/scripts/workflow/migration-integrity.test.mjs", status: "modified" }]],
    ["package migration entry point", [{ filename: "web/package.json", status: "modified", patch: '"check:migration-references"' }]],
    ["trusted launcher", [{ filename: "scripts/rg-verify.ps1", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" }]],
    ["authority renamed out", [{ filename: "archive/workflow.md", previous_filename: "docs/developer-workflow.md", status: "renamed" }]],
    ["authority renamed in", [{ filename: "docs/developer-workflow.md", previous_filename: "drafts/workflow.md", status: "renamed" }]],
    ["sensitive file with absent patch", [{ filename: "web/scripts/db-preflight-core.mjs", status: "modified" }]],
  ])("conservatively classifies %s", (_label, files) => {
    const report = classifyMigrationImpact(files)
    expect(report.potentiallyImpactful).toBe(true)
    expect(report.sensitivePaths.length).toBeGreaterThan(0)
  })

  it.each([
    [{ filename: "docs/design-notes.md", status: "modified", patch: "@@ -1 +1 @@\n-old\n+ordinary prose" }],
    [{ filename: "web/scripts/workflow/state.mjs", status: "modified", patch: "@@ -1 +1 @@\n-old\n+ordinary workflow logic" }],
  ])("keeps unrelated files outside migration authority", (file) => {
    const report = classifyMigrationImpact([file])
    expect(report.potentiallyImpactful).toBe(false)
    expect(report.fileRecords[0]).toMatchObject({ evidenceComplete: true, patchComplete: true })
  })

  it.each([
    ["unknown documentation file without a patch", { filename: "docs/design-notes.md", status: "modified" }],
    ["unknown workflow file with a truncated patch", { filename: "web/scripts/workflow/state.mjs", status: "modified", patch: "@@ -1,2 +1,2 @@\n-old\n+new" }],
    ["known authority file without a patch", { filename: "web/scripts/workflow/migration-integrity.mjs", status: "modified" }],
  ])("treats %s as conservatively impactful", (_label, file) => {
    const report = classifyMigrationImpact([file])
    expect(report).toMatchObject({ conservativelyImpactful: true, potentiallyImpactful: true })
    expect(report.incompleteEvidencePaths.length).toBeGreaterThan(0)
  })

  it("distinguishes authority, content, and incomplete-evidence impact reasons", () => {
    const report = classifyMigrationImpact([
      { filename: "README.md", status: "modified", patch: "@@ -1 +1 @@\n-old\n+supabase/migrations/014_example.sql" },
      { filename: "docs/unknown.md", status: "modified" },
    ])
    expect(report.sensitivePaths).toEqual(["README.md"])
    expect(report.contentDetectedPaths).toEqual(["README.md"])
    expect(report.incompleteEvidencePaths).toEqual(["docs/unknown.md"])
  })

  it.each([
    ["rename missing previous filename", [{ filename: "docs/new.md", status: "renamed" }]],
    ["unknown status", [{ filename: "src/example.ts", status: "mystery" }]],
    ["malformed current path", [{ filename: "../outside.md", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" }]],
    ["malformed previous path", [{ filename: "docs/new.md", previous_filename: "C:\\outside.md", status: "renamed", patch: "@@ -1 +1 @@\n-old\n+new" }]],
  ])("fails closed for %s", (_label, files) => {
    const result = classifyMigrationImpact(files)
    expect(result.malformedFileRecords).toHaveLength(1)
    expect(result.migrationChanged).toBe(true)
    expect(result.potentiallyImpactful).toBe(true)
  })
})

describe("migration-integrity CLI schema", () => {
  it("accepts only the documented optional JSON flag", () => {
    expect(parseMigrationIntegrityArgs([])).toEqual({ json: false })
    expect(parseMigrationIntegrityArgs(["--json"])).toEqual({ json: true })
  })

  it.each([
    [["--json", "--json"]],
    [["--unknown"]],
    [["positional"]],
  ])("rejects %j", (argv) => {
    expect(() => parseMigrationIntegrityArgs(argv)).toThrow()
  })

  it.each([
    ["unknown option", ["--json", "--unknown"]],
    ["duplicate json", ["--json", "--json"]],
    ["unexpected positional", ["--json", "unexpected"]],
  ])("emits one JSON error document for %s", (_label, args) => {
    const scriptDirectory = dirname(fileURLToPath(import.meta.url))
    const child = spawnSync(process.execPath, [resolve(scriptDirectory, "migration-integrity.mjs"), ...args], {
      encoding: "utf8",
      shell: false,
    })
    expect(child.status).not.toBe(0)
    expect(child.stderr).toBe("")
    expect(JSON.parse(child.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "migration-integrity",
      status: "FAIL",
      error: { category: "ARGUMENT" },
    })
  })

  it("keeps documented silent npm JSON output uncontaminated", () => {
    const scriptDirectory = dirname(fileURLToPath(import.meta.url))
    const webDirectory = resolve(scriptDirectory, "..", "..")
    const npmCli = resolveTrustedNpmCli()
    const child = spawnSync(process.execPath, [
      npmCli,
      "run",
      "--silent",
      "check:migration-references",
      "--",
      "--json",
    ], {
      cwd: webDirectory,
      encoding: "utf8",
      shell: false,
      env: process.env,
    })
    expect(child.status).toBe(0)
    expect(child.stderr).toBe("")
    expect(JSON.parse(child.stdout)).toMatchObject({ schemaVersion: 1, status: "PASS" })
  })
})
