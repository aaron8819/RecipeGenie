import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { classifyMigrationImpact } from "./migration-integrity.mjs"
import { assertSafeOutput, assertSecretSafe } from "./state.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const webDirectory = resolve(scriptDirectory, "..", "..")
const repositoryRoot = resolve(webDirectory, "..")
const SHA_PATTERN = /^[0-9a-f]{40}$/u
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const PAGE_SIZE = 100
const MAX_PAGES = 100
const CHECK_LIFECYCLES = new Set([
  "completed", "in_progress", "pending", "queued", "requested", "waiting",
])
const CHECK_CONCLUSIONS = new Set([
  "action_required", "cancelled", "failure", "neutral", "skipped",
  "stale", "startup_failure", "success", "timed_out",
])
const COMMIT_STATES = new Set(["error", "failure", "pending", "success"])
const DEPLOYMENT_STATES = new Set([
  "error", "failure", "inactive", "in_progress", "pending", "queued", "success",
])
const MERGEABLE_STATES = new Set([
  "behind", "blocked", "clean", "dirty", "draft", "has_hooks", "unknown", "unstable",
])
const PR_EVIDENCE_USAGE = "pr-evidence.mjs [--json] [--local-only | [--repository OWNER/REPO] [--pr NUMBER] [--head-sha SHA]]"

function normalizePath(value) {
  return value.replaceAll("\\", "/")
}

function defaultCommandRunner(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  })
  return {
    exitCode: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null,
  }
}

function run(commandRunner, command, args, cwd = repositoryRoot) {
  return commandRunner(command, args, cwd)
}

function outputOrNull(result) {
  return result.exitCode === 0 ? result.stdout.trim() || null : null
}

function parseJson(result) {
  if (result.exitCode !== 0) throw new Error("Evidence query failed.")
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new Error("Evidence query returned malformed JSON.")
  }
}

function githubApi(commandRunner, endpoint, fields = []) {
  const args = ["api", "--method", "GET", endpoint]
  for (const [name, value] of fields) {
    args.push("-f", `${name}=${value}`)
  }
  return parseJson(run(commandRunner, "gh", args))
}

function githubGraphql(commandRunner, query, fields) {
  const args = ["api", "graphql", "-f", `query=${query}`]
  for (const [name, value] of fields) {
    args.push(typeof value === "number" ? "-F" : "-f", `${name}=${value}`)
  }
  return parseJson(run(commandRunner, "gh", args))
}

function assertObjectArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => (
    !item || typeof item !== "object" || Array.isArray(item)
  ))) {
    throw new Error(`${label} page is malformed.`)
  }
  return value
}

function pageFingerprint(value) {
  return JSON.stringify(value)
}

export function githubApiArrayPages(commandRunner, endpoint, fields = [], label = "GitHub collection") {
  const items = []
  const pageFingerprints = new Set()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const current = assertObjectArray(githubApi(
      commandRunner,
      endpoint,
      [...fields, ["per_page", String(PAGE_SIZE)], ["page", String(page)]],
    ), label)
    const fingerprint = pageFingerprint(current)
    if (current.length > 0 && pageFingerprints.has(fingerprint)) {
      throw new Error(`${label} pagination repeated a page.`)
    }
    pageFingerprints.add(fingerprint)
    items.push(...current)
    if (current.length < PAGE_SIZE) return items
  }
  throw new Error(`${label} pagination exceeded ${MAX_PAGES} pages.`)
}

function assertUnique(items, key, label) {
  const seen = new Map()
  for (const item of items) {
    const value = key(item)
    if (value === null || value === undefined || value === "") continue
    const fingerprint = JSON.stringify(item)
    if (seen.has(value)) {
      const conflict = seen.get(value) !== fingerprint
      throw new Error(`${label} contains ${conflict ? "conflicting" : "duplicate"} stable identifiers.`)
    }
    seen.set(value, fingerprint)
  }
}

function addCheck(report, name, status, detail, {
  required = true,
  skipReason = null,
} = {}) {
  report.checks.push({
    name,
    status,
    required,
    skipReason: status === "SKIPPED" ? skipReason ?? detail : null,
    effect: required
      ? status === "PASS" ? "SATISFIES_REQUIRED" : "BLOCKS_PASS"
      : "NO_EFFECT",
    detail,
  })
}

function annotateEvidence(item, required) {
  return {
    ...item,
    required,
    skipReason: item.status === "SKIPPED" ? item.detail : null,
    effect: required
      ? item.status === "PASS" ? "SATISFIES_REQUIRED" : "BLOCKS_PASS"
      : "NO_EFFECT",
  }
}

function addWarning(report, message) {
  if (!report.warnings.includes(message)) report.warnings.push(message)
}

export function recomputeStatus(report) {
  const required = report.checks.filter((item) => item.required)
  if (required.some((item) => item.status === "FAIL")) {
    report.status = "FAIL"
  } else if (required.some((item) => item.status !== "PASS")) {
    report.status = "UNAVAILABLE"
  } else {
    report.status = "PASS"
  }
}

export function repositoryFromRemoteUrl(remoteUrl) {
  const value = remoteUrl?.trim() ?? ""
  const match = value.match(
    /(?:github\.com[/:])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u,
  )
  return match?.[1] ?? null
}

export function evaluateHeadConsistency({
  localHead,
  evidenceHead,
  upstreamHead,
  remoteHead,
  prHead,
}) {
  const heads = {
    local: localHead,
    evidence: evidenceHead,
    upstream: upstreamHead,
    remote: remoteHead,
    pullRequest: prHead,
  }
  const available = Object.entries(heads).filter(([, value]) => value)
  const mismatches = available.filter(([, value]) => value !== evidenceHead)
  return {
    status: mismatches.length > 0 ? "FAIL" : "PASS",
    heads,
    mismatches: mismatches.map(([name]) => name),
    detail: mismatches.length > 0
      ? `Evidence head ${evidenceHead} disagrees with: ${mismatches.map(([name]) => name).join(", ")}.`
      : `All ${available.length} available heads match explicit evidence head ${evidenceHead}.`,
  }
}

