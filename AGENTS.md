# Codex operating policy

This is the authoritative repository policy for Codex. `CLAUDE.md` and the
documents it routes to provide technical context; `docs/developer-workflow.md`
documents workflow command usage. When guidance conflicts, this file wins.

Recipe Genie is a personal experimentation project. Prefer fast, reversible,
practical execution and the least ceremony appropriate to actual risk. Preserve
strict safety for credible data-loss, security, wrong-project,
irreversible-production, and unknown-state risks. Do not build generalized
infrastructure for a one-off low-risk problem. When safety remains adequately
controlled, prefer a documented warning or explicit waiver over an invented
hard blocker.

## Startup

1. Read applicable `SKILL.md` instructions when available. Do not guess a path
   or block startup when a skill is unavailable.
2. Read `.Codex/napkin.md` when present and silently apply relevant lessons.
   It is ignored, machine-local working memory and is not authoritative policy.
3. Read the task request and attachments.
4. Read the applicable repository guidance and inspect repository state.

Keep routine startup silent. A harmless read-only ordering mistake is not a
safety incident; read the missing guidance and continue.

## Workflow selection

Run `npm run rg:doctor` from `web/` before environment-sensitive verification
or work involving Supabase, Vercel, GitHub operational state, PostgreSQL tools,
production verification, deployments, migrations, backups, restores, or
operational incidents. It is optional for writing, documentation-only edits,
and clearly local low-risk code changes unless environment capability matters.
Treat its output as local capability evidence, never proof of remote health.

Classify work using these tiers:

- Tier 1: local application or code changes with no production or database
  writes.
- Tier 2: additive, reversible, or forward-repairable production or database
  changes.
- Tier 3: destructive, lossy, ownership-changing, compatibility-breaking,
  mass-rewrite, or recovery-dependent changes.

Codex may recommend a higher tier but must never silently lower a tier selected
by the user. The user owns the final risk classification and authorization for
external writes. Classification is not authorization.

After a merge or deployment, or when checking an expected production release,
use `npm run rg:release:status` as the first release-consistency check. It
correlates the expected Git SHA, exact-SHA GitHub checks, `/api/version` build
metadata, Supabase project reference, expected migration, and optional
deployment evidence. Unavailable Vercel CLI or control-plane metadata is
degraded assurance, not a blocker, when authoritative GitHub checks and
`/api/version` agree. Use `npm run verify:production` only when fuller
database-backed verification is required. See `docs/developer-workflow.md` for
command syntax and evidence boundaries.

Use status terms consistently:

- `BLOCKED`: wrong or contradictory identity; unsafe target; real migration
  divergence; failed required safety check; destructive action without required
  recovery evidence; or unresolved state that makes proceeding unsafe.
- `ACTION REQUIRED`: specific user authorization, credentials, or manual
  dashboard work is needed; CI failed or is pending; production is unreachable;
  expected and deployed SHAs differ; or a ready operation cannot proceed
  automatically.
- `WARNING`: optional control-plane evidence is unavailable; non-required
  restore evidence is absent; a local Supabase link is absent while explicit
  identities agree; or assurance is otherwise degraded without making the next
  step unsafe.
- Successful completion: required work and verification are complete; warnings
  may still be reported separately.

Never label unavailable optional assurance as `BLOCKED`.

## Authorization boundaries

Codex may run local checks and explicitly requested read-only remote checks.
Stop before any commit, push, merge, deployment, redeployment, rollback, alias
reassignment, environment change, Supabase link change, migration application
or repair, database repair, backup creation, restore execution, production data
write, or other production change. Proceed only after explicit user
authorization for that specific action; approval of an earlier stage does not
authorize a later one.

Current repository-specific migration and backup runbooks remain authoritative
until Phase 3 orchestration exists. Do not invent or pre-document migration,
backup, or restore commands or weaken their safety gates.

## Git worktree convention

- Perform implementation work in an isolated Git worktree unless the user
  explicitly directs otherwise.
- Create Recipe Genie worktrees only under
  `C:\Users\aabloch\claude\vibe-coding\.worktrees\recipe-genie\<short-task-name>`.
- Use branches named `codex/<short-task-name>`.
- Do not create worktrees directly under
  `C:\Users\aabloch\claude\vibe-coding`, inside the primary repository, or
  inside another worktree.
- Before creating one, run `git worktree list` and confirm its path and branch
  are unused.
- Use the current authorized integration or base branch; do not assume `main`
  when the task specifies another base.
- Make task-specific changes only in the isolated worktree. Do not modify,
  move, remove, prune, or clean up another worktree without explicit
  authorization.
- Do not remove the task worktree automatically.

## Final handoff

For engineering and operational tasks, use this concise structure and omit
ceremonial evidence:

```text
STATUS: COMPLETE, ACTION REQUIRED, or BLOCKED

Completed:
- material outcomes

Blockers:
- actual blockers only

Warnings:
- meaningful degraded assurance only

Verification:
- relevant commands and results

Git:
- branch, worktree, base, changed files, and commit/push/merge state when applicable

Safety:
- relevant external actions that did or did not occur

Next action:
- exactly one recommended action
```

Put detailed logs in local artifacts when useful. The final handoff must contain
exactly one recommended next action.
