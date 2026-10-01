# Shopping Slice 8

This slice activates the finalized blueprint §§6, 8–10 through the existing
authenticated `/api/shopping` planner and service-only `shopping_commit` RPC.
It does not complete the Shopping foundation or introduce Slice 9 controls.

## Contract and entry points

| Requirement | Scenarios | Runtime |
|---|---|---|
| Exact buyable coverage; stale checks and unchecks | S77–S88 | `shopping-coverage-runtime.ts`, initialized projector/planner, rendered row evidence passed through the mutation hook |
| First generation, empty Clear, old-trip fencing | S96–S99 | migration 026 row metadata, command planner and existing Clear hook |
| Clear committed preimage; content ABA refusal; current organization | S101–S103 | private bounded inverse, content-epoch trigger, `undoClear` reference command |
| Frozen source restoration and deletion coordination | S104, I09 | owned recipe existence and dependency checks under the existing owner lock; admitted recipe deletion |
| Fresh restored generation, consumption, size and lifetime | S105–S106 | same commit transaction, 1 MiB inverse, ten-minute database expiry |
| Receipt replay, binding and expiry | S107–S111 | unchanged admission/ticket authority; terminal lifecycle outcomes added to the client reader |
| Shared/dormant/hidden organization and legacy approval | S55/S92/S95/S115 | current organization retained; existing placement/recovery commands and reviewed-revision editor preserved |

Earlier slices supply pure coverage comparison, exact quantities, frozen source
occurrences, non-reusable selection versions, command-owned placement,
owner/payload binding, bounded admission and receipts, writer fencing, and
legacy recovery. Slice 8 connects coverage to the runtime and replaces the
temporary whole-document/recipe-bearing Undo restrictions.

## Atomic lifecycle

Migration 026 adds `trip_id`, `trip_revision`, and `content_epoch` to the existing
row. New owners receive a generation with their existing row initialization;
reads never create one. Existing documents and content revisions are unchanged.
Every actual content update advances the epoch, including changes that later
return to an earlier value. Organization-only changes do not. Legacy independent
category repair is excluded from this comparison. Clear and Undo rotate the trip;
Undo never revives the original generation. The trip-start revision also fences
older callers and drafts whose cache has refreshed since they were inspected.

Clear stores the actual locked preimage, at most one inverse, in the existing
private protocol row. It preserves preferences, placement evidence, Pantry and
the recipe library. Empty Clear is unchanged. The computed capability checks current owned sources and uses PostgreSQL encoded
bytes, including retained raw provenance and acknowledgements.
At more than 1 MiB, Clear succeeds without Undo. The HTTP Undo request contains
only its command, original Clear revision and admission reference: it does not
send the inverse back through the 1 MiB request/structural limits.

Undo checks the original inverse revision, post-Clear trip and epoch, supported
structure, unused inverse and database-clock expiry. Current organization is
retained; deleted legacy categories use a current fallback. The commit rechecks
expiry, exact inverse content and organization, validates owned sources, changes
the generation and consumes the inverse with its receipt. Missing recipes reject
the whole operation. Editing an existing recipe does not change its saved frozen
Shopping snapshot.

Recipe deletion already enters the same owner lock before its internal deletion.
Refresh/Undo hold that lock across source existence validation and commit, and
recheck the dependency revision captured by the planner. Deletion first makes a
prepared plan replan and refuse; content first allows deletion to remove that
contribution afterward. A committed receipt is returned before stale conditions
without executing again. Initialization may preserve legacy evidence for an unavailable source; unrelated
edits remain operable, while refresh validates changed sources and Undo validates
all saved sources. Direct recipe deletion/truncation, arbitrary Shopping
writes and legacy RPC writes remain fenced.

## Coverage and user feedback

### Slice 8 corrections (F1–F3)

Coverage version 2 groups exact quantities by canonical allowed alternatives
before summation. Captured source occurrences supply alternatives; Pantry
family matches are not material identity. Reconstructed alternative wording
retains a separate conservative identity until explicitly refreshed. Unknown
package sizes retain each normalized count/descriptor token, including repeated
occurrences; only known identical package sizes permit scalar count coverage.
Display operands retain original package wording.