export function classifyCheckEvidence({
  checkRuns,
  totalCount,
  statuses,
  expectedSha = null,
  statusEndpoint = null,
}) {
  if (!Array.isArray(checkRuns) || !Number.isSafeInteger(totalCount) || !Array.isArray(statuses)) {
    return { status: "FAIL", detail: "Exact-head check evidence is structurally malformed." }
  }
  if (totalCount !== checkRuns.length) {
    return { status: "FAIL", detail: `Expected ${totalCount} check runs but collected ${checkRuns.length}.` }
  }
  const malformedRuns = checkRuns.filter((item) => (
    !item
    || typeof item !== "object"
    || !Number.isSafeInteger(item.id)
    || typeof item.name !== "string"
    || !item.name.trim()
    || !SHA_PATTERN.test(item.headSha ?? "")
    || !CHECK_LIFECYCLES.has(item.status)
    || (item.status === "completed"
      ? !CHECK_CONCLUSIONS.has(item.conclusion)
      : item.conclusion !== null)
  ))
  const endpointBinding = validateCombinedStatusEndpoint(
    statusEndpoint,
    expectedSha,
  )
  if (endpointBinding.status !== "PASS") {
    return { status: "FAIL", detail: endpointBinding.detail }
  }
  const malformedStatuses = statuses.filter((item) => (
    !item
    || typeof item !== "object"
    || !Number.isSafeInteger(item.id)
    || typeof item.context !== "string"
    || !item.context.trim()
    || (!SHA_PATTERN.test(item.sha ?? "") && endpointBinding.status !== "PASS")
    || !COMMIT_STATES.has(item.state)
    || !Number.isFinite(Date.parse(item.createdAt ?? ""))
  ))
  if (malformedRuns.length || malformedStatuses.length) {
    return {
      status: "FAIL",
      detail: `${malformedRuns.length} malformed/unbound check run(s); ${malformedStatuses.length} malformed/unbound commit status(es).`,
    }
  }
  const mismatchedRuns = checkRuns.filter((item) => expectedSha && item.headSha !== expectedSha)
  const mismatchedStatuses = statuses.filter((item) => (
    expectedSha && (item.sha ?? endpointBinding.returnedSha) !== expectedSha
  ))
  if (mismatchedRuns.length || mismatchedStatuses.length) {
    return {
      status: "FAIL",
      detail: `${mismatchedRuns.length} check run(s) and ${mismatchedStatuses.length} commit status(es) are not bound to the explicit head SHA.`,
    }
  }
  const endpointEvaluation = validateCombinedStatusEndpoint(
    statusEndpoint,
    expectedSha,
    statuses,
  )
  if (endpointEvaluation.status !== "PASS") {
    return { status: "FAIL", detail: endpointEvaluation.detail }
  }
  const pendingRuns = checkRuns.filter(
    (item) => item.status !== "completed",
  )
  const latestStatusesByContext = latestCommitStatuses(statuses)
  const latestStatuses = [...latestStatusesByContext.values()]
  const pendingStatuses = latestStatuses.filter(
    (item) => ["pending", "expected"].includes(item.state),
  )
  const failedRuns = checkRuns.filter((item) => (
    item.status === "completed" && item.conclusion !== "success"
  ))
  const failedStatuses = latestStatuses.filter((item) => ["failure", "error"].includes(item.state))
  if (pendingRuns.length || pendingStatuses.length) {
    return {
      status: "FAIL",
      detail: `${pendingRuns.length + pendingStatuses.length} exact-head check(s) are pending or expected.`,
    }
  }
  if (failedRuns.length || failedStatuses.length) {
    return {
      status: "FAIL",
      detail: `${failedRuns.length + failedStatuses.length} exact-head check(s) failed.`,
    }
  }
  return {
    status: "PASS",
    detail: `All ${totalCount} check run(s) and ${latestStatuses.length} latest commit context(s) passed; ${statuses.length} status-history record(s) were validated.`,
  }
}

function latestCommitStatuses(statuses) {
  const latest = new Map()
  for (const item of statuses) {
    const current = latest.get(item.context)
    if (
      !current
      || comparableTime(item.createdAt) > comparableTime(current.createdAt)
      || (item.createdAt === current.createdAt && item.id > current.id)
    ) {
      latest.set(item.context, item)
    }
  }
  return latest
}

function combinedStatusResult(status, endpoint, expectedSha, detail, consistency) {
  return {
    status,
    requestedSha: expectedSha ?? null,
    returnedSha: endpoint?.sha ?? null,
    state: endpoint?.state ?? null,
    totalCount: endpoint?.totalCount ?? null,
    recordsReturned: endpoint?.recordsReturned ?? null,
    consistency,
    verdictEffect: status === "PASS" ? "SUPPORTS_PASS" : "BLOCKS_PASS",
    detail,
  }
}

function validateCombinedStatusBinding(endpoint, expectedSha) {
  const returnedSha = endpoint?.sha ?? null
  const valid = SHA_PATTERN.test(expectedSha ?? "")
    && SHA_PATTERN.test(returnedSha)
    && returnedSha === expectedSha
  return {
    status: valid ? "PASS" : "FAIL",
    requestedSha: expectedSha ?? null,
    returnedSha,
    state: endpoint?.state ?? null,
    totalCount: endpoint?.totalCount ?? null,
    detail: valid
      ? "Combined commit-status endpoint returned the requested exact-head SHA."
      : "Combined commit-status endpoint SHA is missing, malformed, or does not match the requested exact head.",
  }
}

export function validateCombinedStatusEndpoint(endpoint, expectedSha, statusHistory = null) {
  if (
    !endpoint
    || typeof endpoint !== "object"
    || Array.isArray(endpoint)
    || !SHA_PATTERN.test(endpoint.sha ?? "")
    || !COMMIT_STATES.has(endpoint.state)
    || !Number.isSafeInteger(endpoint.totalCount)
    || endpoint.totalCount < 0
    || !Number.isSafeInteger(endpoint.recordsReturned)
    || endpoint.recordsReturned < 0
    || !Array.isArray(endpoint.statuses)
  ) {
    return combinedStatusResult(
      "FAIL",
      endpoint,
      expectedSha,
      "Combined commit-status endpoint evidence is malformed or missing its own SHA, state, count, or records.",
      false,
    )
  }
  if (!SHA_PATTERN.test(expectedSha ?? "") || endpoint.sha !== expectedSha) {
    return combinedStatusResult(
      "FAIL",
      endpoint,
      expectedSha,
      "Combined commit-status endpoint SHA does not match the requested exact head.",
      false,
    )
  }
  const malformedEndpointStatuses = endpoint.statuses.filter((item) => (
    !item
    || typeof item !== "object"
    || Array.isArray(item)
    || !Number.isSafeInteger(item.id)
    || typeof item.context !== "string"
    || !item.context.trim()
    || !COMMIT_STATES.has(item.state)
    || !Number.isFinite(Date.parse(item.createdAt ?? ""))
    || (item.sha !== null && item.sha !== undefined && item.sha !== expectedSha)
  ))
  const endpointContexts = endpoint.statuses.map((item) => item?.context)
  const endpointIds = endpoint.statuses.map((item) => item?.id)
  if (
    malformedEndpointStatuses.length > 0
    || endpoint.totalCount !== endpoint.recordsReturned
    || endpoint.recordsReturned !== endpoint.statuses.length
    || new Set(endpointContexts).size !== endpointContexts.length
    || new Set(endpointIds).size !== endpointIds.length
  ) {
    return combinedStatusResult(
      "FAIL",
      endpoint,
      expectedSha,
      "Combined commit-status endpoint count or latest-context records are malformed, duplicated, or inconsistent.",
      false,
    )
  }
  if (statusHistory === null) {
    const successful = endpoint.state === "success"
    return combinedStatusResult(
      successful ? "PASS" : "FAIL",
      endpoint,
      expectedSha,
      successful
        ? "Combined commit-status endpoint returned a successful exact-head state with internally consistent response metadata."
        : `Combined commit-status endpoint state ${endpoint.state} blocks PASS.`,
      true,
    )
  }
  if (!Array.isArray(statusHistory)) {
    return combinedStatusResult("FAIL", endpoint, expectedSha, "Complete commit-status history is unavailable.", false)
  }
  const latestByContext = latestCommitStatuses(statusHistory)
  if (endpoint.totalCount !== latestByContext.size) {
    return combinedStatusResult(
      "FAIL",
      endpoint,
      expectedSha,
      `Combined commit-status count ${endpoint.totalCount} disagrees with ${latestByContext.size} latest context(s) in complete status history.`,
      false,
    )
  }
  const endpointRecordsMatchHistory = endpoint.statuses.every((item) => {
    const latest = latestByContext.get(item.context)
    return latest
      && latest.id === item.id
      && latest.state === item.state
      && latest.createdAt === item.createdAt
  })
  if (!endpointRecordsMatchHistory) {
    return combinedStatusResult(
      "FAIL",
      endpoint,
      expectedSha,
      "Combined commit-status records contradict the latest records in complete status history.",
      false,
    )
  }
  const latestStates = [...latestByContext.values()].map((item) => item.state)
  const calculatedState = latestStates.some((state) => ["failure", "error"].includes(state))
    ? "failure"
    : latestStates.length === 0 || latestStates.includes("pending")
      ? "pending"
      : "success"
  if (endpoint.state !== calculatedState) {
    return combinedStatusResult(
      "FAIL",
      endpoint,
      expectedSha,
      `Combined commit-status state ${endpoint.state} contradicts calculated state ${calculatedState}.`,
      false,
    )
  }
  return combinedStatusResult(
    endpoint.state === "success" ? "PASS" : "FAIL",
    endpoint,
    expectedSha,
    endpoint.state === "success"
      ? `Combined commit-status state success and count ${endpoint.totalCount} agree with complete status history.`
      : `Combined commit-status endpoint state ${endpoint.state} blocks PASS.`,
    true,
  )
}

