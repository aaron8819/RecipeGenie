import { readFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadMigrationDirectory } from "../db-preflight-core.mjs"
import { assertSafeOutput, assertSecretSafe } from "./state.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, "..", "..")
const repositoryRoot = resolve(webDirectory, "..")
const migrationDirectory = join(repositoryRoot, "supabase", "migrations")
const checksumRegistryPath = join(
  repositoryRoot,
  "supabase",
  "migration-checksums.json",
)
const MIGRATION_INTEGRITY_USAGE = "migration-integrity.mjs [--json]"
const MIGRATION_AUTHORITY_PATHS = new Set([
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "README.md",
  "docs/developer-workflow.md",
  "scripts/rg-verify.ps1",
  "supabase/config.toml",
  "supabase/SCHEMA.md",
  "supabase/migration-checksums.json",
  "web/package.json",
  "web/scripts/db-preflight-core.mjs",
  "web/scripts/db-preflight.mjs",
  "web/scripts/db-preflight.test.mjs",
  "web/scripts/operational/production-checks.mjs",
  "web/scripts/operational/production-checks.test.mjs",
  "web/scripts/verify-production.mjs",
  "web/scripts/verify-production.test.mjs",
  "web/scripts/workflow/context.mjs",
  "web/scripts/workflow/context.test.mjs",
  "web/scripts/workflow/doctor.mjs",
  "web/scripts/workflow/doctor.test.mjs",
  "web/scripts/workflow/migration-integrity.mjs",
  "web/scripts/workflow/migration-integrity.test.mjs",
  "web/scripts/workflow/policy.mjs",
  "web/scripts/workflow/policy.test.mjs",
  "web/scripts/workflow/pr-evidence.mjs",
  "web/scripts/workflow/pr-evidence.test.mjs",
  "web/scripts/workflow/release-status.mjs",
  "web/scripts/workflow/release-status.test.mjs",
  "web/scripts/workflow/verification.mjs",
  "web/scripts/workflow/verification.test.mjs",
  "web/src/app/api/version/route.ts",
  "web/src/app/api/version/route.test.ts",
  "web/src/lib/deployment-manifest.ts",
  "web/src/lib/__tests__/deployment-manifest.test.ts",
])
const MIGRATION_AUTHORITY_PREFIXES = [
  "scripts/database/",
  "supabase/migrations/",
  "supabase/tests/",
  "supabase/verification/",
  "web/scripts/fixtures/db-preflight/",
]

function normalizePath(value) {
  return value.replaceAll("\\", "/")
}

function validRepositoryPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.startsWith("/")
    && !/^[A-Za-z]:\//u.test(value)
    && !/[\0\r\n]/u.test(value)
    && !value.split("/").includes("..")
}

function directMigrationFilename(path) {
  const normalized = normalizePath(path)
  const match = normalized.match(/^supabase\/migrations\/([^/]+\.sql)$/u)
  return match?.[1] ?? null
}

function compareMigrationFilenames(left, right) {
  const leftVersion = BigInt(left.match(/^(\d+)_/u)?.[1] ?? "0")
  const rightVersion = BigInt(right.match(/^(\d+)_/u)?.[1] ?? "0")
  if (leftVersion !== rightVersion) return leftVersion < rightVersion ? -1 : 1
  return left.localeCompare(right, "en")
}

function addCheck(checks, name, status, detail) {
  checks.push({ name, status, detail })
}

function exactSetDifference(left, right) {
  const rightSet = new Set(right)
  return left.filter((value) => !rightSet.has(value))
}

