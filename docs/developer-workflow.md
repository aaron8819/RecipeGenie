# Developer workflow

Root `AGENTS.md` is the authoritative Codex operating policy. This document
describes the implemented workflow commands and their evidence boundaries.

Run the read-only workflow doctor from `web/` before environment-sensitive
verification or work involving Supabase, Vercel, GitHub operational state,
PostgreSQL tooling, production verification, deployments, migrations, backups,
restores, or operational incidents:

```powershell
npm run rg:doctor
```

Use `npm run rg:doctor -- --json` for machine-readable output. The command performs local filesystem and Git discovery only. It makes no network calls, writes no files, and never prints environment values, credential contents, database URLs, or credential-bearing usernames. A missing local Supabase link is a warning when the explicit project identity is otherwise consistent; contradictory repository, project, link, or endpoint identity is blocking.

Do not require it for ordinary writing, documentation-only edits, or clearly
local low-risk code changes unless environment capability matters. The report
replaces separate checks for repository identity, Git/worktree state, runtime
policy, local tool availability, environment-input presence, approved and
linked Supabase identity, database endpoint type, and operational capability
readiness. Runtime policy is derived from `web/.nvmrc` and the
`packageManager` field in `web/package.json`, and exact installed versions must
match those pins. GitHub and Vercel readiness are evaluated independently by
pairing each provider's CLI with its own local credential evidence.
`POSSIBLE` means the required local evidence is present, not that remote
authentication, authorization, or health was probed.

## Verification tiers

All verification commands run from `web/`, use the repository-pinned Node/npm
runtime, print the checks they ran, and return nonzero on failure. Add `--json`
for structured output. Check results use `PASS`, `FAIL`, `SKIPPED`, and
`UNAVAILABLE`; missing evidence is never reported as success.

The command lines are strict: unknown or positional arguments, duplicate
single-use options, repeated value options, missing values, malformed refs,
SHAs, paths, PR numbers, repositories, project refs, or URLs, and options from
another tier are rejected before verification runs. `--file` is the only
repeatable value option because it intentionally defines a multi-file focused
scope.

Focused and PR checks invoke npm through the CLI bundled with the active pinned
Node distribution and verify its version against `packageManager`. Ambient
`npm_execpath`, `npm_node_execpath`, and similar environment overrides are not
executable authority. Child processes receive argument arrays without a shell.

Focused verification is an iteration aid for an explicit bounded scope:

```powershell
npm run rg:verify:focused -- --base origin/main
npm run rg:verify:focused -- --file docs/developer-workflow.md --file web/scripts/workflow/verification.mjs
```

The auditable mapping covers documentation, workflow scripts, database
preflight scripts, fixtures, and migration metadata. It runs migration-reference
integrity for every mapped scope, plus the relevant workflow or preflight unit
tests and lint checks. An application, CI, package, migration SQL, unknown path,
or unresolved base automatically runs the PR tier instead. A focused result
explicitly says that it is not full PR confidence.

PR verification is the complete local pre-PR gate:

```powershell
npm run rg:verify:pr
```

It composes the existing `npm run verify` authority (artifact and secret
guards, migration-reference integrity, lint, typecheck, unit tests, regression
guards, and dependency-cycle analysis), the production build, and the existing
PowerShell migration-tooling test suite. Database-backed migration smoke,
pgTAP, compatibility, audit, and generated-type checks remain exact-head CI
requirements; a local PR-tier pass never substitutes for them.

Release verification delegates to the existing read-only release/status
workflow:

```powershell
npm run rg:verify:release -- --repository aaron8819/RecipeGenie --branch main --expected-sha <sha> --production-url <url> --expected-project-ref <ref>
```

It preserves the existing commit/deployment/manifest binding. Missing external
evidence is `UNAVAILABLE`; contradictory identity, mismatched bindings, pending
or failed required evidence, and invalid inputs fail. It never deploys, changes
aliases, connects to a database, or applies migrations.

The release composition boundary accepts exactly one uncontaminated JSON
document from `rg:release:status`. A passing document must identify its schema,
explicit `PASS` verdict, complete expected/deployed SHA and Supabase project
bindings, expected migration, required authoritative checks, warnings, and next
action. Exit-zero failed, blocked, skipped, incomplete, contradictory, unknown,
or malformed output cannot produce a passing wrapper result.

`npm run verify` remains the comprehensive local code-quality gate used by CI.
`npm run check:migration-references` is its repository-backed migration
documentation check. The check derives the active endpoint from tracked regular
SQL files, reuses the canonical checksum loader, and verifies README and
`supabase/SCHEMA.md` against that source rather than maintaining another active
filename constant.

## PR evidence report

Use the read-only evidence reporter to reconstruct local and GitHub PR state:

```powershell
npm run rg:pr:evidence
npm run rg:pr:evidence -- --json
npm run rg:pr:evidence -- --local-only
npm run rg:pr:evidence -- --repository aaron8819/RecipeGenie --pr 35 --head-sha <40-character-sha>
```

The report includes repository identity; branch and worktree state; local,
upstream, remote, PR, and explicit evidence heads; PR URL/base/head/state and
mergeability; changed files; actual migration SQL versus documentation-only
migration references; checksum-registry impact; exact-head checks, conclusions,
and annotations; reviews and requests; top-level and inline comments; total and
unresolved review threads; and exact-SHA deployment records plus their latest
statuses. Every potentially multi-page GitHub collection is retrieved to a
validated end condition, with repeated pages/cursors, changed totals, malformed
records, later-page failures, truncation, conflicting stable identifiers, and a
100-page safety bound failing closed. Use `--pr NUMBER` or `--head-sha SHA` when
discovery must be explicit. `--local-only` accepts no repository, PR, or explicit
head option. Head disagreement, dirty state, pending/failed checks, merge
conflicts, and unresolved review threads cannot produce a passing report. No
PR, no remote branch, missing GitHub access, incomplete pagination, missing
checks, or unavailable deployment status is reported as `SKIPPED` or
`UNAVAILABLE`, while retaining the useful local report.

