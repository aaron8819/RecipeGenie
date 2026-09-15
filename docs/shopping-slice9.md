# Shopping Slice 9 — Shared organization controls

Contract: finalized Shopping foundation blueprint §7 (D02/D05/D06/D08),
migration-plan Slice 9; scenarios S51–S68, S89–S95 and S100.
Prerequisites: accepted Slices 6/7; Slice 2 semantic settings direction remains.
The implementation base includes accepted Slice 8 corrections.

## Production paths

`ShoppingOrganizationDialog` supplies keyboard purchase start/end/anchor moves,
single and bulk position/category/both resets, category creation/rename/deletion,
relative section moves and category-order reset. The selected purchase includes
all equivalent manual/recipe parts. All remembered keys, including hidden and
dormant keys, are available. The existing Manage drag path captures its snapshot
at drag start and submits the same `organize` command through `useShoppingMutation`.
Both use the existing authenticated `/api/shopping` admission/execute boundary,
service planner and atomic owner/dependency/revision-checked `shopping_commit`.
There is no second persistence path, table or mutation queue.

`shopping-organization.ts` adapts the persisted document to the existing pure
splice rule. Only the moved key is removed/reinserted; hidden anchors stay valid.
Start/end includes all dormant slots. Explicit moves set a shared category
override; position reset preserves that override, category reset removes it and
uses the pinned default. Bulk resets operate on an explicit inspected key scope.
Category deletion immediately transfers the whole sequence to the chosen
fallback in its original order and repairs independent legacy locations. Raw
legacy evidence and pinned defaults stay intact.

Optional `organizationVersions` in the single V4 document stores per-purchase,
category existence, label, section and setting history plus bulk-scope epochs.
Unchanged anchors and unrelated purchase targets keep their versions. A label
rename does not invalidate a purchase destination. Deletion/recreation and
same-field ABA retain monotonic history. Missing metadata reads as version zero;
reads and migration 028 never initialize or rewrite existing rows. Compatible
older replacement intents remain strictly revision-fenced and advance relevant
history conservatively; obsolete adapters are retained for Slice 10's inventory.

## Conflict and Undo

Open organization drafts keep their inspected snapshot across background reads.
Only an explicit Review latest organization action refreshes their approval.
Conflicts retain selections and show recovery feedback. Command retry keeps the
existing immutable owner/payload admission and receipt, never a new operation.

Move Undo is a relative inverse bound to the successful move's key and saved
anchor versions. Unrelated moves may survive; newer movement of the same key or
anchor refuses. Single resets use the same inverse. Bulk reset Undo saves
relative splices and validates the purchase/category scope before any change.
Category deletion Undo recreates only the category and its placements using a
saved section anchor; any intervening purchase/category/section change refuses.
No inverse restores a stale preference map or old content. Undo controls are
session-local; reload retains committed organization but drops these controls.
Section-order reset has no Undo control. Clear's separate bounded authoritative
inverse and current eligibility rules are unchanged.

## Compatibility and verification

Forward migration 028 extends V4 structural validation for nonnegative safe
integer history. It adds no column, grant or writer. Apply the compatible schema
before activating this application; older V4 readers may reject documents with
new metadata, so rolling back to an incompatible application is not supported.
No hosted rollout is authorized or claimed.

From `web/`, under Node 22.23.1 / npm 10.9.8:

- `tsx scripts/test-shopping-slice9.ts`: authenticated HTTP, persisted receipts,
  prepared-plan CAS barrier, duplicate execution, owner isolation, historical
  replay, lifecycle preservation, reset/deletion and setting ABA.
- `tsx scripts/test-shopping-slice9-browser.ts`: actual sign-in, keyboard moves,
  stale draft/explicit recovery, lost response, deletion/Undo and reload at
  1440×900 and 390×844. Loopback app 3117, Supabase API 57321/DB 57322.
- `tsx scripts/test-shopping-slice9-upgrade.ts`: only on a task-owned disposable
  database through 027, with retained `http-state.json`; applies 028 once on one
  connection and verifies exact populated preservation and structural rejection.
- Focused unit cases: `shopping-organization.test.ts`, placement recovery and
  Shopping orchestration. Trusted root `scripts/rg-verify.ps1 ... pr` remains the
  final clean-commit gate.

Evidence and exact results: ignored `.codex-artifacts/slice9/review.md`.
Development browser evidence does not resolve the accepted production-mode
loopback CSP sign-in limitation. CSP/authentication remain unchanged.

## Deferred boundary

Slice 10 is Compatibility cleanup and foundation readiness: inventory consumers
and formats before removing unused adapters, preserve historical/unresolved
evidence, and verify complete flows on the exact revision with appropriate
rollout evidence. No Slice 10, visual redesign, dormant cleanup, fractional ranks,
CRDT, hosted migration or deployment is included. Independent review is required
before accepting Slice 9.
