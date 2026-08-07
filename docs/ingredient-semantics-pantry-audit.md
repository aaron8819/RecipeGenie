# Ingredient semantics and Pantry matching audit

Scope: static design audit only, based on `origin/main` at
`e8e33d6ff526781d0193442e4a76c77cd3f77597`. No application code, schema,
migration, data, Supabase, browser, recovery, or deployment behavior was
changed or accessed.

## 1. Executive conclusion

Recipe Genie has a coherent **Shopping purchase-identity pipeline**, but it
does not yet have one fully coherent interpretation of Pantry satisfaction.
Canonical recipe sections are flattened once, `resolveShoppingIngredient()`
produces the durable Shopping input, and `projectShoppingDocument()` owns
aggregation, live Pantry classification, exclusions, and category preference
application. Ingredient identity and aggregate-row identity are correctly
separate concepts.

The highest-value inconsistency is narrow and concrete: the resolver knows
that `salt`, `kosher salt`, and `sea salt` are members of one semantic family,
and likewise recognizes approved Black pepper variants, but Pantry matching
ignores that output. Pantry compares exact canonical purchase keys only. A
Pantry row named `salt` therefore does not satisfy `kosher salt`, and `black
pepper` does not satisfy `freshly ground black pepper`, while the exclusion
feature treats each pair as one family. A user can consequently say “I have
salt” and still receive “kosher salt” as a needed Shopping row.

The second issue is maintenance-only but large. The Shopping document cutover
left the old `generateShoppingList()` / `mergeShoppingItems()` pipeline, the
old learned-order helper, and the one-time persistence converter in the active
source tree. No runtime code imports them. Their 1,486 source lines and at
least 1,871 dedicated test lines define and verify a parallel semantic system
that production no longer executes. The valuable ingredient cases should be
moved to resolver/projector fixtures and the old pipeline deleted.

“What Can I Make?” is not an active feature. Commit `a9ed431` removed its
component, hook, matcher, tests, and browser coverage. The Pantry domain doc is
stale where it still lists those files and behavior. There is therefore no
current “What Can I Make?” path that can disagree with Shopping; restoring
that feature later must consume the same resolver-backed Pantry satisfaction
contract rather than reviving the deleted fuzzy matcher.

Recommended action: consolidate Pantry around the existing resolver outputs,
add only the demonstrated family/citrus Pantry cases, migrate the compact
semantic matrix to the active projector, and delete the obsolete Shopping
pipeline. No schema migration or ontology is needed. Expected benefit: users
stop seeing salt/pepper purchases that their Pantry already satisfies, while
the codebase loses a misleading second implementation of ingredient semantics.

## 2. Current semantic flow

### Pipeline and authorities

```text
Recipe text / editor row
  -> parseIngredientLine() or canonical editor submission
  -> Recipe.ingredientSections[] (persistence authority)
  -> flattenRecipeIngredients() (ordered boundary adaptation)
  -> resolveShoppingIngredient() (Shopping purchase resolution)
       ingredientKey          purchase identity
       aggregateKey           persisted derived-row identity
       pantryMatchKeys        exact Pantry satisfaction candidates
       exclusionFamily        salt / black-pepper family evidence
       defaultCategoryKey     default aisle
       quantity/citrusPrep    aggregation context
  -> ShoppingDocumentV1.recipeEntries[] (frozen resolved inputs)
  -> projectShoppingDocument()
       aggregate by aggregateKey
       merge quantities / citrus overlap
       classify against live Pantry and preferences
       apply category and row overrides
  -> items / already_have / excluded display buckets
```

Current sources of truth:

