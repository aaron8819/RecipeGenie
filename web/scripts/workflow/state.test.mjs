import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  addArtifactReference,
  assertCurrentBinding,
  assertSafeOutput,
  createOperationKey,
  createWorkflowState,
  workflowArtifactPath,
} from "./state.mjs"

const binding = {
  gitSha: "732d59966d7d8dfbf54bd077a568095b9fd8bb41",
  projectRef: "eyaoahwzixqetjgfghsh",
  migrationHash: "a".repeat(64),
}

describe("workflow state primitives", () => {
  it("generates stable operation keys and safe artifact paths", () => {
    const first = createOperationKey({ operation: "migration-preflight", ...binding })
    const second = createOperationKey({ projectRef: binding.projectRef, operation: "migration-preflight", migrationHash: binding.migrationHash, gitSha: binding.gitSha })
    expect(first).toBe(second)
    expect(first).toMatch(/^migration-preflight-[0-9a-f]{16}$/)

    const repositoryRoot = path.resolve("C:/workspace/Recipe Genie")
    expect(workflowArtifactPath(repositoryRoot, first, "manifest.json")).toBe(path.join(repositoryRoot, ".codex-artifacts", "workflows", first, "manifest.json"))
    expect(() => workflowArtifactPath(repositoryRoot, first, "../outside.json")).toThrow(/segment/)
  })

  it("stores artifact references without performing persistence", () => {
    const state = createWorkflowState({ operationKey: createOperationKey({ operation: "production-backup", ...binding }), binding })
    addArtifactReference(state, {
      kind: "manifest",
      path: `.codex-artifacts/workflows/${state.operationKey}/manifest.json`,
      sha256: "b".repeat(64),
    })
    expect(state.artifacts).toHaveLength(1)
    expect(() => addArtifactReference(state, {
      kind: "manifest",
      path: ".codex-artifacts/workflows/../../outside.json",
    })).toThrow(/artifact root/)
  })

  it("rejects stale bindings", () => {
    const state = createWorkflowState({ operationKey: createOperationKey({ operation: "migration-preflight", ...binding }), binding })
    expect(assertCurrentBinding(state, binding)).toBe(true)
    expect(() => assertCurrentBinding(state, { ...binding, gitSha: "0".repeat(40) })).toThrow(/stale/)
    expect(() => assertCurrentBinding(state, { ...binding, migrationHash: "c".repeat(64) })).toThrow(/stale/)
  })

  it("rejects secret-bearing state and output", () => {
    const state = createWorkflowState({ operationKey: createOperationKey({ operation: "production-backup", ...binding }), binding })
    expect(() => addArtifactReference(state, {
      kind: "manifest",
      path: `.codex-artifacts/workflows/${state.operationKey}/manifest.json`,
      token: "fixture-secret",
    })).toThrow(/secret-bearing/)
    expect(() => assertSafeOutput("database=postgresql://postgres:secret@example.test/postgres")).toThrow(/secret-shaped/)
    expect(() => assertSafeOutput("safe summary fixture-secret", ["fixture-secret"])).toThrow(/disclosed/)
  })
})
