# Historical V3 reference — superseded

This preserves pre-foundation guidance. Use [the current Shopping reference](../shopping-component.md) for production behavior. Temporary Slice 1–5 limitations below are historical, not current V4 gates.

> Slice 9 adds [shared organization controls](../shopping-slice9.md), targeted field history and conditional organization Undo. Earlier V3 guidance below remains historical.

> Slice 8 supersedes the historical Clear restrictions below: see [Shopping Slice 8](../shopping-slice8.md) for runtime coverage, atomic source validation and trip/content-epoch Undo.

# Shopping Domain Reference

> Slice 7 adds explicit identity/extra initialization and durable initial placement through the [Shopping command boundary](../shopping-slice6.md). See [Shopping Slice 7](../shopping-slice7.md) for the current runtime and later-slice boundaries. Historical sections below retain their original migration context.

The Slice 7 correction keeps selection versions non-reusable across removal,
binds removal controls to their inspected selection, preserves legacy row
placement, and versions manual bucket transitions through the Pantry bridge.
See the linked Slice 7 correction notes for concurrency and recovery details.

Shopping persistence is a single versioned JSON document per user, guarded by
one `content_revision`. The V3-capable application reads V2 or V3 and writes
V3. The document stores recipe inputs, manual items, explicit row overrides,
and reusable Shopping preferences. Rendered `items`, `already_have`, and
`excluded` rows are projections and are never persisted.

## Key files

| File | Responsibility |
|------|----------------|
| `web/src/lib/shopping-document.ts` | Strict validator, deterministic projector, and pure mutation reducers. |
| `web/src/lib/shopping-ordering.ts` | The single category and within-category ordering authority. |
| `web/src/lib/shopping-ingredient-semantics.ts` | Central purchase, family, preparation, quantity, category, Pantry, and exclusion semantics. |
| `web/src/lib/shopping-ingredient-resolution.ts` | Resolves recipe structure through the central semantic authority. |
| `web/src/hooks/shopping/use-shopping-document.ts` | Runtime Shopping read/write seam; CAS, replay, Pantry bridge, cache and feedback boundaries. |
| `web/src/lib/shopping-view.ts` | Pure lossless list/config adapters used by the runtime hook. |
| `web/src/lib/shopping-manual-rules.ts` | Shared V3 add/edit collision policy and manual quantity construction. |
| `web/src/lib/shopping-compatibility.ts` | Explicit supported/malformed/unsupported read outcomes; no persistence writes. |
| `web/src/components/shopping/shopping-list.tsx` | Shopping UI orchestration, per-row optimistic check-off state, and immediate inverse-write Undo UX. |
| `supabase/migrations/018_shopping_document_cutover.sql` | Atomic legacy conversion and physical schema cutover. |
| `supabase/migrations/019_personalized_shopping_order.sql` | V1-to-V2 conversion and strict personalized-order persistence. |
| `supabase/migrations/020_shopping_document_v3.sql` | V2/V3 compatibility validation and Pantry bridge support while retaining the V2 database default. |
| `supabase/migrations/021_fix_shopping_v3_family_policy_validation.sql` | Non-empty V3 family-policy validation correction with no default or data rewrite. |

## Persistence contract

- `shopping_list` contains only `user_id`, `document`, `content_revision`, and
  `updated_at`.
- Every normal mutation applies one pure reducer and writes with
  `WHERE content_revision = expected`, advancing the revision exactly once.
- On conflict the client refetches, replays the same intent once, and retries
  once. State-dependent preconditions are revalidated against the fresh
  document before replay; manual add uses the operation's resolved Pantry
  snapshot and active purchase identities, and aborts without a retry write if
  another session added a duplicate. A second conflict is surfaced to the user.
- Check-off interactions render the latest versioned per-row intent immediately
  while owner-scoped document writes remain serialized. Only the current intent
  may clear its optimistic state, so stale success or failure cannot overwrite a
  newer same-row tap. A pending checked row remains actionable until settlement.
