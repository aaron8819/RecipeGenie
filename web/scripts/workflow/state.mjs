import { createHash } from "node:crypto"
import path from "node:path"

const SHA_PATTERN = /^[0-9a-f]{40}$/
const HASH_PATTERN = /^[0-9a-f]{64}$/
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const SAFE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const SECRET_KEY_PATTERN = /(authorization|cookie|credential|database.?url|password|secret|token)/i
const CREDENTIAL_URL_PATTERN = /\b(?:postgres(?:ql)?|https?):\/\/[^\s/@:]+:[^\s/@]+@/i
const SECRET_VALUE_PATTERNS = [
  /\b(?:sbp|sb_secret|sb_publishable)_[A-Za-z0-9_-]{12,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/,
  /\bvercel_[A-Za-z0-9_-]{12,}\b/i,
]

function replaceAllMatches(value, pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  return value.replace(new RegExp(pattern.source, flags), "[REDACTED]")
}

export function redactSecretShapedValues(value) {
  let redacted = String(value ?? "")
  redacted = replaceAllMatches(redacted, CREDENTIAL_URL_PATTERN)
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = replaceAllMatches(redacted, pattern)
  }
  return redacted
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function assertSecretSafe(value, pathLabel = "value") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretSafe(item, `${pathLabel}[${index}]`))
    return value
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key) && child !== undefined && child !== null && child !== false) {
        throw new Error(`${pathLabel}.${key} cannot store secret-bearing values`)
      }
      assertSecretSafe(child, `${pathLabel}.${key}`)
    }
    return value
  }
  if (typeof value === "string" && (CREDENTIAL_URL_PATTERN.test(value) || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value)))) {
    throw new Error(`${pathLabel} contains a secret-shaped value`)
  }
  return value
}

export function assertSafeOutput(output, secretValues = []) {
  if (typeof output !== "string") throw new Error("doctor output must be text")
  assertSecretSafe(output, "output")
  for (const secret of secretValues) {
    if (typeof secret === "string" && secret.length >= 4 && output.includes(secret)) {
      throw new Error("doctor output disclosed a configured secret value")
    }
  }
  return output
}

export function createOperationKey({ operation, gitSha, projectRef, migrationHash }) {
  if (!SAFE_SEGMENT_PATTERN.test(operation)) throw new Error("operation name is invalid")
  validateBinding({ gitSha, projectRef, migrationHash })
  const canonical = JSON.stringify(canonicalize({ operation, gitSha, projectRef, migrationHash: migrationHash || null }))
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 16)
  return `${operation}-${digest}`
}

export function workflowArtifactPath(repositoryRoot, operationKey, artifactName) {
  if (!path.isAbsolute(repositoryRoot)) throw new Error("repository root must be absolute")
  if (!SAFE_SEGMENT_PATTERN.test(operationKey) || !SAFE_SEGMENT_PATTERN.test(artifactName)) {
    throw new Error("workflow artifact path segment is invalid")
  }
  const workflowRoot = path.resolve(repositoryRoot, ".codex-artifacts", "workflows")
  const result = path.resolve(workflowRoot, operationKey, artifactName)
  if (!result.startsWith(`${workflowRoot}${path.sep}`)) throw new Error("workflow artifact path escapes its root")
  return result
}

export function validateBinding({ gitSha, projectRef, migrationHash }) {
  if (!SHA_PATTERN.test(gitSha)) throw new Error("workflow binding Git SHA is invalid")
  if (!PROJECT_REF_PATTERN.test(projectRef)) throw new Error("workflow binding project reference is invalid")
  if (migrationHash !== undefined && migrationHash !== null && !HASH_PATTERN.test(migrationHash)) {
    throw new Error("workflow binding migration hash is invalid")
  }
  return { gitSha, projectRef, ...(migrationHash ? { migrationHash } : {}) }
}

export function createWorkflowState({ operationKey, binding, artifacts = [] }) {
  if (!SAFE_SEGMENT_PATTERN.test(operationKey)) throw new Error("operation key is invalid")
  const state = { operationKey, binding: validateBinding(binding), artifacts: [] }
  for (const artifact of artifacts) addArtifactReference(state, artifact)
  assertSecretSafe(state, "workflow state")
  return state
}

export function addArtifactReference(state, reference) {
  assertSecretSafe(reference, "artifact reference")
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw new Error("artifact reference is invalid")
  if (typeof reference.kind !== "string" || !SAFE_SEGMENT_PATTERN.test(reference.kind)) throw new Error("artifact kind is invalid")
  const referencePath = typeof reference.path === "string" ? reference.path.replace(/\\/g, "/") : ""
  if (!referencePath.startsWith(".codex-artifacts/workflows/") || referencePath.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new Error("artifact reference must use the workflow artifact root")
  }
  if (reference.sha256 !== undefined && !HASH_PATTERN.test(reference.sha256)) throw new Error("artifact hash is invalid")
  state.artifacts.push({ kind: reference.kind, path: referencePath, ...(reference.sha256 ? { sha256: reference.sha256 } : {}) })
  return state
}

export function assertCurrentBinding(state, currentBinding) {
  const expected = validateBinding(state.binding)
  const current = validateBinding(currentBinding)
  if (expected.gitSha !== current.gitSha || expected.projectRef !== current.projectRef || (expected.migrationHash || null) !== (current.migrationHash || null)) {
    throw new Error("workflow state is stale for the current Git, project, or migration binding")
  }
  return true
}
