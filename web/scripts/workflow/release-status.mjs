import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import {
  isFullGitSha,
  parsePublicManifest,
  validateProductionTarget,
} from "../operational/runtime.mjs"
import { collectDoctorReport } from "./context.mjs"
import {
  ENVIRONMENT_INPUTS,
  RECIPE_GENIE_PACKAGE_NAME,
  RECIPE_GENIE_PROJECT_REF,
} from "./policy.mjs"
import { assertSafeOutput, assertSecretSafe } from "./state.mjs"

const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/
const SUCCESSFUL_CONCLUSIONS = new Set(["success"])
const NON_BLOCKING_CONCLUSIONS = new Set(["neutral", "skipped"])
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"])
const DEPLOYMENT_STATES = new Set(["error", "failure", "inactive", "in_progress", "queued", "pending", "success"])

function defaultCommandRunner(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 30_000 })
  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
  }
}

function isSafeBranch(value) {
  if (!BRANCH_PATTERN.test(value || "")) return false
  try {
    assertSecretSafe(value, "branch")
    return true
  } catch {
    return false
  }
}

function validateInputs(input) {
  if (!REPOSITORY_PATTERN.test(input.repository || "")) throw new Error("repository must use owner/repo format")
  if (input.branch && !BRANCH_PATTERN.test(input.branch)) throw new Error("branch is invalid")
  if (!PROJECT_REF_PATTERN.test(input.expectedProjectRef || "")) throw new Error("expected project reference is invalid")
  const target = validateProductionTarget({
    appUrl: input.productionUrl,
    expectedSha: input.expectedSha,
  })
  assertSecretSafe(input.repository, "repository")
  assertSecretSafe(input.branch || "", "branch")
  assertSecretSafe(target.expectedSha, "expected SHA")
  assertSecretSafe(input.expectedProjectRef, "expected project reference")
  assertSecretSafe(target.appUrl, "production URL")
  return { ...input, expectedSha: target.expectedSha, productionUrl: target.appUrl }
}

function check(name, status, authority, detail) {
  return { name, status, authority, detail }
}

function runJson(commandRunner, cwd, args) {
  const result = commandRunner("gh", args, cwd)
  if (result.exitCode !== 0) throw new Error("GitHub evidence is unavailable")
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error("GitHub returned malformed evidence")
  }
}

function githubApi(commandRunner, cwd, endpoint, fields = []) {
  const args = ["api", endpoint]
  if (fields.length) args.push("-X", "GET", ...fields.flatMap(([name, value]) => ["-f", `${name}=${value}`]))
  return runJson(commandRunner, cwd, args)
}

function addWarning(report, message) {
  if (!report.warnings.includes(message)) report.warnings.push(message)
}

function contextChecks(context) {
  const results = []
  if (context.repository?.identity !== RECIPE_GENIE_PACKAGE_NAME) {
    results.push(check("repository-context", "FAIL", "AUTHORITATIVE", "Checkout does not match the Recipe Genie repository identity."))
  } else if (!context.tools?.git?.available) {
    results.push(check("repository-context", "FAIL", "AUTHORITATIVE", "Git is unavailable in the local workflow context."))
  } else {
    results.push(check("repository-context", "PASS", "AUTHORITATIVE", "Recipe Genie repository identity and Git availability confirmed."))
  }
  if (!context.runtime?.nodeSupported || !context.runtime?.npmSupported) {
    results.push(check(
      "supported-runtime",
      "FAIL",
      "AUTHORITATIVE",
      `Repository requires Node ${context.runtime?.expectedNode || "from web/.nvmrc"} and npm ${context.runtime?.expectedNpm || "from packageManager"}.`,
    ))
  } else {
    results.push(check(
      "supported-runtime",
      "PASS",
      "AUTHORITATIVE",
      `Node ${context.runtime?.expectedNode || "pin"} and npm ${context.runtime?.expectedNpm || "pin"} runtime policy confirmed.`,
    ))
  }
  return results
}

