import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertSafeOutput, assertSecretSafe } from "./state.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, "..", "..")
const repositoryRoot = resolve(webDirectory, "..")
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@{}^~:-]*$/u
const PATH_PATTERN = /^(?![A-Za-z]:|\/|\\)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[^\0\r\n]+$/u
const RELEASE_VALUE_OPTIONS = new Set([
  "--repository",
  "--branch",
  "--expected-sha",
  "--production-url",
  "--expected-project-ref",
])

export function resolveTrustedNpmCli(nodeExecutable = process.execPath) {
  const runtimeDirectory = dirname(nodeExecutable)
  const candidates = [
    resolve(runtimeDirectory, "node_modules", "npm"),
    resolve(runtimeDirectory, "..", "lib", "node_modules", "npm"),
  ]
  const expected = JSON.parse(
    readFileSync(resolve(webDirectory, "package.json"), "utf8"),
  ).packageManager
  for (const packageDirectory of candidates) {
    const cli = resolve(packageDirectory, "bin", "npm-cli.js")
    const manifestPath = resolve(packageDirectory, "package.json")
    if (!existsSync(cli) || !existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
    if (`npm@${manifest.version}` !== expected) {
      throw new Error("The active Node runtime does not contain the repository-pinned npm version.")
    }
    return cli
  }
  throw new Error("The repository-pinned npm CLI is unavailable beside the active Node runtime.")
}

const npmCli = resolveTrustedNpmCli()

function npmCheck(name, args, coverage) {
  return {
    name,
    command: process.execPath,
    args: [npmCli, ...args],
    commandLabel: `<node> <trusted-npm-cli> ${args.join(" ")}`,
    coverage,
  }
}

const MIGRATION_CHECK = Object.freeze({
  name: "migration-reference-integrity",
  command: process.execPath,
  args: [resolve(scriptDirectory, "migration-integrity.mjs")],
  coverage: "Validated tracked migration files, checksum coverage, checksums, active endpoint, and documented chain.",
})

const PR_CHECKS = Object.freeze([
  npmCheck(
    "repository-verification",
    ["run", "verify"],
    "Ran artifact and secret guards, migration-reference integrity, lint, typecheck, unit tests, error/skip guards, identity/write guards, and cycle analysis.",
  ),
  npmCheck(
    "production-build",
    ["run", "build"],
    "Ran the production Next.js build.",
  ),
  {
    name: "migration-tooling-tests",
    command: "pwsh",
    args: [
      "-NoProfile",
      "-File",
      resolve(repositoryRoot, "scripts", "database", "tests", "Run-Tests.ps1"),
    ],
    coverage: "Ran the repository's PowerShell migration backup, assertion, and preflight tooling tests.",
  },
])

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "")
}

function check(name, status, detail, command = null) {
  return { name, status, detail, command }
}

function commandLabel(command, args) {
  return [command, ...args].join(" ")
}

function defaultCommandRunner(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30 * 60 * 1000,
  })
  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  }
}

function runCheck(definition, commandRunner, cwd = webDirectory) {
  const startedAt = Date.now()
  const result = commandRunner(
    definition.command,
    definition.args,
    definition.cwd ?? cwd,
  )
  const label = definition.commandLabel
    ?? commandLabel(definition.command, definition.args)
  if (result.exitCode === 0 && !result.error) {
    return check(
      definition.name,
      "PASS",
      `${definition.coverage ?? "Check completed."} Duration: ${Date.now() - startedAt} ms.`,
      label,
    )
  }
  const output = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .slice(-12_000)
  return {
    ...check(
      definition.name,
      "FAIL",
      result.error
        ? `Could not run check: ${result.error}`
        : `Exited ${result.exitCode} after ${Date.now() - startedAt} ms.`,
      label,
    ),
    output,
  }
}