| Question | Current authority | Assessment |
| --- | --- | --- |
| What ingredient is this for Shopping? | `shopping-ingredient-resolution.ts:resolveShoppingIngredient()`, using `normalizeShoppingPurchase()` and `canonicalizeShoppingIngredient()` | Coherent, deliberately conservative purchase identity; not a general food identity. |
| Does Pantry satisfy it? | Resolver-produced `pantryMatchKeys`, compared by `shopping-document.ts:derivedClassification()` to Pantry rows transformed through `createShoppingPurchaseKey()` | Same purchase keys, plus alternatives; does not consume semantic family evidence. |
| Can occurrences share a Shopping row? | `createShoppingAggregateKey()` plus `projectShoppingDocument()` grouping | Correctly separate from ingredient identity. Range/package discriminators may include recipe identity and structured context. |
| Is it an excluded staple family? | `ingredient-exclusion-families.ts:matchIngredientExclusionFamily()`, exposed as `ResolvedShoppingIngredient.exclusionFamily` | One clean fixed-family authority; Pantry does not reuse it. |
| Is it an exact exclusion? | `ShoppingDocumentV1.preferences.excludedIngredientKeys`, canonicalized by `useUpdateShoppingConfig()` and compared to `ingredientKey` | Clean whole-identity matching; alternatives intentionally do not trigger it. |
| What category is it? | `categorizeIngredient()` for the default; `categoryByIngredient` and row overrides in `derivedCategory()` / projector for user intent | Ownership is clear and should stay separate from semantic equality. |

These identities should not be collapsed into one key:

- `ingredientKey` answers “same purchase identity?”
- `aggregateKey` answers “same rendered Shopping row under this
  range/package context?”
- `pantryMatchKeys` answer the directional question “can this Pantry entry
  satisfy this occurrence?”
- `exclusionFamily` is a narrow family classification, not an aggregation key.
- Category is presentation/default intent and must not define equality.

### Representative transformations

| Input | Canonical recipe ingredient | Resolver output | Projector behavior |
| --- | --- | --- | --- |
| `1 tsp kosher salt` | `item=kosher salt`, exact quantity, `unit=tsp` | `ingredientKey=kosher salt`; Pantry keys `[kosher salt]`; family `salt`; default category `pantry` | Aggregates only with `kosher salt`; exact `kosher salt` Pantry matches; Salt-family exclusion can hide it. |
| `freshly ground black pepper` | Item remains the full phrase; no quantity | Key/display `freshly ground black pepper`; same single Pantry key; family `black-pepper`; category `pantry` | Does not aggregate with plain `black pepper`; Black-pepper family exclusion can hide it; plain Pantry `black pepper` cannot satisfy it. |
| `2 lemons, zested and juiced` | Parser yields `item=lemons`, count `2`, modifier `zested and juiced` | Purchase/key `lemon`, count `2`, category `produce`; composite modifier does not set `citrusPrep` | Plain Pantry `lemon` matches. Quantity is correct for the single line, but overlap protection cannot use the composite prep marker. |
| `1 tbsp parsley or cilantro` | Primary `parsley`, alternative `[cilantro]`, amount `1 tbsp` | Key `parsley`; display `parsley (or cilantro)`; Pantry keys `[parsley, cilantro]`; no family; category `produce` | Either Pantry item satisfies it. Aggregation remains anchored to the primary `parsley`, which conservatively avoids choosing an alternative. |
| Pantry `lemon` | Stored as lowercased/trimmed `lemon` | Projection adapts it with `createShoppingPurchaseKey()` to `lemon` | Matches resolved whole-lemon inputs and measured/explicit citrus forms that resolve to `lemon`. |
| Pantry `kosher salt` | Stored as `kosher salt` | Projection key `kosher salt` | Matches only the same purchase key, not plain or sea salt. |
| Pantry `black pepper` | Stored as `black pepper` | Projection key `black pepper` | Matches only the same purchase key, not freshly ground black pepper. |

### Active helper inventory

