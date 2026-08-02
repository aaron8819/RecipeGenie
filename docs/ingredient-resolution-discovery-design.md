# Salt and Black Pepper Exclusions: Phase 1 Design

**Status:** Ready for implementation planning
**Repository revision inspected:** `c880fdf014060e408623cb66e07d3dbaef1519dd`
**Date:** 2026-08-01

Phase 1 is deliberately limited to two user settings and two fixed alias sets.
It does not introduce a general ingredient-resolution system.

## 1. Problem statement

A user who does not buy Salt or Black pepper should be able to exclude common
wording variants from newly generated shopping lists without entering every
variant as a separate exact exclusion.

The implementation must be conservative. It may hide a row only when the
complete structured ingredient name is one approved standalone alias. Unknown,
compound, alternative, ambiguous, or mixed-source ingredients remain visible.

## 2. Current behavior

- `user_config.excluded_keywords` stores user-authored strings. Shopping
  generation compares whole normalized purchase identities through
  `getExcludedKeyword()`. This path is case-insensitive and includes its current
  controlled compatibility behavior; it is not substring matching.
- The Pantry screen manages `excluded_keywords` separately from pantry items.
  Its current “exact match” copy is directionally correct but should say “whole
  ingredient name” so it does not overstate byte-for-byte equality.
- `POST /api/shopping/recipe-contributions` reads pantry and user config, then
  calls `generateShoppingList()` once per recipe to create a frozen
  contribution snapshot.
- `generateShoppingList()` has the complete `Ingredient` before
  `normalizeShoppingPurchase()` broadens or removes purchase-specific wording.
  This is the narrowest safe recognition point.
- The function aggregates compatible occurrences in memory and only then puts
  each row into `items`, `already_have`, or `excluded`. Pantry currently takes
  precedence over exact exclusions.
- `projectShoppingContributions()` later merges frozen contributions and
  reapplies persisted lifecycle and presentation overrides. Ordinary recipe
  replacement is therefore not a guaranteed reclassification boundary.

Phase 1 preserves all of this behavior except for the explicit new setting
checks described below.

## 3. Phase 1 scope

Phase 1 adds exactly two settings, both off by default:

- **Always exclude Salt variants**
- **Always exclude Black pepper variants**

When enabled, a setting applies only to a newly generated recipe contribution.
The matcher:

- recognizes only the aliases in Section 6;
- allows only the exact terminal phrase `to taste`;
- compares the full normalized structured ingredient name;
- rejects ingredients with alternatives;
- leaves compound and ambiguous lines intact and visible; and
- classifies every occurrence before purchase normalization and aggregation.

No row is split, rewritten, or synthesized.

## 4. Explicit non-goals

Phase 1 does not add or change:

- substring, fuzzy, stemmed, multilingual, typo-tolerant, regex, or LLM
  matching;
- custom families, custom aliases, an ingredient registry, or ontology UI;
- recipe parsing or general compound/alternative parsing;
- pantry matching or pantry equivalence;
- purchase canonicalization, merge identity, quantity conversion, category
  assignment, or aggregation identity;
- canonical ingredient IDs on recipes, sources, or shopping rows;
- resolution traces or new shopping-source JSON fields;
- partial exclusion of a compound or aggregate;
- historical replay or reinterpretation of frozen contributions;
- checked, deleted, restored, edited, quantity, category, manual-row, or other
  contribution lifecycle behavior; or
- a shopping normalization version change.

In particular, Phase 1 does not support:

- `salt and pepper to taste`
- `salt and freshly ground black pepper`
- `salt, pepper, and garlic powder`
- `oil or butter`

These remain one visible row exactly as they do today.

## 5. Persistence recommendation

Add two non-null boolean columns to `public.user_config`:

```sql
exclude_salt_variants boolean not null default false
exclude_black_pepper_variants boolean not null default false
```

This is the smallest fit for the current model:

- `user_config` already stores scalar boolean preferences such as
  `auto_assign_days`.
- There are exactly two fixed settings with no Phase 1 need for an extensible
  family payload.
- Columns are directly selectable, typed, independently updateable, and easy to
  default safely.
- A small additive migration is simpler than a codec or compatibility layer.

Do not store family selections in `excluded_keywords`. Do not add typed tokens,
markers, escape rules, or legacy-entry migration. Do not use a JSON family
field unless the product scope later grows beyond these two fixed settings.

Application defaults must also resolve missing or nullable values to `false` so
older test fixtures and a temporarily partial local schema remain conservative.

## 6. Exact alias lists

### Salt

Approved aliases:

