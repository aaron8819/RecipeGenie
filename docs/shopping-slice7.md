# Shopping Slice 7: Identity, extras, legacy operability and initial order

This slice activates explicit initialization and purchase identity through the
accepted Slice 6 command boundary. It depends on Slice 5's pure identity,
legacy-edit and saved-placement rules and the corrected Slice 6 protocol.
It does not complete the Shopping foundation or authorize deployment.

## Runtime and compatibility

An owner explicitly chooses **Update this shopping list**. The command checks
the observed revision; ordinary reads never convert or rewrite organization.
Supported older documents remain operable through their existing behavior until
that choice. Unsupported/malformed documents retain their original evidence and
recovery UI. Migration 024 adds validation and extends the existing service-only
commit function; it changes no stored row or signup default.

The initialized schema is version 4, retaining the existing entry/manual/override/
preferences structure. `ShoppingDocumentV3` and `ShoppingDocumentStateV3` remain
compatibility type names used by existing hooks; runtime readers discriminate
versions explicitly. V4 metadata is strictly checked before the V3 structural
validator validates the common fields. The obsolete candidate
`shopping-target-reader.ts` is removed; `readShoppingCompatibility` is the runtime
reader. Coverage and trip fixtures remain pure specifications for later slices.

- Each new manual extra/reminder has a frozen purchase key, policy version and
  edit version. Amount-only edits retain identity. A different purchase requires
  explicit rebind with total/location preview and version checking.
- Recipe add/refresh compares the supplied capture against the current owned
  recipe under the accepted dependency fence. Re-adding replaces the snapshot
  and selected scale. Identical captured source and scale are a no-op. Source
  evidence records sections, occurrence IDs, original quantities/preparation,
  source revision and authored yield metadata. Old entries retain their original
  entry and are marked reconstructed; missing historical IDs are not invented.
- Recipe requirements and extra requirements group by frozen purchase key.
  Exact scalar arithmetic uses bounded rational conversions. Ranges, packages,
  unknown amounts and repeated occurrences remain separate, inspectable parts.
  Breakdown shows hidden parts separately from the currently displayed total.
- Existing manual amounts and historical derived quantity/name overrides become
  independent editable legacy amounts. Raw evidence, previous checks and
  unresolved category/order evidence survive edits. Resolution chooses extra,
  explicit extra-now for a former total, or reminder, with destination/position
  preview. There is no subtraction from a guessed historical recipe baseline.
- Saved preferences hold the sole purchase sequences and explicit category
  overrides. Separate evidence pins canonical defaults and preserves disputed
  historical placements. Initialization preserves unambiguous slots and seeds
  previously unrecorded displayed order once; hidden fallback keys sort stably.
  Later additions use Slice 5's deterministic append rule. Existing identities
  keep their slots, including after hide, removal, Clear, refresh and return.
  Explicit conflict resolution archives the original disputed sequences.

The existing Shopping screen uses the activated controls and command hooks.
Recipe detail/planner add, source controls, settings, Pantry actions and existing
category/reorder controls continue through `/api/shopping`. Existing moves/reset
use strict document revision checks and local saved-sequence edits, preserving
hidden untouched pairs. No replacement sequence is accepted from visible rows.

## Concurrency and safety

Owner binding, bounded admission, canonical payload binding, durable receipts,
dependency replanning and replay protection remain unchanged. Independent new
extras may rebase; stale edits compare their observed item, and source replacement
compares the observed selection version. New selection versions are minted from
the next owner content revision, which survives removal and Clear. Changed
captures advance to at least that revision; unchanged captures keep their token.
Thus a version identifies the inspected selection state, including its lifetime,
without a counter that resets on re-add. Explicit tokens are checked even when
the supplied document revision is current. Older callers without tokens require
an exact document revision. Removal controls carry the displayed token, and
restoration requires that the selection is still absent. Retrying a committed
operation returns its receipt before planning; retry never retargets stale intent.
Editors adopt a returned target only when the fetched revision matches the
receipt revision. A newer fetch preserves the old draft binding and asks the
user to reload for a new edit, rather than adopting a replacement after replay.
Explicit legacy/placement conversion
requires the reviewed document revision. A later Clear fences stale work.
Editor drafts retain their inspected preconditions and survive rejection.