Check runs and commit statuses are validated independently. Each contributing
record must have a stable identifier/name or context, a recognized lifecycle
and successful state. Check runs require their own explicit matching SHA;
commit statuses require either their own matching SHA or the separately
reported full-SHA REST endpoint binding. The reporter never fills a record's
missing SHA with the requested value. PR-file evidence preserves
GitHub status and both rename endpoints, so renames, copies, and deletions that
cross a migration-sensitive path remain migration impact even without a patch.
Deployment record binding and deployment outcome are separate checks. A record
alone does not pass: the reporter selects the latest deployment and latest
status by timestamp and stable ID and requires a successful terminal status.

## Proportional review

- Behavioral code change: implementation, independent review, corrections,
  focused re-review of corrected ranges when appropriate, then the final merge
  gate.
- A correction that changes behavior or risk requires independent re-review of
  the changed range plus refreshed regression evidence.
- A narrow documentation-only correction requires automated scope and integrity
  validation plus focused re-review; it does not restart an unrelated full
  review.
- Full re-review is required when the approved head, behavioral scope,
  migration/schema impact, security posture, or deployment risk materially
  changes.

Evidence may be reused only when its inputs and affected code are unchanged:
design rationale, unchanged test results, prior discussion, and review findings
outside the corrected range may carry forward. Worktree cleanliness, changed
files, head bindings, migration/documentation integrity, required checks,
mergeability, review requests, and unresolved-thread counts must always be
refreshed at the exact head. Focused verification is sufficient only for a
mapped bounded iteration or narrow documentation correction; PR verification
is mandatory before publishing or after behavioral, build, package, CI,
migration, security, or unknown-scope changes. Reviewers must expand scope when
a correction crosses those boundaries or invalidates reused evidence. Merge is
blocked by a dirty or mismatched reviewed head, failed/pending/incomplete
required checks, unresolved required review, migration/schema inconsistency,
security regression, conflict, or missing exact-head evidence.

## Release status

`rg:doctor` answers whether the local environment is capable.
`rg:release:status` is the default first check after a merge or deployment, or
when verifying an expected production release:

```powershell
npm run rg:release:status -- `
  --repository aaron8819/RecipeGenie `
  --branch main `
  --expected-sha <40-character-sha> `
  --production-url https://recipe-genie.example `
  --expected-project-ref <20-character-project-ref>
```

Use `npm run --silent rg:release:status -- --json ...` for deterministic JSON. The equivalent environment inputs are `RG_REPOSITORY`, `RG_BRANCH`, `RG_EXPECTED_GIT_SHA`, `RG_PRODUCTION_URL`, and `RG_EXPECTED_SUPABASE_PROJECT_REF`. The branch may be omitted only when GitHub reports the repository default branch. Add `--historical` only when intentionally checking an expected SHA that is not the selected branch head.

The command performs authenticated, read-only GitHub queries through `gh` and
one anonymous, credential-free `GET <production-url>/api/version` with a
10-second timeout and redirect following only to a safe HTTPS `/api/version`
target. It does not use Vercel or Supabase APIs, connect to a database, inspect
application data, or persist state. It correlates the expected Git SHA,
exact-SHA GitHub checks, deployed SHA from `/api/version`, Supabase project ref,
expected migration, and optional deployment evidence. GitHub branch refs and
complete exact-SHA Checks responses are authoritative source evidence;
`/api/version` is authoritative for the build answering at the supplied URL.
GitHub deployment records and Vercel control-plane metadata are corroborative
only. When authoritative GitHub and application-manifest evidence agree,
unavailable Vercel CLI or control-plane access is a warning rather than a
blocker.

The Checks API result is considered complete only when its reported total fits
in the requested 100-item page. The command does not infer which checks are
required by branch protection: any observed failure, cancellation, timeout,
pending, or queued run requires action, while neutral, skipped, unknown,
absent, incomplete, or unavailable check evidence produces an explicit warning
and never claims CI passed. Overall command status precedence is deterministic:
`BLOCKED`, then `ACTION_REQUIRED`, then `PASS` with any warnings. Use
`verify:production` only when fuller database-backed verification is required.
Use `npm run audit:data` only for an explicitly targeted, read-only integrity
audit. See `docs/operational-verification.md` for both database-backed command
contracts.

## Risk tiers

- Tier 1: local application and code changes with no production or database writes.
- Tier 2: additive, reversible, or forward-repairable production/database changes.
- Tier 3: destructive, lossy, ownership-changing, mass-rewrite, compatibility-breaking, or recovery-dependent changes.

Automation may recommend a higher tier. It must never reduce an explicitly
selected tier. The user owns final classification and authorization for
external writes. Tier selection is policy evidence, not authorization to write,
deploy, migrate, or contact production.

## Workflow state primitives

`web/scripts/workflow/state.mjs` provides only pure building blocks for later phases: stable operation keys, paths constrained to `.codex-artifacts/workflows/`, artifact references, Git/project/migration binding validation, stale-state rejection, and secret-value rejection. The doctor does not create or update workflow state, and Phase 1 contains no stage engine or operational orchestration.

Repository-specific migration and backup runbooks remain authoritative until
Phase 3 orchestration is implemented. Do not infer future commands or behavior
from these state primitives.