function collectLocalGit(commandRunner) {
  const topLevel = outputOrNull(run(
    commandRunner,
    "git",
    ["rev-parse", "--show-toplevel"],
  ))
  if (!topLevel) throw new Error("Current directory is not a Git worktree.")
  const branch = outputOrNull(run(
    commandRunner,
    "git",
    ["branch", "--show-current"],
    topLevel,
  ))
  const head = outputOrNull(run(
    commandRunner,
    "git",
    ["rev-parse", "HEAD"],
    topLevel,
  ))
  if (!head || !SHA_PATTERN.test(head)) throw new Error("Local HEAD is unavailable.")
  const status = run(
    commandRunner,
    "git",
    ["status", "--porcelain=v1"],
    topLevel,
  )
  if (status.exitCode !== 0) throw new Error("Git worktree state is unavailable.")
  const upstream = outputOrNull(run(
    commandRunner,
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    topLevel,
  ))
  const upstreamHead = upstream
    ? outputOrNull(run(commandRunner, "git", ["rev-parse", upstream], topLevel))
    : null
  const remoteUrl = outputOrNull(run(
    commandRunner,
    "git",
    ["remote", "get-url", "origin"],
    topLevel,
  ))
  return {
    topLevel: normalizePath(topLevel),
    branch,
    head,
    dirty: Boolean(status.stdout.trim()),
    upstream,
    upstreamHead,
    remoteUrl,
  }
}

function collectRemoteHead(commandRunner, branch, cwd) {
  if (!branch) return { status: "SKIPPED", head: null, detail: "Detached HEAD has no remote branch." }
  const result = run(
    commandRunner,
    "git",
    ["ls-remote", "--heads", "origin", `refs/heads/${branch}`],
    cwd,
  )
  if (result.exitCode !== 0) {
    return { status: "UNAVAILABLE", head: null, detail: "Remote branch evidence is unavailable." }
  }
  const head = result.stdout.trim().split(/\s+/u)[0] || null
  if (!head) return { status: "SKIPPED", head: null, detail: "Remote branch does not exist." }
  if (!SHA_PATTERN.test(head)) {
    return { status: "UNAVAILABLE", head: null, detail: "Remote branch returned an invalid SHA." }
  }
  return { status: "PASS", head, detail: `Remote branch head is ${head}.` }
}

function selectPullRequest(pulls) {
  if (!Array.isArray(pulls) || pulls.length === 0) return null
  return [...pulls].sort((left, right) => {
    if ((left.state === "open") !== (right.state === "open")) {
      return left.state === "open" ? -1 : 1
    }
    return right.number - left.number
  })[0]
}

function simplifyUser(value) {
  return value?.login ?? null
}

function simplifyReview(review) {
  return {
    state: review.state ?? null,
    submittedAt: review.submitted_at ?? null,
    url: review.html_url ?? null,
    author: simplifyUser(review.user),
    body: review.body ?? "",
  }
}

function simplifyComment(comment) {
  return {
    url: comment.html_url ?? null,
    author: simplifyUser(comment.user),
    createdAt: comment.created_at ?? null,
    path: comment.path ?? null,
    line: comment.line ?? comment.original_line ?? null,
    body: comment.body ?? "",
  }
}

function validReview(review) {
  return Number.isSafeInteger(review.id)
    && ["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"].includes(review.state)
    && typeof review.body === "string"
    && (review.submitted_at === null || review.submitted_at === undefined || Number.isFinite(Date.parse(review.submitted_at)))
}

function validComment(comment) {
  return Number.isSafeInteger(comment.id)
    && typeof comment.body === "string"
    && typeof comment.html_url === "string"
    && Number.isFinite(Date.parse(comment.created_at ?? ""))
}

function validAnnotation(annotation) {
  return typeof annotation.path === "string"
    && annotation.path.length > 0
    && Number.isSafeInteger(annotation.start_line)
    && annotation.start_line > 0
    && Number.isSafeInteger(annotation.end_line)
    && annotation.end_line >= annotation.start_line
    && ["failure", "notice", "warning"].includes(annotation.annotation_level)
    && typeof annotation.message === "string"
}

function validPullRequest(pullRequest) {
  return pullRequest
    && typeof pullRequest === "object"
    && !Array.isArray(pullRequest)
    && Number.isSafeInteger(pullRequest.number)
    && pullRequest.number > 0
    && Number.isSafeInteger(pullRequest.changed_files)
    && pullRequest.changed_files >= 0
    && typeof pullRequest.html_url === "string"
    && ["open", "closed"].includes(pullRequest.state)
    && typeof pullRequest.draft === "boolean"
    && typeof pullRequest.base?.ref === "string"
    && SHA_PATTERN.test(pullRequest.base?.sha ?? "")
    && typeof pullRequest.head?.ref === "string"
    && SHA_PATTERN.test(pullRequest.head?.sha ?? "")
}