function isDocumentationPath(path) {
  return path === "README.md"
    || path === "AGENTS.md"
    || path === "CLAUDE.md"
    || path === "supabase/SCHEMA.md"
    || path.startsWith("docs/")
    || (path.startsWith("scripts/database/") && path.endsWith(".md"))
}

function focusedCategory(path) {
  if (isDocumentationPath(path)) return "documentation"
  if (/^web\/scripts\/workflow\/[^/]+\.mjs$/u.test(path)) return "workflow"
  if (
    /^web\/scripts\/db-preflight(?:-core)?(?:\.test)?\.mjs$/u.test(path)
    || path.startsWith("web/scripts/fixtures/db-preflight/")
  ) return "db-preflight"
  if (path === "supabase/migration-checksums.json") return "migration-metadata"
  return null
}

export function planFocusedVerification(changedFiles) {
  const files = [...new Set(changedFiles.map(normalizePath))].sort()
  if (files.length === 0) {
    return {
      files,
      escalated: false,
      categories: [],
      checks: [],
      detail: "No changed files were found for the explicit scope.",
    }
  }

  const categories = files.map(focusedCategory)
  const unknownFiles = files.filter((_, index) => !categories[index])
  if (unknownFiles.length > 0) {
    return {
      files,
      escalated: true,
      categories: [...new Set(categories.filter(Boolean))].sort(),
      checks: PR_CHECKS,
      detail: `Scope includes paths without a safe focused mapping: ${unknownFiles.join(", ")}.`,
    }
  }

  const uniqueCategories = [...new Set(categories)].sort()
  const checks = [MIGRATION_CHECK]
  if (uniqueCategories.includes("workflow")) {
    checks.push(npmCheck(
      "workflow-unit-tests",
      ["run", "test", "--", "--run", "scripts/workflow"],
      "Ran every workflow-script unit test.",
    ))
    checks.push(npmCheck(
      "workflow-lint",
      ["exec", "--", "eslint", "scripts/workflow/*.mjs"],
      "Linted every workflow script and workflow test.",
    ))
  }
  if (uniqueCategories.includes("db-preflight")) {
    checks.push(npmCheck(
      "db-preflight-unit-tests",
      [
        "run",
        "test",
        "--",
        "--run",
        "scripts/db-preflight.test.mjs",
      ],
      "Ran the canonical database-preflight unit tests.",
    ))
    checks.push(npmCheck(
      "db-preflight-lint",
      [
        "exec",
        "--",
        "eslint",
        "scripts/db-preflight.mjs",
        "scripts/db-preflight-core.mjs",
        "scripts/db-preflight.test.mjs",
      ],
      "Linted the database-preflight implementation and tests.",
    ))
  }

  return {
    files,
    escalated: false,
    categories: uniqueCategories,
    checks,
    detail: `Focused mapping selected ${checks.length} check(s) for ${files.length} changed file(s).`,
  }
}

function gitChangedFiles(base, commandRunner) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}^~:-]*$/u.test(base ?? "")) {
    return { files: [], unknown: true, detail: "Base/ref format is invalid." }
  }
  const verified = commandRunner(
    "git",
    ["rev-parse", "--verify", `${base}^{commit}`],
    repositoryRoot,
  )
  if (verified.exitCode !== 0) {
    return { files: [], unknown: true, detail: `Base/ref ${base} could not be resolved.` }
  }
  const changed = commandRunner(
    "git",
    ["diff", "--name-only", "--diff-filter=ACDMRTUXB", base, "--"],
    repositoryRoot,
  )
  const untracked = commandRunner(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    repositoryRoot,
  )
  if (changed.exitCode !== 0 || untracked.exitCode !== 0) {
    return { files: [], unknown: true, detail: "Changed-file scope could not be determined." }
  }
  return {
    files: [changed.stdout, untracked.stdout]
      .join("\n")
      .split(/\r?\n/u)
      .filter(Boolean),
    unknown: false,
    detail: `Changed files resolved against ${base}.`,
  }
}

