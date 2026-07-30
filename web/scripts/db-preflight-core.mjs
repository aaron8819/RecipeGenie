import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

export class MigrationPreflightError extends Error {
  constructor(category, message) {
    super(message)
    this.name = "MigrationPreflightError"
    this.category = category
  }
}

function invalidConfiguration(message) {
  throw new MigrationPreflightError("invalid-configuration", message)
}

function drift(message) {
  throw new MigrationPreflightError("drift", message)
}

export function parseExpectedPendingOption(argv, npmExpectedPending) {
  const npmFlagWithoutValue = npmExpectedPending === "true"
  let expectedPending = npmFlagWithoutValue ? undefined : npmExpectedPending
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--help" || argument === "-h") {
      help = true
      continue
    }
    if (argument === "--expected-pending") {
      if (expectedPending !== undefined) {
        invalidConfiguration("`--expected-pending` must be supplied at most once.")
      }
      const value = argv[index + 1]
      if (!value || value.startsWith("-")) {
        invalidConfiguration("`--expected-pending` requires one migration version.")
      }
      expectedPending = value
      index += 1
      continue
    }
    if (argument.startsWith("--expected-pending=")) {
      if (expectedPending !== undefined) {
        invalidConfiguration("`--expected-pending` must be supplied at most once.")
      }
      expectedPending = argument.slice("--expected-pending=".length)
      if (!expectedPending) {
        invalidConfiguration("`--expected-pending` requires one migration version.")
      }
      continue
    }
    if (argv.length === 1 && expectedPending === undefined && !argument.startsWith("-")) {
      expectedPending = argument
      continue
    }
    invalidConfiguration(`unexpected argument: ${argument}`)
  }

  if (npmFlagWithoutValue && expectedPending === undefined) {
    invalidConfiguration("`--expected-pending` requires one migration version.")
  }
  if (expectedPending !== undefined && !/^\d+$/u.test(expectedPending)) {
    invalidConfiguration(
      "`--expected-pending` must be one numeric migration version, such as `014`.",
    )
  }

  return { expectedPending, help }
}

function stripTableCell(value) {
  return value
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replaceAll("`", "")
    .trim()
}

export function parseMigrationList(output) {
  try {
    const parsed = JSON.parse(output)
    if (Array.isArray(parsed?.migrations)) {
      return parsed.migrations.map((row) => ({
        local: String(row.local ?? "").trim(),
        remote: String(row.remote ?? "").trim(),
      }))
    }
  } catch {
    // The pinned CLI emits a table by default.
  }

  return output
    .split(/\r?\n/u)
    .map((line) => {
      let tableLine = line
        .replace(/\u001b\[[0-9;]*m/gu, "")
        .trim()
      if (/^[|│]/u.test(tableLine) && /[|│]$/u.test(tableLine)) {
        tableLine = tableLine.slice(1, -1)
      }
      const match = tableLine.match(
        /^\s*([^|│]*?)\s*[|│]\s*([^|│]*?)\s*[|│]\s*([^|│]*?)\s*$/u,
      )
      return match
        ? { local: stripTableCell(match[1]), remote: stripTableCell(match[2]) }
        : null
    })
    .filter(Boolean)
    .filter((row) => (
      row.local !== "Local"
      && row.remote !== "Remote"
      && !/^-+$/u.test(row.local)
      && !/^-+$/u.test(row.remote)
      && (row.local || row.remote)
    ))
}

function checksumMigration(contents) {
  return createHash("sha256")
    .update(contents.replace(/\r\n/gu, "\n"))
    .digest("hex")
}

export async function loadMigrationDirectory(directory, checksumRegistry) {
  if (
    !checksumRegistry
    || typeof checksumRegistry !== "object"
    || Array.isArray(checksumRegistry)
  ) {
    drift("migration checksum registry is missing or malformed")
  }

  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "en"))

  const registeredFilenames = Object.keys(checksumRegistry).sort(
    (left, right) => left.localeCompare(right, "en"),
  )
  if (
    registeredFilenames.length !== filenames.length
    || registeredFilenames.some((filename, index) => filename !== filenames[index])
  ) {
    drift("migration checksum registry does not exactly match active migration files")
  }

  const migrations = []
  for (const filename of filenames) {
    const match = filename.match(/^(\d+)_(.+)\.sql$/u)
    if (!match) drift(`malformed migration filename: ${filename}`)
    const contents = await readFile(join(directory, filename), "utf8")
    if (!contents.trim()) drift(`migration ${match[1]} is empty`)
    const checksum = checksumMigration(contents)
    const expectedChecksum = checksumRegistry[filename]
    if (!/^[0-9a-f]{64}$/u.test(expectedChecksum ?? "")) {
      drift(`migration checksum registry entry is invalid for ${filename}`)
    }
    if (checksum !== expectedChecksum) {
      drift(`migration ${match[1]} has checksum drift from the repository registry`)
    }
    migrations.push({
      version: match[1],
      name: match[2],
      checksum,
      statementCount: 1,
    })
  }
  return migrations
}