export function evaluateMergeability(pullRequest) {
  const mergeablePresent = Boolean(pullRequest)
    && Object.hasOwn(pullRequest, "mergeable")
  const mergeStatePresent = Boolean(pullRequest)
    && Object.hasOwn(pullRequest, "mergeable_state")
  const mergeable = pullRequest?.mergeable
  const mergeState = pullRequest?.mergeable_state
  const raw = {
    mergeablePresent,
    mergeStatePresent,
    mergeable: mergeable ?? null,
    mergeableState: mergeState ?? null,
  }
  if (mergeable === null && mergeState === "unknown") {
    return {
      ...raw,
      status: "UNAVAILABLE",
      detail: "PR mergeability is pending authoritative GitHub computation.",
    }
  }
  if (typeof mergeable !== "boolean" || !MERGEABLE_STATES.has(mergeState)) {
    return {
      ...raw,
      status: "FAIL",
      detail: "PR mergeability fields are missing, malformed, null, or unknown.",
    }
  }
  if (mergeable === true && mergeState === "clean") {
    return {
      ...raw,
      status: "PASS",
      detail: "PR mergeability is explicitly true with a clean merge state.",
    }
  }
  return {
    ...raw,
    status: "FAIL",
    detail: `PR mergeability combination is not accepted: mergeable=${mergeable}; state=${mergeState}.`,
  }
}

function blockingReviewState(reviews, requested) {
  const latestByAuthor = new Map()
  for (const review of reviews) {
    const author = review.author ?? "unknown"
    if (review.state === "COMMENTED") continue
    latestByAuthor.set(author, review.state)
  }
  const changesRequested = [...latestByAuthor.values()].filter(
    (state) => state === "CHANGES_REQUESTED",
  ).length
  const requestedCount = requested.users.length + requested.teams.length
  return {
    changesRequested,
    requestedCount,
    status: changesRequested || requestedCount ? "FAIL" : "PASS",
    detail: `${changesRequested} active changes-requested review(s); ${requestedCount} outstanding review request(s).`,
  }
}

export function collectReviewRequests(commandRunner, repository, prNumber) {
  const users = []
  const teams = []
  const fingerprints = new Set()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = githubApi(
      commandRunner,
      `repos/${repository}/pulls/${prNumber}/requested_reviewers`,
      [["per_page", String(PAGE_SIZE)], ["page", String(page)]],
    )
    const currentUsers = assertObjectArray(response?.users, "requested reviewers")
    const currentTeams = assertObjectArray(response?.teams, "requested teams")
    const fingerprint = pageFingerprint({ users: currentUsers, teams: currentTeams })
    if ((currentUsers.length || currentTeams.length) && fingerprints.has(fingerprint)) {
      throw new Error("Review-request pagination repeated a page.")
    }
    fingerprints.add(fingerprint)
    users.push(...currentUsers)
    teams.push(...currentTeams)
    if (currentUsers.length < PAGE_SIZE && currentTeams.length < PAGE_SIZE) {
      assertUnique(users, (item) => item.id, "requested reviewers")
      assertUnique(teams, (item) => item.id, "requested teams")
      if (users.some((item) => !Number.isSafeInteger(item.id) || typeof item.login !== "string")) {
        throw new Error("Requested reviewer evidence is malformed.")
      }
      if (teams.some((item) => !Number.isSafeInteger(item.id) || typeof item.slug !== "string")) {
        throw new Error("Requested team evidence is malformed.")
      }
      return { users, teams }
    }
  }
  throw new Error(`Review-request pagination exceeded ${MAX_PAGES} pages.`)
}

async function localChangedFiles(commandRunner, git) {
  const candidates = ["main", "origin/main"]
  let changed = null
  for (const base of candidates) {
    const result = run(
      commandRunner,
      "git",
      ["diff", "--name-only", base, "--"],
      git.topLevel,
    )
    if (result.exitCode === 0) {
      changed = result.stdout.split(/\r?\n/u).filter(Boolean)
      break
    }
  }
  const untracked = run(
    commandRunner,
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    git.topLevel,
  )
  if (untracked.exitCode === 0) {
    changed = [
      ...(changed ?? []),
      ...untracked.stdout.split(/\r?\n/u).filter(Boolean),
    ]
  }
  const files = [...new Set(changed ?? [])].map(normalizePath).sort()
  const contentsByPath = {}
  await Promise.all(files.map(async (path) => {
    try {
      contentsByPath[path] = await readFile(resolve(git.topLevel, path), "utf8")
    } catch {
      contentsByPath[path] = ""
    }
  }))
  return { files, contentsByPath }
}

function queryPullRequest(commandRunner, repository, branch, number) {
  if (number) return githubApi(commandRunner, `repos/${repository}/pulls/${number}`)
  if (!branch) return null
  const owner = repository.split("/")[0]
  const pulls = githubApiArrayPages(
    commandRunner,
    `repos/${repository}/pulls`,
    [["state", "all"], ["head", `${owner}:${branch}`]],
    "pull requests",
  )
  return selectPullRequest(pulls)
}

