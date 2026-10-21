# Recipe Genie agent guidance

This is the authoritative repository policy for agents. Use the
[developer workflow guide](docs/developer-workflow.md) for supported runtime,
verification and release commands; this file owns authorization boundaries.

Recipe Genie is a personal experimentation project. Prefer small, reversible
changes and the least ceremony appropriate to actual risk. Preserve strict
safety for data loss, security, wrong targets and irreversible production work.
Do not build a framework for a one-off task. Use documented warnings or explicit
owner waivers when appropriate; never silently turn failed checks into passes.

## Start with the task

Read this file, then the [normal task path](docs/developer-workflow.md#normal-task-path).
Inspect current remote base, Git state and ownership before editing. One owner
keeps the task through its authorized release stages. Preserve unrelated work.
Read specialist domain/schema/operations docs and relevant skills only when the
task needs them; the [documentation index](docs/DOCS_INDEX.md) locates those owners.
Task-relevant `.Codex/napkin.md` lessons are background, not operating policy.

## Repository map and conventions

The app uses Next.js 16, React 19, TypeScript, TanStack Query, Tailwind and
Supabase. `web/package.json`, `web/.nvmrc` and the lockfile own runtime versions
and scripts; do not duplicate a command catalog here. Run npm commands from
`web/`. `npm run lint` invokes `eslint .`; unit tests use Vitest and browser
checks use Playwright.

- `web/src/app/(authenticated)/` owns route screens under the shared shell;
  `/` redirects to `/recipes`. Only the active route should mount its queries.
- `web/src/components/` owns UI, `web/src/hooks/` owns query/mutation
  orchestration, and `web/src/lib/` owns pure domain helpers and server utilities.
- `@/*` maps to `web/src/*`. Follow existing local formatting and filenames;
  prefer named exports. Do not add `@ts-expect-error` (the enforced baseline is
  zero); use generated database types or narrow typed adapters.
- Keep service-role clients server-only and user writes within the existing
  owner/command/RPC boundaries. Shopping commands own Shopping writes; do not
  substitute direct table writes to bypass permissions.
- Keep auth network calls out of the request proxy and avoid blocking the
  initial shell on auth verification. API routes/server actions retain their
  authoritative user checks. Preserve the root layout's per-request CSP nonce.
- Use `toLocalNoonISOString()` in `web/src/lib/planner-utils.ts` for `date_made`
  and the SSR-safe `web/src/hooks/use-is-desktop.ts` for breakpoint detection.
- Follow existing feature recovery and per-item pending behavior; do not change
  Planner cooked state, history, Shopping selection or Undo semantics as cleanup.

## Verification and release

The [workflow guide](docs/developer-workflow.md) owns commands, check selection,
source/base binding and evidence reuse. Use pinned dependencies, affected tests,
and artifact/secret guards before an authorized early draft. Hosted CI replaces
the duplicate mandatory local full PR gate; `rg-verify.ps1 pr` remains an explicit
diagnostic. No routine local database reset or development-mode Playwright is a
release prerequisite. Relevant hosted persistence/browser qualification remains
required. Never call missing, failed or pending evidence a pass.

Follow current-head CI, independent review and all already-authorized stages.
Fix recoverable in-scope failures, refresh invalidated evidence, and continue.
Stop only for a material scope/access/risk decision or a protected action not
already authorized. Recheck current main before merge; integrate a changed base
and refresh evidence. Verify merged-tree correspondence, exact post-merge CI,
and production identity with the read-only release launcher after deployment.

Keep secrets, local auth state and raw private diagnostics out of commits and
artifacts. Preserve ignored task receipts; do not clean shared previews or
processes incidentally. Historical waivers remain failures for those historical
candidates, never current acceptance. Report implementation, checks, review,
merge and release separately.

Risk tiers: Tier1 is local code without production/database writes; Tier2 is
additive/forward-repairable production work; Tier3 is destructive, lossy,
ownership-changing or recovery-dependent work. Never lower an owner-selected
tier. Classification grants no authorization. Use BLOCKED for unsafe targets or
failed safety, ACTION REQUIRED for missing/failed acceptance or access, and
WARNING only for optional assurance.

## Authorization boundaries

Codex may run task-relevant local checks, builds, and read-only remote checks.
Task-authorized implementation includes appropriate verification, commits,
task-branch pushes, draft PRs, CI follow-through, and independent review without
repeat owner approval. Use proportionate checks for the change as described above.
Stage only task-specific changes and preserve unrelated owner work. Checks that
require a clean committed worktree may run immediately after the local commit;
retain failures and repair authorized defects before acceptance or merge. Draft PRs
may expose incomplete checks so CI and review can start; report that state explicitly.
Continue under the same bounded approval; no stage already covered needs approval again.

Unless already covered by explicit task authorization, stop before any merge,
deployment, redeployment, rollback, alias
reassignment, environment change, Supabase link change, migration application
or repair, database repair, backup creation, restore execution, production data
write, or other production change. One user message may authorize multiple
protected stages when it explicitly names them. A bounded approval naming merge
and release authorizes those stages for that task; it is not blanket permission
for future releases. Do not ask again for a stage already covered by that approval.
Any unmentioned protected stage remains unauthorized. Production writes,
migrations, restores, destructive actions, and other materially risky
operations remain separately protected unless the user explicitly includes
them.

Current repository-specific migration and backup runbooks remain authoritative. Do not invent or pre-document migration,
backup, or restore commands or weaken their safety gates.

## Git worktree convention

- Perform implementation work in an isolated Git worktree unless the user
  explicitly directs otherwise.
- Create Recipe Genie worktrees only under
  the primary checkout’s sibling `.worktrees/recipe-genie/<short-task-name>`
  directory on either Linux or Windows.
- Use branches named `codex/<short-task-name>`.
- Do not create worktrees directly under
  the primary checkout’s parent, inside the primary repository, or inside
  another worktree.
- Before creating one, run `git worktree list` and confirm its path and branch
  are unused.
- Use the current authorized integration or base branch; do not assume `main`
  when the task specifies another base.
- Make task-specific changes only in the isolated worktree. Do not modify,
  move, remove, prune, or clean up another worktree without explicit
  authorization.
- Do not remove the task worktree automatically.

## Handoff

State the material outcome, relevant verification, branch/base and publication
state, actual blockers/warnings, and any external actions. Keep the report
concise; put detailed evidence in local artifacts when useful. End with exactly
one recommended next action. Do not claim tests, independent approval or release
that did not happen.
