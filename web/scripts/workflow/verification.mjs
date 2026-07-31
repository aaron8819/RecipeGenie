import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
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
const REQUIRED_RELEASE_CHECKS = [
  "github-repository",
  "branch-head",
  "exact-sha-ci",
  "production-manifest",
  "deployed-sha",
  "supabase-project-ref",
]
const OPTIONAL_RELEASE_CHECKS = new Set(["deployment-record"])
const VERIFICATION_USAGE = "verification.mjs focused (--base REF | --file PATH...) [--json] | pr [--json] | release [--json] [release options]"
const RUNTIME_SHIM_NAMES = process.platform === "win32"
  ? [
    "node", "node.com", "node.exe", "node.cmd", "node.bat", "node.ps1",
    "npm", "npm.com", "npm.exe", "npm.cmd", "npm.bat", "npm.ps1",
    "npx", "npx.com", "npx.exe", "npx.cmd", "npx.bat", "npx.ps1",
  ]
  : ["node", "npm", "npx"]

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

function environmentValue(environment, name) {
  const entry = Object.entries(environment).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )
  return entry?.[1]
}

const PLATFORM_ENVIRONMENT_KEYS = [
  "APPDATA",
  "CI",
  "COLORTERM",
  "FORCE_COLOR",
  "GITHUB_ACTIONS",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "NEXT_TELEMETRY_DISABLED",
  "NO_COLOR",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "SystemDrive",
  "SystemRoot",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USERPROFILE",
  "windir",
]
const RELEASE_ENVIRONMENT_KEYS = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "RG_BRANCH",
  "RG_EXPECTED_GIT_SHA",
  "RG_EXPECTED_SUPABASE_PROJECT_REF",
  "RG_PRODUCTION_URL",
  "RG_REPOSITORY",
  "RECIPE_GENIE_PRODUCTION_PROJECT_REF",
]

function containsRuntimeShim(directory) {
  return RUNTIME_SHIM_NAMES.some((name) => existsSync(join(directory, name)))
}

export function createTrustedChildEnvironment({
  environment = process.env,
  nodeExecutable = process.execPath,
  npmExecutable = resolveTrustedNpmCli(nodeExecutable),
  platform = process.platform,
  mode = "ordinary",
} = {}) {
  const runtimeDirectory = dirname(nodeExecutable)
  const localBinDirectory = resolve(webDirectory, "node_modules", ".bin")
  if (containsRuntimeShim(localBinDirectory)) {
    throw new Error("The project-local executable directory contains an unexpected Node/npm runtime shim.")
  }
  const comparison = (value) => platform === "win32"
    ? resolve(value).toLowerCase()
    : resolve(value)
  const systemRoot = "C:\\Windows"
  const programFiles = "C:\\Program Files"
  const trustedSystemPaths = platform === "win32"
    ? [
      join(systemRoot, "System32"),
      systemRoot,
      join(systemRoot, "System32", "Wbem"),
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      join(programFiles, "PowerShell", "7"),
      join(programFiles, "Git", "cmd"),
    ]
    : ["/usr/local/bin", "/usr/bin", "/bin", "/usr/local/sbin", "/usr/sbin", "/sbin"]
  const trustedPaths = [runtimeDirectory, localBinDirectory, ...trustedSystemPaths]
    .filter(existsSync)
    .filter((value, index, values) => (
      values.findIndex((candidate) => comparison(candidate) === comparison(value)) === index
    ))
  const sanitized = {}
  const allowedKeys = mode === "release"
    ? [...PLATFORM_ENVIRONMENT_KEYS, ...RELEASE_ENVIRONMENT_KEYS]
    : PLATFORM_ENVIRONMENT_KEYS
  for (const key of allowedKeys) {
    const value = environmentValue(environment, key)
    if (value !== undefined) sanitized[key] = value
  }
  if (platform === "win32") {
    sanitized.SystemRoot = systemRoot
    sanitized.windir = systemRoot
    sanitized.ProgramFiles = programFiles
  }
  const shell = platform === "win32"
    ? join(systemRoot, "System32", "cmd.exe")
    : "/bin/sh"
  if (!existsSync(shell)) {
    throw new Error("The trusted platform script shell is unavailable.")
  }
  sanitized[platform === "win32" ? "Path" : "PATH"] = trustedPaths.join(
    platform === "win32" ? ";" : delimiter,
  )
  sanitized.npm_execpath = npmExecutable
  sanitized.npm_node_execpath = nodeExecutable
  sanitized.npm_config_script_shell = shell
  sanitized.npm_config_node_options = ""
  sanitized.npm_config_ignore_scripts = "false"
  sanitized.npm_config_if_present = "false"
  sanitized.npm_config_scripts_prepend_node_path = "true"
  sanitized.npm_config_userconfig = platform === "win32" ? "NUL" : "/dev/null"
  sanitized.npm_config_globalconfig = resolve(dirname(npmExecutable), "..", ".npmrc")
  if (platform === "win32") {
    sanitized.ComSpec = shell
    sanitized.PATHEXT = ".COM;.EXE;.BAT;.CMD"
  } else {
    sanitized.SHELL = shell
  }
  return sanitized
}