function finishReport(report) {
  const failed = report.checks.some((item) => item.status === "FAIL")
  const unavailable = report.checks.some((item) => item.status === "UNAVAILABLE")
  report.status = failed ? "FAIL" : unavailable ? "UNAVAILABLE" : "PASS"
  assertSecretSafe(report, "verification report")
  return report
}

export function runPrVerification(options = {}) {
  const commandRunner = options.commandRunner ?? defaultCommandRunner
  const checks = PR_CHECKS.map((definition) => runCheck(
    definition,
    commandRunner,
  ))
  return finishReport({
    schemaVersion: 1,
    requestedTier: "PR",
    effectiveTier: "PR",
    status: "PASS",
    scope: null,
    checks,
    note: "PR verification composes repository integrity, full local verification, build, and migration-tooling tests. Exact-head CI migration smoke remains a separate merge gate.",
  })
}

export function runFocusedVerification({
  files,
  base,
  commandRunner = defaultCommandRunner,
} = {}) {
  let scope
  if (files?.length) {
    scope = { files, unknown: false, detail: "Explicit changed-file scope supplied." }
  } else {
    scope = gitChangedFiles(base, commandRunner)
  }

  let plan
  if (scope.unknown) {
    plan = {
      files: [],
      escalated: true,
      categories: [],
      checks: PR_CHECKS,
      detail: `${scope.detail} Escalating to PR verification.`,
    }
  } else {
    plan = planFocusedVerification(scope.files)
  }

  const scopeStatus = plan.files.length === 0 && !plan.escalated
    ? "SKIPPED"
    : "PASS"
  const checks = [check(
    "changed-file-scope",
    scopeStatus,
    plan.detail,
  )]
  checks.push(...plan.checks.map((definition) => runCheck(
    definition,
    commandRunner,
  )))

  return finishReport({
    schemaVersion: 1,
    requestedTier: "FOCUSED",
    effectiveTier: plan.escalated ? "PR" : "FOCUSED",
    status: "PASS",
    scope: {
      base: base ?? null,
      files: plan.files,
      categories: plan.categories,
    },
    checks,
    note: plan.escalated
      ? "Focused verification did not claim confidence; the command ran the PR tier."
      : "Focused verification covers only the explicit mapped scope and is not full PR confidence.",
  })
}

export function runReleaseVerification({
  args = [],
  commandRunner = defaultCommandRunner,
} = {}) {
  const releaseScript = resolve(scriptDirectory, "release-status.mjs")
  const result = commandRunner(
    process.execPath,
    [releaseScript, "--json", ...args],
    webDirectory,
  )
  let releaseReport = null
  let validation = null
  try {
    releaseReport = JSON.parse(result.stdout)
    validation = validateReleaseReport(releaseReport)
  } catch {
    // The check below records malformed or missing release evidence.
  }

  let releaseCheck
  if (result.exitCode !== 0 || !validation?.valid) {
    releaseCheck = check(
      "release-status",
      "FAIL",
      result.exitCode !== 0 && releaseReport?.nextAction
        ? releaseReport.nextAction
        : validation?.detail
          ?? "Release status returned malformed JSON or did not complete successfully.",
      `<node> release-status.mjs --json ${args.join(" ")}`.trim(),
    )
  } else {
    const unavailable = releaseReport.warnings?.length > 0
      || releaseReport.checks?.some(
        (item) => ["WARN", "SKIP"].includes(item.status),
      )
    releaseCheck = check(
      "release-status",
      unavailable ? "UNAVAILABLE" : "PASS",
      unavailable
        ? "Release status passed with explicitly unavailable or inconclusive external evidence."
        : "Existing release/status workflow passed with complete required evidence.",
      `<node> release-status.mjs --json ${args.join(" ")}`.trim(),
    )
  }

  return finishReport({
    schemaVersion: 1,
    requestedTier: "RELEASE",
    effectiveTier: "RELEASE",
    status: "PASS",
    scope: null,
    checks: [releaseCheck],
    releaseReport,
    note: "Release verification is read-only and delegates commit, deployment, manifest, project, and exact-SHA CI binding to rg:release:status.",
  })
}