The accepted recipe TRUNCATE fence and monotone owner cache remain in force.
Resolved hook results pair a fetched document with its actual revision. Clear
uses the same database-computed actual inverse/full-document bounds and compact
Undo transport. Recipe-bearing Clear and later-write Undo remain unavailable;
there is no arbitrary restoration command. Individual manual removal retains a
versioned tombstone for conditional restoration.

### Independent review corrections

The correction request numbers stale yield as F1 and legacy order as F2; the
independent report uses the opposite numbering. F3/F4 match both documents.

- Legacy rows keep envelope IDs for editing and frozen purchase keys for
  ordering. Initialization includes manual-only identities, their actual stored
  categories, hidden rows and dormant slots. The supported V3 projector supplies
  display order for missing slots; no source-array/alphabetical reconstruction
  replaces an established order. Conflicting categories stay unresolved, with
  all original sequences retained. Independent unresolved rows use retained
  anchors for provisional display without choosing shared placement or writing.
- Removal and changed-ingredient refresh retire only orphaned atom overrides.
  Shared overrides, manual extras and all remembered purchase placement survive.
  Selection controls continue to derive from entries even with no visible rows.
- The Shopping-to-Pantry bridge increments a manual's version when its bucket
  changes. Show/hide and manual edit already increment it, so a bridge/return ABA
  cannot restore a stale rebind precondition. The existing owner lock, dependency
  revision check and unchanged-payload replan protect validation-to-commit races.
  Ordinary Pantry insert/update/delete changes dependency revision but does not
  change a manual extra's bucket, quantity or identity: extras bypass automatic
  availability hiding. Such transitions may replan a still-valid rebind. This
  is scoped manual protection, not Slice 8 acknowledgement/version semantics.

Original V4 documents remain readable without mutation. Where defective
initialization retained the sequence, corrected projection restores its order.
Migration 025 extends the existing service-only context with read-only receipt
provenance; it performs no document rewrite and changes no format or default.

### F2 existing-document recovery

The existing explicit `initialize` command also reviews retained V4 locations.
The screen offers **Review retained locations** when reconstructed source or
legacy-envelope categories disagree with a pinned initialization default.
Reads only detect the discrepancy; they never write. The command requires the
exact observed document revision and uses the existing owner lock/CAS commit.

Automatic recovery requires all of the following:

- A retained Applied receipt at the current content revision whose hash matches
  the canonical initialize command at revision minus one. This proves there has
  been no subsequent document write. Missing/pruned receipts, optional command
  variants, or later writes provide no proof; no history is inferred from defaults.
- The original identity-policy pin, no explicit category override and no existing
  unresolved/resolved archive for that purchase. Later explicit overrides win.
- Complete, consistent reconstructed source evidence: version zero, original
  entry equal to the retained entry, matching occurrence snapshots, and a single
  supported category. Source versions alone never prove organization history.
- A recoverable relative order: one retained source sequence and an empty
  destination sequence. Hidden and dormant slots count when checking anchors.

Eligible purchases move in their retained sequence order, sharing one placement
across equivalent needs. The canonical pin stays unchanged. The existing
`placementEvidence.resolved` archive records both category alternatives and the
full prior sequence, and prevents reruns from undoing later moves or resets.
Only organization and that archive change; quantities, manual intent, snapshots,
selection versions, checks and unrelated settings remain identical.

All genuine ambiguities use the existing `unresolved` envelope and explicit
destination/anchor controls. Partial/conflicting evidence, unknown interleaving,
and a missing initialization receipt do not select a winner. Missing historical
evidence cannot be reconstructed. Original source/envelope data stays intact.
The exact re-review fixture was installed directly, so it has no initialization
receipt: it transitions from Produce to a visible Dairy/Produce choice, then to
Dairy when confirmed. A real old-initializer commit with its matching receipt
recovers Dairy automatically. A later move and reset can produce the same JSON
as defective initialization; that history needs explicit confirmation.

Old committed commands return their receipt without executing again. Pending
stale organization/recovery commands conflict; a prepared plan that loses the
commit race replans with its original observed revision and conflicts. Existing
owner-scoped monotone cache handling prevents historical responses from rolling
back a newer fetched revision. No replacement writer or second order authority
is added. F1/F3/F4 and later-slice boundaries remain unchanged.