export function collectReviewThreads(commandRunner, repository, prNumber) {
  const [owner, name] = repository.split("/")
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $cursor) {
            totalCount
            nodes { id isResolved path line }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `
  const nodes = []
  const cursors = new Set()
  let cursor = ""
  let totalCount = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const fields = [
      ["owner", owner],
      ["name", name],
      ["number", prNumber],
    ]
    if (cursor) fields.push(["cursor", cursor])
    const response = githubGraphql(commandRunner, query, fields)
    const connection = response?.data?.repository?.pullRequest?.reviewThreads
    const current = assertObjectArray(connection?.nodes, "review threads")
    if (!Number.isSafeInteger(connection?.totalCount) || connection.totalCount < 0) {
      throw new Error("Review-thread total count is malformed.")
    }
    if (totalCount !== null && totalCount !== connection.totalCount) {
      throw new Error("Review-thread total count changed during pagination.")
    }
    totalCount = connection.totalCount
    nodes.push(...current)
    const pageInfo = connection.pageInfo
    if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
      throw new Error("Review-thread pagination metadata is malformed.")
    }
    if (!pageInfo.hasNextPage) {
      if (nodes.length !== totalCount) throw new Error("Review-thread collection is truncated.")
      assertUnique(nodes, (item) => item.id, "review threads")
      return { totalCount, nodes }
    }
    if (typeof pageInfo.endCursor !== "string" || !pageInfo.endCursor || cursors.has(pageInfo.endCursor)) {
      throw new Error("Review-thread pagination repeated or omitted a cursor.")
    }
    cursors.add(pageInfo.endCursor)
    cursor = pageInfo.endCursor
  }
  throw new Error(`Review-thread pagination exceeded ${MAX_PAGES} pages.`)
}

export function collectExactHeadChecks(commandRunner, repository, headSha) {
  const combinedStatuses = []
  const combinedFingerprints = new Set()
  let combinedSha = null
  let combinedState = null
  let combinedTotalCount = null
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const combinedResponse = githubApi(
      commandRunner,
      `repos/${repository}/commits/${headSha}/status`,
      [["per_page", String(PAGE_SIZE)], ["page", String(page)]],
    )
    const current = assertObjectArray(
      combinedResponse?.statuses,
      "combined commit statuses",
    )
    if (
      !SHA_PATTERN.test(combinedResponse?.sha ?? "")
      || !COMMIT_STATES.has(combinedResponse?.state)
      || !Number.isSafeInteger(combinedResponse?.total_count)
      || combinedResponse.total_count < 0
    ) throw new Error("Combined commit-status response metadata is malformed.")
    if (combinedTotalCount !== null && (
      combinedResponse.sha !== combinedSha
      || combinedResponse.state !== combinedState
      || combinedResponse.total_count !== combinedTotalCount
    )) throw new Error("Combined commit-status response metadata changed during pagination.")
    combinedSha = combinedResponse.sha
    combinedState = combinedResponse.state
    combinedTotalCount = combinedResponse.total_count
    const fingerprint = pageFingerprint(current)
    if (current.length > 0 && combinedFingerprints.has(fingerprint)) {
      throw new Error("Combined commit-status pagination repeated a page.")
    }
    combinedFingerprints.add(fingerprint)
    combinedStatuses.push(...current)
    if (combinedStatuses.length > combinedTotalCount) {
      throw new Error("Combined commit-status pagination exceeded its total count.")
    }
    if (combinedStatuses.length === combinedTotalCount) break
    if (current.length < PAGE_SIZE) throw new Error("Combined commit-status collection is truncated.")
    if (page === MAX_PAGES) throw new Error(`Combined commit-status pagination exceeded ${MAX_PAGES} pages.`)
  }
  if (combinedStatuses.length !== combinedTotalCount) {
    throw new Error("Combined commit-status collection is incomplete.")
  }
  const statusEndpoint = {
    sha: combinedSha,
    state: combinedState,
    totalCount: combinedTotalCount,
    recordsReturned: combinedStatuses.length,
    statuses: combinedStatuses.map((item) => ({
      id: item.id ?? null,
      context: item.context ?? null,
      state: item.state ?? null,
      sha: item.sha ?? null,
      createdAt: item.created_at ?? null,
    })),
  }
  const statusEndpointBinding = validateCombinedStatusBinding(
    statusEndpoint,
    headSha,
  )
  const rawRuns = []
  let totalCount = null
  const fingerprints = new Set()
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = githubApi(
      commandRunner,
      `repos/${repository}/commits/${headSha}/check-runs`,
      [["per_page", String(PAGE_SIZE)], ["page", String(page)]],
    )
    if (!Number.isSafeInteger(response?.total_count) || response.total_count < 0) {
      throw new Error("Check-run total count is malformed.")
    }
    const current = assertObjectArray(response.check_runs, "check runs")
    if (totalCount !== null && response.total_count !== totalCount) {
      throw new Error("Check-run total count changed during pagination.")
    }
    totalCount = response.total_count
    const fingerprint = pageFingerprint(current)
    if (current.length > 0 && fingerprints.has(fingerprint)) {
      throw new Error("Check-run pagination repeated a page.")
    }
    fingerprints.add(fingerprint)
    rawRuns.push(...current)
    if (rawRuns.length > totalCount) throw new Error("Check-run pagination exceeded its total count.")
    if (rawRuns.length === totalCount) break
    if (current.length < PAGE_SIZE) throw new Error("Check-run collection is truncated.")
    if (page === MAX_PAGES) throw new Error(`Check-run pagination exceeded ${MAX_PAGES} pages.`)
  }
  if (rawRuns.length !== totalCount) throw new Error("Check-run collection is incomplete.")
  assertUnique(rawRuns, (item) => item.id, "check runs")
  const rawStatuses = githubApiArrayPages(
    commandRunner,
    `repos/${repository}/commits/${headSha}/statuses`,
    [],
    "commit statuses",
  )
  assertUnique(rawStatuses, (item) => item.id, "commit statuses")
  const checkRuns = rawRuns.map((item) => ({
    id: item.id,
    name: item.name ?? null,
    status: item.status ?? null,
    conclusion: item.conclusion ?? null,
    url: item.html_url ?? item.details_url ?? null,
    startedAt: item.started_at ?? null,
    completedAt: item.completed_at ?? null,
    headSha: item.head_sha ?? null,
    annotations: [],
  }))
  for (const item of checkRuns) {
    if (!Number.isSafeInteger(item.id)) {
      item.annotations = []
      continue
    }
    const annotations = githubApiArrayPages(
      commandRunner,
      `repos/${repository}/check-runs/${item.id}/annotations`,
      [],
      `check-run ${item.id} annotations`,
    )
    if (annotations.some((annotation) => !validAnnotation(annotation))) {
      throw new Error(`Check-run ${item.id} annotations are malformed.`)
    }
    item.annotations = annotations.map((annotation) => ({
      path: annotation.path ?? null,
      startLine: annotation.start_line ?? null,
      endLine: annotation.end_line ?? null,
      level: annotation.annotation_level ?? null,
      title: annotation.title ?? null,
      message: annotation.message ?? "",
    }))
  }
  const statuses = rawStatuses.map((item) => ({
    id: item.id,
    context: item.context ?? null,
    state: item.state ?? null,
    url: item.target_url ?? null,
    sha: item.sha ?? null,
    createdAt: item.created_at ?? null,
  }))
  return {
    headSha,
    totalCount,
    checkRuns,
    statuses,
    statusEndpoint,
    statusEndpointBinding,
    statusEndpointEvaluation: validateCombinedStatusEndpoint(
      statusEndpoint,
      headSha,
      statuses,
    ),
    annotationsComplete: true,
  }
}

export function collectDeployments(commandRunner, repository, headSha) {
  const deployments = githubApiArrayPages(
    commandRunner,
    `repos/${repository}/deployments`,
    [["sha", headSha]],
    "deployments",
  )
  assertUnique(deployments, (item) => item.id, "deployments")
  return deployments.map((item) => {
    const rawStatuses = Number.isSafeInteger(item.id)
      ? githubApiArrayPages(
        commandRunner,
        `repos/${repository}/deployments/${item.id}/statuses`,
        [],
        `deployment ${item.id} statuses`,
      )
      : []
    assertUnique(rawStatuses, (status) => status.id, `deployment ${item.id} statuses`)
    return {
      id: item.id ?? null,
      sha: item.sha ?? null,
      ref: item.ref ?? null,
      environment: item.environment ?? null,
      task: item.task ?? null,
      createdAt: item.created_at ?? null,
      url: item.statuses_url ?? null,
      statuses: rawStatuses.map((status) => ({
        id: status.id ?? null,
        state: status.state ?? null,
        createdAt: status.created_at ?? null,
        updatedAt: status.updated_at ?? null,
        environment: status.environment ?? null,
        url: status.target_url ?? null,
      })),
    }
  })
}

function comparableTime(value) {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

function latestByAuthority(items) {
  return [...items].sort((left, right) => (
    comparableTime(right.createdAt) - comparableTime(left.createdAt)
    || (right.id ?? 0) - (left.id ?? 0)
  ))[0] ?? null
}

export function classifyDeploymentEvidence(deployments, expectedSha) {
  if (!Array.isArray(deployments)) {
    return {
      binding: { status: "FAIL", detail: "Deployment records are malformed." },
      outcome: { status: "FAIL", detail: "Deployment outcomes are malformed." },
      latestDeployment: null,
      latestStatus: null,
    }
  }
  if (deployments.length === 0) {
    return {
      binding: { status: "SKIPPED", detail: `No deployment record is bound to ${expectedSha}.` },
      outcome: { status: "SKIPPED", detail: "No deployment outcome exists." },
      latestDeployment: null,
      latestStatus: null,
    }
  }
  const malformed = deployments.filter((item) => (
    !item
    || typeof item !== "object"
    || !Number.isSafeInteger(item.id)
    || !SHA_PATTERN.test(item.sha ?? "")
    || !Number.isFinite(Date.parse(item.createdAt ?? ""))
    || !Array.isArray(item.statuses)
  ))
  const mismatched = deployments.filter((item) => item?.sha !== expectedSha)
  const latestDeployment = latestByAuthority(deployments)
  const binding = malformed.length
    ? { status: "FAIL", detail: `${malformed.length} deployment record(s) are malformed or unbound.` }
    : mismatched.length
      ? { status: "FAIL", detail: `${mismatched.length} deployment record(s) target another SHA.` }
      : { status: "PASS", detail: `All ${deployments.length} deployment record(s) are explicitly bound to ${expectedSha}.` }
  if (!latestDeployment || !Array.isArray(latestDeployment.statuses)) {
    return {
      binding,
      outcome: { status: "FAIL", detail: "The latest deployment outcome is malformed." },
      latestDeployment,
      latestStatus: null,
    }
  }
  if (latestDeployment.statuses.length === 0) {
    return {
      binding,
      outcome: { status: "UNAVAILABLE", detail: "The latest deployment has no status." },
      latestDeployment,
      latestStatus: null,
    }
  }
  const malformedStatuses = latestDeployment.statuses.filter((item) => (
    !item
    || typeof item !== "object"
    || !Number.isSafeInteger(item.id)
    || !DEPLOYMENT_STATES.has(item.state)
    || !Number.isFinite(Date.parse(item.createdAt ?? ""))
  ))
  if (malformedStatuses.length) {
    return {
      binding,
      outcome: { status: "FAIL", detail: `${malformedStatuses.length} deployment status record(s) are malformed.` },
      latestDeployment,
      latestStatus: null,
    }
  }
  const latestStatus = latestByAuthority(latestDeployment.statuses)
  const outcome = latestStatus.state === "success"
    ? { status: "PASS", detail: "The latest exact-head deployment status is successful." }
    : ["pending", "queued", "in_progress"].includes(latestStatus.state)
      ? { status: "FAIL", detail: `The latest exact-head deployment status is ${latestStatus.state}.` }
      : { status: "FAIL", detail: `The latest exact-head deployment status is ${latestStatus.state}.` }
  return { binding, outcome, latestDeployment, latestStatus }
}

export async function collectPrEvidence(options = {}) {
  const commandRunner = options.commandRunner ?? defaultCommandRunner
  const git = collectLocalGit(commandRunner)
  const evidenceHead = (options.headSha ?? git.head).toLowerCase()
  if (!SHA_PATTERN.test(evidenceHead)) throw new Error("Evidence head must be a full 40-character Git SHA.")
  const repository = options.repository
    ?? repositoryFromRemoteUrl(git.remoteUrl)
  if (!REPOSITORY_PATTERN.test(repository ?? "")) {
    throw new Error("Repository identity could not be derived as owner/repo.")
  }
  const remote = options.localOnly
    ? { status: "SKIPPED", head: null, detail: "Remote branch evidence was skipped by --local-only." }
    : collectRemoteHead(commandRunner, git.branch, git.topLevel)
  const localChanges = await localChangedFiles(commandRunner, git)
  const report = {
    schemaVersion: 1,
    status: "PASS",
    evidenceHeadSha: evidenceHead,
    repository: {
      expected: repository,
      remoteUrl: git.remoteUrl,
      github: null,
    },
    git: {
      worktree: git.topLevel,
      branch: git.branch,
      clean: !git.dirty,
      localHead: git.head,
      upstream: git.upstream,
      upstreamHead: git.upstreamHead,
      remoteHead: remote.head,
    },
    pullRequest: null,
    changedFiles: localChanges.files,
    changedFileRecords: localChanges.files.map((filename) => ({
      filename,
      previousFilename: null,
      status: "modified",
      patchAvailable: false,
    })),
    migrationImpact: classifyMigrationImpact(
      localChanges.files,
      localChanges.contentsByPath,
    ),
    exactHeadChecks: null,
    reviews: [],
    reviewRequests: { users: [], teams: [] },
    comments: { topLevel: [], inline: [] },
    reviewThreads: null,
    deployments: [],
    deploymentEvidence: {
      binding: annotateEvidence(
        { status: "SKIPPED", detail: "Deployment evidence was not collected." },
        !options.localOnly,
      ),
      outcome: annotateEvidence(
        { status: "SKIPPED", detail: "Deployment evidence was not collected." },
        !options.localOnly,
      ),
      latestDeploymentId: null,
      latestStatus: null,
    },
    checks: [],
    warnings: [],
  }

  addCheck(
    report,
    "worktree-cleanliness",
    git.dirty ? "FAIL" : "PASS",
    git.dirty ? "Worktree is dirty." : "Worktree is clean.",
  )
  addCheck(report, "remote-branch", remote.status, remote.detail, {
    required: !options.localOnly,
    skipReason: options.localOnly ? "Remote branch evidence is outside local-only mode." : null,
  })

  if (options.localOnly) {
    addCheck(
      report,
      "github-evidence",
      "UNAVAILABLE",
      "GitHub evidence was intentionally skipped by --local-only.",
    )
    addWarning(report, "GitHub, PR, checks, reviews, comments, threads, and deployments were not queried.")
    addCheck(
      report,
      "deployment-binding",
      "SKIPPED",
      "Deployment binding is outside local-only mode.",
      { required: false, skipReason: "Deployment evidence is outside local-only mode." },
    )
    addCheck(
      report,
      "deployment-status",
      "SKIPPED",
      "Deployment outcome is outside local-only mode.",
      { required: false, skipReason: "Deployment evidence is outside local-only mode." },
    )
    const heads = evaluateHeadConsistency({
      localHead: git.head,
      evidenceHead,
      upstreamHead: git.upstreamHead,
      remoteHead: remote.head,
      prHead: null,
    })
    addCheck(report, "head-consistency", heads.status, heads.detail)
    recomputeStatus(report)
    assertSecretSafe(report, "PR evidence report")
    return report
  }

  let pullRequest
  try {
    const repositoryMetadata = githubApi(commandRunner, `repos/${repository}`)
    report.repository.github = repositoryMetadata.full_name ?? null
    if (
      typeof repositoryMetadata.full_name !== "string"
      || repositoryMetadata.full_name.toLowerCase() !== repository.toLowerCase()
    ) {
      addCheck(report, "github-repository", "FAIL", "GitHub repository identity disagrees with the local remote.")
    } else {
      addCheck(report, "github-repository", "PASS", "GitHub repository identity matches the local remote.")
    }
    pullRequest = queryPullRequest(
      commandRunner,
      repository,
      git.branch,
      options.prNumber,
    )
  } catch {
    addCheck(report, "github-evidence", "UNAVAILABLE", "GitHub repository or PR evidence is unavailable.")
    addWarning(report, "The report contains local Git evidence only because GitHub access failed.")
  }

  if (!pullRequest) {
    addCheck(
      report,
      "pull-request",
      "UNAVAILABLE",
      "No pull request was found for the current branch.",
    )
  } else {
    if (!validPullRequest(pullRequest)) {
      addCheck(report, "pull-request", "FAIL", "Pull-request metadata is malformed or incomplete.")
      pullRequest = null
    }
  }

  if (pullRequest) {
    const mergeability = evaluateMergeability(pullRequest)
    report.pullRequest = {
      number: pullRequest.number,
      url: pullRequest.html_url,
      base: pullRequest.base?.ref ?? null,
      baseSha: pullRequest.base?.sha ?? null,
      head: pullRequest.head?.ref ?? null,
      headSha: pullRequest.head?.sha ?? null,
      state: pullRequest.merged_at ? "MERGED" : String(pullRequest.state ?? "UNKNOWN").toUpperCase(),
      draft: pullRequest.draft ?? null,
      mergeable: mergeability.mergeable,
      mergeStateStatus: mergeability.mergeableState?.toUpperCase?.() ?? null,
      mergeableFieldPresent: mergeability.mergeablePresent,
      mergeStateFieldPresent: mergeability.mergeStatePresent,
      mergeabilityEvaluation: mergeability.status,
    }
    addCheck(report, "pull-request", "PASS", `PR #${pullRequest.number} metadata is available.`)
    addCheck(report, "mergeability", mergeability.status, mergeability.detail)

    try {
      const files = githubApiArrayPages(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/files`,
        [],
        "pull request files",
      )
      if (!Number.isSafeInteger(pullRequest.changed_files) || files.length !== pullRequest.changed_files) {
        throw new Error("Changed-file evidence is incomplete.")
      }
      const records = files.map((item) => ({
        filename: normalizePath(item.filename ?? ""),
        previous_filename: item.previous_filename
          ? normalizePath(item.previous_filename)
          : null,
        status: item.status ?? null,
        patch: typeof item.patch === "string" ? item.patch : null,
        additions: item.additions,
        deletions: item.deletions,
        changes: item.changes,
      }))
      assertUnique(records, (item) => item.filename, "pull request files")
      report.changedFiles = records.map((item) => item.filename).sort()
      report.migrationImpact = classifyMigrationImpact(records)
      report.changedFileRecords = report.migrationImpact.fileRecords
      const malformed = report.migrationImpact.malformedFileRecords.length
      addCheck(
        report,
        "changed-files",
        malformed ? "FAIL" : "PASS",
        malformed
          ? `${malformed} PR file record(s) have malformed status or rename metadata.`
          : `All ${files.length} PR changed files and rename endpoints were reported.`,
      )
    } catch {
      addCheck(report, "changed-files", "UNAVAILABLE", "Complete PR changed-file evidence is unavailable.")
    }

    try {
      const reviews = githubApiArrayPages(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/reviews`,
        [],
        "reviews",
      )
      assertUnique(reviews, (item) => item.id, "reviews")
      if (reviews.some((item) => !validReview(item))) throw new Error("Review evidence is malformed.")
      const requested = collectReviewRequests(commandRunner, repository, pullRequest.number)
      report.reviews = reviews.map(simplifyReview)
      report.reviewRequests = {
        users: (requested.users ?? []).map(simplifyUser),
        teams: (requested.teams ?? []).map((team) => team.slug ?? null),
      }
      addCheck(report, "reviews", "PASS", `${reviews.length} reviews and current review requests were reported.`)
      const reviewState = blockingReviewState(
        report.reviews,
        report.reviewRequests,
      )
      addCheck(report, "review-state", reviewState.status, reviewState.detail)
    } catch {
      addCheck(report, "reviews", "UNAVAILABLE", "Complete review evidence is unavailable.")
    }

    try {
      const topLevel = githubApiArrayPages(
        commandRunner,
        `repos/${repository}/issues/${pullRequest.number}/comments`,
        [],
        "top-level comments",
      )
      const inline = githubApiArrayPages(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/comments`,
        [],
        "inline comments",
      )
      assertUnique(topLevel, (item) => item.id, "top-level comments")
      assertUnique(inline, (item) => item.id, "inline comments")
      if (topLevel.some((item) => !validComment(item)) || inline.some((item) => !validComment(item))) {
        throw new Error("Comment evidence is malformed.")
      }
      report.comments = {
        topLevel: topLevel.map(simplifyComment),
        inline: inline.map(simplifyComment),
      }
      addCheck(report, "comments", "PASS", `${topLevel.length} top-level and ${inline.length} inline comments were reported.`)
    } catch {
      addCheck(report, "comments", "UNAVAILABLE", "Complete comment evidence is unavailable.")
    }

    try {
      const threads = collectReviewThreads(
        commandRunner,
        repository,
        pullRequest.number,
      )
      if (!threads || !Array.isArray(threads.nodes) || threads.totalCount > threads.nodes.length) {
        throw new Error("Review-thread evidence is incomplete.")
      }
      if (threads.nodes.some((item) => (
        typeof item.id !== "string"
        || typeof item.isResolved !== "boolean"
        || (item.path !== null && item.path !== undefined && typeof item.path !== "string")
        || (item.line !== null && item.line !== undefined && !Number.isSafeInteger(item.line))
      ))) {
        throw new Error("Review-thread evidence is malformed.")
      }
      const unresolved = threads.nodes.filter((item) => !item.isResolved)
      report.reviewThreads = {
        total: threads.totalCount,
        unresolved: unresolved.length,
        threads: threads.nodes,
      }
      addCheck(
        report,
        "review-threads",
        unresolved.length ? "FAIL" : "PASS",
        `${threads.totalCount} total review threads; ${unresolved.length} unresolved.`,
      )
    } catch {
      addCheck(report, "review-threads", "UNAVAILABLE", "Complete review-thread evidence is unavailable.")
    }
  }

  try {
    report.exactHeadChecks = collectExactHeadChecks(
      commandRunner,
      repository,
      evidenceHead,
    )
    const classified = classifyCheckEvidence({
      checkRuns: report.exactHeadChecks.checkRuns,
      totalCount: report.exactHeadChecks.totalCount,
      statuses: report.exactHeadChecks.statuses,
      expectedSha: evidenceHead,
      statusEndpoint: report.exactHeadChecks.statusEndpoint,
    })
    addCheck(report, "exact-head-checks", classified.status, classified.detail)
  } catch {
    addCheck(report, "exact-head-checks", "UNAVAILABLE", "Exact-head checks or annotations are unavailable.")
  }

  try {
    report.deployments = collectDeployments(
      commandRunner,
      repository,
      evidenceHead,
    )
    const classified = classifyDeploymentEvidence(report.deployments, evidenceHead)
    report.deploymentEvidence = {
      binding: annotateEvidence(classified.binding, true),
      outcome: annotateEvidence(classified.outcome, true),
      required: true,
      latestDeploymentId: classified.latestDeployment?.id ?? null,
      latestStatus: classified.latestStatus?.state ?? null,
    }
    addCheck(report, "deployment-binding", classified.binding.status, classified.binding.detail)
    addCheck(report, "deployment-status", classified.outcome.status, classified.outcome.detail)
  } catch {
    addCheck(report, "deployment-binding", "UNAVAILABLE", "Complete deployment records are unavailable.")
    addCheck(report, "deployment-status", "UNAVAILABLE", "Complete deployment statuses are unavailable.")
  }

  const heads = evaluateHeadConsistency({
    localHead: git.head,
    evidenceHead,
    upstreamHead: git.upstreamHead,
    remoteHead: remote.head,
    prHead: report.pullRequest?.headSha ?? null,
  })
  addCheck(report, "head-consistency", heads.status, heads.detail)
  recomputeStatus(report)
  assertSecretSafe(report, "PR evidence report")
  return report
}

export function renderPrEvidenceText(report) {
  const pr = report.pullRequest
  return [
    `PR evidence: ${report.status}`,
    `Repository: ${report.repository.expected}`,
    `Branch: ${report.git.branch ?? "DETACHED"}`,
    `Worktree: ${report.git.clean ? "CLEAN" : "DIRTY"}`,
    `Evidence head: ${report.evidenceHeadSha}`,
    `Heads: local=${report.git.localHead} upstream=${report.git.upstreamHead ?? "SKIPPED"} remote=${report.git.remoteHead ?? "SKIPPED"} pr=${pr?.headSha ?? "SKIPPED"}`,
    pr
      ? `PR: #${pr.number} ${pr.state}${pr.draft ? " DRAFT" : ""} ${pr.url}`
      : "PR: UNAVAILABLE",
    `Changed files: ${report.changedFiles.length}`,
    `Migration impact: files=${report.migrationImpact.migrationFiles.length} potentially-impactful=${report.migrationImpact.potentiallyImpactful ? "YES" : "NO"} authority-paths=${report.migrationImpact.sensitivePaths.length} content-detected=${report.migrationImpact.contentDetectedPaths.length} incomplete-evidence=${report.migrationImpact.incompleteEvidencePaths.length} conservative=${report.migrationImpact.conservativelyImpactful ? "YES" : "NO"} documentation-only=${report.migrationImpact.documentationOnly ? "YES" : "NO"} checksum-registry=${report.migrationImpact.checksumRegistryChanged ? "CHANGED" : "UNCHANGED"}`,
    ...report.migrationImpact.incompleteEvidenceReasons.map((item) => (
      `- incomplete migration evidence ${item.filename}: ${item.reasons.join(" ")}`
    )),
    `Reviews: ${report.reviews.length}; requests=${report.reviewRequests.users.length + report.reviewRequests.teams.length}`,
    `Comments: top-level=${report.comments.topLevel.length}; inline=${report.comments.inline.length}`,
    `Review threads: total=${report.reviewThreads?.total ?? "UNAVAILABLE"}; unresolved=${report.reviewThreads?.unresolved ?? "UNAVAILABLE"}`,
    `Deployments returned: ${report.deployments.length}; binding=${report.deploymentEvidence.binding.status}; latest outcome=${report.deploymentEvidence.outcome.status}${report.deploymentEvidence.latestStatus ? ` (${report.deploymentEvidence.latestStatus})` : ""}`,
    `Combined status endpoint: returned=${report.exactHeadChecks?.statusEndpointEvaluation?.returnedSha ?? "UNAVAILABLE"}; state=${report.exactHeadChecks?.statusEndpointEvaluation?.state ?? "UNAVAILABLE"}; count=${report.exactHeadChecks?.statusEndpointEvaluation?.totalCount ?? "UNAVAILABLE"}; returned-records=${report.exactHeadChecks?.statusEndpointEvaluation?.recordsReturned ?? "UNAVAILABLE"}; consistent=${report.exactHeadChecks?.statusEndpointEvaluation?.consistency === true ? "YES" : "NO"}; effect=${report.exactHeadChecks?.statusEndpointEvaluation?.verdictEffect ?? "BLOCKS_PASS"}`,
    ...report.checks.map((item) => `- ${item.name}: ${item.status} [${item.required ? "required" : "optional"}; effect=${item.effect}] - ${item.detail}`),
    ...report.warnings.map((warning) => `WARNING: ${warning}`),
  ].join("\n")
}

export function renderPrEvidenceJson(report) {
  const output = `${JSON.stringify(report, null, 2)}\n`
  assertSafeOutput(output)
  return output
}

export function parsePrEvidenceArgs(argv) {
  const options = {
    json: false,
    localOnly: false,
    repository: null,
    prNumber: null,
    headSha: null,
  }
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!["--json", "--local-only", "--repository", "--pr", "--head-sha"].includes(argument)) {
      throw new Error(`Unexpected PR-evidence argument: ${argument}`)
    }
    if (seen.has(argument)) throw new Error(`Duplicate option: ${argument}`)
    seen.add(argument)
    if (argument === "--json") options.json = true
    else if (argument === "--local-only") options.localOnly = true
    else if (["--repository", "--pr", "--head-sha"].includes(argument)) {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`)
      if (argument === "--repository") options.repository = value
      if (argument === "--pr") {
        if (!/^[1-9]\d*$/u.test(value)) throw new Error("--pr must be a positive integer")
        options.prNumber = Number(value)
      }
      if (argument === "--head-sha") options.headSha = value.toLowerCase()
      index += 1
    }
  }
  if (options.repository && !REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error("--repository must use owner/repo format")
  }
  if (options.prNumber !== null && (!Number.isSafeInteger(options.prNumber) || options.prNumber < 1)) {
    throw new Error("--pr must be a positive integer")
  }
  if (options.headSha && !SHA_PATTERN.test(options.headSha)) {
    throw new Error("--head-sha must be a full 40-character Git SHA")
  }
  if (options.localOnly && (options.repository || options.prNumber || options.headSha)) {
    throw new Error("--local-only cannot be combined with GitHub or PR-specific options")
  }
  return options
}

async function main(argv = process.argv.slice(2)) {
  const jsonRequested = argv.includes("--json")
  try {
    const options = parsePrEvidenceArgs(argv)
    const report = await collectPrEvidence(options)
    process.stdout.write(
      options.json
        ? renderPrEvidenceJson(report)
        : `${renderPrEvidenceText(report)}\n`,
    )
    if (report.status !== "PASS") process.exitCode = 1
  } catch (error) {
    const message = error instanceof Error ? error.message : "PR evidence failed."
    if (jsonRequested) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        command: "pr-evidence",
        status: "FAIL",
        error: {
          code: /argument|option|requires|must|cannot|unexpected/iu.test(message)
            ? "ARGUMENT_ERROR"
            : "RUNTIME_ERROR",
          category: /argument|option|requires|must|cannot|unexpected/iu.test(message)
            ? "ARGUMENT"
            : "RUNTIME",
          message,
          usage: PR_EVIDENCE_USAGE,
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