export function validateReleaseReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return { valid: false, detail: "Release status must return one JSON object." }
  }
  if (!["PASS", "ACTION_REQUIRED", "BLOCKED"].includes(report.status)) {
    return { valid: false, detail: "Release status returned a missing or unknown status." }
  }
  if (report.status !== "PASS") {
    return { valid: false, detail: "Release status explicitly did not pass." }
  }
  if (
    report.schemaVersion !== 1
    || !report.binding
    || typeof report.binding !== "object"
    || Array.isArray(report.binding)
    || !Array.isArray(report.checks)
    || report.checks.length === 0
    || !Array.isArray(report.warnings)
    || typeof report.nextAction !== "string"
    || !report.nextAction.trim()
  ) {
    return { valid: false, detail: "Release PASS is missing required report fields." }
  }
  const binding = report.binding
  if (
    typeof binding.repository !== "string"
    || !binding.repository.trim()
    || typeof binding.branch !== "string"
    || !binding.branch.trim()
    || !/^[0-9a-f]{40}$/u.test(binding.expectedSha ?? "")
    || !/^[0-9a-f]{40}$/u.test(binding.deployedSha ?? "")
    || binding.deployedSha !== binding.expectedSha
    || typeof binding.expectedProjectRef !== "string"
    || !binding.expectedProjectRef.trim()
    || binding.deployedProjectRef !== binding.expectedProjectRef
    || typeof binding.expectedMigration !== "string"
    || !binding.expectedMigration.trim()
  ) {
    return { valid: false, detail: "Release PASS has incomplete or contradictory binding evidence." }
  }
  const recognizedStatuses = new Set(["PASS", "WARN", "SKIP", "FAIL"])
  const validChecks = report.checks.every((item) => (
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof item.name === "string"
    && item.name.trim()
    && recognizedStatuses.has(item.status)
    && typeof item.authority === "string"
    && item.authority.trim()
    && typeof item.detail === "string"
  ))
  if (!validChecks || report.checks.some((item) => item.status === "FAIL")) {
    return { valid: false, detail: "Release PASS contains malformed or failed evidence." }
  }
  const requiredNames = [
    "github-repository",
    "branch-head",
    "exact-sha-ci",
    "production-manifest",
    "deployed-sha",
    "supabase-project-ref",
  ]
  if (!requiredNames.every((name) => report.checks.some((item) => item.name === name))) {
    return { valid: false, detail: "Release PASS is missing required authoritative checks." }
  }
  const bindingChecksPassed = [
    "production-manifest",
    "deployed-sha",
    "supabase-project-ref",
  ].every((name) => report.checks.some((item) => (
    item.name === name && item.status === "PASS"
  )))
  if (!bindingChecksPassed) {
    return { valid: false, detail: "Release PASS is missing required deployment binding evidence." }
  }
  return { valid: true, detail: "Release report contract is complete." }
}

export function renderVerificationText(report) {
  const lines = [
    `${report.requestedTier} verification: ${report.status}`,
    `Effective tier: ${report.effectiveTier}`,
    ...report.checks.map(
      (item) => `- ${item.name}: ${item.status} - ${item.detail}`,
    ),
    report.note,
  ]
  for (const item of report.checks) {
    if (item.status === "FAIL" && item.output?.trim()) {
      lines.push(`Failure output (${item.name}):`, item.output.trim())
    }
  }
  return lines.join("\n")
}

export function renderVerificationJson(report) {
  const structured = {
    ...report,
    checks: report.checks.map(({ output: _output, ...item }) => item),
  }
  const output = `${JSON.stringify(structured, null, 2)}\n`
  assertSafeOutput(output)
  return output
}