- Recipe entries are keyed by immutable recipe UUID and there is at most one
  active entry per recipe.
- Manual IDs and derived aggregate keys produce stable `manual:*` and
  `derived:*` row references. Row-targeted actions fail closed without one.
- `preferences.categoryOrder` owns reusable category order and
  `preferences.ingredientOrderByCategory` owns reusable purchase-key order.
  Row references never become learned ordering identity.
- Unlearned rows order by reusable ingredient identity first. Each identity's
  fallback key is its minimum `normalizeItemName(displayName)` in Unicode
  scalar-value order; rows inside that identity then use normalized display and
  `rowRef`. Migration 019 uses the same definition when seeding V1 order.
- A Manage-mode drop is one replayable mutation. Within-category drops update
  the ingredient sequence; cross-category drops atomically update
  `categoryByIngredient` and both affected sequences. Manual rows use the same
  conservative purchase key as recipe ingredients.
- Delete, clear, and recipe removal happen immediately. Undo is a new inverse
  document mutation; there is no delayed commit queue.

### Conditional Clear Undo (G02/H03, Slice 1)

Clear returns `null` for a reducer no-op and no result on failure. After a
successful CAS it returns the authenticated owner, the content preimage of
that successful attempt, and the actual returned post-Clear revision. The
mutation plan's optional `committedValue` callback runs only after a write
succeeds, so a rebased Clear captures the fresh preimage rather than the
original cache. This is local result plumbing, not a persisted retry receipt.

Whole-clear Undo binds permanently to that owner and revision. Initial and
fresh-replay validation must both match it; the restore CAS uses that same
revision. Even a restore reducer no-op must pass CAS. Later additions, edits,
removals, and add-then-delete sequences therefore refuse with
“Shopping changed after Clear; Undo was not applied.” Restore replaces only
content and retains preferences. Clear/Undo fence active-owner changes around
asynchronous reads/writes and reject stale responses without replacing a
newer cache or exposing a late inverse.

Temporary limits in this V3-only repair:

- Organization/preferences share `contentRevision`, so any intervening document
  write can safely refuse Undo, including organization-only changes. Slice 8's
  content epochs separate this from organization writes.
- A recipe-bearing Clear succeeds but offers no Undo, with explicit temporary
  unavailability disclosed before confirmation (including hidden selections).
  Final eligibility comes from the successful Clear attempt, so recipe content
  acquired during a retry also withholds Undo and explains why afterward.
  `delete_recipe` advances Shopping revision only when
  the selection is present; source deletion after Clear can leave that revision
  unchanged. A client existence read cannot close the race. The whole inverse
  is unavailable; the manual subset is never silently restored. Atomic source
  validation and safe recipe-bearing restoration wait for Slice 8.
- Undo remains local to the existing toast/session. There are no new trip IDs,
  epochs, schema, receipts, selective restoration UI, or lost-response retry
  guarantees. Reload loses the Undo action; a completed restore persists.
  This repair does not establish full Shopping foundation readiness.

### Concurrent exclusion and family settings (G03/H07, Slice 2)

Pantry additions/removals submit one canonical exclusion key through
`useSetShoppingExclusion`. Salt and Black pepper controls submit one explicit
family value. Small pure validation helpers live in `shopping-settings.ts`.
Each submission captures its observed state and owner, reads authoritative
state before planning, and validates again after a failed CAS. The reducer
changes only that key or family setting; content and organization stay intact.

- Different-key additions/removals and different-family edits survive.
- Repeated exclusion transitions converge: adding a newly added key or removing
  an already removed key returns unchanged after an authoritative read.
- An already-satisfied intent from a stale revision is conservatively refused:
  it could otherwise reverse an opposite action. A same-family value changed
  since observation also refuses, even if it now matches the requested value.
- No-op results come from authoritative state, never cached equality; no-op
  reads do not increment the revision. Outcomes reflect the successful attempt,
  including replay. Conflict refreshes the cache monotonically within its owner.