- `salt`
- `kosher salt`
- `sea salt`
- `table salt`

Each alias may have the exact terminal phrase `to taste`, for example `sea salt
to taste`.

The Salt setting must not exclude:

- `garlic salt`
- `celery salt`
- `seasoned salt`
- `Himalayan salt`
- `flaky salt`
- `coarse salt`
- `salted butter`
- `saltine crackers`

### Black pepper

Approved aliases:

- `black pepper`
- `ground black pepper`
- `freshly ground black pepper`
- `cracked black pepper`

Each alias may have the exact terminal phrase `to taste`.

The Black pepper setting must not exclude:

- `pepper`
- `white pepper`
- `mixed peppercorns`
- `red pepper flakes`
- `bell pepper`
- `poblano pepper`
- `pepper jack cheese`
- `pepperoni`

Bare `pepper` is never a Phase 1 Black pepper alias.

## 7. Normalization rules

Use one small pure matcher owned by shopping generation. It returns `salt`,
`black-pepper`, or no match; that result is transient and is not an ingredient
identity.

For each `Ingredient` occurrence:

1. If `alternatives` contains any non-empty entry, return no match.
2. Start from `ingredient.item`; do not inspect or reparse `originalText`.
3. Trim leading and trailing whitespace, collapse internal whitespace to one
   space, and lowercase deterministically.
4. Preserve punctuation. Do not remove commas, periods, hyphens, slashes,
   parentheses, or other punctuation.
5. If `ingredient.modifier` is empty, compare the normalized item directly.
6. If the modifier normalizes to exactly `to taste`, compare
   `<normalized item> to taste`.
7. Any other non-empty modifier returns no match.
8. Compare the entire candidate against the fixed alias set, including the
   optional terminal `to taste` forms.

Consequences:

- Case and whitespace variants match.
- `salt to taste` matches whether `to taste` is part of `item` or the separate
  structured modifier.
- `salt.` and `black-pepper` do not match because punctuation is not erased.
- `salt and pepper to taste` does not match because the complete string is not
  an alias.
- The matcher never uses `purchaseName`, `identityKey`, merge keys, aggregate
  display text, or category text as semantic evidence.

## 8. Matching location and flow

Pass the two settings from the recipe-contribution route into
`generateShoppingList()` separately from `excluded_keywords`.

For each recipe ingredient, immediately before `normalizeShoppingPurchase()`:

1. Evaluate the structured ingredient with the matcher from Section 7.
2. Continue the existing purchase normalization and aggregation unchanged.
3. On the transient `ingredientMap` entry, retain only whether every occurrence
   merged into that entry matched the same family. A no-match or different
   family makes that entry ineligible for family exclusion.
4. After aggregation, preserve current classification precedence:
   - pantry match;
   - existing exact exclusion;
   - enabled unanimous family exclusion;
   - visible shopping item.
5. For a family exclusion, use the existing `excluded` bucket and existing
   `excludedBy` field with the user-facing reason `Salt variants` or
   `Black pepper variants`.
6. Discard the transient consensus after classification. Do not add it to
   `ShoppingItem.sources`, recipes, shopping rows, or contribution schema.

Evaluating the existing exact exclusion first preserves its current behavior
and explanation when both mechanisms could apply.

## 9. Conservative mixed-source behavior

The all-source rule applies at both existing aggregation stages.

### Within one generated recipe contribution

An aggregate qualifies for family exclusion only when every ingredient
occurrence merged into it independently matched the same enabled family. If any
occurrence is unmatched, ambiguous, alternative-bearing, or from another
family, the new setting does not exclude the aggregate.

### Across frozen recipe contributions

`projectShoppingContributions()` already finds the contribution items that map
to a derived aggregate when it chooses the aggregate's default bucket. Make one
narrow change at that decision:

- If none of the contributing items uses a new family `excludedBy` reason, keep
  the existing bucket behavior unchanged.
- If at least one uses a family reason, default the aggregate to `excluded` only
  when every contributing item is in `excluded` with the same family reason.
- Otherwise default the aggregate to visible `items`.

This reuses existing contribution data and requires no generalized projection
or persisted evidence change. A pre-existing user lifecycle override still
wins after the default bucket is calculated. That preserves explicit restores,
pantry moves, deletes, checks, edits, quantities, categories, and manual rows.

When exact-exclusion precedence or old snapshot data prevents proof of
unanimous family matching, conservative visibility is acceptable. Phase 1 must
not redesign projection to recover stronger evidence.

## 10. UI design