| Helper | Classification | Current role / disposition |
| --- | --- | --- |
| `recipe-parser.ts:parseIngredientLine()` | Authoritative recipe parsing | Owns quantity-prefix parsing, modifier extraction, and alternatives at text-import boundaries. Keep. |
| `recipe-structure.ts:flattenRecipeIngredients()` | Boundary adaptation | Preserves canonical section/item order for ingredient-level consumers. Keep. |
| `recipe-quantity.ts:resolveIngredientQuantity()` and scale helpers | Authoritative quantity resolution | Own exact/range/package quantity semantics. Keep separate from name identity. |
| `shopping-ingredient-canonicalization.ts:canonicalizeShoppingIngredient()` | Authoritative Shopping name resolution | Conservative aliases, known plurals, preparation stripping, identity modifiers, display, and merge key. Keep behind the resolver. |
| `shopping-list-normalization.ts:normalizeShoppingPurchase()` | Authoritative purchase adaptation | Converts high-confidence citrus/whole-produce forms and normalizes purchase units/quantities. Keep behind the resolver. |
| `shopping-ingredient-resolution.ts:resolveShoppingIngredient()` | Authoritative semantic resolution | The single recipe ingredient -> Shopping input contract. Keep and make Pantry consume all relevant outputs. |
| `createShoppingAggregateDiscriminator()` / `createShoppingAggregateKey()` | Persistence/aggregate identity | Separates range/package occurrences when arithmetic merging would lose structure. Keep. |
| `createShoppingPurchaseKey()` | Boundary adaptation | Resolves free-form Pantry, exact-exclusion, and preference names into an `ingredientKey`. Keep, but route all such consumers through it explicitly. |
| `ingredient-exclusion-families.ts:matchIngredientExclusionFamily()` | Authoritative fixed semantic family | Approved Salt/Black pepper aliases only. Keep; consume its existing output as shared semantic evidence without renaming the persisted V1 field. |
| `shopping-document.ts:derivedClassification()` | Pantry/exclusion policy | Applies live precedence and unanimity. Keep policy here; add resolver-family comparison here. |
| `shopping-document.ts:mergeQuantity()` / `citrusAmountToMerge()` | Shopping-specific aggregation | Quantity conversion and same-recipe juice/zest overlap. Keep outside the resolver. |
| `shopping-categories.ts:categorizeIngredient()` | Default category inference | Keyword/default and recipe-authored category selection. Keep separate from identity. |
| `shopping-document.ts:derivedCategory()` | Category preference policy | Applies ingredient preference and deterministic conflict selection. Keep. |
| `pantry.ts:normalizePantryItemName()` | Persistence boundary | Lowercase/trim only for Pantry storage/display uniqueness. Keep; it is not semantic matching. |
| `shopping-list-normalization.ts:normalizeItemName()` | Legacy/general heuristic | Still used by recipe duplicate warnings, category keyword matching, and manual Shopping input. Its alias behavior is not the resolver contract. Narrow or rename uses; do not let it answer Pantry equivalence. |
| `shopping-ingredient-canonicalization.ts:pluralizeCanonicalShoppingName()` | Display-only formatting | UI quantity display only. Keep. |
| `shopping-list.ts:generateShoppingList()` | Legacy duplication / candidate for deletion | No runtime importer after the Shopping document cutover; tests only. Delete after moving valuable fixtures. |
| `shopping-list-merging.ts:mergeShoppingItems()` | Legacy duplication / candidate for deletion | Old projection merge path; tests only. Delete. |
| `shopping-item-order.ts` | Legacy duplication / candidate for deletion | Old learned-order model; imported only by the two dead modules and tests. Delete. |
| `shopping-document-converter.ts:convertShoppingPersistenceV1()` | One-time cutover helper / candidate for deletion | No runtime or migration caller; tests only after migration 018. Delete, retaining immutable SQL migration evidence. |
| `shopping-categories.ts:getExcludedKeyword()` and compatibility-key helpers | Legacy duplication / candidate for deletion | Used by the dead generator path, not active document projection. Delete after old tests move. |
| `ingredient-exclusion-families.ts:isIngredientExclusionEnabled()` and reason adapters | Legacy duplication / candidate for deletion | Used only by the dead generator or no active caller. Retain only the aliases, reason constants, matcher, and shared family type. |

## 3. Representative-case matrix

