import { readFile } from "node:fs/promises"
import { dirname, basename, join, resolve } from "node:path"
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

function normalizePath(value) {
  return value.replaceAll("\\", "/")
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

export function classifyMigrationImpact(changedFiles, contentsByPath = {}) {
  const normalizedFiles = [...new Set(changedFiles.map(normalizePath))].sort()
  const migrationFiles = normalizedFiles.filter(directMigrationFilename)
  const referenceFiles = normalizedFiles.filter((path) => {
    if (migrationFiles.includes(path)) return false
    const contents = contentsByPath[path] ?? ""
    return /(?:supabase\/migrations\/)?\d{3}_[a-z0-9_]+\.sql/iu.test(contents)
      || /supabase\/migrations\//iu.test(contents)
  })
  const documentationReferences = referenceFiles.filter(
    (path) => path.endsWith(".md"),
  )
  const toolingReferences = referenceFiles.filter(
    (path) => !path.endsWith(".md"),
  )

  return {
    migrationFiles,
    checksumRegistryChanged: normalizedFiles.includes(
      "supabase/migration-checksums.json",
    ),
    referenceFiles,
    documentationReferences,
    toolingReferences,
    migrationChanged: migrationFiles.length > 0,
    documentationOnly: migrationFiles.length === 0
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

async function main(argv = process.argv.slice(2)) {
  if (argv.some((argument) => !["--json"].includes(argument))) {
    throw new Error("Usage: npm run check:migration-references -- [--json]")
  }
  const report = await collectMigrationIntegrity()
  process.stdout.write(
    argv.includes("--json")
      ? renderMigrationIntegrityJson(report)
      : `${renderMigrationIntegrityText(report)}\n`,
  )
  if (report.status === "FAIL") process.exitCode = 1
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
