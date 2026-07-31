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

export function parseExpectedPendingOption(argv) {
  let expectedPending
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
    invalidConfiguration(`unexpected argument: ${argument}`)
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
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replaceAll("`", "")
    .trim()
}

function validateMigrationListRow(row, rowNumber) {
  const expectedFields = ["local", "remote", "time"]
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    drift(`migration-list row ${rowNumber} is malformed`)
  }

  const fields = Object.keys(row).sort()
  if (
    fields.length !== expectedFields.length
    || fields.some((field, index) => field !== expectedFields[index])
  ) {
    drift(`migration-list row ${rowNumber} must contain exactly three cells`)
  }

  if (expectedFields.some((field) => typeof row[field] !== "string")) {
    drift(`migration-list row ${rowNumber} contains a missing or invalid cell`)
  }

  const parsed = {
    local: stripTableCell(row.local),
    remote: stripTableCell(row.remote),
    time: stripTableCell(row.time),
  }
  if (!parsed.local && !parsed.remote) {
    drift(`migration-list row ${rowNumber} has no local or remote version`)
  }
  if (!parsed.time) {
    drift(`migration-list row ${rowNumber} is missing its time cell`)
  }
  for (const field of ["local", "remote"]) {
    if (parsed[field] && !/^\d+$/u.test(parsed[field])) {
      drift(
        `migration-list row ${rowNumber} has malformed ${field} version `
        + parsed[field],
      )
    }
  }
  return parsed
}

function parseJsonMigrationList(output) {
  let parsed
  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }

  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || !Array.isArray(parsed.migrations)
  ) {
    drift("migration-list JSON is missing its migrations array")
  }
  const rootFields = Object.keys(parsed).sort()
  if (
    rootFields.length !== 2
    || rootFields[0] !== "message"
    || rootFields[1] !== "migrations"
    || typeof parsed.message !== "string"
  ) {
    drift("migration-list JSON has an ambiguous response shape")
  }
  return parsed.migrations.map((row, index) => (
    validateMigrationListRow(row, index + 1)
  ))
}

function splitTableRow(line, rowNumber) {
  let cells = line
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .trim()
    .split(/[|│┼]/u)
    .map(stripTableCell)

  if (cells[0] === "" && cells.at(-1) === "") {
    cells = cells.slice(1, -1)
  }
  if (cells.length !== 3) {
    drift(`migration-list table row ${rowNumber} must contain exactly three cells`)
  }
  return cells
}

function isSeparatorCell(cell) {
  return /^[-─—=]+$/u.test(cell)
}

function parseTableMigrationList(output) {
  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 3) {
    drift("migration-list table is missing its header, separator, or rows")
  }

  const header = splitTableRow(lines[0], 1).map((cell) => cell.toLowerCase())
  if (
    header[0] !== "local"
    || header[1] !== "remote"
    || header[2] !== "time (utc)"
  ) {
    drift("migration-list table header is missing or ambiguous")
  }

  const separator = splitTableRow(lines[1], 2)
  if (!separator.every(isSeparatorCell)) {
    drift("migration-list table separator is malformed")
  }

  return lines.slice(2).map((line, index) => {
    const [local, remote, time] = splitTableRow(line, index + 3)
    return validateMigrationListRow(
      { local, remote, time },
      index + 1,
    )
  })
}

export function parseMigrationList(output) {
  if (typeof output !== "string" || !output.trim()) {
    drift("no output was returned by `supabase migration list`")
  }
  const jsonRows = parseJsonMigrationList(output)
  const rows = jsonRows ?? parseTableMigrationList(output)
  if (rows.length === 0) {
    drift("no migration rows were parsed from `supabase migration list`")
  }
  return rows
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
    })
  }
  return migrations
}

function validateVersionChain(versions, label) {
  if (versions.length === 0) drift(`${label} migration history is empty`)

  const seen = new Set()
  for (let index = 0; index < versions.length; index += 1) {
    const version = versions[index]
    if (!/^\d+$/u.test(version)) {
      drift(`${label} contains malformed migration version ${version}`)
    }
    if (seen.has(version)) {
      drift(`${label} contains duplicate migration ${version}`)
    }
    seen.add(version)

    if (index > 0) {
      const previous = versions[index - 1]
      if (BigInt(version) <= BigInt(previous)) {
        drift(
          `${label} migrations are reordered at ${previous}/${version}`,
        )
      }
      if (
        version.length === 3
        && previous.length === 3
        && BigInt(version) !== BigInt(previous) + 1n
      ) {
        drift(
          `${label} migration history has a gap between `
          + `${previous} and ${version}`,
        )
      }
    }
  }
}

function validateLocalMigrations(migrations) {
  validateVersionChain(
    migrations.map((migration) => migration.version),
    "local",
  )
  for (const migration of migrations) {
    if (!migration.name || !/^[0-9a-f]{64}$/u.test(migration.checksum ?? "")) {
      drift(`local migration ${migration.version} has incomplete file metadata`)
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
  migrationRows,
  expectedPending,
}) {
  validateLocalMigrations(localMigrations)
  assertExpectedPending(expectedPending, localMigrations)

  if (!Array.isArray(migrationRows) || migrationRows.length === 0) {
    drift("no migration rows were provided for analysis")
  }

  const listedLocal = migrationRows
    .filter((row) => row.local)
    .map((row) => row.local)
  assertVersionsEqual(
    listedLocal,
    localMigrations.map((migration) => migration.version),
    "local",
  )

  const remoteVersions = migrationRows
    .filter((row) => row.remote)
    .map((row) => row.remote)
  validateVersionChain(remoteVersions, "remote")

  for (let index = 0; index < migrationRows.length; index += 1) {
    const row = migrationRows[index]
    if (row.local && row.remote && row.local !== row.remote) {
      drift(
        `migration identifiers diverge at row ${index + 1}: `
        + `local=${row.local}, remote=${row.remote}`,
      )
    }
  }

  const remoteOnly = migrationRows
    .filter((row) => !row.local && row.remote)
    .map((row) => row.remote)
  if (remoteOnly.length > 0) {
    drift(`remote-only migrations detected: ${remoteOnly.join(", ")}`)
  }

  const localOnlyRows = migrationRows
    .map((row, index) => ({ ...row, index }))
    .filter((row) => row.local && !row.remote)
  const localOnly = localOnlyRows.map((row) => row.local)

  if (expectedPending === undefined) {
    if (localOnly.length > 0) {
      drift(`local-only migrations detected: ${localOnly.join(", ")}`)
    }
    return { status: "aligned", latest: localMigrations.at(-1).version }
  }

  if (
    localOnlyRows.length !== 1
    || localOnlyRows[0].local !== expectedPending
    || localOnlyRows[0].index !== migrationRows.length - 1
  ) {
    drift(
      `expected sole pending migration ${expectedPending}, `
      + `but local-only migrations are ${localOnly.join(", ") || "(none)"}`,
    )
  }

  return {
    status: "expected-pending",
    expectedPending,
    latestRemote: remoteVersions.at(-1),
  }
}

function assertVersionsEqual(actual, expected, label) {
  if (
    actual.length !== expected.length
    || actual.some((version, index) => version !== expected[index])
  ) {
    drift(`${label} versions from \`supabase migration list\` are inconsistent`)
  }
}
