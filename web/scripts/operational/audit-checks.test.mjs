import { describe, expect, it } from "vitest"
import { AUDIT_CHECKS, executeAuditChecks } from "./audit-checks.mjs"
import { assertReadOnlySql } from "./runtime.mjs"

const definitions = [
  {
    name: "fixture-clean",
    severity: "ERROR",
    why: "fixture invariant",
    remediation: "fixture remediation",
    sql: "select 0",
  },
  {
    name: "fixture-finding",
    severity: "WARNING",
    why: "fixture invariant",
    remediation: "fixture remediation",
    sql: "select 1",
  },
  {
    name: "fixture-skip",
    severity: "INFO",
    why: "not modeled",
    remediation: "none",
    skip: "not persisted",
  },
]

describe("data integrity audit", () => {
  it("contains only guarded read-only SQL", () => {
    for (const definition of AUDIT_CHECKS) {
      if (definition.sql) expect(() => assertReadOnlySql(definition.sql)).not.toThrow()
    }
  })

  it("returns stable machine-readable findings with capped identifiers", async () => {
    const query = async (sql, parameters) => {
      expect(parameters).toEqual([2])
      return sql === "select 0"
        ? [{ record_count: 0, sample_ids: [] }]
        : [{ record_count: 3, sample_ids: ["one", "two"] }]
    }
    const results = await executeAuditChecks(query, 2, definitions)

    expect(results).toEqual([
      expect.objectContaining({ check: "fixture-clean", status: "CLEAN", affectedRecordCount: 0 }),
      expect.objectContaining({
        check: "fixture-finding",
        status: "FINDING",
        severity: "WARNING",
        affectedRecordCount: 3,
        representativeIdentifiers: ["one", "two"],
      }),
      expect.objectContaining({ check: "fixture-skip", status: "SKIP", skipReason: "not persisted" }),
    ])
  })
})
