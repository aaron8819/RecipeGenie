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

## Local verification

Use `npm run verify` from `web/` as the comprehensive Tier 1 repository gate.
Run focused tests while iterating, then use the full gate when the task or
repository policy requires it.

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
