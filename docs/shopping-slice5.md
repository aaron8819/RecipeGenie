# Shopping Slice 5: rules and compatibility

Base: Slice 4 `e709d26c4e1b5bf12553a2284fd477f100d77aaa`.
The finalized September 11 Shopping contract and ten-slice migration plan
govern this change. This is a behavior-preserving V3 extraction plus bounded
target specifications. Passing these tests does not establish full foundation,
deployment, or authoritative command readiness.

## Rule ownership and production callers

| Rule | Pure home | Production caller / boundary |
| --- | --- | --- |
| Manual quantity construction and purchase collision decision | `shopping-manual-rules.ts` | `useAddShoppingItem`, `useUpdateShoppingItem`; both initial planning and fresh CAS replay |
| Supported read versus malformed/unsupported state | `shopping-compatibility.ts` | `parseShoppingDocumentRow`, for fetch and CAS responses |
| Lossless projected rows, source UUID labels, selection metadata and settings adapter | `shopping-view.ts` | `useShoppingList`, config query and mutations; original hook exports forward to the one implementation for compatibility |
| Frozen recipe projection, quantity aggregation, bucket classification, document reducers | Existing `shopping-document.ts` / ingredient semantics | Retained, not reimplemented |
| Settings intent preconditions | Existing `shopping-settings.ts` | Slice 2 hooks retained |
| UUID source identity, category fallback, quantity formatting | Existing sources, category and quantity helpers | Slice 3–4 UI callers retained |
| Current saved ordering and fallback ordering | Existing `shopping-ordering.ts` | Production projector/reducers unchanged; scalar-value text comparator exported for target batch ordering |

Network requests, owner/cache guards, Pantry acquisition, retry scheduling,
CAS and error/toast translation remain in hooks/persistence. The manual rule
returns Allowed, Conflict or TargetGone. An Allowed result is permission to
continue local planning, not a successful server acknowledgement. Quantity
construction preserves null/zero distinctions and existing unit normalization.

The reader accepts the existing V1/V2/V3 structural compatibility contract.
V1/V2 upgrades are in-memory only. V3 frozen semantics remain unchanged. It
returns the original malformed/unsupported value for recovery, never an empty
replacement. The hook still exposes the existing read error and refuses writes.

## Target specifications, deliberately inactive

These small modules are executable target rules for the later service; none is
imported into production mutation paths:

- `shopping-coverage.ts`: exact rational scalar sums, identical range/token
  multiplicity, known package descriptor/count comparison, componentwise mixed
  units, empty/changed/invalid outcomes, and acknowledgement preconditions.
  Inputs already contain canonical purchase/material/unit keys. Only identical
  units are supported here; no new conversion catalog, density conversion,
  package-content conversion or rounded purchase arithmetic is inferred.
- `shopping-target-order.ts`: pinned semantic catalog → bounded whole-phrase
  keyword policy → Misc, batch append by Unicode scalar-value key order,
  return-slot reuse, and moved-key-only splice with target/anchor versions.
  Policy version and catalog/keyword evidence are explicit inputs. Their order
  is pinned policy, never recipe/source voting. Existing placement wins.
- `shopping-target-selection.ts`: explicit positive exact scale replacement,
  selection/source/trip preconditions, immutable full authored snapshot and
  supplied occurrence IDs. The source revision/context must eventually come
  from the authenticated transaction. No identifiers or missing history are
  fabricated. A batch multiplier uses the same exact scale; this adds no yield UI.
- `shopping-target-legacy.ts`: independently editable unresolved amount,
  text and previous-check evidence by ID/version; raw evidence, contradictory
  categories/order and unavailable history survive every safe edit.
- `shopping-target-reader.ts`: candidate **V4 content fixture** structural
  reader for resolved needs beside supported legacy envelopes, with complete
  placement sequences and retained V3 evidence. V4 is separate from V3, not a
  relabeling of its booleans/fields. This is not the final persisted owner or
  service wire schema: Slice 6 must complete protocol/dependency fields and
  matching SQL validation before activation. Current runtime explicitly rejects
  V4, so there are no target writes or accidental lazy conversions.

## Compatibility classes and scenario map

Synthetic corpus: `web/src/test/shopping-compatibility-fixtures.ts` and the
table-driven `shopping-foundation-compatibility.test.ts`. Expected outcomes are
explicit assertions, not generated snapshots. Existing structured-quantity
fixtures remain in `shopping-quantity-display.test.tsx` and frozen semantics
fixtures in `shopping-ingredient-semantics-v3.test.ts`.