Add a compact **Always exclude** section at the top of the existing excluded
ingredients card on the Pantry screen:

- [ ] Salt variants
- [ ] Black pepper variants

Show this explanatory copy directly beneath the corresponding controls:

- Salt variants include salt, kosher salt, sea salt, and table salt.
- Black pepper variants include black pepper, ground black pepper, freshly
  ground black pepper, and cracked black pepper.

Keep the existing exact exclusions controls below a divider under an **Exact
exclusions** heading. Do not mix the toggle values into its count, chips, input,
or mutation.

The exact-exclusion copy should say that it matches a whole normalized
ingredient name and does not perform substring matching. No new screen, mobile
tab, modal, alias editor, or advanced-rule UI is needed.

Each checkbox must have a programmatic label, its explanatory text connected
with `aria-describedby`, a visible focus state, and a disabled/pending state
while its mutation is in flight. A failed save must restore the displayed value
and show the repository's standard user-visible error toast.

## 11. Migration and backward compatibility

Use one additive migration after the current `014_add_recipe_yield_metadata.sql`
migration. The migration adds both non-null columns with `default false`.

Backward-compatibility requirements:

- Existing rows receive `false`; existing users see no behavior change.
- New user-config rows default both settings to `false`.
- Existing `excluded_keywords` arrays are untouched and are not inspected for
  implied family selection.
- No legacy exact entry is broadened or migrated.
- Existing generated shopping lists and contribution snapshots are untouched.
- Enabling a setting affects only contributions generated afterward.
- Ordinary replacement may retain a prior lifecycle override.
- Clear/reset followed by generation is the reliable way to rebuild a list
  under current settings.
- No backfill, historical replay, normalization-version bump, or source-schema
  migration is required.

Implementation and deployment of the migration must follow the repository's
existing migration runbook and authorization gates; this design does not alter
those procedures.

## 12. Exact files likely to change

The expected implementation surface is:

- `supabase/migrations/015_add_shopping_exclusion_settings.sql` — add the two
  boolean columns.
- `supabase/SCHEMA.md` — document the columns and migration.
- `web/src/types/database.generated.ts` — regenerate `user_config` row, insert,
  and update types.
- `web/src/lib/user-config.ts` — add conservative application defaults and
  missing-value resolution.
- `web/src/app/home-page-client.tsx` — include both columns in the explicit
  config prefetch select.
- `web/src/components/pantry/pantry-list.tsx` — render and persist the two
  controls while keeping exact exclusions separate.
- `web/src/lib/ingredient-exclusion-families.ts` — fixed aliases and pure
  matcher.
- `web/src/lib/shopping-list.ts` — evaluate occurrences pre-purchase and apply
  unanimous in-contribution classification.
- `web/src/app/api/shopping/recipe-contributions/route.ts` — select and pass the
  two settings.
- `web/src/lib/shopping-contributions.ts` — apply the narrow cross-contribution
  unanimous-family bucket rule.
- `docs/pantry-component.md` and `docs/shopping-component.md` — document the
  implemented UI and generation behavior.

Focused tests should be added or updated in:

- `web/src/lib/__tests__/ingredient-exclusion-families.test.ts`
- `web/src/lib/__tests__/shopping-list.test.ts`
- `web/src/lib/__tests__/shopping-contributions.test.ts`
- `web/src/lib/__tests__/user-config.test.ts`
- `web/src/app/api/shopping/recipe-contributions/route.test.ts`
- `web/src/components/pantry/__tests__/pantry-list.test.tsx`
- `web/src/hooks/shared/__tests__/user-config.test.tsx` if the generic config
  mutation needs new optimistic or rollback coverage for these controls.

No Phase 1 changes are expected in the recipe parser, purchase
canonicalization, merge identity, shopping source type, contribution database
schema, or historical replay code.

## 13. Required tests

### Matcher tests

- Every approved Salt alias matches.
- Every approved Black pepper alias matches.
- Every approved alias matches with terminal `to taste` in `item`.
- `to taste` also matches when stored as the separate structured modifier.
- Case differences and repeated whitespace match.
- Punctuation is conservative and is not stripped.
- Every listed Salt false positive remains visible.
- Every listed Black pepper false positive remains visible, including bare
  `pepper`.
- A non-empty alternatives array returns no match.
- Every listed compound/ambiguous example remains visible.
- Any modifier other than exact `to taste` returns no match.

### Shopping-generation tests

- With both settings off, current output is unchanged.
- Enabling only Salt affects only approved Salt aliases in newly generated
  contributions.
- Enabling only Black pepper affects only approved Black pepper aliases in
  newly generated contributions.