function classifyCi(evidence) {
  const checkRuns = evidence?.check_runs
  const totalCount = evidence?.total_count
  if (!Array.isArray(checkRuns) || !Number.isSafeInteger(totalCount) || totalCount < checkRuns.length || totalCount < 0) {
    return { status: "WARN", detail: "Exact-SHA GitHub Checks returned structurally invalid evidence." }
  }
  if (totalCount === 0) return { status: "WARN", detail: "GitHub authoritatively reported no exact-SHA check runs; CI is not proven." }
  const pending = checkRuns.filter((item) => item?.status !== "completed" || !item?.conclusion)
  const failed = checkRuns.filter((item) => item?.status === "completed" && FAILED_CONCLUSIONS.has(item?.conclusion))
  const nonBlocking = checkRuns.filter((item) => item?.status === "completed" && NON_BLOCKING_CONCLUSIONS.has(item?.conclusion))
  const unknown = checkRuns.filter((item) => item?.status === "completed" && !SUCCESSFUL_CONCLUSIONS.has(item?.conclusion) && !NON_BLOCKING_CONCLUSIONS.has(item?.conclusion) && !FAILED_CONCLUSIONS.has(item?.conclusion))
  if (failed.length) return { status: "FAIL", detail: `${failed.length} of ${totalCount} observed exact-SHA check runs failed; GitHub requiredness is not inferred.` }
  if (pending.length) return { status: "FAIL", detail: `${pending.length} of ${totalCount} observed exact-SHA check runs are pending or queued; GitHub requiredness is not inferred.` }
  if (totalCount > checkRuns.length) return { status: "WARN", detail: `GitHub returned only ${checkRuns.length} of ${totalCount} exact-SHA check runs, so CI is not proven.` }
  if (nonBlocking.length || unknown.length) return { status: "WARN", detail: `${nonBlocking.length + unknown.length} of ${totalCount} exact-SHA check runs were neutral, skipped, or inconclusive; CI is not reported as passed.` }
  return { status: "PASS", detail: `All ${totalCount} observed exact-SHA check runs completed successfully; GitHub requiredness is not inferred.` }
}

async function readManifest(fetchImpl, productionUrl, timeoutSignal) {
  let response
  try {
    response = await fetchImpl(new URL("/api/version", productionUrl).toString(), {
      credentials: "omit",
      redirect: "follow",
      signal: timeoutSignal,
    })
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") throw new Error("Production manifest request timed out.")
    throw new Error("Production manifest request failed.")
  }
  const status = Number.isInteger(response?.status) && response.status >= 100 && response.status <= 599 ? response.status : "unknown"
  if (!response?.ok) throw new Error(`Production manifest request failed with HTTP ${status}.`)
  if (response.url) {
    try {
      const finalUrl = new URL(response.url)
      if (finalUrl.protocol !== "https:" || finalUrl.username || finalUrl.password || finalUrl.search || finalUrl.hash || !["/api/version", "/api/version/"].includes(finalUrl.pathname)) {
        throw new Error("unsafe redirect")
      }
    } catch {
      throw new Error("Production manifest redirect target is unsafe.")
    }
  }
  const contentType = response.headers?.get?.("content-type")
  if (contentType && !contentType.toLowerCase().includes("application/json")) throw new Error("Production manifest response is not JSON.")
  let value
  try {
    value = await response.json()
  } catch {
    throw new Error("Production manifest JSON is malformed.")
  }
  try {
    const manifest = parsePublicManifest({
      ...value,
      gitSha: value?.gitSha ?? null,
      buildTimestamp: value?.buildTimestamp ?? null,
      applicationVersion: value?.applicationVersion ?? "0.0.0",
    })
    return manifest
  } catch {
    throw new Error("Production manifest structure is invalid.")
  }
}

function chooseNextAction(report) {
  if (report.status === "BLOCKED") {
    if (report.checks.some((item) => item.name === "supabase-project-ref" && item.status === "FAIL")) return "Resolve the Supabase project identity contradiction before release work."
    const branchHead = report.checks.find((item) => item.name === "branch-head" && item.status === "FAIL")
    if (branchHead?.detail.includes("was not supplied")) return "Supply an explicit branch or restore access to the repository default branch."
    if (branchHead) return "Reconcile the expected SHA with the selected branch head before release work."
    return "Resolve the repository or configuration identity blocker before release work."
  }
  if (report.status === "ACTION_REQUIRED") {
    if (report.checks.some((item) => item.name === "supported-runtime" && item.status === "FAIL")) return "Run this command with the repository-pinned Node and npm runtimes."
    if (report.checks.some((item) => item.name === "exact-sha-ci" && item.status === "FAIL")) return "Wait for or fix the exact-SHA GitHub checks, then run this command again."
    if (report.checks.some((item) => item.name === "deployed-sha" && item.status === "FAIL")) return "Deploy the expected SHA to the production URL, then run this command again."
    return "Restore a valid production /api/version response, then run this command again."
  }
  const ci = report.checks.find((item) => item.name === "exact-sha-ci" && item.status === "WARN")
  if (ci?.detail.includes("no exact-SHA check runs")) return "Run or configure CI for the expected SHA, then run this command again."
  if (ci?.detail.includes("returned only")) return "Review the complete exact-SHA check-run set in GitHub before relying on this release status."
  if (ci?.detail.includes("neutral, skipped, or inconclusive")) return "Review the neutral, skipped, or inconclusive exact-SHA checks before release."
  if (ci) return "Run this command again when exact-SHA GitHub Checks are accessible."
  if (report.checks.some((item) => item.name === "branch-head" && ["WARN", "SKIP"].includes(item.status))) return "Run this command again when authoritative branch-head evidence is accessible."
  if (report.checks.some((item) => item.name === "github-repository" && item.status === "WARN")) return "Run this command again when authoritative GitHub repository evidence is accessible."
  return "No release action is required."
}