const expectedRuntime = readFileSync(resolve(webDirectory, ".nvmrc"), "utf8").trim()

function npmCheck(name, args, coverage) {
  const npmCli = resolveTrustedNpmCli()
  return {
    name,
    command: process.execPath,
    args: [npmCli, ...args],
    commandLabel: `<node> <trusted-npm-cli> ${args.join(" ")}`,
    coverage,
  }
}

function runtimeProbe() {
  return npmCheck(
    "nested-runtime-authority",
    ["run", "--silent", "check:migration-references", "--", "--json"],
    "Verified the effective nested Node and npm executable identities.",
  )
}

function resolveTrustedPowerShell() {
  const candidates = process.platform === "win32"
    ? [
      resolve("C:\\Program Files", "PowerShell", "7", "pwsh.exe"),
      resolve("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ]
    : ["/usr/bin/pwsh", "/usr/local/bin/pwsh", "/opt/microsoft/powershell/7/pwsh"]
  const executable = candidates.find(existsSync)
  if (!executable) {
    throw new Error("A trusted PowerShell executable is unavailable for migration-tooling tests.")
  }
  return executable
}

const MIGRATION_CHECK = Object.freeze({
  name: "migration-reference-integrity",
  command: process.execPath,
  args: [resolve(scriptDirectory, "migration-integrity.mjs")],
  commandLabel: "<node> migration-integrity.mjs",
  coverage: "Validated tracked migration files, checksum coverage, checksums, active endpoint, and documented chain.",
})

function prChecks() {
  return [
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
      command: resolveTrustedPowerShell(),
      args: [
        "-NoProfile",
        "-File",
        resolve(repositoryRoot, "scripts", "database", "tests", "Run-Tests.ps1"),
      ],
      commandLabel: "<trusted-powershell> -NoProfile -File <migration-tooling-tests>",
      coverage: "Ran the repository's PowerShell migration backup, assertion, and preflight tooling tests.",
    },
  ]
}

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "")
}

function check(name, status, detail, command = null) {
  return { name, status, detail, command }
}

function commandLabel(command, args) {
  return [command, ...args].join(" ")
}

function defaultCommandRunner(
  command,
  args,
  cwd,
  childEnvironment = createTrustedChildEnvironment(),
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30 * 60 * 1000,
    env: childEnvironment,
  })
  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  }
}

function runRuntimeProbe(commandRunner, childEnvironment) {
  const probe = runtimeProbe()
  const npmCli = resolveTrustedNpmCli()
  const result = commandRunner(
    probe.command,
    probe.args,
    webDirectory,
    childEnvironment,
  )
  let identity = null
  try {
    identity = JSON.parse(result.stdout)
  } catch {
    // The result below fails closed without exposing child output.
  }
  const valid = result.exitCode === 0
    && !result.error
    && identity?.runtime?.node === expectedRuntime
    && identity?.runtime?.npm === JSON.parse(readFileSync(resolve(dirname(npmCli), "..", "package.json"), "utf8")).version
    && identity?.runtime?.nodeExecutableMatchesLifecycle === true
    && identity?.runtime?.npmExecutableBundledWithNode === true
    && identity?.runtime?.scriptShellTrusted === true
  return check(
    probe.name,
    valid ? "PASS" : "FAIL",
    valid
      ? `Nested executors use Node ${expectedRuntime} and npm ${JSON.parse(readFileSync(resolve(dirname(npmCli), "..", "package.json"), "utf8")).version}.`
      : "Nested runtime identity is missing, malformed, or does not match the pinned Node/npm distribution.",
    probe.commandLabel,
  )
}

