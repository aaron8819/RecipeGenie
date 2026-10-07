# Combined Recipe and Planner preparation checkpoint

STATUS: COMPLETE for local preparation only. Qualification pending under the
Trainer browser-process ownership hold. No combined runtime approval or release.

## Exact inputs and base

Read-only remote lookup on 2026-10-07 confirmed origin main:
`8277eeeb06ee68d5c198f0fa9d6d781f9135bacc` (tree
`87d20421bbe01ab1b198b071b1df3d6cc0c7f8e8`). This is also both inputs' merge base.
No divergence from remote main was observed. Primary main remains older f682945.

Recipe input: `22387af6ce1eefe0fc4c46f0f8e61161ee6eafe9`, tree
`f578faa31b8240f6e69abb3f602dbb1797484f49`, direct parent
`7579572a75ba1766cc35000be0bc775efa291c00`.
Retains cards 9e8ce1c and detail e9fd69a in its ancestry.

Planner input: `56b3e026e9876c5853bb57bf2beb4df135f8109c`, tree
`8076d11b46569798648c08092746cd18b55af37c`, direct parent
`bfc216f71fbc5e97dbafa60acaf0a2daf9461902`.

Branch: `codex/recipe-planner-combined-prep`.
Worktree: `C:/Users/aabloch/claude/vibe-coding/.worktrees/recipe-genie/recipe-planner-combined-prep`.
The preparation merge has Recipe then Planner as its two parents. Its exact SHA
and tree are recorded in the task-7 HANDOFF.md outside this tree to avoid a
self-referential identity. No existing local branch contained both heads before
creation; no duplicate combined worktree was found in registered worktrees.

## Reconciliation and scope

The input changed-path sets are disjoint: Recipe owns 18 paths, Planner owns 9.
Git merged without conflicts; 26 input paths retain their input blobs; the
historical integration plan retains its input content plus the checkpoint pointer.
No implementation, test, or historical evidence file was manually rewritten.
The only new content is this preparation note and a current-checkpoint pointer
in the historical integration plan. Earlier plan sections describe staged work;
this checkpoint records what is actually included and does not expand Slice 5.

Shared semantic boundary: Planner calls Recipe's grouped Shopping selector.
Static source inspection confirms onCloseAutoFocus still forwards to DialogContent,
actual connected/enabled Planner triggers restore focus, canonical flattened
ordinals remain global, and initialShoppingSelection precedes caller defaults.
Dashboard and shell source remain unchanged. Recipe hook changes retain the
weekly mark-made caller and add exact-entry global-history Undo without changing
weekly cooked-state writes. Runtime compatibility still requires qualification.

Preserved dispositions: unassigned meals distribute into existing day buckets;
Clear week is omitted; one recipe occurrence per week; saved Shopping yield and
subset win. Preserve recovery/receipt deduplication, return-week URL navigation,
existing templates/settings/generation controls, and separate history/cooked state.
No new workflow/contract, schema, migration, credential or security change.
PR73 migration work remains outside this integration scope.

## Evidence boundaries

Read exact Recipe Undo independent REVIEW.md in recipe-slice3-undo-rereview,
Planner fixes/HANDOFF.md and task-6/REVIEW.md. Their PASS results qualify the
recorded separate candidates only. Recipe evidence reports 21 focused tests,
both engines and 229 hashes; Planner correction review binds 74 packet plus six
carried hashes, reusing 27 tests/72 browser checks and its exact-candidate gate.
This preparation did not rerun or independently approve those executions.
Recipe Retry Undo lasts only while the collection remains mounted: reload or
unmount loses the retry control while retained history persists.

Read repository AGENTS.md/CLAUDE.md, domain references, architecture guardrails,
current integration plan and capability map. No checkout SKILL.md was found.
No specialist skill was needed for Git/source-only preparation.
Static verification: exact commit/tree/parent identities and common ancestry;
remote main lookup; clean source candidates; no unmerged index entries;
combined diff whitespace check; changed-path/scope and shared-interface inspection.
No formatter/linter/compiler/test/build/server/browser/database process was run.
The normal gate and doctor are deferred by explicit user hold.

## Proposed targeted combined qualification (parent-owned, after hold clears)

1. Bind a clean exact combined commit/tree; reconfirm remote main and permitted
   process ownership. Use pinned Node 22.23.1/npm 10.9.8 and repository trusted
   runtime/gates. If remote advances, reconcile and qualify the new resulting head.
2. Focused suites: Recipe card/list/detail/state, history stats/Undo, shared
   Shopping selection and quantity/ordinal helpers, Planner components/interactions/
   selectors/route-state/template-load, and unchanged Dashboard Shopping callers.
3. Authenticated Chromium and WebKit sequentially at 1440x900, 390x844, 320x844:
   Recipe card/detail, Planner meal/full-week, Dashboard Shopping. Check actual
   pointer/keyboard trigger focus, Escape/Cancel, containment and removed/disabled
   fallback; grouped repeated ingredient ordinals; saved yield/subset over viewed
   yield/week scale; Select/Deselect all; long text/footer geometry/no overflow.
4. Verify failed source/read/command recovery and unknown-outcome deduplication,
   saved selections after reload, stale selection rejection/reopen, owner isolation,
   Planner failed/cached reads versus genuine empty week, exact-entry rejected Undo
   retry with newer rows and pending taps, and weekly cooked flags unchanged by
   Recipe global-history Undo. Cover Planner cooked/move/remove Undo/swap conflict,
   duplicates, day distribution, templates/generation/settings reachability, and
   Recipe return to the selected Planner week via Back/Forward/reload.
5. Run required exact-clean-head PR gate without weakening checks. Independent
   combined review must distinguish fresh coverage from carried evidence. Native
   Safari/physical touch/screen-reader/production HTTPS remain disclosed gaps unless
   specifically qualified. Windows WebKit loopback shim evidence is not hosted CSP
   evidence. Comprehensive race/settings/history/regeneration coverage remains
   limited as disclosed by the input reviews.

## Release prerequisites and safety

Parent must clear the verification hold, own safe qualification/process handling,
review the combined exact head, and require exact-head hosted CI before merge.
Parent owns push/PR/main merge/deploy and release-status expected/deployed SHA
confirmation under the existing authorization. Do not infer deployed health from
local evidence. No migrations are introduced or requested by this UI candidate.

Only isolated Git/file operations and read-only remote lookup occurred here.
No tests, builds, harnesses, browser/server launch, process cleanup, push, PR,
main merge, deployment, hosted/data writes or external messages. Existing
previews 3124/3126/3184, Trainer, accounts, infrastructure, original worktrees
and ignored review evidence were not touched.

Next action: parent qualify this exact combined candidate after clearing the hold.