| Scenarios | Passing evidence and its limit |
| --- | --- |
| S01/S02/S04/S06/S08/S18/S19/S25/S28/S31–S46 | Existing document, semantics, persistence and manual-hook tests retained; new fixture asserts source multiplicity, exact preserved manual quantities, frozen inputs, and stable preferences through Clear |
| S27/S40/S49/S71/S72/S75 | New reader/view fixtures plus Slice 4 query/component/browser tests: all selections, UUID identity, real recipe named Manual, unknown categories, errors distinct from empty |
| S35/S38/S39/S84/S85 | Existing lossless display suite exercises fractions, packages, repeated ranges, mixed units, qualitative and unspecified amounts through the relocated production adapter and rendered components |
| S50/S61/S63/S100 | Existing Slice 2 pure and hook tests preserve independent settings and conservative conflicts |
| S26/S101/S102 | Existing Clear Undo hook/persistence regressions retain exact successful-attempt preimage and fixed-revision refusal |
| S70/S112/S116 compatibility | New empty V1/V2/V3 and populated V2 fixtures preserve original input, manual amount/check/category evidence, and full dormant sequence; no historical identity/order invention |
| S14/S15/S76 | Target-only arithmetic tests prove both operand orders cover exact 5; replacement scale 2 stays 2 on repeat. Runtime extras grouping/yield capture remains Slice 7 |
| S77–S88 | Target-only coverage/precondition fixtures: increases, decreases, material changes, fractions, ranges, packages, unknown multiplicity, mixed units and inspected-basis races; runtime completion is Slice 8 |
| S54/S55/S59/S64/S66/S89–S93/S95 | Target-only batch, return, hidden splice, empty destination, anchor conflict and default fixtures. Production saved order is unchanged; runtime append/shared placement remains Slices 7/9 |
| S112–S116 target envelopes | Pure safe-edit/mixed-reader fixtures preserve ambiguous meaning and all conflicting evidence. Real resolution UI, conversion and writer fencing remain Slices 6/7/10 |

**Temporary behavior retained:** V3 rejects adding a manual purchase already
active; rebind scans all projected buckets while add uses active rows with
explicit successful Pantry. Same-identity manual amount edits remain legal
alongside recipe demand. Quantified manual extras remain separate rows. V3
unquantified reminder shadowing and recomputed manual identity remain. These
are compatibility restrictions, not the final D01 identity/extra contract.

Slice 1 Undo still refuses after any later document write, including organization
changes, and withholds recipe-bearing inverses. Slice 2 retains its conservative
revision fallback without ABA history. Slice 4 unsupported documents remain
read-only; supported legacy envelope operability is still a future runtime feature.

**Deferred acceptance:** S05/S10/S11/S48/S69/S73/S74/S107–S111 require Slice 6
transaction authority, every-writer fencing and bounded receipts. Pure source
preconditions do not close the source deletion race. S20/S21/S30/S41 and
S89–S92/S112–S116 need Slice 7 initialization/evidence/extras/legacy activation.
S17/S23/S47/S77–S88/S96–S99/S103–S106 need Slice 8 trip, dependency and coverage
authority. S51–S68/S93–S95 need Slice 9 complete shared organization commands
and UI; existing tested portions remain compatible. S94 resets/deletion,
S97 empty trip choices, S99 complete target Clear, S103–S106 full inverse
lifecycle and S114 explicit resolution preview are not implemented in this
slice. No skipped or failing future-contract tests are added to the passing suite.

The known hidden-slot defect in V3 `mergeVisibleSequence`, source/manual
placement disagreement, alphabetical fallback for unlearned purchases, and
stale move no-op feedback are not blessed as intended behavior. This slice
does not change those implementations. Target splice tests state the approved
answer separately; reads never rebuild persisted order or discard dormant keys.

## Real verification boundary

`shopping-rules.spec.ts` uses disposable owners on verified loopback Supabase
and the task's app at port 3107, at 1440×900 and 390×844. It stores actual V3
fixtures, checks rendered quantities/order and manual editing through hooks,
reloads, compares full recipe evidence/preferences, verifies zero read writes,
and checks rejected collision causes no write. It deletes only its owners.
It does not intercept database responses.

The retained `shopping-operability.spec.ts` verifies source controls/recovery
at both dimensions. Its invalid/read-failure cases are browser-only intercepted
responses; valid V3 fixtures are real database data. Neither harness resets
shared fixtures. Exact run results, screenshots, commit/tree and trusted gate
are recorded in the task-local `.codex-artifacts/slice5/review.md`.

Next planned slice: **Slice 6 — Authoritative commit, receipts and compatibility
fence**, requiring its separately authorized schema/security scope.
