# Shopping Domain Reference

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
| `web/src/hooks/shopping/use-shopping-document.ts` | The only runtime Shopping read/write seam; CAS, replay, Pantry bridge, and UI adapters. |
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

Shopping purchase identity removes only explicitly recognized preparation and
use qualifiers from recipe wording. Unknown adjectives remain literal.
Generic, white, and yellow onion share the `onion` purchase identity; red,
green, pearl, and pickled onion forms remain distinct. Exact recipe quantities
and semantic preparation metadata remain available to source detail even when
the primary row uses the cleaned purchase name.

One exact preparation vocabulary classifies supported forms, but evidence
strength is contextual. A structured modifier or parser-recognized trailing
modifier is strong evidence; leading free text keeps only the established
legacy canonicalizations and does not automatically strip newly recognized
multi-word phrases. The established leading rules still canonicalize forms
such as `sliced bread`, `shredded cheese`, `grated parmesan`, and `crushed
tomatoes`; extending or correcting that older contract is outside this Tier 1
change. A comma-delimited trailing candidate is normalized only when the whole
candidate is supported. Unsupported compounds such as `very finely chopped`
remain literal and are never partially stripped.

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

## Verification

Run from `web/`:

```bash
npm run typecheck
npm run test -- --run src/lib/__tests__/shopping-document.test.ts src/lib/__tests__/shopping-document-persistence.test.ts
supabase test db --local --workdir ..
```

Last updated: 2026-08-17