export async function collectReleaseStatus(rawInput, options = {}) {
  const input = validateInputs(rawInput)
  const commandRunner = options.commandRunner || defaultCommandRunner
  const fetchImpl = options.fetchImpl || fetch
  const manifestSignal = options.manifestSignal || AbortSignal.timeout(10_000)
  const cwd = options.cwd || process.cwd()
  const context = options.context || collectDoctorReport({ cwd, commandRunner })
  const report = {
    schemaVersion: 1,
    status: "PASS",
    binding: {
      repository: input.repository,
      branch: input.branch || null,
      expectedSha: input.expectedSha,
      deployedSha: null,
      expectedProjectRef: input.expectedProjectRef,
      deployedProjectRef: null,
      expectedMigration: null,
    },
    checks: [],
    warnings: [],
    nextAction: "",
  }

  const localChecks = contextChecks(context)
  report.checks.push(...localChecks)
  if (localChecks.find((item) => item.name === "repository-context")?.status === "FAIL") report.status = "BLOCKED"
  else if (localChecks.find((item) => item.name === "supported-runtime")?.status === "FAIL") report.status = "ACTION_REQUIRED"
  if (input.expectedProjectRef !== RECIPE_GENIE_PROJECT_REF) {
    report.checks.push(check("supabase-project-ref", "FAIL", "AUTHORITATIVE", "Explicit project reference contradicts the approved Recipe Genie project."))
    report.status = "BLOCKED"
  }
  if (report.status === "BLOCKED") {
    report.nextAction = chooseNextAction(report)
    assertSecretSafe(report, "release status")
    return report
  }

  let githubAvailable = context.tools?.gh?.available !== false
  let repositoryMetadata
  if (githubAvailable) {
    try {
      repositoryMetadata = githubApi(commandRunner, cwd, `repos/${input.repository}`)
      const actual = repositoryMetadata.full_name
      if (typeof actual !== "string" || actual.toLowerCase() !== input.repository.toLowerCase()) {
        report.checks.push(check("github-repository", "FAIL", "AUTHORITATIVE", "GitHub repository identity contradicts the explicit repository."))
        report.status = "BLOCKED"
      } else {
        report.checks.push(check("github-repository", "PASS", "AUTHORITATIVE", "GitHub repository identity matches the explicit repository."))
      }
    } catch {
      githubAvailable = false
      report.checks.push(check("github-repository", "WARN", "INFERRED", "GitHub repository identity is temporarily inaccessible."))
      addWarning(report, "GitHub source and CI evidence are temporarily inaccessible.")
    }
  } else {
    report.checks.push(check("github-repository", "WARN", "INFERRED", "GitHub CLI is unavailable."))
    addWarning(report, "GitHub source and CI evidence are unavailable because gh is missing.")
  }

  const branch = input.branch || repositoryMetadata?.default_branch
  if (!isSafeBranch(branch)) {
    report.checks.push(check("branch-head", "FAIL", "INFERRED", "Branch was not supplied and could not be safely determined."))
    report.status = "BLOCKED"
  } else {
    report.binding.branch = branch
    if (githubAvailable) {
      try {
        const ref = githubApi(commandRunner, cwd, `repos/${input.repository}/git/ref/heads/${encodeURIComponent(branch)}`)
        const headSha = ref?.object?.sha?.toLowerCase()
        if (!isFullGitSha(headSha)) throw new Error("invalid branch evidence")
        if (headSha !== input.expectedSha && !input.historical) {
          report.checks.push(check("branch-head", "FAIL", "AUTHORITATIVE", "Selected branch head does not match the explicitly expected SHA."))
          report.status = "BLOCKED"
        } else if (headSha !== input.expectedSha) {
          report.checks.push(check("branch-head", "WARN", "AUTHORITATIVE", "Expected SHA is historical and is not the selected branch head."))
          addWarning(report, "Historical SHA verification was explicitly requested.")
        } else {
          report.checks.push(check("branch-head", "PASS", "AUTHORITATIVE", "Selected branch head matches the explicitly expected SHA."))
        }
      } catch {
        report.checks.push(check("branch-head", "WARN", "INFERRED", "GitHub branch-head evidence is temporarily inaccessible."))
        addWarning(report, "GitHub branch-head evidence is temporarily inaccessible.")
      }
    } else {
      report.checks.push(check("branch-head", "SKIP", "INFERRED", "GitHub branch-head evidence was not queried."))
    }
  }

  if (githubAvailable) {
    try {
      const evidence = githubApi(commandRunner, cwd, `repos/${input.repository}/commits/${input.expectedSha}/check-runs`, [["per_page", "100"]])
      const ci = classifyCi(evidence)
      report.checks.push(check("exact-sha-ci", ci.status, "AUTHORITATIVE", ci.detail))
      if (ci.status === "FAIL" && report.status !== "BLOCKED") report.status = "ACTION_REQUIRED"
      if (ci.status === "WARN") addWarning(report, "Exact-SHA GitHub Checks could not establish a CI conclusion.")
    } catch {
      report.checks.push(check("exact-sha-ci", "WARN", "INFERRED", "Exact-SHA GitHub Checks are temporarily inaccessible."))
      addWarning(report, "Exact-SHA GitHub Checks are temporarily inaccessible.")
    }
  } else {
    report.checks.push(check("exact-sha-ci", "WARN", "INFERRED", "Exact-SHA GitHub Checks were not queried."))
  }

  if (githubAvailable) {
    try {
      const deployments = githubApi(commandRunner, cwd, `repos/${input.repository}/deployments`, [["sha", input.expectedSha], ["per_page", "1"]])
      if (!Array.isArray(deployments) || deployments.length === 0) {
        report.checks.push(check("deployment-record", "WARN", "CORROBORATIVE", "No GitHub deployment record was found for the expected SHA."))
        addWarning(report, "Optional GitHub/Vercel deployment evidence is absent.")
      } else {
        const deploymentId = deployments[0]?.id
        let detail = "GitHub has a deployment record for the expected SHA."
        if (Number.isSafeInteger(deploymentId) && deploymentId > 0) {
          try {
            const statuses = githubApi(commandRunner, cwd, `repos/${input.repository}/deployments/${deploymentId}/statuses`, [["per_page", "1"]])
            const state = statuses?.[0]?.state
            if (DEPLOYMENT_STATES.has(state)) detail = `GitHub deployment record latest state is ${state}.`
          } catch {
            addWarning(report, "Optional GitHub deployment status is inaccessible.")
          }
        }
        report.checks.push(check("deployment-record", "PASS", "CORROBORATIVE", detail))
      }
    } catch {
      report.checks.push(check("deployment-record", "WARN", "INFERRED", "Optional GitHub deployment evidence is inaccessible."))
      addWarning(report, "Optional GitHub/Vercel deployment evidence is inaccessible.")
    }
  } else {
    report.checks.push(check("deployment-record", "SKIP", "INFERRED", "Optional deployment evidence was not queried."))
    addWarning(report, "Optional GitHub/Vercel deployment evidence is inaccessible.")
  }

  let manifest
  try {
    manifest = await readManifest(fetchImpl, input.productionUrl, manifestSignal)
    report.binding.deployedSha = manifest.gitSha?.toLowerCase() || null
    report.binding.deployedProjectRef = manifest.expectedSupabaseProjectRef || null
    report.binding.expectedMigration = manifest.expectedLatestMigration || null
    report.checks.push(check("production-manifest", "PASS", "AUTHORITATIVE", "Production returned a valid public deployment manifest."))
  } catch (error) {
    report.checks.push(check("production-manifest", "FAIL", "INFERRED", error instanceof Error ? error.message : "Production manifest is unavailable."))
    if (report.status !== "BLOCKED") report.status = "ACTION_REQUIRED"
  }

  if (manifest) {
    if (!report.binding.deployedSha || report.binding.deployedSha !== input.expectedSha) {
      report.checks.push(check("deployed-sha", "FAIL", "AUTHORITATIVE", "Production deployed SHA does not match the explicitly expected SHA."))
      if (report.status !== "BLOCKED") report.status = "ACTION_REQUIRED"
    } else {
      report.checks.push(check("deployed-sha", "PASS", "AUTHORITATIVE", "Production deployed SHA matches the explicitly expected SHA."))
    }
    if (report.binding.deployedProjectRef !== input.expectedProjectRef) {
      report.checks.push(check("supabase-project-ref", "FAIL", "AUTHORITATIVE", "Production manifest project reference contradicts the approved project."))
      report.status = "BLOCKED"
    } else if (!report.checks.some((item) => item.name === "supabase-project-ref")) {
      report.checks.push(check("supabase-project-ref", "PASS", "AUTHORITATIVE", "Production manifest identifies the approved Supabase project."))
    }
  } else {
    report.checks.push(check("deployed-sha", "SKIP", "INFERRED", "Production manifest was unavailable."))
    if (!report.checks.some((item) => item.name === "supabase-project-ref")) {
      report.checks.push(check("supabase-project-ref", "SKIP", "INFERRED", "Production manifest was unavailable."))
    }
  }

  report.nextAction = chooseNextAction(report)
  assertSecretSafe(report, "release status")
  return report
}