function runCheck(definition, commandRunner, cwd = webDirectory, childEnvironment = createTrustedChildEnvironment()) {
  const startedAt = Date.now()
  const result = commandRunner(
    definition.command,
    definition.args,
    definition.cwd ?? cwd,
    childEnvironment,
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
      checks: prChecks(),
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
  const childEnvironment = options.childEnvironment ?? createTrustedChildEnvironment()
  const runtimeAuthority = runRuntimeProbe(commandRunner, childEnvironment)
  const definitions = prChecks()
  const checks = [runtimeAuthority]
  if (runtimeAuthority.status === "PASS") {
    checks.push(...definitions.map((definition) => runCheck(
      definition,
      commandRunner,
      webDirectory,
      childEnvironment,
    )))
  } else {
    checks.push(...definitions.map((definition) => check(
      definition.name,
      "SKIPPED",
      "Required execution was not started because nested runtime authority failed.",
      definition.commandLabel ?? commandLabel(definition.command, definition.args),
    )))
  }
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
  childEnvironment = createTrustedChildEnvironment(),
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
      checks: prChecks(),
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
  if (plan.checks.length > 0) {
    const runtimeAuthority = runRuntimeProbe(commandRunner, childEnvironment)
    checks.push(runtimeAuthority)
    if (runtimeAuthority.status === "PASS") {
      checks.push(...plan.checks.map((definition) => runCheck(
        definition,
        commandRunner,
        webDirectory,
        childEnvironment,
      )))
    } else {
      checks.push(...plan.checks.map((definition) => check(
        definition.name,
        "SKIPPED",
        "Required execution was not started because nested runtime authority failed.",
        definition.commandLabel ?? commandLabel(definition.command, definition.args),
      )))
    }
  }

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
  const childEnvironment = createTrustedChildEnvironment({ mode: "release" })
  const result = commandRunner(
    process.execPath,
    [releaseScript, "--json", ...args],
    webDirectory,
    childEnvironment,
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
    releaseCheck = check(
      "release-status",
      "PASS",
      validation.optionalNonPassing > 0
        ? `All required authoritative release evidence passed; ${validation.optionalNonPassing} optional corroborative result(s) remain visible but do not affect the verdict.`
        : "Existing release/status workflow passed with complete required authoritative evidence.",
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
    releaseAuthorityPolicy: {
      recognized: ["AUTHORITATIVE", "CORROBORATIVE"],
      required: "AUTHORITATIVE",
    },
    releaseAuthorityIdentities: validation?.authorities ?? {},
    releaseAuthorityEvaluation: validation?.evaluatedChecks ?? [],
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
  const recognizedStatuses = new Set(["PASS", "WARN", "SKIP", "UNAVAILABLE", "FAIL"])
  const recognizedAuthorities = new Set(["AUTHORITATIVE", "CORROBORATIVE"])
  const validChecks = report.checks.every((item) => (
    item
    && typeof item === "object"
    && !Array.isArray(item)
    && typeof item.name === "string"
    && item.name.trim()
    && recognizedStatuses.has(item.status)
    && recognizedAuthorities.has(item.authority)
    && typeof item.detail === "string"
  ))
  if (!validChecks) {
    return { valid: false, detail: "Release PASS contains malformed evidence." }
  }
  const checkNames = report.checks.map((item) => item.name)
  if (new Set(checkNames).size !== checkNames.length) {
    return { valid: false, detail: "Release PASS contains duplicate check identities." }
  }
  const suppliedReportIdentities = report.checks
    .filter((item) => Object.hasOwn(item, "identity"))
    .map((item) => item.identity)
  if (suppliedReportIdentities.some((identity) => (
    typeof identity !== "string" || !identity.trim()
  ))) {
    return { valid: false, detail: "Release PASS contains a malformed authority identity." }
  }
  if (new Set(suppliedReportIdentities).size !== suppliedReportIdentities.length) {
    return { valid: false, detail: "Release PASS reuses an authority identity." }
  }
  if (!REQUIRED_RELEASE_CHECKS.every((name) => report.checks.filter((item) => item.name === name).length === 1)) {
    return { valid: false, detail: "Release PASS is missing required authoritative checks." }
  }
  const requiredChecks = REQUIRED_RELEASE_CHECKS.map(
    (name) => report.checks.find((item) => item.name === name),
  )
  if (requiredChecks.some((item) => (
    item.status !== "PASS" || item.authority !== "AUTHORITATIVE"
  ))) {
    return { valid: false, detail: "Release PASS is missing recognized authoritative PASS evidence." }
  }
  const evaluatedChecks = report.checks.map((item) => {
    const required = REQUIRED_RELEASE_CHECKS.includes(item.name)
      || item.authority === "AUTHORITATIVE"
    return {
      name: item.name,
      status: item.status,
      authority: item.authority,
      required,
      warning: item.status === "WARN",
      skipReason: ["SKIP", "UNAVAILABLE"].includes(item.status) ? item.detail : null,
      effect: required
        ? item.status === "PASS" ? "SATISFIES_REQUIRED" : "BLOCKS_PASS"
        : item.status === "FAIL" ? "BLOCKS_PASS" : "NO_EFFECT",
    }
  })
  if (evaluatedChecks.some((item) => item.required && (
    item.authority !== "AUTHORITATIVE" || item.status !== "PASS"
  ))) {
    return { valid: false, detail: "Release PASS contains non-passing or mislabeled required authoritative evidence." }
  }
  if (evaluatedChecks.some((item) => !item.required && !OPTIONAL_RELEASE_CHECKS.has(item.name))) {
    return { valid: false, detail: "Release PASS contains an unknown optional check identity." }
  }
  if (evaluatedChecks.some((item) => !item.required && (
    item.authority !== "CORROBORATIVE" || item.status === "FAIL"
  ))) {
    return { valid: false, detail: "Optional release evidence is malformed, mislabeled, or explicitly failed." }
  }
  const authorityIdentities = [
    `github-repository:${binding.repository.toLowerCase()}`,
    `github-branch:${binding.repository.toLowerCase()}:${binding.branch}:${binding.expectedSha}`,
    `github-checks:${binding.repository.toLowerCase()}:${binding.expectedSha}`,
    `production-manifest:${binding.deployedSha}:${binding.deployedProjectRef}:${binding.expectedMigration}`,
    `deployed-sha:${binding.deployedSha}`,
    `supabase-project:${binding.deployedProjectRef}`,
  ]
  if (authorityIdentities.some((identity) => !identity.trim())) {
    return { valid: false, detail: "Release PASS contains an authority without a stable identity." }
  }
  if (new Set(authorityIdentities).size !== authorityIdentities.length) {
    return { valid: false, detail: "Release PASS reuses an authority identity." }
  }
  const explicitIdentityMode = requiredChecks.some(
    (item) => Object.hasOwn(item, "identity"),
  )
  if (explicitIdentityMode) {
    const suppliedIdentities = requiredChecks.map((item) => item.identity)
    if (suppliedIdentities.some((identity) => (
      typeof identity !== "string" || !identity.trim()
    ))) {
      return { valid: false, detail: "Release PASS contains an authority without a stable identity." }
    }
    if (new Set(suppliedIdentities).size !== suppliedIdentities.length) {
      return { valid: false, detail: "Release PASS reuses an authority identity." }
    }
    if (suppliedIdentities.some((identity, index) => identity !== authorityIdentities[index])) {
      return { valid: false, detail: "Release PASS contains an authority identity that conflicts with its binding." }
    }
  }
  return {
    valid: true,
    detail: "Release report contract is complete.",
    authorities: Object.fromEntries(REQUIRED_RELEASE_CHECKS.map(
      (name, index) => [name, authorityIdentities[index]],
    )),
    evaluatedChecks,
    optionalNonPassing: evaluatedChecks.filter((item) => (
      !item.required && item.status !== "PASS"
    )).length,
  }
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
  if (report.requestedTier === "RELEASE") {
    lines.push(...report.releaseAuthorityEvaluation.map((item) => (
      `- release ${item.name}: ${item.status} [${item.required ? "required" : "optional"}; ${item.authority}; effect=${item.effect}]${item.skipReason ? ` - ${item.skipReason}` : ""}`
    )))
    lines.push(...(report.releaseReport?.warnings ?? []).map((warning) => `WARNING: ${warning}`))
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
      `Usage: ${VERIFICATION_USAGE}`,
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
  const jsonRequested = argv.includes("--json")
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification failed."
    if (jsonRequested) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        command: "verification",
        status: "FAIL",
        error: {
          code: message.startsWith("Usage:") || /argument|option|requires|must|scope/iu.test(message)
            ? "ARGUMENT_ERROR"
            : "RUNTIME_ERROR",
          category: message.startsWith("Usage:") || /argument|option|requires|must|scope/iu.test(message)
            ? "ARGUMENT"
            : "RUNTIME",
          message,
          usage: VERIFICATION_USAGE,
        },
      }, null, 2)}\n`)
    } else {
      process.stderr.write(`${message}\n`)
    }
    process.exitCode = 1
  }
}

if (
  process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main()
}
