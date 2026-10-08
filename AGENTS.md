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

Read relevant guidance and inspect Git state before editing. Preserve unrelated
owner changes. Read applicable skills and task-relevant `.Codex/napkin.md`
lessons when available; local memory is not authoritative policy. A harmless
read-only ordering mistake does not require restarting the task.

Use only the specialist docs needed for the work:

- [Architecture](docs/project_overview.md) and
  [guardrails](docs/ARCHITECTURE_GUARDRAILS.md).
- [Recipes](docs/recipes-component.md), [Planner](docs/planner-component.md),
  [Shopping](docs/shopping-component.md), [Pantry](docs/pantry-component.md).
- [Schema and migrations](supabase/SCHEMA.md),
  [backup/restore runbooks](scripts/database/README.md).
- [E2E workflow](web/tests/README.md) and
  [target/credential contract](web/tests/E2E_CREDENTIALS.md).
- [Documentation index](docs/DOCS_INDEX.md), [decisions](decisions.md),
  [release history](changelog.md).

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

Choose checks for the actual change and the task's environment constraints.
For prose-only changes, validate commands, links and whitespace; do not launch
full builds or browser/database harnesses merely for documentation edits.
For code, use the existing focused checks and required CI rather than inventing
new gates. Keep secrets, local auth state and raw private diagnostics out of
commits and uploaded artifacts. Preserve ignored `.codex-artifacts/` receipts;
never delete evidence, shared previews or processes as incidental cleanup.

Run `npm run rg:doctor` before environment-sensitive verification or operational
work involving Supabase, Vercel, GitHub, PostgreSQL, migrations, backups or
restores. It is optional for clearly local low-risk/prose changes and is local
capability evidence, not remote health evidence.

After a merge/deployment, use `scripts/rg-verify.ps1 release` as the first
read-only release consistency check. The workflow guide owns its syntax and
identity binding. Use `npm run verify:production` only when fuller database-backed
verification is required. Missing optional Vercel control-plane evidence is a
warning when authoritative GitHub checks and `/api/version` agree.

Report implementation, testing, review, merge and release separately. Preserve
failed checks and exact owner waivers: PR79's full browser qualification remains
FAIL under Aaron's maintenance-only merge waiver, not resolved UI acceptance.
See [PR79](https://github.com/aaron8819/RecipeGenie/pull/79) for the retained
Chromium locator ambiguity and unresolved WebKit findings.

Risk tiers: Tier1 is local code with no production/database writes; Tier2 is
additive or forward-repairable production work; Tier3 is destructive, lossy,
ownership-changing or recovery-dependent work. Never silently lower a tier
selected by the owner. Risk classification does not grant authorization.

Use `BLOCKED` for unsafe/contradictory targets, real migration divergence,
failed required safety checks or unauthorized destructive actions. Use
`ACTION REQUIRED` for pending/failed CI, missing authorization/access or release
SHA mismatch. Use `WARNING` for optional missing assurance; do not present it as
an unsafe-target blocker.

## Authorization boundaries

Codex may run local checks and explicitly requested read-only remote checks.
Stop before any commit, push, merge, deployment, redeployment, rollback, alias
reassignment, environment change, Supabase link change, migration application
or repair, database repair, backup creation, restore execution, production data
write, or other production change. One user message may authorize multiple
stages when it explicitly names them. For example, a request to implement,
commit, push, and open a draft PR authorizes those four stages without repeated
approval; any unmentioned later stage remains unauthorized. Production writes,
migrations, restores, destructive actions, and other materially risky
operations remain separately protected unless the user explicitly includes
them.

Current repository-specific migration and backup runbooks remain authoritative. Do not invent or pre-document migration,
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

## Handoff

State the material outcome, relevant verification, branch/base and publication
state, actual blockers/warnings, and any external actions. Keep the report
concise; put detailed evidence in local artifacts when useful. End with exactly
one recommended next action. Do not claim tests, independent approval or release
that did not happen.