- Existing exact exclusions, including their current normalization behavior
  and `excludedBy` value, remain unchanged.
- Pantry matching and pantry-before-exclusion precedence remain unchanged.
- Amounts, units, purchase canonicalization, categories, and aggregation
  identity remain unchanged.
- Multiple occurrences exclude only when all independently match the same
  enabled family.
- A mixed or unprovable in-recipe aggregate remains visible.

### Contribution and route tests

- The route reads and forwards both settings, defaulting missing values to
  `false`.
- Enabling a setting affects a newly generated contribution.
- Existing contribution snapshots are not rewritten.
- Cross-contribution aggregates exclude only when every contribution item has
  the same family reason.
- Mixed-source aggregates remain visible.
- Existing exact, pantry, aggregation, and lifecycle-override tests remain
  unchanged and pass.
- Checked, deleted, restored, edited, quantity, category, and manual-row
  behavior remains unchanged.
- Ordinary replacement preserves current lifecycle overrides.
- Clear/reset plus regeneration applies the current settings.

### Persistence and UI tests

- Migration defaults are `false` for existing and new users.
- Resolving a missing/legacy config yields both settings as `false` without
  changing `excluded_keywords`.
- Each toggle loads its persisted value, saves independently, survives a
  refetch, and rolls back on failure.
- Exact exclusion entry/removal is unaffected by toggle changes.
- Both controls are reachable by accessible name, have associated explanatory
  descriptions, are keyboard operable, and expose pending/disabled state.

## 14. Implementation plan

1. Add the two boolean columns, regenerate database types, and add application
   defaults.
2. Add the pure fixed-alias matcher and exhaustive table-driven tests.
3. Thread both booleans through the contribution route into shopping
   generation.
4. Add transient per-aggregate family consensus and classification after the
   existing pantry and exact checks.
5. Add the narrow cross-contribution unanimous-family default-bucket rule.
6. Add the Pantry-screen controls using the existing config mutation path and
   keep exact exclusions separate.
7. Add focused route, generation, projection, persistence, UI, and regression
   tests.
8. Update the Pantry, Shopping, and schema documentation, then run the normal
   local verification suite appropriate for the changed files.

The implementation should remain one small reviewable PR. Stop and revise this
design if implementation requires changes to parser behavior, purchase
identity, persisted sources, generalized projection, or historical replay.

## 15. Risks

- **Structured representation differences:** `to taste` may be in `item` or
  `modifier`. Supporting only those two explicit forms avoids reparsing stale
  `originalText`.
- **False positives from punctuation cleanup:** Removing punctuation could turn
  compounds or annotations into aliases. The matcher preserves punctuation.
- **Mixed contribution buckets:** Current projection chooses one default bucket
  after merging. The narrow unanimous-family check prevents a single matching
  source from hiding a mixed aggregate.
- **Partial config reads:** Explicit Supabase select lists can omit new columns
  and seed an incomplete cache. Update the route and home-page prefetch selects,
  and resolve absent values to `false`.
- **Historical expectations:** Users may expect a toggle to rewrite an existing
  list. UI copy and release notes must state that clear/reset plus regeneration
  is the reliable rebuild path.
- **Scope expansion:** Adding more families, custom aliases, or compound parsing
  would change the product and architecture. Defer it to a separate decision.

## 16. Approval checklist

- [ ] Phase 1 contains only the Salt and Black pepper settings.
- [ ] Both settings are separate non-null booleans defaulting to `false`.
- [ ] `excluded_keywords` and legacy exact entries remain untouched.
- [ ] Alias lists and terminal `to taste` are approved exactly as written.
- [ ] Matching uses full normalized structured names and preserves punctuation.
- [ ] Alternatives, compounds, ambiguous text, and bare `pepper` remain visible.
- [ ] Matching occurs before purchase normalization and aggregation.
- [ ] Pantry and existing exact-exclusion behavior retain precedence and
      semantics.
- [ ] In-recipe and cross-contribution exclusion both require unanimous family
      evidence; unknown or mixed evidence remains visible.
- [ ] No parser, purchase identity, merge identity, source JSON, normalization
      version, or historical replay change is included.
- [ ] Existing shopping lists, snapshots, and lifecycle overrides are preserved.
- [ ] Clear/reset plus regeneration is documented as the reliable rebuild path.
- [ ] UI controls are small, separate from exact exclusions, persistent, and
      accessible.
- [ ] The required false-positive and regression matrix is implemented before
      shipping.

READY FOR IMPLEMENTATION PLANNING
