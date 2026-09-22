# Shopping domain reference

Shopping stores one owner document. Supported old documents read without writes;
explicit initialization produces V4. The authenticated `/api/shopping` boundary
admits commands, plans against authoritative state, and commits through the
service-only `shopping_commit` transaction. The browser never replaces a document.

## Runtime ownership

| Files | Authority |
|---|---|
| `shopping-compatibility.ts`, `shopping-initialization.ts` | Strict V1–V4 readers, explicit initialization and preserved legacy evidence |
| `shopping-command-client.ts`, `app/api/shopping/route.ts` | Owner/payload-bound admission and retry |
| `shopping-command-planner.ts`, `shopping-initialized-command.ts` | Authoritative command validation and pure planning |
| `shopping-document.ts`, `shopping-view.ts`, `shopping-quantity-display.ts` | Frozen-source projection and lossless rendered operands |
| `shopping-coverage-runtime.ts` | Exact buyable coverage, alternatives, packages and old-evidence recheck |
| `shopping-organization.ts`, `shopping-target-order.ts` | Shared purchase placement, hidden/dormant slots, versions and relative inverses |
| `hooks/shopping/use-shopping-document.ts` | UI command adapters, owner fencing, monotonic cache reconciliation and confirmed feedback |
| `shopping-list.tsx`, `shopping-organization-dialog.tsx` | Sources, extras, completion, recovery, drag and keyboard organization |

Resolved manual amounts are extras, added to compatible recipe demand. Reminders
remain visible operands. Re-adding a recipe replaces its selected frozen snapshot
and exact yield; it does not add another occurrence. Source controls use recipe
UUIDs, including hidden or empty selections and duplicate titles.

Manual wording and quantity commands compare the inspected touched-field versions
and a shared identity/visibility guard. Purchase-equivalent wording and quantity
edits can commute; same-field changes (including value-return ABA) conflict.
Explicit unchanged replacement fields still count as intent; forms omit unchanged
fields and preserve explicit quantity clearing. Legacy edits retain whole-record
checks. Rebind, removal/restoration and Shopping-to-Pantry/visibility changes
advance the shared guard; their whole-item version checks remain intact.
Migration 029 adds optional `identity.fieldVersions` without rewriting old rows.
Missing field history starts from the existing whole-item version. Only a
successful command records new history; reads remain pure.

Completion acknowledges the inspected buyable basis. Demand changes retain checks
only when coverage is proven. Alternative constraints, unknown package sizes,
ranges and unknown quantities remain conservative. Unsupported V1 coverage is
preserved and requires one explicit recheck; it is never silently upgraded.

One purchase key owns remembered category/default/position across equivalent
manual and recipe parts. Commands establish missing slots. Moves splice only the
moved key; projection, filters, reload, source removal and Clear never compact
dormant slots. Reset Position, Reset Category and Clear are distinct operations.

V4 `tripVisibility` owns explicit bucket choices by purchase key, independently
of active sources, placement and completion. Recipe refresh/removal, manual
removal/rebind and coordinated recipe deletion retain dormant choices. Equivalent
manual/recipe demand uses the same choice on return. Clear removes it; bounded
Undo restores it as content while preserving later organization. Migration 030
extends validation, content snapshots and coordinated deletion without rewriting
existing rows. Commands recover only consistent retained legacy bucket evidence;
already-pruned choices and contradictory history cannot be reconstructed.

Clear starts a new trip and retains organization. Its single inverse is bounded
to 1 MiB and ten minutes. Undo requires unchanged content epoch and existing owned
recipe sources under transactional locking; organization-only changes survive.
Restoration uses frozen evidence in a new generation. Organization Undo is a
separate session-local conditional inverse. Retry receipts last fifteen minutes,
with 256 owner admission slots; retries do not extend inverse lifetimes.

## Compatibility that must remain

- V1–V3 structural readers and V3 projection/settings UI support old documents
  before explicit initialization. `ShoppingSettingsModal` and
  `useUpdateShoppingConfig` still have this production caller.
- Legacy independent rows remain visible, editable, removable and recoverable.
  Explicit resolution preserves raw evidence and binds confirmation to the
  reviewed revision. Recovered placement is not guessed again on reload.
- Revision-fenced older command shapes remain for receipt/payload compatibility.
  Direct REST/RPC writers remain denied by database grants and fences.
- Invalid/unsupported whole documents remain preserved and read-only. Pantry
  failure is unavailable data, never an empty successful dependency.
- Historical migrations and fixtures remain. The former client CAS implementation
  is retained only in `src/test/shopping-legacy-persistence.ts`; its production
  callers were replaced by the command boundary. The conflict error/type module
  remains shared with current callers.

## Detailed contracts and verification

See [boundary and fences](shopping-slice6.md),
[initialization and recovery](shopping-slice7.md),
[coverage and lifecycle](shopping-slice8.md), and
[organization](shopping-slice9.md). The [historical V3 reference](history/shopping-v3-reference.md)
preserves earlier implementation context; its temporary restrictions are not
current V4 requirements.

Run the root trusted `scripts/rg-verify.ps1 pr` gate under Node 22.23.1/npm 10.9.8.
Authenticated local scripts under `web/scripts/test-shopping-*.ts` additionally
exercise HTTP, persisted outcomes, deterministic races and populated upgrades.
Their ports and local fixture requirements are explicit in each script.
See [local production-build configuration](../web/tests/LOCAL_AUTH_BROWSER.md).
Slice 10's exact scenario ledger and independent-review handoff are retained in
`.codex-artifacts/slice10/`. Local verification does not authorize deployment or
establish hosted health. Foundation acceptance requires independent review.

## Shopping presentation

Initialized lists use the normal Add item form for manual extras and reminders.
Each ingredient has one collapsed View sources disclosure containing every
recipe occurrence and manual contribution; contributions outside the displayed
bucket are explicitly marked. Manual edit/remove and legacy-meaning controls
live in that ingredient's disclosure, including In Pantry and Excluded rows.
Yield controls sit with Recipes in list, which includes hidden-only selections.
Unresolved placement controls appear on affected rows; dormant placement
evidence without a row retains a conditional recovery control.

Entirely unspecified quantities omit the main-row amount only. Expanded source
wording, mixed known/unknown amounts, copy/export, and persisted quantities keep
their existing lossless semantics. Disclosure and form interactions are separate
from check-off and drag handles.
