import { createHash } from "node:crypto"
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as preflightCore from "./db-preflight-core.mjs"
import {
  MigrationPreflightError,
  parseExpectedPendingOption,
  parseMigrationList,
} from "./db-preflight-core.mjs"
import { runMigrationPreflight } from "./db-preflight.mjs"

const fixtureRoots = []

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )))
})

function checksum(contents) {
  return createHash("sha256")
    .update(contents.replace(/\r\n/gu, "\n"))
    .digest("hex")
}

async function createMigrationFixture(last = 14) {
  const root = await mkdtemp(join(tmpdir(), "recipe-genie-preflight-"))
  fixtureRoots.push(root)
  const migrationDirectory = join(root, "migrations")
  const checksumRegistryPath = join(root, "migration-checksums.json")
  await mkdir(migrationDirectory)

  const registry = {}
  for (let number = 1; number <= last; number += 1) {
    const version = String(number).padStart(3, "0")
    const filename = `${version}_migration_${version}.sql`
    const contents = `select ${number};\n`
    await writeFile(join(migrationDirectory, filename), contents, "utf8")
    registry[filename] = checksum(contents)
  }
  await writeFile(
    checksumRegistryPath,
    `${JSON.stringify(registry, null, 2)}\n`,
    "utf8",
  )

  return {
    checksumRegistryPath,
    migrationDirectory,
  }
}

function migrationRow(local, remote, time = local || remote) {
  return { local, remote, time }
}

function migrationRows(localLast, remoteLast) {
  const rows = []
  const last = Math.max(localLast, remoteLast)
  for (let number = 1; number <= last; number += 1) {
    const version = String(number).padStart(3, "0")
    rows.push(migrationRow(
      number <= localLast ? version : "",
      number <= remoteLast ? version : "",
      version,
    ))
  }
  return rows
}

function migrationListJson(rows, overrides = {}) {
  return JSON.stringify({
    migrations: rows,
    message: "Migrations listed",
    ...overrides,
  })
}

async function runComposed({
  argv = [],
  fixture,
  output,
  migrationListRunner,
}) {
  const resolvedFixture = fixture ?? await createMigrationFixture()
  return runMigrationPreflight({
    argv,
    ...resolvedFixture,
    migrationListRunner: migrationListRunner ?? (() => output),
  })
}

async function expectFailure(run, category, message) {
  try {
    await run()
    throw new Error("expected migration preflight failure")
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationPreflightError)
    expect(error.category).toBe(category)
    expect(error.message).toContain(message)
  }
}

describe("composed preflight authorization", () => {
  const pending014 = () => migrationListJson(migrationRows(14, 13))

  it("accepts remote 001-013 versus local 001-014 with explicit argv", async () => {
    await expect(runComposed({
      argv: ["--expected-pending", "014"],
      output: pending014(),
    })).resolves.toEqual({
      status: "expected-pending",
      expectedPending: "014",
      latestRemote: "013",
    })
  })

  it("rejects the same state with empty argv", async () => {
    await expectFailure(() => runComposed({
      output: pending014(),
    }), "drift", "local-only migrations detected: 014")
  })

  it("ignores ambient npm configuration when argv is empty", async () => {
    const previous = process.env.npm_config_expected_pending
    process.env.npm_config_expected_pending = "014"
    try {
      await expectFailure(() => runComposed({
        output: pending014(),
      }), "drift", "local-only migrations detected: 014")
    } finally {
      if (previous === undefined) {
        delete process.env.npm_config_expected_pending
      } else {
        process.env.npm_config_expected_pending = previous
      }
    }
  })

  it("does not combine or conflict explicit and ambient values", async () => {
    const previous = process.env.npm_config_expected_pending
    process.env.npm_config_expected_pending = "015"
    try {
      await expect(runComposed({
        argv: ["--expected-pending=014"],
        output: pending014(),
      })).resolves.toMatchObject({
        status: "expected-pending",
        expectedPending: "014",
      })
      await expectFailure(() => runComposed({
        argv: ["014"],
        output: pending014(),
      }), "invalid-configuration", "unexpected argument: 014")
      await expectFailure(() => runComposed({
        argv: ["--expected-pending", "014", "015"],
        output: pending014(),
      }), "invalid-configuration", "unexpected argument: 015")
    } finally {
      if (previous === undefined) {
        delete process.env.npm_config_expected_pending
      } else {
        process.env.npm_config_expected_pending = previous
      }
    }
  })

  it("strictly rejects malformed, duplicate, missing, and unknown options", () => {
    expect(() => parseExpectedPendingOption([
      "--expected-pending",
      "not-a-version",
    ])).toThrow("must be one numeric migration version")
    expect(() => parseExpectedPendingOption([
      "--expected-pending",
      "014",
      "--expected-pending=014",
    ])).toThrow("at most once")
    expect(() => parseExpectedPendingOption([
      "--expected-pending",
    ])).toThrow("requires one migration version")
    expect(() => parseExpectedPendingOption([
      "--unknown",
    ])).toThrow("unexpected argument")
  })
})