export function renderReleaseStatusJson(report, secretValues = []) {
  return assertSafeOutput(`${JSON.stringify(report, null, 2)}\n`, secretValues)
}

export function renderReleaseStatusText(report, secretValues = []) {
  const label = report.status === "ACTION_REQUIRED" ? "ACTION REQUIRED" : report.status
  const value = (candidate) => candidate || "unknown"
  const lines = [
    `STATUS: ${label}`,
    "",
    "Release:",
    `- repository: ${report.binding.repository}`,
    `- branch: ${value(report.binding.branch)}`,
    `- expected SHA: ${report.binding.expectedSha}`,
    `- deployed SHA: ${value(report.binding.deployedSha)}`,
    `- expected project: ${report.binding.expectedProjectRef}`,
    `- deployed project: ${value(report.binding.deployedProjectRef)}`,
    `- expected migration: ${value(report.binding.expectedMigration)}`,
    "",
    "Checks:",
    ...report.checks.map((item) => `- ${item.status} [${item.authority}] ${item.name}: ${item.detail}`),
    "",
    "Warnings:",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "Next action:",
    `- ${report.nextAction}`,
  ]
  return assertSafeOutput(`${lines.join("\n")}\n`, secretValues)
}

export function parseReleaseStatusArgs(argv, environment = process.env) {
  const values = {}
  const booleanOptions = new Set(["json", "historical"])
  const allowed = new Set(["repository", "branch", "expected-sha", "production-url", "expected-project-ref", ...booleanOptions])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith("--")) throw new Error("unsupported command syntax")
    const separator = argument.indexOf("=")
    const key = argument.slice(2, separator === -1 ? undefined : separator)
    if (!allowed.has(key) || Object.hasOwn(values, key)) throw new Error("unsupported command syntax")
    if (booleanOptions.has(key)) {
      if (separator !== -1) throw new Error("unsupported command syntax")
      values[key] = true
      continue
    }
    const candidate = separator === -1 ? argv[++index] : argument.slice(separator + 1)
    if (!candidate || candidate.startsWith("--")) throw new Error("unsupported command syntax")
    values[key] = candidate
  }
  return {
    repository: values.repository || environment.RG_REPOSITORY,
    branch: values.branch || environment.RG_BRANCH,
    expectedSha: values["expected-sha"] || environment.RG_EXPECTED_GIT_SHA,
    productionUrl: values["production-url"] || environment.RG_PRODUCTION_URL,
    expectedProjectRef: values["expected-project-ref"] || environment.RG_EXPECTED_SUPABASE_PROJECT_REF || environment.RECIPE_GENIE_PRODUCTION_PROJECT_REF,
    historical: Boolean(values.historical),
    json: Boolean(values.json),
  }
}

function configuredSecrets(environment) {
  return ENVIRONMENT_INPUTS.filter((item) => item.secret).map((item) => environment[item.name]).filter(Boolean)
}

async function main() {
  try {
    const input = parseReleaseStatusArgs(process.argv.slice(2))
    const report = await collectReleaseStatus(input)
    const output = input.json ? renderReleaseStatusJson(report, configuredSecrets(process.env)) : renderReleaseStatusText(report, configuredSecrets(process.env))
    process.stdout.write(output)
    process.exitCode = report.status === "PASS" ? 0 : report.status === "ACTION_REQUIRED" ? 1 : 2
  } catch {
    process.stderr.write("STATUS: BLOCKED\nInvalid or unsafe rg:release:status configuration.\n")
    process.exitCode = 2
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