Migration 027 accepts both coverage versions without rewriting documents,
revisions, acknowledgements or inverses. Version 1 runtime evidence omitted
alternatives and operand provenance, so it cannot prove safe material coverage
after source changes or removals. The authorized compatibility strategy retains
that evidence and acknowledgement version, but requires one explicit recheck
before it can satisfy version 2 demand (with an explicit request to recheck missing ingredient/package detail). Legacy
boolean evidence and corrected version 2 completion are unaffected. Old clients
cannot check version 2 demand with version 1 inspected evidence. A rollout must
use the corrected reader and command boundary together; downgrading the
application can reintroduce the old coverage interpretation.

Clear success comes from its Applied receipt. A follow-up read reconciles with
the newest same-owner cache before evaluating Undo against the receipt's trip
and content epoch. New content disables Undo without turning Clear into a
conflict; organization-only changes preserve eligibility. A failed read returns
confirmed success with separate synchronization feedback and no Undo. Receipt
recovery can offer the original compact Undo when current epoch/trip still
match, even without a historical preimage in the response. No cache preimage is
presented as authoritative restoration evidence. Rejected and unknown command
outcomes remain distinct even if their synchronization read fails.

`test-shopping-slice8-corrections.ts` and
`test-shopping-slice8-corrections-browser.ts` exercise these rules through local
authenticated commands and persisted receipts. The browser runner uses held
responses and a controlled clock for the delayed-cache race, at both required
viewports. Browser verification remains development-mode only.

Acknowledgements are optional V4 metadata. Existing boolean checks remain labeled
previous evidence. New checks save exact current buyable operands before rounding;
hidden recipe parts are excluded and manual extras remain explicit. The existing
coverage comparator handles scalar decreases, source recomposition and conservative
range/package/unknown matching. A larger or unsupported changed requirement
reopens with “Requirement changed”; coverage never becomes Pantry inventory.

The rendered row supplies the inspected basis, acknowledgement version and
revision. Queued execution does not replace them with a newer basis. The server
derives the current basis with its dependency snapshot and the commit checks that
snapshot under the owner lock. Unchecks retain a versioned tombstone so they
cannot erase a subsequent recheck. Rejected commands receive terminal receipts.

Only a confirmed committed `undoAvailable` result enables Undo. A newer content
epoch observed on response suppresses it without reporting Clear as failed.
Organization-only responses can still offer Undo. The toast lasts up to ten
minutes; database time is authoritative. Navigation/reload, dismissal or a newer
toast can remove this session's control. There is no selective restore UI.

## Verification and compatibility

`test-shopping-slice8.ts` uses authenticated HTTP and actual SQL state/receipts.
Its prepared-plan barriers pause after the production planner's dependency
snapshot, commit a competing command, then call the real commit RPC and retry
the identical admitted HTTP payload. No sleeps choose race winners. It tests
both source-deletion orders, exact maximum inverse bytes, coverage conflicts,
organization preservation, content ABA, replay, expiry and owner isolation.

`test-shopping-slice8-browser.ts` signs in through the actual development UI at
1440×900 and 390×844; a second authenticated session supplies competing commands.
It checks persisted state and reloads, not only notifications. Run from `web/`
with Node 22.23.1, a task-owned app on 3117 and disposable Supabase on 57321/57322.
Derive `.env.local` only from that stack. Neither runner resets a database.
The inherited placement-recovery runner now requires `--apply` for its 025
migration rehearsal; omit it on the Slice 8 schema so it cannot replace the
newer command-context function. Historical initialization fixtures use the
explicit initialization action while preserving their original document output.

Apply migrations only through repository runbooks and separately authorized
targets. Local acceptance includes fresh installation and populated upgrade from
025. The forward migration preserves historical files and existing JSON. After
coverage writes, rollback requires a coverage-compatible reader/command boundary
or read-only recovery. Source-only old clients fail closed where new evidence is
required; no compatibility window permits arbitrary replacement writes.

Production-mode loopback sign-in remains limited by the accepted CSP behavior.
Development browser evidence is not production browser evidence. CSP and auth
have not been weakened. The independent handoff records executed checks and
remaining limits. Full field-version organization merging, advanced resets,
selective restoration and visual redesign remain deferred.