- Failed exclusion input remains in the form. Failed family choices remain
  available through an explicit retry control; checkboxes show saved values.
  Queued operations and old batch closures cannot acquire a different owner.
- The former whole-array exclusion hook is removed. The generic config adapter
  remains for Shopping category settings; any replacement that includes
  exclusions/families (including mixed full-config updates and intentional bulk
  resets) requires the exact observed document revision, initially and on replay.
  No current UI offers bulk exclusion/family reset. Category-only replacement
  callers remain deferred; they do not replace exclusions or family fields.

V3 has no persistent field/key versions. A value that changes and returns to
its observed value (ABA) cannot be distinguished from an unrelated write;
independent transitions may therefore pass value-based validation after ABA.
This is not a persistent field-version guarantee. Slice 6 introduces the
authoritative boundary and writer fence; Slice 9 completes field-version
organization behavior. Older clients/direct document writers remain outside
this application repair until Slice 6. Slice 1 Undo still refuses every
intervening document write, including settings.

The shared toast provider now cancels obsolete hide transitions, so a quick
asynchronous conflict response cannot be removed by the prior Undo timer.

## Projection and Pantry

Projection combines the document with live Pantry rows. Classification order
is Pantry, excluded ingredient, enabled unanimous built-in family, then visible.
Explicit persisted bucket overrides win. Moving a row to Pantry uses
`move_shopping_document_item_to_pantry(...)`, which performs the Shopping CAS
and Pantry insertion in one transaction.

Shopping preferences—including safe ingredient exclusions, family toggles, category
overrides, custom categories, and category order—live inside the document.
`user_config` contains planner/onboarding preferences only.

V3 persists purchase and family semantics separately. Purchase identity drives
aggregation and ordering; explicitly directional family policy drives Pantry
and exclusion compatibility. V2 documents upgrade in memory on read and are
written back as V3 on the next normal mutation. The database accepts both
versions during that lazy transition and continues defaulting new rows to V2.

## V3 rollout sequence

Shopping V3 uses a phased rollout rather than an atomic app/schema assumption:

1. Apply migration 020 while the prior application is live. It accepts V2 and
   V3, updates the Pantry bridge, performs no document rewrite, and keeps the
   V2 column default.
2. Apply migration 021 before relying on non-empty V3 persistence. It corrects
   the migration-020 policy-key expression without changing the accepted
   contract, rewriting documents, or switching the V2 default.
3. Deploy the V2/V3-capable application. Reads of V2 upgrade in memory and the
   next normal Shopping mutation writes V3.
4. After the V3-capable application is confirmed live, a separate follow-up
   migration/PR may change the database default to V3.

Do not include the V3-default switch in the same migration batch as migrations
020 or 021. Before any V3 write, rollback to the prior application remains safe.

Exact scalar discrete quantities are rounded up only after compatible recipe
contributions aggregate. Structured ranges, packages, and source quantities
remain exact. An unchecked, unquantified manual row may be hidden while a safe
same-purchase derived row is visible; the persisted manual row is unchanged.

Shopping display uses ordered `ShoppingItem.quantityParts`, including the
primary exactly once. `shopping-quantity-display.ts` is the shared formatter for
active/completed rows, source quantity details, Pantry/excluded chips, drag
previews, and clipboard copy (there is no separate Shopping print/export path).
Main quantity text wraps and includes every additional requirement. Repeated
ranges/packages and source detail lines are not deduplicated by formatted text.
Recipe references remain attached to the complete source list.

Projection retains unknown operands, distinguishing `amount unspecified` from
source wording such as `as needed`. Existing preparation wording can explain a
frozen null quantity; absent wording is never invented. Newly captured Shopping
contributions retain supported qualitative/unparsed quantity metadata. Reads,
rendering and check-off never rewrite saved recipes or frozen contributions.

