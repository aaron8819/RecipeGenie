# Combined UI hosted qualification candidate

This local CI addition is based on reviewed combined preparation commit
`5f44d00fe1b3bf0b8533d797e78c9762b913f2c2`, tree
`2802429507a2ac68a7ea9fdd3538415ad16847b6`.
It changes only a workflow, Playwright configuration/specification, environment preparation,
and this handoff. Application source, migrations, dependencies, permissions and contracts are frozen.
It has not been run, published, independently approved or released.
The spec lives in `web/qualification/`, outside ordinary Playwright discovery, so its Actions-only
guard cannot interfere with the existing local suites.

## Small qualification route

`.github/workflows/combined-ui.yml` runs on pull requests affecting web, scripts, Supabase
or this workflow. There is no push, manual dispatch or privileged `pull_request_target` trigger.
Both jobs check out the exact PR head, use pinned Actions, have only `contents: read`, and do
not persist checkout credentials. No repository secrets, grants, new tokens or paid integrations
are required. PR-scoped concurrency cancels superseded runs.

1. An ephemeral `windows-latest` job installs the existing locked dependencies and runs the
   unchanged trusted `doctor` and `verification.mjs pr --json` gate. This includes repository
   verification, production build and the existing PowerShell migration-tooling tests. The
   tooling tests require Windows PowerShell rejection, junction and peer-worktree fixtures;
   the job therefore creates one detached peer worktree in its temporary directory. Its ignored
   `.env.local` contains build-only dummy values. No app or database runs in this job.
2. Only after that gate succeeds, an ephemeral `ubuntu-latest` job starts and resets the existing
   local Supabase configuration, binds its generated loopback keys in an ignored `.env.local`,
   builds the same PR head, and runs Chromium/WebKit through standard Playwright `webServer`.
   It uses ordinary Next production and the repository's existing loopback production ingress.
3. Always steps upload bounded JSON/PNG evidence with seven-day retention and stop the
   job-local Supabase instance with its CLI. Hosted runner disposal is the final isolation boundary.

Each job is bounded to 45 minutes. Browser execution is serial, without retries, with a
25-minute suite limit, four-minute case limits plus two minutes reserved for teardown,
15-second API/action limits and ten-second private witness reads. No shared preview or laptop
resources are acquired or cleaned up. The workflow is deliberately not a reusable execution system.

## Changed-feature smoke coverage

Four cases cover desktop 1440x900 and phone 390x844 in Chromium and WebKit. Each uses two newly
created, confirmed disposable users, matching canonical recipe `id`/`recipe_uuid` values, grouped
ingredients with distinct lemon occurrences, a cooked meal, an unassigned meal, two saved weeks,
a replacement recipe and an initialized Shopping list containing a manual item.

Real paths include UI sign-in; owner-scoped RLS reads; card Shopping subset/yield persistence;
detail/print/edit entry reachability; saved selector reuse from detail, Planner and Dashboard;
full-week cooked inclusion; return-week navigation/reload; duplicate prevention; move, cooked
Undo, remove Undo and swap; global history exact-row Undo; stale Shopping source rejection;
and a committed Shopping write recovered with the same operation identity after response loss.
Assertions check database revisions, membership, ordinals, manual preservation and history versus
weekly cooked-state separation. Dialog geometry, keyboard containment and trigger focus are checked.

Injected faults are explicitly browser-only: Shopping admission/read failure, lost execute
response after a real server request, Planner read/swap failure, and history DELETE failure/pending
retry. Successful retries use real local app/SQL paths. These are not production network or
database outage simulations. Owner B's public and private Shopping state is hashed before/after
the A flows; B cannot read A's canonical recipe through its authenticated SDK.

## Evidence and safety

No auth storage state, traces, videos, HARs, sessions, raw row dumps or environment files are
uploaded. Generated keys/passwords/emails are masked in logs. Receipts contain source/run identity,
case checks, witness status, canonical disposable owner IDs and cleanup status; screenshots mask
the disposable email. The existing gate's JSON renderer omits child output.

All acquisition is inside a teardown scope. Returned user identities are journaled in memory.
Teardown releases any held route, closes its own browser contexts, rechecks exact user ID/email/run
metadata, revokes its own fresh sessions and deletes only those users. It then checks Auth absence,
all owner-keyed public tables, sender/recipient shares, and private Shopping protocol/admissions
absence. Private reads use the existing CI Docker/psql path against only
`supabase_db_Recipe_Genie`; the SQL is owner-scoped and read-only. Cleanup continues for other
owned fixtures on failure. Missing acquisition, witness or absence evidence cannot produce PASS.
Cancellation, job timeout or runner loss can prevent receipts/teardown; such a run is incomplete
and cannot qualify a release, even though its ephemeral VM/database is discarded.

## Remaining qualification and release prerequisites

No tests, builds, browser/server/database harnesses or process cleanup were run on the laptop.
Only source compilation, lint, formatting, YAML/static inspection and Git checks are permitted here.
Parent owns independent review, any push/PR creation, workflow execution and release decisions.
After authorization, require fresh trusted PR-gate PASS and all four browser receipts PASS for the
same exact head, complete absence/witness evidence, existing required CI checks, and current-main
divergence review. Missing artifacts, skips, cancellation or either job failure block qualification.

The first hosted execution may reveal platform assumptions in the existing trusted Windows gate
or local Supabase fixture contracts. Keep failures visible; do not substitute a lighter gate or
count source checks/input slice passes as combined runtime approval. The browser build is separately
executed on Linux against disposable local keys; the Windows gate's build is not its runtime artifact.

Known limits: WebKit document responses remove only `upgrade-insecure-requests` in the browser to
reach local HTTP production; server CSP stays unchanged, so this is not a production CSP claim.
Sharing/import mutations, actual print output, edit-save/delete flows, 320px and exhaustive accessibility
matrices, live hosted infrastructure, back/forward history traversal, stale concurrent-swap SQL races
and collection-unmount Undo persistence are outside this focused smoke. Retry Undo persists only
while the collection is mounted. Existing input tests provide context, not a PASS for this candidate.