| Ingredient case | Recipe resolution | Pantry | Shopping | Exclusion | Desired consistency |
| --- | --- | --- | --- | --- | --- |
| `salt` <-> `kosher salt` | Distinct purchase keys; same `salt` family | **No match** today | Remain separate aggregate rows | Same built-in Salt family | Pantry should match by the shared Salt family; Shopping aggregation should remain distinct. |
| `salt` <-> `sea salt` | Distinct keys; same `salt` family | **No match** today | Remain distinct | Same built-in family | Same as above. |
| `black pepper` <-> `freshly ground black pepper` | Distinct keys; same `black-pepper` family | **No match** today | Remain distinct | Same built-in family | Pantry should match by family; aggregation remains conservative. |
| `lemon` <-> `lemon zest` | Measured or `zest of ...` forms resolve to `lemon`; bare unmeasured `lemon zest` stays `lemon zest` | Conditional | Conditional aggregation | None | Add `lemon` to Pantry satisfaction keys for clear zest wording without forcing uncertain quantities or aggregate identity to change. |
| `lemon` <-> `lemon juice` | Measured/`juice of` forms can resolve to whole lemon; bare unmeasured component remains distinct | Conditional | Conditional | None | Keep purchase aggregation conservative; add Pantry satisfaction only for wording that unambiguously means juice from whole fruit. Do not create a global `lemon juice=lemon` alias. |
| `garlic` <-> `garlic cloves` | Both resolve to `garlic` | Match | Merge | Exact key | Current result is correct; resolver owns it. |
| `onion` <-> `yellow onion` | `yellow` is an identity modifier | No match | Remain distinct | Distinct | Keep conservative. A generic Pantry item does not prove the required variety; changing this would be a separate product decision. |
| `parsley` <-> `parsley or cilantro` | Primary key `parsley`; Pantry keys include both options | Match with either Pantry option | Aggregate by primary only | Alternatives reject family matching; exact exclusion checks primary only | Current result is correct and intentionally asymmetric. |
| `chicken breast` <-> `boneless skinless chicken breast` | Boneless/skinless are identity modifiers | No match | Remain distinct | Distinct | Keep conservative; Pantry should not erase an explicit product requirement without product evidence. |
| `2 lemons, zested and juiced` <-> Pantry `lemon` | Resolves to `lemon`, count `2`; composite prep evidence is dropped | Match | One lemon row | None | Matching is correct. Preserve both prep intents only if another same-recipe citrus occurrence demonstrates overlap risk. |

## 4. Complexity findings

### Finding 1 — Pantry ignores resolver family evidence

- **Current behavior:** `resolveShoppingIngredient()` emits
  `exclusionFamily`, but `derivedClassification()` builds a set only from
  Pantry purchase keys and checks `pantryMatchKeys`.
- **Files/functions:** `shopping-ingredient-resolution.ts:125-240`;
  `shopping-document.ts:449-480`; `ingredient-exclusion-families.ts:29-47`.
- **Why it exists:** Salt/pepper families were introduced as exclusion-only
  settings, so Pantry was explicitly out of the original phase scope.
- **Still necessary:** No. The family evidence is already conservative,
  persisted with resolved Shopping inputs, and demonstrated by a second
  consumer.
- **User-visible failure:** Pantry contains `salt`; a recipe contributes
  `kosher salt`; Shopping shows it as needed unless the separate Salt-family
  exclusion toggle is enabled.
- **Maintenance cost:** Pantry and exclusion behavior answer the same family
  question differently and require separate mental models.
- **Severity:** **medium** (highest-value active inconsistency; common and
  visible, but bounded to two opt-in approved families).

### Finding 2 — A complete legacy Shopping semantic pipeline remains

- **Current behavior:** `shopping-list.ts`, `shopping-list-merging.ts`,
  `shopping-item-order.ts`, and `shopping-document-converter.ts` are imported
  only by one another or tests. Runtime recipe adds use
  `createShoppingRecipeEntry()` -> resolver -> document projector instead.
