# Developer workflow

Run the read-only workflow doctor from `web/` before choosing an operational workflow:

```powershell
npm run rg:doctor
```

Use `npm run rg:doctor -- --json` for machine-readable output. The command performs local filesystem and Git discovery only. It makes no network calls, writes no files, and never prints environment values, credential contents, database URLs, or credential-bearing usernames. A missing local Supabase link is a warning when the explicit project identity is otherwise consistent; contradictory repository, project, link, or endpoint identity is blocking.

The report replaces separate checks for repository identity, Git/worktree state, runtime policy, local tool availability, environment-input presence, approved and linked Supabase identity, database endpoint type, and operational capability readiness. `POSSIBLE` means the required local evidence is present, not that remote authorization or health was probed.

## Release status

`rg:doctor` answers whether the local environment is capable. `rg:release:status` answers whether one explicitly expected release is currently consistent:

```powershell
npm run rg:release:status -- `
  --repository aaron8819/RecipeGenie `
  --branch main `
  --expected-sha <40-character-sha> `
  --production-url https://recipe-genie.example `
  --expected-project-ref <20-character-project-ref>
```

Use `npm run --silent rg:release:status -- --json ...` for deterministic JSON. The equivalent environment inputs are `RG_REPOSITORY`, `RG_BRANCH`, `RG_EXPECTED_GIT_SHA`, `RG_PRODUCTION_URL`, and `RG_EXPECTED_SUPABASE_PROJECT_REF`. The branch may be omitted only when GitHub reports the repository default branch. Add `--historical` only when intentionally checking an expected SHA that is not the selected branch head.

The command performs authenticated, read-only GitHub queries through `gh` and one anonymous, credential-free `GET <production-url>/api/version` with a 10-second timeout and redirect following only to a safe HTTPS `/api/version` target. It does not use Vercel or Supabase APIs, connect to a database, inspect application data, or persist state. GitHub branch refs and complete exact-SHA Checks responses are authoritative source evidence; `/api/version` is authoritative for the build answering at the supplied URL. GitHub deployment records are corroborative only, and missing GitHub/Vercel deployment records do not mean the release failed.

The Checks API result is considered complete only when its reported total fits in the requested 100-item page. The command does not infer which checks are required by branch protection: any observed failure, cancellation, timeout, pending, or queued run requires action, while neutral, skipped, unknown, absent, incomplete, or unavailable check evidence produces an explicit warning and never claims CI passed. Overall status precedence is deterministic: `BLOCKED`, then `ACTION_REQUIRED`, then `PASS` with any warnings. This release correlation does not replace the fuller database-backed `verify:production` command.

## Risk tiers

- Tier 1: local application and code changes with no production or database writes.
- Tier 2: additive, reversible, or forward-repairable production/database changes.
- Tier 3: destructive, lossy, ownership-changing, mass-rewrite, compatibility-breaking, or recovery-dependent changes.

Automation may recommend a higher tier. It must never reduce an explicitly selected tier. Tier selection is policy evidence, not authorization to write, deploy, migrate, or contact production.

## Workflow state primitives

`web/scripts/workflow/state.mjs` provides only pure building blocks for later phases: stable operation keys, paths constrained to `.codex-artifacts/workflows/`, artifact references, Git/project/migration binding validation, stale-state rejection, and secret-value rejection. The doctor does not create or update workflow state, and Phase 1 contains no stage engine or operational orchestration.