Continuous exact fractional operands stay separate when the existing numeric
aggregator cannot supply a provably exact total: `1/3 cup + 1/3 cup`, rather than
claiming exact aggregate arithmetic. Existing numeric compatible-unit conversion
and aggregate discrete purchase rounding remain; rounded purchase scalars do not
retain contradictory fractional display metadata. Exact source detail remains
unrounded. Numeric legacy operands and cross-unit aggregate arithmetic still use
the existing approximate engine; exact target grouping belongs to foundation
Slice 7. The legacy Shopping-item normalizer retains its historical numeric
shape; runtime document adapters emit full quantity parts instead.

Shopping purchase identity removes only explicitly recognized preparation and
use qualifiers from recipe wording. Unknown adjectives remain literal.
Generic, white, and yellow onion share the `onion` purchase identity; red,
green, pearl, and pickled onion forms remain distinct. Exact recipe quantities
and semantic preparation metadata remain available to source detail even when
the primary row uses the cleaned purchase name.

One exact preparation vocabulary in the dependency-neutral ingredient modifier
classifier classifies supported forms for both the recipe parser and Shopping
semantics; the parser has no separate phrase list. Evidence strength remains
contextual. A structured modifier or parser-recognized trailing modifier is
strong evidence; leading free text keeps only the established
legacy canonicalizations and does not automatically strip newly recognized
multi-word phrases. The established leading rules still canonicalize forms
such as `sliced bread`, `shredded cheese`, `grated parmesan`, and `crushed
tomatoes`; extending or correcting that older contract is outside this Tier 1
change. A comma-delimited trailing candidate is normalized only when the whole
candidate is supported. Unsupported compounds such as `very finely chopped`
remain literal and are never partially stripped.
The recipe parser and Shopping resolver normalize ASCII/full-width comma
boundaries, retain repeated empty boundaries, and classify the same complete
trailing expression before extracting any preparation or qualifier. Unsupported
multi-segment expressions stay in the item without partial evidence. Ordinary
commas inside the ingredient identity remain compatible with a separate final
modifier. Legacy multi-descriptor behavior such as `cheese, shredded, low-fat`
remains deferred outside Tier 1.

Exact whole-fruit grammar such as `juice and zest of 1 lime` becomes one lime
with `juiced` and `zested` preparation evidence. Measured or packaged component
forms such as `2 tbsp lime juice` and `1 bottle lime juice` retain the `lime
juice` purchase identity. Malformed component data such as `lime juice` with a
count unit is not converted to whole fruit. Composite preparation evidence is
stored in the existing preparation array, so one composite contribution counts
one fruit. Independent juice-only or zest-only contributions remain separate
requirements; a composite plus either one requires two fruits, and independent
juice-only plus zest-only contributions also require two.

Resolver changes affect only newly generated recipe contributions. A persisted
V3 recipe contribution retains its stored purchase identity, aggregate key, and
resolved semantic fields—including `quantityKind`—during validation,
projection, and unrelated Shopping mutations. Discrete rounding is applied
after contributions with the same persisted quantity semantics aggregate; a
frozen continuous count remains continuous even when the current resolver would
classify that unit as discrete. Updating an old contribution requires explicit
recipe regeneration or a supported migration; ordinary reads do not silently
reinterpret it.

Manual rows preserve the user's trimmed surface text for display while deriving
duplicate, Pantry, and ordering identity from the same canonical semantics as
recipe ingredients. A merged recipe row uses a hard primary requirement for
display when another source offers that ingredient only as an alternative.

Quantified manual rows may coexist with recipe-derived rows of the same
purchase identity. Editing an existing manual row preserves that coexistence
when its canonical purchase identity is unchanged; it never merges quantities
or changes recipe contributions. Identity-changing edits still reject collisions
with other projected rows, including Pantry/excluded rows. Both initial edits
and conflict replays compare against the current persisted manual identity and
revalidate collisions before writing. A missing manual target fails the edit.

## Source controls, categories, and recovery