describe("composed row-preserving migration-list handling", () => {
  it("rejects split blank rows instead of compacting columns", async () => {
    const rows = migrationRows(12, 12)
    rows.push(
      migrationRow("013", "", "013"),
      migrationRow("", "013", "013"),
      migrationRow("014", "", "014"),
    )
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      output: migrationListJson(rows),
    }), "drift", "remote-only migrations detected: 013")
  })

  it("rejects missing cells and extra columns in JSON rows", async () => {
    const missing = migrationRows(14, 13)
    delete missing[5].remote
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      output: migrationListJson(missing),
    }), "drift", "must contain exactly three cells")

    const extra = migrationRows(14, 13)
    extra[5].checksum = "fabricated"
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      output: migrationListJson(extra),
    }), "drift", "must contain exactly three cells")
  })

  it("rejects malformed and ambiguous table output", async () => {
    const missingCell = `
      Local | Remote | Time (UTC)
      ----- | ------ | ----------
      001   | 001
    `
    await expectFailure(() => runComposed({
      output: missingCell,
    }), "drift", "must contain exactly three cells")

    const extraColumn = `
      Local | Remote | Time (UTC)
      ----- | ------ | ----------
      001   | 001    | 001 | extra
    `
    await expectFailure(() => runComposed({
      output: extraColumn,
    }), "drift", "must contain exactly three cells")

    const ambiguousHeader = `
      Local | Remote | Time (UTC)
      ----- | ------ | ----------
      Local | Remote | Time (UTC)
    `
    await expectFailure(() => runComposed({
      output: ambiguousHeader,
    }), "drift", "malformed local version")
  })

  it("rejects duplicated, reordered, and gapped rows", async () => {
    const duplicated = migrationRows(14, 13)
    duplicated.splice(5, 0, { ...duplicated[5] })
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      output: migrationListJson(duplicated),
    }), "drift", "local versions")

    const reordered = migrationRows(14, 13)
    ;[reordered[4], reordered[5]] = [reordered[5], reordered[4]]
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      output: migrationListJson(reordered),
    }), "drift", "local versions")

    const gapped = migrationRows(14, 13)
    gapped.splice(5, 1)
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      output: migrationListJson(gapped),
    }), "drift", "local versions")
  })

  it("rejects unexpected 015 and multiple pending migrations", async () => {
    const unexpectedFixture = await createMigrationFixture(15)
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      fixture: unexpectedFixture,
      output: migrationListJson(migrationRows(15, 13)),
    }), "invalid-configuration", "is not the local tail")

    const multipleFixture = await createMigrationFixture(15)
    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "015"],
      fixture: multipleFixture,
      output: migrationListJson(migrationRows(15, 13)),
    }), "drift", "local-only migrations are 014, 015")
  })

  it("rejects remote-only migrations", async () => {
    await expectFailure(() => runComposed({
      output: migrationListJson(migrationRows(14, 15)),
    }), "drift", "remote-only migrations detected: 015")
  })

  it("rejects a local checksum-registry mismatch before ledger analysis", async () => {
    const fixture = await createMigrationFixture()
    const registry = JSON.parse(await readFile(
      fixture.checksumRegistryPath,
      "utf8",
    ))
    registry["008_migration_008.sql"] = "0".repeat(64)
    await writeFile(
      fixture.checksumRegistryPath,
      `${JSON.stringify(registry, null, 2)}\n`,
      "utf8",
    )
    let listCalled = false

    await expectFailure(() => runComposed({
      argv: ["--expected-pending", "014"],
      fixture,
      migrationListRunner: () => {
        listCalled = true
        return migrationListJson(migrationRows(14, 13))
      },
    }), "drift", "checksum drift from the repository registry")
    expect(listCalled).toBe(false)
  })

  it("never creates remote checksum, name, or statement metadata", async () => {
    const rows = parseMigrationList(
      migrationListJson(migrationRows(14, 14)),
    )
    expect(rows[0]).toEqual({
      local: "001",
      remote: "001",
      time: "001",
    })
    expect(Object.keys(rows[0]).sort()).toEqual(["local", "remote", "time"])
    expect(preflightCore.migrationsFromList).toBeUndefined()

    await expect(runComposed({
      output: migrationListJson(rows),
    })).resolves.toEqual({
      status: "aligned",
      latest: "014",
    })
  })

  it("keeps exact row alignment passing by default", async () => {
    await expect(runComposed({
      output: migrationListJson(migrationRows(14, 14)),
    })).resolves.toEqual({
      status: "aligned",
      latest: "014",
    })
  })
})

describe("documented table parsing", () => {
  it("preserves explicit blank cells row by row", () => {
    expect(parseMigrationList(`
      Local | Remote | Time (UTC)
      ----- | ------ | ----------
      001   | 001    | 001
            | 002    | 002
      003   |        | 003
    `)).toEqual([
      migrationRow("001", "001", "001"),
      migrationRow("", "002", "002"),
      migrationRow("003", "", "003"),
    ])
  })
})