function runtimeIdentity() {
  const npmExecPath = process.env.npm_execpath
  const npmNodeExecPath = process.env.npm_node_execpath
  const expectedNpmLocations = [
    resolve(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ]
  let npm = null
  try {
    npm = JSON.parse(
      readFileSync(resolve(dirname(npmExecPath), "..", "package.json"), "utf8"),
    ).version
  } catch {
    // Runtime validation reports a null npm version.
  }
  const platformShell = process.platform === "win32"
    ? resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe")
    : "/bin/sh"
  return {
    node: process.versions.node,
    npm,
    nodeExecutableMatchesLifecycle: Boolean(npmNodeExecPath)
      && resolve(npmNodeExecPath) === resolve(process.execPath),
    npmExecutableBundledWithNode: Boolean(npmExecPath)
      && expectedNpmLocations.some((candidate) => resolve(npmExecPath) === candidate),
    scriptShellTrusted: Boolean(process.env.npm_config_script_shell)
      && resolve(process.env.npm_config_script_shell) === resolve(platformShell),
  }
}

export function validateMigrationMetadata({
  trackedMigrationPaths,
  checksumRegistry,
  readme,
  schema,
}) {
  const checks = []
  const trackedFilenames = trackedMigrationPaths
    .map(directMigrationFilename)
    .filter(Boolean)
    .sort(compareMigrationFilenames)
  const registryFilenames = Object.keys(checksumRegistry ?? {})
    .sort(compareMigrationFilenames)

  const trackedVersions = trackedFilenames.map(
    (filename) => filename.match(/^(\d{3})_[a-z0-9_]+\.sql$/u)?.[1] ?? null,
  )
  const versionChainValid = trackedVersions.length > 0
    && trackedVersions.every((version, index) => (
      version !== null
      && BigInt(version) === BigInt(index + 1)
    ))
  addCheck(
    checks,
    "tracked-version-chain",
    versionChainValid ? "PASS" : "FAIL",
    versionChainValid
      ? `Tracked active migration versions are contiguous through ${trackedVersions.at(-1)}.`
      : "Tracked active migration filenames are malformed, duplicated, reordered, or missing a version.",
  )

  const missingFromRegistry = exactSetDifference(
    trackedFilenames,
    registryFilenames,
  )
  const staleRegistryEntries = exactSetDifference(
    registryFilenames,
    trackedFilenames,
  )
  if (missingFromRegistry.length || staleRegistryEntries.length) {
    addCheck(
      checks,
      "checksum-registry-coverage",
      "FAIL",
      [
        missingFromRegistry.length
          ? `missing: ${missingFromRegistry.join(", ")}`
          : null,
        staleRegistryEntries.length
          ? `stale: ${staleRegistryEntries.join(", ")}`
          : null,
      ].filter(Boolean).join("; "),
    )
  } else {
    addCheck(
      checks,
      "checksum-registry-coverage",
      "PASS",
      `Registry exactly covers ${trackedFilenames.length} tracked active migrations.`,
    )
  }

  const activeFilename = trackedFilenames.at(-1) ?? null
  if (!activeFilename) {
    addCheck(
      checks,
      "documented-active-endpoint",
      "FAIL",
      "No tracked active migration file exists.",
    )
  } else {
    const documentedEndpoint = readme?.match(
      /currently\s+`[^`]+`\s+through\s+`(?:supabase\/migrations\/)?([^`/]+\.sql)`/isu,
    )?.[1]
    if (!documentedEndpoint) {
      addCheck(
        checks,
        "documented-active-endpoint",
        "FAIL",
        "README does not name the active migration endpoint.",
      )
    } else if (!trackedFilenames.includes(documentedEndpoint)) {
      addCheck(
        checks,
        "documented-active-endpoint",
        "FAIL",
        `README names an untracked active endpoint: ${documentedEndpoint}.`,
      )
    } else if (!registryFilenames.includes(documentedEndpoint)) {
      addCheck(
        checks,
        "documented-active-endpoint",
        "FAIL",
        `README endpoint is absent from the checksum registry: ${documentedEndpoint}.`,
      )
    } else if (documentedEndpoint !== activeFilename) {
      addCheck(
        checks,
        "documented-active-endpoint",
        "FAIL",
        `README endpoint ${documentedEndpoint} disagrees with tracked tip ${activeFilename}.`,
      )
    } else {
      addCheck(
        checks,
        "documented-active-endpoint",
        "PASS",
        `README endpoint matches tracked and registered tip ${activeFilename}.`,
      )
    }
  }

  const activeSection = schema?.match(
    /### Current Active Migration Chain\s+([\s\S]*?)(?=\n###\s)/u,
  )?.[1] ?? ""
  const documentedChain = [...activeSection.matchAll(
    /`supabase\/migrations\/([^`/]+\.sql)`/gu,
  )].map((match) => match[1])
  const chainMatches = documentedChain.length === trackedFilenames.length
    && documentedChain.every(
      (filename, index) => filename === trackedFilenames[index],
    )
  if (!chainMatches) {
    addCheck(
      checks,
      "documented-active-chain",
      "FAIL",
      "SCHEMA.md active chain does not exactly match tracked active migrations.",
    )
  } else {
    addCheck(
      checks,
      "documented-active-chain",
      "PASS",
      `SCHEMA.md lists all ${trackedFilenames.length} tracked active migrations in order.`,
    )
  }

  const documentedTipVersion = schema?.match(
    /current authoritative chain ends at migration\s+(\d+)/iu,
  )?.[1]
  const activeVersion = activeFilename?.match(/^(\d+)_/u)?.[1] ?? null
  if (!documentedTipVersion || documentedTipVersion !== activeVersion) {
    addCheck(
      checks,
      "documented-tip-version",
      "FAIL",
      `SCHEMA.md tip version ${documentedTipVersion ?? "is missing"}; tracked tip is ${activeVersion ?? "missing"}.`,
    )
  } else {
    addCheck(
      checks,
      "documented-tip-version",
      "PASS",
      `SCHEMA.md tip version matches migration ${activeVersion}.`,
    )
  }

  return {
    status: checks.some((check) => check.status === "FAIL") ? "FAIL" : "PASS",
    activeFilename,
    trackedFilenames,
    checks,
  }
}

const GITHUB_FILE_STATUSES = new Set([
  "added", "changed", "copied", "modified", "removed", "renamed", "unchanged",
])

function normalizeChangedFile(value) {
  if (typeof value === "string") {
    return { filename: normalizePath(value), previousFilename: null, status: "modified", patch: null }
  }
  const filename = typeof value?.filename === "string"
    ? normalizePath(value.filename)
    : ""
  const rawPreviousFilename = value?.previous_filename ?? value?.previousFilename
  return {
    filename,
    previousFilename: typeof rawPreviousFilename === "string" && rawPreviousFilename
      ? normalizePath(rawPreviousFilename)
      : null,
    status: value?.status ?? null,
    patch: typeof value?.patch === "string" ? value.patch : null,
  }
}

function migrationSensitivePath(path) {
  return Boolean(path) && (
    MIGRATION_AUTHORITY_PATHS.has(path)
    || MIGRATION_AUTHORITY_PREFIXES.some((prefix) => path.startsWith(prefix))
    || /^web\/scripts\/run-migration\d+-preflight-parity(?:\.test)?\.mjs$/u.test(path)
  )
}

function completeUnifiedPatch(patch) {
  if (typeof patch !== "string" || !patch) return false
  const lines = patch.split(/\r?\n/u)
  let hunkFound = false
  let expectedOld = 0
  let expectedNew = 0
  let actualOld = 0
  let actualNew = 0
  const hunkComplete = () => actualOld === expectedOld && actualNew === expectedNew
  for (const line of lines) {
    const header = line.match(/^@@ -(?:\d+)(?:,(\d+))? \+(?:\d+)(?:,(\d+))? @@/u)
    if (header) {
      if (hunkFound && !hunkComplete()) return false
      hunkFound = true
      expectedOld = header[1] === undefined ? 1 : Number(header[1])
      expectedNew = header[2] === undefined ? 1 : Number(header[2])
      actualOld = 0
      actualNew = 0
      continue
    }
    if (!hunkFound || line.startsWith("\\ No newline at end of file")) continue
    if (line === "" && hunkComplete()) continue
    if (line.startsWith("+")) actualNew += 1
    else if (line.startsWith("-")) actualOld += 1
    else if (line.startsWith(" ")) {
      actualOld += 1
      actualNew += 1
    } else {
      return false
    }
    if (actualOld > expectedOld || actualNew > expectedNew) return false
  }
  return hunkFound && hunkComplete()
}

export function classifyMigrationImpact(changedFiles, contentsByPath = {}) {
  const records = changedFiles.map(normalizeChangedFile)
  const normalizedFiles = [...new Set(records.map((item) => item.filename))].sort()
  const malformedFileRecords = records.filter((item) => (
    !validRepositoryPath(item.filename)
    || !GITHUB_FILE_STATUSES.has(item.status)
    || (item.previousFilename !== null && !validRepositoryPath(item.previousFilename))
    || (["renamed", "copied"].includes(item.status) && !item.previousFilename)
  ))
  const involvedPaths = [...new Set(records.flatMap(
    (item) => [item.filename, item.previousFilename].filter(Boolean),
  ))].sort()
  const migrationFiles = involvedPaths.filter(directMigrationFilename)
  const referenceFiles = normalizedFiles.filter((path) => {
    if (migrationFiles.includes(path)) return false
    const record = records.find((item) => item.filename === path)
    const contents = Object.hasOwn(contentsByPath, path)
      ? contentsByPath[path]
      : record?.patch ?? ""
    return /(?:supabase\/migrations\/)?\d{3}_[a-z0-9_]+\.sql/iu.test(contents)
      || /supabase\/migrations\//iu.test(contents)
  })
  const documentationReferences = referenceFiles.filter(
    (path) => path.endsWith(".md"),
  )
  const toolingReferences = referenceFiles.filter(
    (path) => !path.endsWith(".md"),
  )

  const sensitivePaths = involvedPaths.filter(migrationSensitivePath)
  const fileRecords = records.map(({ patch, ...item }) => {
    const completeContent = Object.hasOwn(contentsByPath, item.filename)
      && typeof contentsByPath[item.filename] === "string"
    const patchComplete = completeUnifiedPatch(patch)
    return {
      ...item,
      patchAvailable: patch !== null,
      patchComplete,
      evidenceComplete: completeContent || patchComplete,
    }
  })
  const incompleteEvidencePaths = [...new Set(fileRecords
    .filter((item) => !item.evidenceComplete)
    .flatMap((item) => [item.filename, item.previousFilename].filter(Boolean)))]
    .sort()
  const contentDetectedPaths = [...referenceFiles]
  const conservativelyImpactful = malformedFileRecords.length > 0
    || incompleteEvidencePaths.length > 0
  return {
    fileRecords,
    migrationFiles,
    sensitivePaths,
    contentDetectedPaths,
    incompleteEvidencePaths,
    conservativelyImpactful,
    malformedFileRecords,
    checksumRegistryChanged: sensitivePaths.includes("supabase/migration-checksums.json"),
    referenceFiles,
    documentationReferences,
    toolingReferences,
    migrationChanged: migrationFiles.length > 0 || conservativelyImpactful,
    potentiallyImpactful: sensitivePaths.length > 0
      || contentDetectedPaths.length > 0
      || conservativelyImpactful,
    documentationOnly: migrationFiles.length === 0
      && !conservativelyImpactful
      && documentationReferences.length > 0
      && normalizedFiles.every((path) => path.endsWith(".md")),
  }
}

function runGit(args, cwd = repositoryRoot) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) {
    throw new Error("Git could not enumerate tracked migration files.")
  }
  return result.stdout
}

export async function collectMigrationIntegrity(options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot
  const registryPath = options.checksumRegistryPath
    ?? join(root, "supabase", "migration-checksums.json")
  const migrationsPath = options.migrationDirectory
    ?? join(root, "supabase", "migrations")
  const trackedOutput = options.trackedMigrationPaths
    ? options.trackedMigrationPaths.join("\n")
    : runGit(["ls-files", "--", "supabase/migrations/*.sql"], root)
  const trackedMigrationPaths = trackedOutput.split(/\r?\n/u).filter(Boolean)
  const checksumRegistry = options.checksumRegistry ?? JSON.parse(
    await readFile(registryPath, "utf8"),
  )
  const readme = options.readme ?? await readFile(join(root, "README.md"), "utf8")
  const schema = options.schema ?? await readFile(
    join(root, "supabase", "SCHEMA.md"),
    "utf8",
  )
  const report = validateMigrationMetadata({
    trackedMigrationPaths,
    checksumRegistry,
    readme,
    schema,
  })

  try {
    const migrations = await loadMigrationDirectory(
      migrationsPath,
      checksumRegistry,
    )
    addCheck(
      report.checks,
      "migration-file-checksums",
      "PASS",
      `All ${migrations.length} active migration files match the checksum registry.`,
    )
  } catch (error) {
    addCheck(
      report.checks,
      "migration-file-checksums",
      "FAIL",
      error instanceof Error ? error.message : "Migration checksums are invalid.",
    )
    report.status = "FAIL"
  }

  report.schemaVersion = 1
  report.runtime = runtimeIdentity()
  assertSecretSafe(report, "migration integrity report")
  return report
}

export function renderMigrationIntegrityText(report) {
  return [
    `Migration reference integrity: ${report.status}`,
    `Active migration: ${report.activeFilename ?? "UNAVAILABLE"}`,
    ...report.checks.map(
      (check) => `- ${check.name}: ${check.status} - ${check.detail}`,
    ),
  ].join("\n")
}

export function renderMigrationIntegrityJson(report) {
  const output = `${JSON.stringify(report, null, 2)}\n`
  assertSafeOutput(output)
  return output
}

export function parseMigrationIntegrityArgs(argv) {
  if (argv.some((argument) => argument !== "--json") || argv.filter((argument) => argument === "--json").length > 1) {
    throw new Error(`Usage: ${MIGRATION_INTEGRITY_USAGE}`)
  }
  return { json: argv.includes("--json") }
}

async function main(argv = process.argv.slice(2)) {
  const jsonRequested = argv.includes("--json")
  try {
    const options = parseMigrationIntegrityArgs(argv)
    const report = await collectMigrationIntegrity()
    process.stdout.write(
      options.json
        ? renderMigrationIntegrityJson(report)
        : `${renderMigrationIntegrityText(report)}\n`,
    )
    if (report.status === "FAIL") process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration integrity failed."
    if (jsonRequested) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        command: "migration-integrity",
        status: "FAIL",
        error: {
          code: message.startsWith("Usage:") ? "ARGUMENT_ERROR" : "RUNTIME_ERROR",
          category: message.startsWith("Usage:") ? "ARGUMENT" : "RUNTIME",
          message,
          usage: MIGRATION_INTEGRITY_USAGE,
        },
      }, null, 2)}\n`)
    } else {
      process.stderr.write(`${message}\n`)
    }
    process.exitCode = 1
  }
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main()
}