function validateChain(migrations, label) {
  if (migrations.length === 0) drift(`${label} migration history is empty`)

  const versions = new Set()
  for (let index = 0; index < migrations.length; index += 1) {
    const migration = migrations[index]
    if (!/^\d+$/u.test(migration.version)) {
      drift(`${label} contains malformed migration version ${migration.version}`)
    }
    if (!migration.name || !migration.checksum || migration.statementCount < 1) {
      drift(`${label} migration ${migration.version} is partially recorded`)
    }
    if (versions.has(migration.version)) {
      drift(`${label} contains duplicate migration ${migration.version}`)
    }
    versions.add(migration.version)

    if (index > 0) {
      const previous = migrations[index - 1]
      if (BigInt(migration.version) <= BigInt(previous.version)) {
        drift(
          `${label} migrations are reordered at ${previous.version}/${migration.version}`,
        )
      }
      if (
        migration.version.length === 3
        && previous.version.length === 3
        && BigInt(migration.version) !== BigInt(previous.version) + 1n
      ) {
        drift(
          `${label} migration history has a gap between `
          + `${previous.version} and ${migration.version}`,
        )
      }
    }
  }
}

function assertExpectedPending(expectedPending, localMigrations) {
  if (expectedPending === undefined) return
  const matches = localMigrations.filter(
    (migration) => migration.version === expectedPending,
  )
  if (matches.length !== 1) {
    invalidConfiguration(
      `expected pending migration ${expectedPending} must identify exactly one local migration`,
    )
  }
  const tail = localMigrations.at(-1).version
  if (tail !== expectedPending) {
    invalidConfiguration(
      `expected pending migration ${expectedPending} is not the local tail (${tail})`,
    )
  }
}

export function analyzeMigrationState({
  localMigrations,
  remoteMigrations,
  expectedPending,
}) {
  validateChain(localMigrations, "local")
  validateChain(remoteMigrations, "remote")
  assertExpectedPending(expectedPending, localMigrations)

  const sharedLength = Math.min(localMigrations.length, remoteMigrations.length)
  for (let index = 0; index < sharedLength; index += 1) {
    const local = localMigrations[index]
    const remote = remoteMigrations[index]
    if (local.version !== remote.version) {
      drift(
        `migration identifiers diverge at position ${index + 1}: `
        + `local=${local.version}, remote=${remote.version}`,
      )
    }
    if (local.checksum !== remote.checksum) {
      drift(`migration ${local.version} has checksum drift`)
    }
  }

  if (remoteMigrations.length > localMigrations.length) {
    const remoteOnly = remoteMigrations
      .slice(localMigrations.length)
      .map((migration) => migration.version)
    drift(`remote-only migrations detected: ${remoteOnly.join(", ")}`)
  }

  const localOnly = localMigrations
    .slice(remoteMigrations.length)
    .map((migration) => migration.version)

  if (expectedPending === undefined) {
    if (localOnly.length > 0) {
      drift(`local-only migrations detected: ${localOnly.join(", ")}`)
    }
    return { status: "aligned", latest: localMigrations.at(-1).version }
  }

  if (localOnly.length !== 1 || localOnly[0] !== expectedPending) {
    drift(
      `expected sole pending migration ${expectedPending}, `
      + `but local-only migrations are ${localOnly.join(", ") || "(none)"}`,
    )
  }

  return {
    status: "expected-pending",
    expectedPending,
    latestRemote: remoteMigrations.at(-1).version,
  }
}

function listedVersions(rows, field) {
  return rows.map((row) => row[field]).filter(Boolean)
}

function assertVersionsEqual(actual, expected, label) {
  if (
    actual.length !== expected.length
    || actual.some((version, index) => version !== expected[index])
  ) {
    drift(`${label} versions from \`supabase migration list\` are inconsistent`)
  }
}

export function migrationsFromList(rows, localMigrations) {
  if (rows.length === 0) {
    drift("no migration rows were parsed from `supabase migration list`")
  }
  assertVersionsEqual(
    listedVersions(rows, "local"),
    localMigrations.map((migration) => migration.version),
    "local",
  )

  const localByVersion = new Map(
    localMigrations.map((migration) => [migration.version, migration]),
  )
  return listedVersions(rows, "remote").map((version) => (
    localByVersion.get(version) ?? {
      version,
      name: `remote_${version}`,
      checksum: `remote-only-${version}`,
      statementCount: 1,
    }
  ))
}