- **Files/functions:** the four modules above and their dedicated tests;
  `use-shopping-document.ts:466-503` is the active add path.
- **Why it exists:** PR 1 introduced the resolver/projector/converter before
  the migration 018 cutover; physical runtime cleanup did not remove all pure
  legacy modules afterward.
- **Still necessary:** No. The SQL migration is immutable cutover evidence;
  the TypeScript converter and old projector are not rollback safety.
- **User-visible failure:** A regression can pass the large old test suite
  while the active document projector behaves differently. The existing
  canonicalization matrix itself asserts one obsolete rule—different
  effective categories prevent merging—while the active projector deliberately
  aggregates first and selects category deterministically.
- **Maintenance cost:** 1,486 non-runtime source lines, at least 1,871 dedicated
  test lines, duplicate family/category/Pantry/merge branches, and misleading
  code search results.
- **Severity:** **medium** (high maintenance cost; indirect runtime risk).

### Finding 3 — Pantry documentation describes a deleted feature

- **Current behavior:** `docs/pantry-component.md` lists
  `what-can-i-make.tsx`, `use-pantry-match.ts`, and `pantry-matcher.ts`; none
  exists on current `main`.
- **Files/functions:** Pantry domain doc; deletion commit `a9ed431`.
- **Why it exists:** Documentation was not reconciled after the feature was
  removed.
- **Still necessary:** No.
- **User-visible failure:** None in the active app. The risk is that future work
  audits or revives semantics that no longer run.
- **Maintenance cost:** False architecture authority and wasted investigation.
- **Severity:** **low**.

### Finding 4 — Composite citrus prep loses overlap evidence

- **Current behavior:** `2 lemons, zested and juiced` resolves to the correct
  lemon count and key, but `canonicalizeShoppingIngredient()` recognizes only
  individual preparation tokens and `resolveShoppingIngredient()` emits only
  one `citrusPrep` value. The composite modifier produces none.
- **Files/functions:** `recipe-parser.ts:1420-1496`;
  `shopping-ingredient-canonicalization.ts:194-215`;
  `shopping-ingredient-resolution.ts:196-202`;
  `shopping-document.ts:citrusAmountToMerge()`.
- **Why it exists:** Citrus overlap was implemented as a deliberately narrow
  single-intent contract.
- **Still necessary:** The narrowness is appropriate; silently losing this one
  common composite phrase is not.
- **User-visible failure:** The line alone is correct. Double counting is
  possible only when the same recipe separately contributes another resolved
  lemon juice/zest occurrence that refers to the same fruit.
- **Maintenance cost:** A hidden exception in otherwise explicit citrus
  handling.
- **Severity:** **low**. Cover it only in the focused resolver slice; do not
  generalize preparation parsing.

### Finding 5 — `normalizeItemName()` still looks more authoritative than it is

- **Current behavior:** The helper aliases `yellow onion` to `onion` and EVOO
  to olive oil. Active recipe duplicate warnings and manual Shopping entry use
  it, while recipe-derived Shopping identity deliberately preserves yellow
  onion as distinct.
- **Files/functions:** `shopping-list-normalization.ts:90-99,321-334`;
  `recipe-dialog.validation.ts:createCanonicalNearDuplicateKey()`;
  `use-shopping-document.ts:279-335`.
- **Why it exists:** It predates the structured resolver and now serves several
  narrower UI heuristics.
- **Still necessary:** Lowercase/trim and duplicate-warning behavior are
  useful; the Shopping alias table should not be presented as general
  ingredient semantics.
- **User-visible failure:** A manually entered `yellow onion` is displayed as
  `onion`, while a recipe-derived `yellow onion` remains specific.
- **Maintenance cost:** Two similarly named normalization authorities with
  different results.
- **Severity:** **low**. Narrow/rename the manual and duplicate-warning paths
  during cleanup rather than expanding the resolver.

## 5. Target ownership model