`shopping-sources.ts` supplies selection labels and source controls. The recipe
panel reads every persisted `recipeEntries` entry, including empty, suppressed,
Pantry, excluded, and completed selections. Recipe UUIDs own navigation,
removal, metadata lookup, colors and React keys. Matching snapshot titles get
numbered labels in stable UUID order; these are display distinctions, not new
selection or historical occurrence IDs. A recipe named Manual is an ordinary
recipe. Manual sources carry `manualId`; manual editing uses `manual:` row IDs.
Source controls coalesce repeated recipe UUIDs, while quantity details retain
every stored occurrence. Missing IDs are never resolved by title. The existing
recipe detail route reports unavailable recipes and returns to Shopping, where
the saved selection remains independently removable.

Unknown category references appear once in `Other items — category unavailable`
after known categories, including the completed partition and clipboard output.
Grouping retains original rows/references and performs no repair writes. The
existing Manage-mode move to a valid row/category remains the explicit edit;
shared placement and organization redesign remain later-slice work. Pantry and
excluded chips render their complete buckets without category filtering.

Shopping projection requires a successfully loaded Pantry snapshot. Initial
Pantry failure shows recovery and selections without claiming ingredient
availability; cached Pantry data can remain visible with a refresh warning.
Manual add requires that dependency and refetches/rejects failed cached reads.
Selection removal, settings, and Clear do not depend on Pantry. Existing
boolean checks and explicit row actions can use labeled last-known rows; this
does not implement future obtained-basis coverage or dependency versioning.

Shopping read failures never produce an editable empty list. Unsupported or
malformed documents have a non-destructive recovery message; cached supported
data may remain visible, with writes disabled and source navigation available.
Both the document mutation helper and Pantry bridge refuse an errored Shopping
query before planning/writing. Retry refetches the failed dependency without
resetting data. A successful bridge invalidates Pantry rather than presenting
its single returned item as an authoritative Pantry snapshot. No new schema,
legacy conversion, all-writer fencing, or automatic recovery write is added.

## Verification

Slice 5 rule ownership, compatibility classes, target-only specifications and
scenario deferrals are recorded in [Shopping Slice 5](../shopping-slice5.md).
Candidate V4 content fixtures are not accepted by runtime writers. V3 ordering,
source evidence, Slice 1 Undo restrictions and Slice 2 conflicts remain intact.

Run from `web/`:

```bash
npm run typecheck
npm run test -- --run src/lib/__tests__/shopping-document.test.ts src/lib/__tests__/shopping-document-persistence.test.ts
npm run test -- --run src/hooks/__tests__/use-shopping-clear-undo.test.tsx src/components/shopping/__tests__/shopping-list-orchestration.test.tsx
supabase test db --local --workdir ..
```

The Clear/Undo hook tests use a deterministic owner/revision-filtered CAS mock
and assert persisted content plus feedback across races. They do not verify
live database grants, browser timing, or production state.

For real persistence/browser evidence, run `npx playwright test
tests/shopping-clear-undo.spec.ts --project=chromium` against the established
local runtime. It requires already-running loopback Supabase and local E2E
configuration, creates disposable owners, and never resets shared fixtures.
It covers 1440 x 900 and 390 x 844, two browser sessions, controlled real CAS
interleavings, reload persistence, recipe eligibility, and F02 editing.
Authentication traces/video are disabled and screenshots mask account text.

Slice 4 tests: `shopping-sources.test.ts`, `use-shopping-recovery.test.tsx`,
Shopping orchestration/components, and Pantry read/cache tests. Run
`npx playwright test tests/shopping-operability.spec.ts --project=chromium`
against existing loopback Supabase for 1440×900 and 390×844 persisted-source,
hidden removal, unknown category, keyboard, and reload checks. Read errors and
unsupported/malformed responses use browser-only interception; the latter are
not claimed as legal persisted database fixtures. The tests assert recovery
does not write, and clean up only their disposable owners.

Last updated: 2026-09-12
`meal-planner.tsx` also reads authoritative Shopping selections for its “In shopping” badges, so a missing Pantry projection does not erase known selection membership.
