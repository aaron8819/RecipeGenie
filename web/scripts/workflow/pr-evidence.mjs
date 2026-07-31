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

function addCheck(report, name, status, detail) {
  report.checks.push({ name, status, detail })
}

function addWarning(report, message) {
  if (!report.warnings.includes(message)) report.warnings.push(message)
}

function recomputeStatus(report) {
  if (report.checks.some((item) => item.status === "FAIL")) {
    report.status = "FAIL"
  } else if (report.checks.some((item) => item.status === "UNAVAILABLE")) {
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
}) {
  if (
    !Array.isArray(checkRuns)
    || !Number.isSafeInteger(totalCount)
    || totalCount < checkRuns.length
    || !Array.isArray(statuses)
  ) {
    return { status: "UNAVAILABLE", detail: "Exact-head check evidence is structurally incomplete." }
  }
  if (totalCount > checkRuns.length) {
    return { status: "UNAVAILABLE", detail: `Only ${checkRuns.length} of ${totalCount} exact-head check runs were returned.` }
  }
  if (totalCount === 0 && statuses.length === 0) {
    return { status: "UNAVAILABLE", detail: "No exact-head checks or commit statuses were reported." }
  }
  if (
    expectedSha
    && (
      checkRuns.some((item) => item.headSha && item.headSha !== expectedSha)
      || statuses.some((item) => item.sha && item.sha !== expectedSha)
    )
  ) {
    return { status: "FAIL", detail: "Returned check evidence is not bound to the explicit head SHA." }
  }
  const pendingRuns = checkRuns.filter(
    (item) => item.status !== "completed" || !item.conclusion,
  )
  const pendingStatuses = statuses.filter(
    (item) => ["pending", "expected"].includes(item.state),
  )
  const failedRuns = checkRuns.filter(
    (item) => item.status === "completed"
      && !["success", "neutral", "skipped"].includes(item.conclusion),
  )
  const failedStatuses = statuses.filter((item) => item.state === "failure" || item.state === "error")
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
  const inconclusive = checkRuns.filter(
    (item) => ["neutral", "skipped"].includes(item.conclusion),
  )
  if (inconclusive.length) {
    return {
      status: "UNAVAILABLE",
      detail: `${inconclusive.length} exact-head check run(s) were neutral or skipped; success is not claimed.`,
    }
  }
  return {
    status: "PASS",
    detail: `All ${totalCount + statuses.length} exact-head checks and statuses passed.`,
  }
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
  const pulls = githubApi(
    commandRunner,
    `repos/${repository}/pulls`,
    [["state", "all"], ["head", `${owner}:${branch}`], ["per_page", "100"]],
  )
  return selectPullRequest(pulls)
}