function takeSingleFlag(seen, argument) {
  if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`)
  seen.add(argument)
}

function takeValue(argv, index, argument, seen) {
  takeSingleFlag(seen, argument)
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) {
    throw new Error(`${argument} requires a value`)
  }
  return value
}

export function parseVerificationArgs(argv) {
  const [tier, ...rest] = argv
  if (!["focused", "pr", "release"].includes(tier)) {
    throw new Error(
      "Usage: verification.mjs focused (--base REF | --file PATH...) [--json] | pr [--json] | release [--json] [release options]",
    )
  }
  const seen = new Set()
  let json = false
  const values = []
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (argument === "--json") {
      takeSingleFlag(seen, argument)
      json = true
    } else if (tier === "focused" && argument === "--file") {
      const value = rest[index + 1]
      if (!value || value.startsWith("--")) throw new Error("--file requires a value")
      values.push([argument, value])
      index += 1
    } else if (tier === "focused" && argument === "--base") {
      values.push([argument, takeValue(rest, index, argument, seen)])
      index += 1
    } else if (tier === "release" && argument === "--historical") {
      takeSingleFlag(seen, argument)
      values.push([argument, null])
    } else if (tier === "release" && RELEASE_VALUE_OPTIONS.has(argument)) {
      values.push([argument, takeValue(rest, index, argument, seen)])
      index += 1
    } else {
      throw new Error(`Unexpected ${tier}-verification argument: ${argument}`)
    }
  }
  if (tier === "pr") return { tier, json, args: [] }
  if (tier === "release") {
    const releaseValues = Object.fromEntries(values.filter(([, value]) => value !== null))
    if (releaseValues["--repository"] && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(releaseValues["--repository"])) {
      throw new Error("--repository must use owner/repo format")
    }
    if (releaseValues["--branch"] && !REF_PATTERN.test(releaseValues["--branch"])) {
      throw new Error("--branch must be a valid Git ref")
    }
    if (releaseValues["--expected-sha"] && !/^[0-9a-f]{40}$/u.test(releaseValues["--expected-sha"])) {
      throw new Error("--expected-sha must be a full lowercase Git SHA")
    }
    if (releaseValues["--expected-project-ref"] && !/^[a-z0-9]{20}$/u.test(releaseValues["--expected-project-ref"])) {
      throw new Error("--expected-project-ref must be a 20-character project ref")
    }
    if (releaseValues["--production-url"]) {
      let target
      try {
        target = new URL(releaseValues["--production-url"])
      } catch {
        throw new Error("--production-url must be a valid HTTPS URL")
      }
      if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) {
        throw new Error("--production-url must be a credential-free HTTPS URL")
      }
    }
    return {
      tier,
      json,
      args: values.flatMap(([name, value]) => value === null ? [name] : [name, value]),
    }
  }

  let base = null
  const files = []
  for (const [name, value] of values) {
    if (name === "--base") base = value
    else files.push(value)
  }
  if ((!base && files.length === 0) || (base && files.length > 0)) {
    throw new Error("Focused verification requires exactly one scope: --base or one or more --file values")
  }
  if (base && !REF_PATTERN.test(base)) throw new Error("--base must be a valid Git ref")
  if (files.some((path) => !PATH_PATTERN.test(path))) {
    throw new Error("--file must be a repository-relative path")
  }
  return { tier, json, base, files }
}

async function main(argv = process.argv.slice(2)) {
  const options = parseVerificationArgs(argv)
  const report = options.tier === "focused"
    ? runFocusedVerification(options)
    : options.tier === "pr"
      ? runPrVerification()
      : runReleaseVerification({ args: options.args })
  process.stdout.write(
    options.json
      ? renderVerificationJson(report)
      : `${renderVerificationText(report)}\n`,
  )
  if (report.status !== "PASS") process.exitCode = 1
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