```text
Canonical recipe ingredient
        |
        v
resolveShoppingIngredient()
  purchase identity + Pantry candidates + narrow semantic family + context
        |
        +----------------+----------------+----------------+
        v                v                v                v
Pantry satisfaction   Shopping row     Exclusion        Category default
directional policy    aggregation      preferences      + user override
```

The resolver should own:

- conservative purchase name identity and controlled singular/plural aliases;
- preparation-vs-identity modifier handling;
- high-confidence citrus purchase adaptation;
- alternative Pantry candidate keys;
- the existing narrow Salt/Black pepper semantic family (retain the V1
  `exclusionFamily` field name to avoid persistence-contract churn);
- structured range/package context needed to construct aggregate identity;
- default category lookup as an output, not category preference policy.

Pantry should still own:

- Pantry item CRUD, display spelling, and storage uniqueness;
- the directional satisfaction policy;
- resolving a Pantry item through the same purchase-key/family adapter;
- comparing Pantry evidence to `pantryMatchKeys` and the narrow shared family.

Shopping should still own:

- `aggregateKey` and its range/package discriminator;
- cross-recipe grouping, quantity/unit merging, additional quantities, and
  same-recipe citrus overlap;
- row overrides, suppression, order, checks, and deterministic projection.

Exclusion logic should still own:

- user-configured exact keys and family-toggle state;
- Pantry-before-exclusion precedence and unanimous aggregate classification;
- user-facing exclusion reasons.

Category logic should still own:

- default keyword inference;
- recipe-authored category override;
- user category preference and explicit row override;
- deterministic selection when merged occurrences have different defaults.

The resolver must not own Pantry storage, Shopping row state, user exclusions,
custom categories, ordering, or a general taxonomy.

## 6. What gets deleted/consolidated

Delete after equivalent active fixtures exist:

- `web/src/lib/shopping-list.ts`
- `web/src/lib/shopping-list-merging.ts`
- `web/src/lib/shopping-item-order.ts`
- `web/src/lib/shopping-document-converter.ts`
- their four dedicated test files
- unused `getExcludedKeyword()`, `isExcludedIngredient()`,
  `getShoppingCategories()`, `createItemKey()`, compatibility-key helpers, and
  exclusion-family adapters once the dead callers are gone
- Pantry domain-doc references to the removed “What Can I Make?” files

Consolidate rather than delete:

- Move the valuable cases from
  `shopping-canonicalization-matrix.test.ts` to one resolver/projector matrix.
- Make Pantry rows use the same resolver-backed purchase key and approved
  family evidence as recipe occurrences.
- Keep exact exclusions represented as canonical `ingredientKey` values.
- Narrow or rename `normalizeItemName()` call sites so it is clearly a UI
  normalization/duplicate-warning helper, not ingredient identity.

Keep separate:

- recipe parsing and canonical section persistence;
- exact/range/package quantity resolution;
- `ingredientKey` and `aggregateKey`;
- alternative satisfaction and primary-item aggregation;
- category defaults and user overrides;
- manual Shopping row identity;
- immutable migration 018 SQL and its database verification evidence.

## 7. Options and recommendation

### A. Leave the current architecture alone

Not recommended. The main runtime is coherent, but the Salt/Black pepper Pantry
gap is a real user-visible disagreement, and the dead semantic pipeline makes
future changes unnecessarily risky.

### B. Consolidate consumers around existing ingredient resolution

**Recommended.** `resolveShoppingIngredient()` already exposes the required
purchase identity, Pantry candidates, family evidence, aggregate key, citrus
context, and category default. Pantry needs to consume the existing family
evidence, plus a tightly bounded citrus Pantry candidate rule. The active
projector then becomes the only fixture target.

Risk is low because Shopping aggregation keys remain unchanged. The main
behavior change is intentionally limited to Pantry classification for approved
Salt/Black pepper families and explicit citrus component wording.

### C. Add a generalized resolver contract