function collectReviewThreads(commandRunner, repository, prNumber) {
  const [owner, name] = repository.split("/")
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            totalCount
            nodes { isResolved path line }
          }
        }
      }
    }
  `
  const response = githubGraphql(commandRunner, query, [
    ["owner", owner],
    ["name", name],
    ["number", prNumber],
  ])
  return response?.data?.repository?.pullRequest?.reviewThreads ?? null
}

function collectExactHeadChecks(commandRunner, repository, headSha) {
  const response = githubApi(
    commandRunner,
    `repos/${repository}/commits/${headSha}/check-runs`,
    [["per_page", "100"]],
  )
  const combinedStatus = githubApi(
    commandRunner,
    `repos/${repository}/commits/${headSha}/status`,
    [["per_page", "100"]],
  )
  const checkRuns = (response.check_runs ?? []).map((item) => ({
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
  let annotationsComplete = true
  for (const item of checkRuns) {
    if (!Number.isSafeInteger(item.id)) continue
    const annotations = githubApi(
      commandRunner,
      `repos/${repository}/check-runs/${item.id}/annotations`,
      [["per_page", "100"]],
    )
    if (!Array.isArray(annotations)) {
      annotationsComplete = false
      continue
    }
    if (annotations.length === 100) annotationsComplete = false
    item.annotations = annotations.map((annotation) => ({
      path: annotation.path ?? null,
      startLine: annotation.start_line ?? null,
      endLine: annotation.end_line ?? null,
      level: annotation.annotation_level ?? null,
      title: annotation.title ?? null,
      message: annotation.message ?? "",
    }))
  }
  return {
    headSha,
    totalCount: response.total_count,
    checkRuns,
    statuses: (combinedStatus.statuses ?? []).map((item) => ({
      context: item.context ?? null,
      state: item.state ?? null,
      url: item.target_url ?? null,
      sha: item.sha ?? headSha,
    })),
    annotationsComplete,
  }
}

function collectDeployments(commandRunner, repository, headSha) {
  const deployments = githubApi(
    commandRunner,
    `repos/${repository}/deployments`,
    [["sha", headSha], ["per_page", "100"]],
  )
  if (!Array.isArray(deployments)) throw new Error("Deployment evidence is malformed.")
  return deployments.map((item) => ({
    id: item.id ?? null,
    sha: item.sha ?? null,
    ref: item.ref ?? null,
    environment: item.environment ?? null,
    task: item.task ?? null,
    createdAt: item.created_at ?? null,
    url: item.statuses_url ?? null,
  }))
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
  const remote = collectRemoteHead(commandRunner, git.branch, git.topLevel)
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
    checks: [],
    warnings: [],
  }

  addCheck(
    report,
    "worktree-cleanliness",
    git.dirty ? "FAIL" : "PASS",
    git.dirty ? "Worktree is dirty." : "Worktree is clean.",
  )
  addCheck(report, "remote-branch", remote.status, remote.detail)

  if (options.localOnly) {
    addCheck(
      report,
      "github-evidence",
      "UNAVAILABLE",
      "GitHub evidence was intentionally skipped by --local-only.",
    )
    addWarning(report, "GitHub, PR, checks, reviews, comments, threads, and deployments were not queried.")
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
    report.pullRequest = {
      number: pullRequest.number,
      url: pullRequest.html_url,
      base: pullRequest.base?.ref ?? null,
      baseSha: pullRequest.base?.sha ?? null,
      head: pullRequest.head?.ref ?? null,
      headSha: pullRequest.head?.sha ?? null,
      state: pullRequest.merged_at ? "MERGED" : String(pullRequest.state ?? "UNKNOWN").toUpperCase(),
      draft: pullRequest.draft ?? null,
      mergeable: pullRequest.mergeable ?? null,
      mergeStateStatus: pullRequest.mergeable_state?.toUpperCase?.() ?? null,
    }
    addCheck(report, "pull-request", "PASS", `PR #${pullRequest.number} metadata is available.`)
    if (
      pullRequest.mergeable === false
      || ["blocked", "behind", "dirty", "unstable"].includes(
        pullRequest.mergeable_state,
      )
    ) {
      addCheck(report, "mergeability", "FAIL", `PR mergeability is ${pullRequest.mergeable_state ?? "conflicting"}.`)
    } else if (pullRequest.mergeable === null || pullRequest.mergeable_state === "unknown") {
      addCheck(report, "mergeability", "UNAVAILABLE", "PR mergeability has not been determined.")
    } else {
      addCheck(report, "mergeability", "PASS", `PR merge state is ${pullRequest.mergeable_state}.`)
    }

    try {
      const files = githubApi(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/files`,
        [["per_page", "100"]],
      )
      if (!Array.isArray(files) || files.length < pullRequest.changed_files) {
        throw new Error("Changed-file evidence is incomplete.")
      }
      report.changedFiles = files.map((item) => normalizePath(item.filename)).sort()
      report.migrationImpact = classifyMigrationImpact(
        report.changedFiles,
        Object.fromEntries(files.map((item) => [
          normalizePath(item.filename),
          item.patch ?? "",
        ])),
      )
      addCheck(report, "changed-files", "PASS", `All ${files.length} PR changed files were reported.`)
    } catch {
      addCheck(report, "changed-files", "UNAVAILABLE", "Complete PR changed-file evidence is unavailable.")
    }

    try {
      const reviews = githubApi(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/reviews`,
        [["per_page", "100"]],
      )
      const requested = githubApi(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/requested_reviewers`,
      )
      if (!Array.isArray(reviews) || reviews.length === 100) throw new Error("Review evidence is incomplete.")
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
      const topLevel = githubApi(
        commandRunner,
        `repos/${repository}/issues/${pullRequest.number}/comments`,
        [["per_page", "100"]],
      )
      const inline = githubApi(
        commandRunner,
        `repos/${repository}/pulls/${pullRequest.number}/comments`,
        [["per_page", "100"]],
      )
      if (!Array.isArray(topLevel) || !Array.isArray(inline) || topLevel.length === 100 || inline.length === 100) {
        throw new Error("Comment evidence is incomplete.")
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
    })
    if (!report.exactHeadChecks.annotationsComplete) {
      classified.status = "UNAVAILABLE"
      classified.detail += " Check annotations may be incomplete."
    }
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
    const deploymentMismatch = report.deployments.some(
      (deployment) => deployment.sha !== evidenceHead,
    )
    addCheck(
      report,
      "deployments",
      deploymentMismatch
        ? "FAIL"
        : report.deployments.length ? "PASS" : "SKIPPED",
      deploymentMismatch
        ? "A returned deployment record is not bound to the explicit head SHA."
        : report.deployments.length
        ? `${report.deployments.length} deployment record(s) are explicitly bound to ${evidenceHead}.`
        : `No deployment record is bound to ${evidenceHead}.`,
    )
  } catch {
    addCheck(report, "deployments", "UNAVAILABLE", "Deployment evidence is unavailable.")
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
    `Migration impact: files=${report.migrationImpact.migrationFiles.length} documentation-only=${report.migrationImpact.documentationOnly ? "YES" : "NO"} checksum-registry=${report.migrationImpact.checksumRegistryChanged ? "CHANGED" : "UNCHANGED"}`,
    `Reviews: ${report.reviews.length}; requests=${report.reviewRequests.users.length + report.reviewRequests.teams.length}`,
    `Comments: top-level=${report.comments.topLevel.length}; inline=${report.comments.inline.length}`,
    `Review threads: total=${report.reviewThreads?.total ?? "UNAVAILABLE"}; unresolved=${report.reviewThreads?.unresolved ?? "UNAVAILABLE"}`,
    `Deployments bound to evidence head: ${report.deployments.length}`,
    ...report.checks.map((item) => `- ${item.name}: ${item.status} - ${item.detail}`),
    ...report.warnings.map((warning) => `WARNING: ${warning}`),
  ].join("\n")
}

export function renderPrEvidenceJson(report) {
  const output = `${JSON.stringify(report, null, 2)}\n`
  assertSafeOutput(output)
  return output
}

function parseArgs(argv) {
  const options = {
    json: false,
    localOnly: false,
    repository: null,
    prNumber: null,
    headSha: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--json") options.json = true
    else if (argument === "--local-only") options.localOnly = true
    else if (["--repository", "--pr", "--head-sha"].includes(argument)) {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`)
      if (argument === "--repository") options.repository = value
      if (argument === "--pr") options.prNumber = Number(value)
      if (argument === "--head-sha") options.headSha = value.toLowerCase()
      index += 1
    } else {
      throw new Error(`Unexpected PR-evidence argument: ${argument}`)
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
  return options
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const report = await collectPrEvidence(options)
  process.stdout.write(
    options.json
      ? renderPrEvidenceJson(report)
      : `${renderPrEvidenceText(report)}\n`,
  )
  if (report.status === "FAIL") process.exitCode = 1
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