Regression commands: `node --import tsx scripts/test-shopping-placement-recovery.ts`
and `node --import tsx scripts/test-shopping-placement-recovery-browser.ts`.
The tracked defective fixture was generated through the actual `21c73d8`
initializer during the baseline SQL reproduction. The SQL suite rehearses its
old commit through real admission/commit, verifies receipt provenance and both
CAS interleavings, and reapplies migration 025 while preserving an affected row.
The browser suite verifies explicit resolution and persisted/rendered Dairy at
1440×900 and 390×844. Neither suite accesses hosted services or resets a shared
database. `shopping-placement-recovery.test.ts` covers the pure recovery rules.

Correction regressions (same verified loopback services described below):
`node --import tsx scripts/test-shopping-slice7-corrections.ts`, then the same
command with `--upgrade-fixtures` for original Slice 7 version-zero selections;
`node --import tsx scripts/test-shopping-slice7-corrections-browser.ts` for both
viewports. The browser script delays real removal requests, uses two authenticated
sessions, and checks committed SQL state. The database script additionally holds
production plans across competing commits and tests the real service-only RPC.
Hook tests separately verify preservation of inspected tokens across newer cache
state; they are not database evidence. Existing Slice 6/7 suites remain required.

## Acceptance and executable evidence

| Contract/scenarios | Executable checks |
|---|---|
| S14/S15/S19–S21 extras, distinct/frozen identity, rebind | `shopping-initialization.test.ts`; `test-shopping-slice7.ts`; `shopping-slice7.spec.ts` |
| S30/S41/S76 replacement, frozen evidence, total yield/batches | Same tests, including real source dependency mutation and repeated no-op |
| S54/S55/S57/S89–S95 durable initial order, return, defaults | Unit command tests and real concurrently admitted additions, with receipt revisions defining commit order |
| S112–S116 legacy edits, resolution, location, retained evidence | Unit command tests and both viewport workflows; SQL/TypeScript malformed/compatibility parity |
| Owner, replay, stale/conflicting commands, unsupported input | Real HTTP Slice 7 script and accepted protocol regression script |
| Slice 6 F1/F2/F3 | Correction script, correction/protocol browser suites, six pgTAP suites |

Browser runs use real local authentication, REST reads, command requests and
persisted SQL assertions. The older correction/protocol suites deliberately
hold or drop real responses to test delivery races; they do not mock database
commits. Screenshots are inspected at 1440×900 and 390×844. Exact counts, exits,
commit/tree identity and reproduction commands are recorded in the task handoff
under `.codex-artifacts/slice7/review.md`.

## Later slices

Slice 8 owns obtained-basis coverage/check acknowledgement, trip lifecycle and
recipe-bearing safe Undo. Activated rows show old checks only as previous-check
evidence; current-need check-off is disabled. This is not an implementation of
S113's new coverage acknowledgement portion. Slice 9 owns complete organization
controls and field/version-aware concurrent moves/resets. Slice 10 owns final
cleanup and foundation acceptance. These boundaries do not waive this slice's
identity, amount, legacy-operability or initial-order requirements.

## Local reproduction

Use the pinned Node 22.23.1/npm 10.9.8 distribution and an isolated Supabase
configuration (project `Recipe_Genie_Shopping_Slice7`, API 57321, DB 57322).
Never point these fixtures at hosted services or the shared default stack.
Copy migrations/tests into that configuration, start it, and derive `.env.local`
from its local status without printing keys. Start the worktree Next server at
127.0.0.1:3117. Run from `web/`:

```
node --import tsx scripts/test-shopping-slice7.ts
```

For upgrade, reset only that disposable configuration to 023, then run the same
script with `--apply`. It compares a representative persisted document/revision
before and after applying 024. For a fresh installation reset that configuration
through 024 and run without `--apply`. Run `supabase test db --workdir <isolated>`
for each mode. Set `RECIPE_GENIE_SLICE7_REHEARSAL=1` only for the accepted
`test-shopping-protocol.ts`, `test-shopping-corrections.ts`, and
`playwright test --config playwright.shopping-slice7.config.ts` regressions;
their original isolated-port defaults remain unchanged.

Finally stop task-owned services, commit locally, and run the trusted clean-commit
gate from the worktree root:

```
pwsh -NoProfile -File ./scripts/rg-verify.ps1 -NodeDistribution C:/node-v22.23.1-win-arm64 pr
```