Not recommended. There is no demonstrated need for `resolvedIngredientId`, a
food registry, alias database, species hierarchy, or broad canonical name.
Renaming the persisted V1 `exclusionFamily` field would add contract churn with
no behavior benefit; reuse it as-is.

## 8. Implementation slices

### PR 1 — Active resolver/Projector Pantry consistency

- Keep the existing persisted `exclusionFamily` field and interpret it as the
  resolver's narrow shared family evidence without changing its two approved
  families.
- Resolve Pantry rows to both purchase key and the same narrow family.
- In `derivedClassification()`, allow a Pantry family match before exclusions;
  keep aggregation identity unchanged.
- Add `lemon`/`lime` Pantry candidate keys only for explicit juice/zest source
  wording, including clear forms whose purchase identity remains a component;
  do not add a global alias.
- Add a focused regression case for `zested and juiced`; defer expanding the
  persisted single-intent `citrusPrep` contract unless a real multi-occurrence
  double-counting fixture demonstrates the need.
- Build one table-driven fixture matrix covering resolver output, Pantry
  bucket, Shopping aggregation, exclusion, and category fallback/override.
- No schema, persistence shape, UI redesign, or browser testing.

### PR 2 — Delete post-cutover semantic duplication

- Delete the four obsolete modules and dedicated tests listed in Section 6.
- Move remaining valuable old matrix cases to the active resolver/projector
  matrix before deletion.
- Remove now-unused compatibility exports and narrow `normalizeItemName()`
  call sites.
- Correct Pantry and Shopping docs to name only active files and explicitly
  record that “What Can I Make?” is absent.
- Verify repository-wide imports contain no old generator, merger, converter,
  or learned-order caller.

## 9. Decision table

| Decision | Recommendation | Reason | Risk | Verification |
| --- | --- | --- | --- | --- |
| General ingredient ontology | Reject | No consumer requires it | High conceptual and maintenance cost | N/A |
| Recipe identity | Keep canonical structured ingredient | Parser/persistence concern is already coherent | None | Parser and structure fixtures |
| Purchase identity | Keep `ingredientKey` from resolver | Correctly preserves meaningful product modifiers | Resolver key drift | Golden resolver keys |
| Aggregate identity | Keep separate `aggregateKey` | Range/package context is legitimately row-specific | Override stability | Aggregation-key fixtures |
| Pantry Salt/pepper | Match shared fixed family | Existing family is conservative and already resolved | Slightly broader Pantry classification | Pair matrix and precedence cases |
| Pantry citrus | Add bounded satisfaction keys, not global equality | Pantry satisfaction can be broader than aggregation identity | Ambiguous bottled juice wording | Explicit positive/negative wording fixtures |
| Alternatives | Keep Pantry candidates; aggregate by primary | Avoids silently choosing a substitute | Reverse-primary rows stay separate | Parsley/cilantro direction cases |
| Exact exclusions | Keep canonical primary ingredient keys | User-configurable, predictable, whole identity | Alternatives intentionally do not exclude | Exact/plural/alternative cases |
| Built-in exclusions | Consume shared family evidence | One family authority | Mixed aggregate handling | Unanimous/mixed family cases |
| Category | Default in resolver; preference/override in projector | Presentation is not identity | Conflicting defaults | Fallback, preference, row-override cases |
| “What Can I Make?” | Document as absent | Runtime was deleted in `a9ed431` | Stale docs only | Call-site/file inventory |
| Old generator/merger/converter | Delete after fixture migration | No runtime callers; parallel semantics are misleading | Losing useful regression coverage | Active matrix parity + zero-import search |

## Final recommendation

`IMPLEMENT PR 1 — consolidate active Pantry satisfaction around
resolveShoppingIngredient(): compare Pantry rows with the resolver's existing
Salt/Black-pepper exclusionFamily evidence, add only explicit lemon/lime
juice-or-zest Pantry candidate keys, and add one shared
resolver/Pantry/Shopping/exclusion/category fixture matrix including “zested
and juiced”; do not change aggregate keys, persisted field names, schema,
migrations, or UI.`
