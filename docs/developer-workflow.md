# Developer workflow

Run the read-only workflow doctor from `web/` before choosing an operational workflow:

```powershell
npm run rg:doctor
```

Use `npm run rg:doctor -- --json` for machine-readable output. The command performs local filesystem and Git discovery only. It makes no network calls, writes no files, and never prints environment values, credential contents, database URLs, or credential-bearing usernames. A missing local Supabase link is a warning when the explicit project identity is otherwise consistent; contradictory repository, project, link, or endpoint identity is blocking.

The report replaces separate checks for repository identity, Git/worktree state, runtime policy, local tool availability, environment-input presence, approved and linked Supabase identity, database endpoint type, and operational capability readiness. `POSSIBLE` means the required local evidence is present, not that remote authorization or health was probed.

## Risk tiers

- Tier 1: local application and code changes with no production or database writes.
- Tier 2: additive, reversible, or forward-repairable production/database changes.
- Tier 3: destructive, lossy, ownership-changing, mass-rewrite, compatibility-breaking, or recovery-dependent changes.

Automation may recommend a higher tier. It must never reduce an explicitly selected tier. Tier selection is policy evidence, not authorization to write, deploy, migrate, or contact production.

## Workflow state primitives

`web/scripts/workflow/state.mjs` provides only pure building blocks for later phases: stable operation keys, paths constrained to `.codex-artifacts/workflows/`, artifact references, Git/project/migration binding validation, stale-state rejection, and secret-value rejection. The doctor does not create or update workflow state, and Phase 1 contains no stage engine or operational orchestration.
