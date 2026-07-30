import { describe, expect, it } from "vitest"
import {
  MigrationPreflightError,
  analyzeMigrationState,
  parseExpectedPendingOption,
  parseMigrationList,
} from "./db-preflight-core.mjs"

function migration(version, overrides = {}) {
  return {
    version,
    name: `migration_${version}`,
    checksum: `checksum-${version}`,
    statementCount: 1,
    ...overrides,
  }
}

function chain(last) {
  return Array.from({ length: last }, (_, index) => (
    migration(String(index + 1).padStart(3, "0"))
  ))
}

function expectFailure(run, category, message) {
  try {
    run()
    throw new Error("expected migration preflight failure")
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationPreflightError)
    expect(error.category).toBe(category)
    expect(error.message).toContain(message)
  }
}

describe("migration preflight expected-pending contract", () => {
  it("accepts remote 001-013 versus local 001-014 only with expectation 014", () => {
    expect(analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(13),
      expectedPending: "014",
    })).toEqual({
      status: "expected-pending",
      expectedPending: "014",
      latestRemote: "013",
    })
  })

  it("rejects the same local-only migration without explicit opt-in", () => {
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(13),
    }), "drift", "local-only migrations detected: 014")
  })

  it("rejects an unexpected 015 and multiple pending migrations", () => {
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(15),
      remoteMigrations: chain(13),
      expectedPending: "014",
    }), "invalid-configuration", "is not the local tail")

    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(15),
      remoteMigrations: chain(13),
      expectedPending: "015",
    }), "drift", "local-only migrations are 014, 015")
  })

  it("rejects a remote-only migration", () => {
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(15),
    }), "drift", "remote-only migrations detected: 015")
  })

  it("rejects checksum drift in a shared migration", () => {
    const remote = chain(13)
    remote[7] = migration("008", { checksum: "altered" })
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: remote,
      expectedPending: "014",
    }), "drift", "migration 008 has checksum drift")
  })

  it("rejects gaps, reordered entries, and duplicates", () => {
    expectFailure(() => analyzeMigrationState({
      localMigrations: [migration("001"), migration("003")],
      remoteMigrations: [migration("001"), migration("003")],
    }), "drift", "gap between 001 and 003")

    expectFailure(() => analyzeMigrationState({
      localMigrations: [migration("002"), migration("001")],
      remoteMigrations: [migration("001"), migration("002")],
    }), "drift", "reordered")

    expectFailure(() => analyzeMigrationState({
      localMigrations: [migration("001"), migration("001")],
      remoteMigrations: [migration("001")],
    }), "drift", "duplicate migration 001")
  })

  it("rejects malformed, duplicate, zero, unknown, and non-tail expectations", () => {
    expectFailure(
      () => parseExpectedPendingOption(["--expected-pending", "not-a-version"]),
      "invalid-configuration",
      "must be one numeric migration version",
    )
    expectFailure(
      () => parseExpectedPendingOption([
        "--expected-pending",
        "014",
        "--expected-pending=014",
      ]),
      "invalid-configuration",
      "at most once",
    )
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(13),
      expectedPending: "000",
    }), "invalid-configuration", "must identify exactly one local migration")
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(13),
      expectedPending: "999",
    }), "invalid-configuration", "must identify exactly one local migration")
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(13),
      expectedPending: "013",
    }), "invalid-configuration", "is not the local tail")
  })

  it("rejects a partially recorded or partially applied 014", () => {
    const partialRemote = chain(14)
    partialRemote[13] = migration("014", { checksum: "partial-014" })
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: partialRemote,
      expectedPending: "014",
    }), "drift", "migration 014 has checksum drift")

    const missingStatements = chain(13)
    missingStatements[12] = migration("013", { statementCount: 0 })
    expectFailure(() => analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: missingStatements,
      expectedPending: "014",
    }), "drift", "migration 013 is partially recorded")
  })

  it("keeps exact alignment passing without an expectation", () => {
    expect(analyzeMigrationState({
      localMigrations: chain(14),
      remoteMigrations: chain(14),
    })).toEqual({ status: "aligned", latest: "014" })
  })
})

describe("npm option forwarding", () => {
  it("accepts npm's positional and npm_config forms without weakening direct parsing", () => {
    expect(parseExpectedPendingOption(["014"])).toEqual({
      expectedPending: "014",
      help: false,
    })
    expect(parseExpectedPendingOption([], "014")).toEqual({
      expectedPending: "014",
      help: false,
    })
    expect(parseExpectedPendingOption(["014"], "true")).toEqual({
      expectedPending: "014",
      help: false,
    })
  })
})

describe("Supabase migration-list parsing", () => {
  it("preserves missing local and remote cells in captured table output", () => {
    expect(parseMigrationList(`
      Local | Remote | Time (UTC)
      001   | 001    | 001
            | 002    | 002
      003   |        | 003
    `)).toEqual([
      { local: "001", remote: "001" },
      { local: "", remote: "002" },
      { local: "003", remote: "" },
    ])
  })
})
