# Shopping persistence simplification design

Scope: design only. This audit is based on `origin/main` at
`afcd8dc331b0d928cb2ef8ea96667c8f52096744`, including migration 017. The
evidence is static application, test, documentation, schema, and migration
inspection. No application code, schema, migration, data, local Supabase,
browser, recovery tooling, or deployment configuration was changed or used.

## 1. Executive conclusion

The current Shopping persistence model is materially overcomplicated for a
personal meal-planning feature. Recipe-derived quantities are canonical in
`shopping_recipe_contributions`, while user-visible and user-edited state is
canonical in the three persisted `shopping_list` projection buckets. A recipe
change must reconstruct both authorities, infer user intent by comparing old
and regenerated projections, and commit contribution rows, the projection,
and an idempotency record together.

**Recommendation: Option B, one Shopping document with one active recipe entry
per recipe, manual items, explicit overrides, Shopping preferences, and one
`content_revision`.** Rendered rows are deterministic output. Pantry and
exclusion classifications are recalculated from current Pantry and Shopping
preferences; only an explicit restore or bucket choice is persisted as user
intent.

The primary value is architectural simplicity and reliability: one content
authority, one normal write per user action, no inferred intent, and no
contribution/projection synchronization. Payload and database-write speed are
not guaranteed to improve because a bounded JSON document is still rewritten.

The main risk is key stability. A changed `aggregateKey` can prevent a checked,
quantity, category, bucket, suppression, or order override from following the
same logical item across recipe refresh. The resolver, projector, and converter
therefore need fixture proof before the persistence cutover.

Recommended implementation order:

1. Make one pure ingredient-to-Shopping resolver production-authoritative and
   prove a pure document projector/converter with local fixtures.
2. Perform one atomic runtime/persistence cutover, including physical removal
   of the contribution, projection, command, repair, and compatibility model.

## 2. Current flow and ownership map

### 2.1 Current authorities

```text
canonical recipe sections
  -> flattenRecipeIngredients()
  -> generateShoppingList() per recipe
  -> frozen shopping_recipe_contributions snapshot
  -> mergeShoppingItems() / projectShoppingContributions()
  -> persisted shopping_list items/already_have/excluded projection
  -> ShoppingListView selectors and optimistic cache patches
```

Recipe commands travel through
`web/src/lib/shopping-contribution-client.ts:runRecipeContributionCommand()`,
`web/src/app/api/shopping/recipe-contributions/route.ts:executeCommand()`, and
`public.apply_recipe_shopping_contribution_uuid_command(...)`. Ordinary item
actions bypass that route and directly read and replace JSON arrays through
the hooks in `web/src/hooks/shopping/`.

The active query keys are:

- `shoppingKeys.detail(principalId)` =
  `['principal', principalId, 'shopping-list', 'detail']`.
- `configurationKeys.detail(principalId)` =
  `['principal', principalId, 'user-configuration', 'detail']`.
- `pantryKeys.list(principalId)` =
  `['principal', principalId, 'pantry', 'list']`.
- Recipe fallback/navigation reads use principal-scoped `recipeKeys`.

### 2.2 Persistent field classification

| Store or field | Current role | Classification | Target disposition |
| --- | --- | --- | --- |
| `shopping_list.user_id` | Owner and one-row identity | Canonical source input | Keep as row primary key. |
| `shopping_list.items` | Visible rows, manual rows, checks, quantities, categories, sources, and order | Canonical user intent mixed with derived projection and unnecessary duplication | Replace with one `document` column. |
| `shopping_list.already_have` | Frozen Pantry rows plus restored/moved lifecycle state | Derived projection mixed with canonical user intent | Derive classification; persist only explicit bucket overrides. |
| `shopping_list.excluded` | Frozen exact/family exclusions plus restored lifecycle state | Derived projection mixed with canonical user intent | Derive classification; persist only explicit bucket overrides. |
| `shopping_list.source_recipes` | Text recipe identity mirror | Legacy compatibility and derived projection | Delete. |
| `shopping_list.source_recipe_uuids` | UUID recipe identity mirror | Derived projection and compatibility mirror | Delete; recipe entries contain the UUID once. |
| `shopping_list.scale` | Single-list compatibility scale | Derived projection and unnecessary duplication | Delete; each recipe entry owns its selected scale. |
| `shopping_list.total_servings` | Sum of frozen contribution servings | Derived projection | Recalculate if displayed; otherwise remove. |
| `shopping_list.custom_order` | Switch between array order and preference sorting | Canonical user intent encoded as a projection flag | Delete; the document has one explicit order list. |
| `shopping_list.generated_at` | Projection write timestamp | Cache metadata | Replace with ordinary `updated_at`. |
| `shopping_list.contribution_revision` | CAS across contribution commands and every direct list update | Repair/concurrency mechanism | Replace with one narrowly named `content_revision`. |
| `shopping_list.contribution_overrides` | Intent reconstructed from projection differences | Repair mechanism containing canonical user intent | Replace with overrides written directly by mutations. |
| `shopping_list.legacy_items_preserved` | Marks ambiguous pre-contribution projection data | Legacy compatibility | Consume once in conversion, then delete. |
| `shopping_recipe_contributions.user_id` | Owner | Canonical source input | Fold into the owner document. |
| `.recipe_uuid` | Active recipe identity | Canonical source input | Keep once in the document recipe entry. |
| `.recipe_id` | Text identity paired with the UUID | Legacy compatibility | Delete. |
| `.servings`, `.scale`, snapshot recipe name | Frozen recipe selection | Canonical source input | Keep compact equivalents in the recipe entry. |
| `.snapshot.items` | Resolved generated rows, buckets, source data, and quantities | Canonical frozen input mixed with derived projection | Convert to resolved ingredient occurrences without rendered bucket state. |
| `.normalization_version` | Allows in-memory projection upgrades | Legacy compatibility and repair mechanism | Consume during conversion; document schema version replaces it. |
| `.idempotency_key`, timestamps | Command provenance | Repair mechanism and metadata | Delete. |
| `shopping_contribution_commands.*` | Deduplicates fingerprints and retries | Repair mechanism | Delete the table. |
| `user_config.category_overrides` | Future Shopping category preference | Canonical user intent | Move into the Shopping document. |
| `user_config.custom_categories`, `category_order` | Store layout preferences | Canonical user intent | Move into the Shopping document. |
| `user_config.shopping_item_order` | Cross-generation item ordering preferences | Canonical user intent plus cache optimization | Replace with the document's current row order. |
| `user_config.excluded_keywords` | Whole-ingredient exclusions | Canonical user intent | Move into the Shopping document as normalized ingredient keys. |
| `user_config.exclude_salt_variants`, `exclude_black_pepper_variants` | Fixed family preferences | Canonical user intent | Move into the Shopping document. |
| `pantry_items` | Current inventory | Canonical source input owned by Pantry | Keep separate; never copy Pantry state into ingredient identity. |
| TanStack Shopping/config caches | Optimistic and refetch state | Cache optimization | Keep one Shopping document cache and the Pantry cache; remove projection repair patches. |

Within a persisted `ShoppingItem`, `checked` is user intent; an explicitly
edited `item`, quantity, category, bucket, or order is user intent; ordinary
`item`, quantity, exact quantity/package fields, `additionalAmounts`, sources,
category defaults, `excludedBy`, and aggregate servings are derived.
`contributionKey`, `derivedQuantity`, and `legacyRecipeProvenance` are repair or
legacy fields. A persisted `rowId` is necessary only for a manual item. It is
unnecessary duplication for a deterministic derived aggregate.

### 2.3 End-to-end current action map

| User action | UI and hook/mutation | Helper/projection | RPC/database write | Cache result and persisted result |
| --- | --- | --- | --- | --- |
| 1. Add a meal plan to Shopping | `meal-planner.tsx:handleGenerateShoppingList()` -> `useAddToShoppingList()` with `weeklyPlan.recipe_ids` and one plan scale | `parseBody()` deduplicates/sorts IDs; `buildContribution()` calls `generateShoppingList()` once per recipe; `projectShoppingContributions()` rebuilds the full list | `get_recipe_shopping_contribution_state`, Pantry/config/recipe reads, then `apply_recipe_shopping_contribution_uuid_command` | Returned list replaces `shoppingKeys.detail`; contribution rows, all three projection buckets, overrides, revision, and command record persist. |
| 2. Add one recipe | Recipe list `handleAddToShoppingList()`, Planner `handleAddRecipeToCart()`, or Detail `handleAddToShopping()` -> `useAddToShoppingList()` | Same route; Detail also passes exact `scaleV1` from `selectedYieldRatio()` | Same apply RPC and write set | Same authoritative cache replacement; one contribution is inserted or replaced. |
| 3. Add multiple recipes | Planner passes one `recipeIds[]` command | Route bulk-loads recipes, builds one snapshot per recipe, then projects all prior and next contributions | One apply RPC transaction writes multiple contribution rows, one list row, and one command row | One returned list cache replacement; user sees an atomic bulk result. |
| 4. Add the same recipe again | Any add entry point -> same hook | `parseBody()` removes duplicate IDs in a command; next contributions replace by `recipeId` | `(user_id, recipe_id)`/UUID uniqueness upserts the same contribution | No multiplicity exists. Same scale is quantitatively idempotent; another scale/content refresh replaces the snapshot. |
| 5. Remove one recipe | `ShoppingListView:handleRemoveRecipeItems()` -> `useShoppingPendingActions.enqueueRemoveRecipe()` -> delayed `useRemoveRecipeItems()` | On commit, route removes the contribution and reprojects remaining sources; pending UI cannot safely preview the subtraction | DELETE route -> apply RPC deletes contribution row and rewrites list/overrides/command | Returned projection replaces Shopping cache after the delay. |
| 6. Change serving scale | Detail `handleAddToShopping(selectedYield)` -> add command with numeric and exact scale | `assertRecipeScalingFeasible()`/quantity helpers, `generateShoppingList()`, then contribution replacement | Apply RPC updates `servings`, `scale`, `snapshot`, projection, revision, and command record | Cache receives the fully regenerated list. |
| 7. Merge equivalent ingredients | Add command | `flattenRecipeIngredients()` -> `normalizeShoppingPurchase()` -> `canonicalizeShoppingIngredient()`; `generateShoppingList()` aggregates; `aggregateContributions()` calls `mergeShoppingItems()` again | Merged form is stored in both contribution snapshot and list projection | UI renders the persisted aggregate and its combined sources. |
| 8. Keep non-equivalent ingredients distinct | Add command | Conservative canonical identity preserves variety/size/product state; current keys also include effective category and structured range/package source identity. Incompatible units can remain one row through `additionalAmounts` | Distinct/compound rows and additional amounts are duplicated in snapshot/projection | UI keys rows by persisted `rowId`. |
| 9. Apply Pantry matches | Recipe command reads `pantry_items` | `generateShoppingList()` compares the primary purchase key and alternatives, with Pantry first in precedence | Snapshot item stores bucket `already_have`; list row also stores it in `already_have` | Classification is frozen until a later command; restore directly rewrites `items`/`already_have`. |
| 10. Apply exact and seasoning exclusions | Recipe command reads five Shopping config fields | `getExcludedKeyword()` checks only the primary whole identity; `matchIngredientExclusionFamily()` runs on the complete structured ingredient before purchase normalization; unanimous salt/pepper logic runs within and across contributions | Snapshot stores bucket and `excludedBy`; list projection stores the excluded row again | Current settings affect new snapshots, not all existing entries. |
| 11. Check or uncheck | `handleCheckOff()` -> `useCheckOffItem()` | Hook toggles the target `rowId` in a fetched array; the documented `toggle_shopping_item_checked` RPC is unused | One list read plus whole-`items` update; revision trigger increments | Optimistic `shoppingKeys.detail` patch is reconciled locally. Next recipe command infers the check override. |
| 12. Add manual items | `handleAddItem()` allocates `createShoppingRowId()` -> `useAddShoppingItem()` | `createManualShoppingItem()`, category resolution, and order sorting run in both optimistic and server paths | Config is read in `onMutate` and `mutationFn`; list is read; whole `items` is updated | Optimistic patch, then invalidation/refetch. Manual identity is encoded by `sources: Manual` plus `rowId`. |
| 13. Edit item text or quantity | UI exposes `handleSaveManualItemEdit()` only for manual-only rows -> `useUpdateShoppingItem()` | Recreates the manual row, preserves `rowId`, rejects duplicate normalized names, and resorts | Config read, list read, whole `items` update | Optimistic patch is reconciled. Derived quantity/display override support exists in projection repair but has no direct current editor. |
| 14. Override category | Cross-category item drag -> `useSaveCategoryOverride()` then `useReorderShoppingList()`; settings use `useUpdateShoppingConfig()` | Purchase key becomes a future category preference; dragged row is also rewritten | Sequential `user_config` read/update, `shopping_list` update, and item-order config upsert | Config and Shopping queries are separately invalidated; one gesture can partially succeed. |
| 15. Reorder items/categories | `ShoppingListView:handleDragEnd()` -> `useReorderShoppingList()`; `ShoppingSettingsModal:handleDragEnd()` -> config mutation | `learnShoppingItemOrderPreferences()` stores category key lists; array order plus `custom_order` stores current order | Item drag writes list then `user_config`; category drag writes `user_config` | Shopping/config invalidations and refetches; current and future order have separate authorities. |
| 16. Navigate to a source recipe | Row source tag or recipe chip -> `handleRecipeTagClick()` -> `openRecipeDetail(router, id, 'shopping')` | If source UUID is absent, `useRecipes()` provides a name lookup fallback | No write | Routes to `/recipes/[id]?from=shopping`; provenance comes from persisted row sources. |
| 17. Complete Shopping | All checked -> `handleClearListWithUndo()` -> delayed `useClearShoppingList()` | DELETE command uses `clearAll`; projection clears contributions, manual rows, buckets, and overrides | Apply RPC deletes all contributions and rewrites empty list plus command record | Returned empty list replaces cache after the undo delay. |
| 18. Regenerate while preserving edits | Any re-add/rescale | `captureOverrides()` reconstructs the previous derivation, diffs it against all current buckets, infers deletion/check/display/category/quantity/order/bucket intent, then `applyOverride()` projects next state | Contribution replacement plus full projection/override/revision/command writes | Cache receives the result. Overrides survive only if legacy/key disambiguation succeeds. |

One add/rescale currently costs a browser API request, authentication, three
parallel state/context reads, a recipe read, and an apply RPC: six backend calls
including auth. Remove/clear skip the recipe read. A revision conflict repeats
the read, generation, projection, and write path up to four times. Ordinary
actions use a separate read-modify-write model and range from two calls for a
check to as many as eight calls for a cross-category drag.

## 3. Complexity findings

| Finding | Current behavior and reason | Still necessary? | Concrete cost | Severity |
| --- | --- | --- | --- | --- |
| Two content authorities | Contributions were added to make per-recipe quantities reversible without replacing the old JSON list. | No. One bounded user document can own recipe inputs and explicit edits. | Duplicate rows, cross-table projection, three write targets, and transactional alignment. | High |
| User intent is inferred | `captureOverrides()` treats projection differences and absence as edits/deletions and repairs v1/category ambiguity. | No. Mutations know the user's intent when it occurs. | Reverse inference, false tombstones, legacy matching, and large regression matrices. | High |
| Ordinary actions replace arrays | Item hooks fetch JSON, change it, replace it, and often refetch. | No. Cached document plus CAS is sufficient. | Whole-array lost-update windows, two to eight calls, duplicated optimistic logic. | High |
| Category and order have split ownership | A drag changes projection state and future config in separate writes. | No. Both are Shopping intent. | Partial failure and cross-query invalidation. | High |
| Command controls defend the hybrid | Command table, fingerprints, idempotency keys, per-user scopes, row lock, revision, and four retries protect two stores. | Only one CAS revision remains necessary. | Extra table/write/logging/error states and route/SQL security surface. | Medium |
| Derived rows have mutable IDs | Fetch backfills missing `rowId` values and writes during a read. | No. Derived identity can be deterministic; manual rows still need UUIDs. | Read-triggered writes, repair helpers, larger JSON, RPC coupling. | Medium |
| Classification is frozen into identity snapshots | Pantry and exclusion outcomes are copied into each contribution, then copied into list buckets. | No. They are reversible environmental classifications, not ingredient identity. | Stale settings, clear/regenerate guidance, bucket reconciliation. | Medium |
| Undo delays persistence | Remove item/recipe/clear depend on a mounted five-second queue and cleanup effects. | No. Immediate write plus inverse Undo is simpler and durable. | Refresh/navigation risk and timer orchestration/tests. | Medium |
| Active compatibility remains | UUID/text mirrors, normalization upgrades, missing-column fallback, legacy flags, and unused check/category helpers remain callable. | No after cutover. | More branches, types, triggers, tests, and misleading documentation. | Low |

## 4. Required Shopping behavior

### 4.1 Essential behavior to retain

- Add one or many recipes atomically from Recipes, Planner, or Detail.
- Explicitly refresh/rescale a recipe from current canonical recipe content.
- Remove one recipe while retaining the quantities and sources contributed by
  other recipes to a merged aggregate.
- Deterministically merge equivalent purchase identities and retain distinct
  conservative identities and incompatible quantity presentations.
- Show every contributing recipe and navigate to its canonical detail route.
- Preserve manual items and explicit checked, quantity, display, category,
  bucket, suppression, and order intent when the same `aggregateKey` survives
  recipe refresh.
- Apply current Pantry, exact exclusion, and approved salt/black-pepper family
  settings conservatively; allow a user to restore a classified row.
- Complete Shopping by clearing recipe entries, manual items, active overrides,
  and row order while retaining Shopping preferences.
- Prevent silent overwrites from stale tabs/devices with one revision CAS.

### 4.2 Incidental behavior to remove

- Exact historical reconstruction of every prior projection.
- A contribution command ledger, request fingerprint, or generalized
  idempotency history.
- Persisted generated buckets, rendered source arrays, aggregate totals, and
  row IDs for derived items.
- Inference that a missing/different rendered row represents user intent.
- Frozen Pantry/exclusion outcomes that require clear-and-regenerate after a
  preference or inventory change.
- Delayed persistence as the implementation of Undo.
- UUID/text recipe identity mirrors inside Shopping.
- Compatibility for v1 contribution keys after the one-time converter.

### 4.3 Intentional behavior decisions

| Question | Decision | Reason |
| --- | --- | --- |
| Remove one recipe from a merged row? | Required. | It is the central reason to retain compact per-recipe provenance. |
| Multiple active occurrences of the same recipe? | Not required. Re-adding replaces/refreshes the one active entry keyed by `recipeId`. | Current Planner and contribution contract permit one active recipe; duplicate adds are commonly retries or repeated clicks. Adding occurrence UUIDs would create new UI/removal semantics without evidence of user value. |
| Source navigation? | Required, at recipe level. | Current Shopping exposes recipe chips and row source links. Fine-grained historical source-row reconstruction is not required. |
| Quantity override across regeneration? | Required when explicitly set; prune it when its aggregate disappears. | It represents a shopping decision, not recipe truth. |
| Checked/category/order/manual state across regeneration? | Required while the referenced aggregate/manual ID still exists. | These are direct Shopping intent. |
| Pantry/exclusion frozen at add time? | No. Recalculate from current environment/preferences on projection. | Inventory and exclusions are current classification inputs, not permanent ingredient facts. |
| Restore Pantry/excluded item? | Required as an explicit bucket override and reversible by removing/changing that override. | The user may intentionally buy an item they already own or normally exclude. |
| Exact historical projection replay? | Not required. | Shopping is an active personal list, not an audit/event system. |

Recipe content itself remains frozen at the explicit add/refresh boundary:
editing a recipe does not silently rewrite an active list. Pantry and exclusion
changes do reclassify active resolved inputs because those are current
environmental facts. This distinction is intentional.

## 5. Options

| Option | Model | Strengths | Costs and failure modes | Assessment |
| --- | --- | --- | --- | --- |
| A. Current model with cleanup | Keep contribution rows and rendered projection; remove dead helpers and use existing RPCs more consistently. | Lowest migration risk; could reduce a few ordinary-action calls. | Still has two authorities, inferred overrides, cross-table synchronization, duplicated generated data, key/version repair, and command concurrency. | Reject as a target. It improves hygiene without simplifying ownership. |
| B. One document with compact recipe entries and explicit edits | Store frozen resolved recipe inputs, manual items, explicit derived overrides, order, preferences, and one CAS revision; derive rows. | One content authority; reversible recipe operations; explicit intent; one normal write; no command table or persisted projection. | Rewrites a bounded document; requires stable keys and a careful one-time converter; projection needs current Pantry data. | **Recommend.** Smallest model that retains per-recipe removal/rescale and source navigation. |
| C. Persist rendered rows only | Store visible rows with sources and edits. | Simplest read/render path and smallest conceptual schema. | A merged amount does not retain enough quantitative provenance to remove or rescale one recipe safely. Regeneration must infer contribution quantities again or discard edits. | Reject. It loses essential reversible recipe behavior. |

## 6. Exact target contract

### 6.1 Canonical persisted state

The database row is exactly:

```text
shopping_list(
  user_id uuid primary key,
  document jsonb not null,
  content_revision bigint not null,
  updated_at timestamptz not null
)
```

The JSON contract is deliberately bounded and Shopping-specific:

```ts
type ShoppingBucket = 'items' | 'already_have' | 'excluded'
type IngredientKey = string
type AggregateKey = string
type RowRef = `derived:${AggregateKey}` | `manual:${string}`

type ShoppingQuantity = {
  amount: number | null
  unit: string
  exactQuantityV1?: QuantityV1
  exactPackageV1?: PackageV1
  exactAuthoredUnit?: string
}

type ShoppingDocumentV1 = {
  schemaVersion: 1

  // Exactly one active entry per recipeId. Re-add and rescale replace it.
  recipeEntries: Record<string, {
    recipeId: string
    recipeName: string
    selectedServings: number
    scaleV1: RationalV1
    ingredients: Array<{
      ingredientKey: IngredientKey
      aggregateKey: AggregateKey
      displayName: string
      quantity: ShoppingQuantity | null
      purchaseUnit: string
      defaultCategoryKey: string
      pantryMatchKeys: IngredientKey[]
      exclusionFamily?: 'salt' | 'black-pepper'
    }>
  }>

  manualItems: Array<{
    id: string
    displayName: string
    quantity: ShoppingQuantity | null
    categoryKey: string
    bucket: ShoppingBucket
    checked: boolean
  }>

  itemOverrides: Record<AggregateKey, {
    displayName?: string
    // null is an explicit no-quantity override; absence means derived.
    quantity?: ShoppingQuantity | null
    categoryKey?: string
    bucket?: ShoppingBucket
    checked?: boolean
    suppressed?: true
  }>

  order: RowRef[]

  preferences: {
    categoryByIngredient: Record<IngredientKey, string>
    customCategories: CustomShoppingCategory[]
    categoryOrder: string[]
    excludedIngredientKeys: IngredientKey[]
    excludeSaltVariants: boolean
    excludeBlackPepperVariants: boolean
  }
}
```

`ShoppingQuantity` reuses the existing exact/range/package quantity authority
and its compatibility amount/unit projection; it is not a new quantity system.
The document stores recipe input, manual input, explicit overrides,
Shopping-owned preferences, and schema version. `content_revision` is the only
concurrency state and is not a second content authority.

### 6.2 Derived state

The pure projector recalculates:

1. Ingredient aggregation and compatible quantity totals.
2. Recipe source names/UUIDs from parent `recipeEntries`.
3. Current Pantry classification from `pantryMatchKeys` and `pantry_items`.
4. Current exact and family exclusion classification from document
   preferences.
5. Effective display name, quantity, category, bucket, check, and suppression
   after explicit overrides.
6. Manual/derived row combination and stable ordering.
7. UI `items`, `already_have`, and `excluded` buckets, category groups,
   progress totals, source labels, and rendered row props.

Classification precedence is Pantry, exact exclusion, enabled family
exclusion, then visible. A merged aggregate is `already_have` only if every
occurrence matches Pantry, and `excluded` only if every occurrence is excluded
for the same reason. Mixed or unprovable aggregates remain visible. An explicit
bucket override wins.

When equivalent occurrences disagree on a default category, choose
deterministically by most frequent default category, then category order, then
key. Category is presentation, not ingredient identity. The explicit aggregate
override wins, followed by `preferences.categoryByIngredient`.

### 6.3 Identity

- `ingredientKey` is the resolver's conservative normalized purchase identity.
  It includes identity-bearing variety, size, product type, and processing
  state. It excludes quantity, preparation-only modifiers, checked state,
  Pantry/exclusion result, display/category overrides, and order. It scopes
  category/exclusion preferences.
- `aggregateKey` identifies one derived rendered aggregate. For ordinary
  quantities it is a versioned encoding of `ingredientKey`; it adds only a
  narrow quantity discriminator when an exact range/package cannot be safely
  aggregated. It does not contain category, bucket, checked state, or a mutable
  row ID.
- Manual-item identity is one UUID allocated before the first write and reused
  for optimistic state, conflict replay, editing, ordering, deletion, and Undo.
- Recipe-occurrence identity is the recipe UUID itself. The target deliberately
  supports one active entry per recipe. It does not add a generalized
  occurrence-ID system.

All encodings are versioned strings produced by one resolver. Unknown or
unresolved names remain opaque conservative keys; the resolver never guesses
them into a broader ingredient.

### 6.4 Ingredient-resolution boundary

Canonical recipe `ingredientSections` remain the raw recipe authority.
Shopping flattens them exactly once with
`web/src/lib/recipe-structure.ts:flattenRecipeIngredients()`, preserving global
ingredient order. A single pure boundary owns the existing narrow decisions:

```ts
resolveShoppingIngredient(canonicalIngredient, scale, sourceOrdinal) -> {
  ingredientKey,
  aggregateKey,
  displayName,
  quantity,
  purchaseUnit,
  defaultCategoryKey,
  pantryMatchKeys,
  exclusionFamily,
}
```

It composes the existing quantity resolver, conservative ingredient
canonicalization, purchase normalization, default categorization, and the
salt/black-pepper matcher. The family match must still inspect the complete
structured ingredient before purchase normalization; alternatives remain
ineligible for family matching, and bare `pepper` remains visible. Pantry may
use primary plus alternative match keys; exact exclusion uses only the primary
`ingredientKey`.

Shopping consumes the resolved output and does not normalize names again in
the projector. Raw unresolved ingredient data remains in the recipe and is not
duplicated in the Shopping document. A compact display/source label may be
stored only when the current UI actually renders it.

After this boundary is authoritative, projection-time calls to
`createShoppingPurchaseKey()`, `canonicalizeStoredContributionKey()`,
`findOverride()`, normalization-version upgrades, and legacy category-key
disambiguation disappear. The existing normalization/canonicalization helpers
may remain as resolver internals; ingredient resolution itself is not
redesigned.

### 6.5 Invariants

- One row and one document exist per authenticated user.
- `recipeEntries` has at most one entry per owned recipe UUID, and the key
  equals `recipeId`.
- Every derived override key is currently produced by at least one recipe
  entry; mutations prune orphan overrides immediately.
- Every `order` reference is unique and points to a current aggregate or manual
  item; missing references append in deterministic projection order.
- Manual IDs are unique and never reused.
- Derived keys never depend on user-editable display/category/bucket/check/order
  fields.
- Projecting the same document, Pantry snapshot, and resolver version produces
  byte-equivalent semantic rows.
- The persisted document never contains rendered buckets, source mirrors,
  aggregate totals, or historical revisions.

### 6.6 Mutation and read/write behavior

The hook uses the cached document as input and sends a complete next document
with the expected revision. Successful writes return the revised row and
replace `shoppingKeys.detail`; there is no success invalidation/refetch.

| Mutation | Document behavior | Normal reads | Normal writes |
| --- | --- | ---: | ---: |
| Add one recipe | Read current canonical recipe content, resolve at selected scale, replace `recipeEntries[recipeId]`, retain matching overrides/order | 1 recipe read if not already available | 1 CAS document update |
| Add many recipes/plan | Bulk-read canonical recipe content, resolve all, replace entries as one intent | 1 bulk recipe read | 1 CAS document update |
| Remove recipe | Delete its entry; reproject; retain overrides still produced elsewhere and prune the rest | 0 | 1 CAS document update |
| Rescale/refresh recipe | Read current recipe, resolve at new scale, replace the same entry | 1 recipe read | 1 CAS document update |
| Set checked/un-checked | Write the target boolean to derived override or manual item; never persist a toggle command | 0 | 1 CAS document update |
| Add manual item | Allocate UUID first and append the full manual item | 0 | 1 CAS document update |
| Edit/delete manual item | Replace/remove by manual UUID and prune its order reference | 0 | 1 CAS document update |
| Override quantity/text | Set the exact desired override by `aggregateKey` | 0 | 1 CAS document update |
| Override category | Set current aggregate override and future ingredient preference in the same document | 0 | 1 CAS document update |
| Reorder items/categories | Replace the relevant `order` or `categoryOrder` array with unique valid refs | 0 | 1 CAS document update |
| Restore Pantry/excluded row | Set explicit `bucket: 'items'`; removing/changing it restores automatic classification | 0 | 1 CAS document update |
| Move row to Pantry | Document-aware atomic RPC clears conflicting bucket intent and upserts Pantry | 0 application reads; one locked transaction | 1 document update + at most 1 Pantry insert |
| Complete Shopping | Clear entries, manual items, overrides, and order; retain preferences | 0 | 1 CAS document update |
| Undo | Apply the inverse narrow mutation immediately | 0 | 1 CAS document update |

Initial Shopping load is one document read plus one Pantry read, performed in
parallel. Preferences no longer require a separate `user_config` read.

### 6.7 Concurrency

Every document update predicates on both `user_id = auth.uid()` and
`content_revision = expected`, increments the revision once, and returns the
new row. Direct RLS-protected update is sufficient for document-only actions;
only the cross-table Pantry action requires an RPC.

If the CAS returns no row:

1. Refetch the document once.
2. Replay the same narrow idempotent intent on the fresh document.
3. Retry the CAS once.
4. If it conflicts again, retain the server document and show a visible error.

Replay safety is explicit: recipe add replaces by recipe ID; manual add reuses
its preallocated UUID; checked actions set a target boolean; category/quantity
actions set a target value; remove is no-op when already absent; reorder sets a
complete validated order. No command table, fingerprint, four-attempt loop,
event history, or collaborative editing is needed.

### 6.8 Performance assessment

| Dimension | Mechanism and expected result |
| --- | --- |
| Database round trips | Normal item actions fall from read+write/refetch sequences to one returned-row CAS write. Recipe actions use one recipe read and one write. A conflict adds exactly one refetch and one retry. |
| Payload size | Contribution snapshot plus rendered projection duplication disappears. Each mutation still sends the full bounded document, so payload savings must be measured rather than promised. |
| Write amplification | Recipe commands stop writing contribution rows, a projected list, and a command record. Normal actions remain one row rewrite; Pantry move intentionally touches two tables. |
| Client transformation | One deterministic projection replaces prior derivation, next derivation, override capture, legacy key repair, persisted bucket rendering, and selector re-merging. Personal-list compute should remain negligible. |
| React rendering | Stable `aggregateKey`/manual UUID keys preserve row identity. Replacing one query value can still rerender affected selectors; no major render-speed claim is justified without measurement. |
| Reliability | Explicit intent cannot be inferred incorrectly; CAS prevents silent stale overwrites; immediate persistence makes Undo independent of component lifetime. |
| Development/test burden | Contribution route/RPC/security, command retry, row-ID repair, version compatibility, projection inference, and split-config tests disappear. Converter and CAS tests are added once. |

## 7. Migration and deletion plan

### 7.1 Conversion and cutover

1. Implement a pure `convertShoppingPersistenceV1()` over local fixtures. Its
   inputs are the current list row, contribution rows, Shopping `user_config`
   fields, and Pantry snapshot. It produces one validated document and a
   projected semantic comparison result.
2. Convert each authoritative contribution snapshot into one recipe entry.
   Use existing source/quantity data and the authoritative resolver once;
   consume v1 normalization compatibility only inside this converter.
3. Convert current projection differences into explicit overrides. Convert
   manual rows and ambiguous `legacy_items_preserved` rows into manual items.
   Preserve current bucket placement with an explicit bucket override only when
   the new live classification differs at conversion time.
4. Copy Shopping preferences from `user_config`, map existing derived order to
   `derived:<aggregateKey>`, and preserve or deterministically allocate manual
   UUIDs.
5. Require fixture and cutover validation for recipe-entry counts, manual-row
   counts, source sets, quantities, checks, categories, buckets, exclusions,
   and order. Any invalid row aborts before the runtime switch.
6. In one cutover release, add/populate/validate `document` and
   `content_revision`, switch every runtime read/write to the document, and
   remove the old runtime/schema surface. Do not dual-write, lazily convert,
   background-convert, or retain compatibility columns.

The old contribution table should be **converted and dropped in the cutover
PR**. Retaining an unwritten copy for one release is not a real rollback: it
becomes stale after the first document mutation. The safe rollback boundary is
before the cutover transaction/release commits. After new writes, recovery is
forward repair or a separately authorized restore under the repository's
existing runbooks; this design does not invent recovery commands.

### 7.2 Concrete deletion inventory

**Tables and columns**

- Drop `shopping_recipe_contributions` and
  `shopping_contribution_commands`, including identity sync triggers,
  constraints, indexes, grants, and policies.
- From `shopping_list`, replace `items`, `already_have`, `excluded`,
  `source_recipes`, `source_recipe_uuids`, `scale`, `total_servings`,
  `custom_order`, `generated_at`, `contribution_revision`,
  `contribution_overrides`, and `legacy_items_preserved` with `document`,
  `content_revision`, and `updated_at`.
- Remove Shopping-only `user_config` fields after conversion:
  `category_overrides`, `custom_categories`, `category_order`,
  `shopping_item_order`, `excluded_keywords`, `exclude_salt_variants`, and
  `exclude_black_pepper_variants`.

**RPCs, triggers, and compatibility SQL**

- Drop `get_recipe_shopping_contribution_state()`.
- Drop both `apply_recipe_shopping_contribution_command(...)` and
  `apply_recipe_shopping_contribution_uuid_command(...)`.
- Drop `bump_shopping_contribution_revision()` and its trigger.
- Drop the unused `toggle_shopping_item_checked(...)` contract.
- Replace `move_shopping_item_to_pantry(...)` with the document/CAS-aware
  cross-table mutation; do not retain JSON-bucket/`rowId` compatibility.
- Remove private Shopping UUID/text source converters, contribution identity
  synchronizers, validation helpers, and recipe-delete contribution cleanup
  once caller search proves they are Shopping-only.

**Application routes, hooks, and cache logic**

- Delete `web/src/app/api/shopping/recipe-contributions/route.ts` and its test.
- Delete `web/src/lib/shopping-contribution-client.ts` and
  `web/src/lib/shopping-contributions.ts`.
- Replace `use-shopping-list.ts`, `use-shopping-recipes.ts`,
  `use-shopping-items.ts`, `use-shopping-categories.ts`, and
  `use-shopping-config.ts` with one document query and narrow document
  mutations; rewrite only the cross-table part of `use-shopping-pantry.ts`.
- Delete `user-config-read.ts`, the missing-column fallback,
  `preserveCheckedItemsFromExisting()`, unused `useUpdateItemCategory()`, and
  the contribution write scope/serialization that no longer protects a hybrid.
- Delete `use-shopping-pending-actions.ts`; use immediate mutations and inverse
  Undo.
- Remove derived `rowId` backfill/persistence from
  `shopping-row-identity.ts`; retain at most a manual UUID helper.
- Remove projection invalidation/refetch and split Shopping/config optimistic
  patches. Keep principal-scoped `shoppingKeys.detail`, installing each
  returned CAS row directly.
- Reduce `shopping-list-merging.ts` to the pure compatible-quantity merger used
  by the document projector. Remove duplicate normalization and
  `additionalAmounts` reconstruction paths elsewhere.

**Tests and documentation**

- Replace contribution projection/route/hook tests:
  `shopping-contributions.test.ts`, `route.test.ts`, and
  `use-shopping-recipe-contributions.test.tsx`.
- Delete delayed queue tests in `use-shopping-pending-actions.test.tsx` and
  test immediate action/inverse behavior instead.
- Replace current read-modify-write/config fallback assumptions in
  `use-shopping-items.test.ts`, `use-shopping-pantry.test.ts`,
  `shopping-user-config-read.test.ts`, and
  `shopping-list-checked-state.test.ts`.
- Replace `supabase/tests/shopping_contribution_security.sql`; update the
  Shopping portions of privileged RPC, UUID reference, and recipe deletion
  tests rather than deleting unrelated coverage.
- Remove or rewrite `web/scripts/check-shopping-contribution-writes.mjs` and its
  package script for the new document write contract.
- Delete `docs/shopping-contributions.md`; update `shopping-component.md`,
  `pantry-component.md`, `project_overview.md`, `supabase/SCHEMA.md`, and mark
  ADR-022's persisted-derived-row requirement superseded in `decisions.md`.
  Keep historical migrations and audits as immutable evidence, clearly labeled
  superseded where repository convention requires.

### 7.3 Focused verification

Use existing Vitest and migration-fixture infrastructure only:

- Resolver identity matrix: equivalent ingredients merge; variety, size,
  product state, conservative compounds, structured packages/ranges, and
  salt/pepper false positives remain distinct/visible as specified.
- Deterministic projection: same inputs produce identical rows and keys;
  compatible quantities merge and incompatible quantities remain explicit.
- Add/remove/rescale one recipe, bulk add, repeated add replacement, and merged
  source provenance/navigation.
- Quantity/display/category/bucket/check/suppression overrides survive refresh
  by `aggregateKey` and do not transfer to a changed identity.
- Manual add/edit/delete, stable UUID replay, exact-duplicate UI behavior, and
  order across regeneration.
- Live Pantry/exact/family classification, conservative mixed aggregates,
  restore override, alternatives behavior, exact-term primary-only behavior,
  and approved salt/black-pepper variants.
- One successful CAS write installs its returned row without invalidation; one
  conflict refetches/replays once; a second conflict is visible and overwrites
  nothing.
- Document-aware Pantry move is atomic across both tables.
- Pure converter fixtures cover contribution-only, manual-only, mixed legacy,
  overrides, duplicate source names, incompatible quantities, all buckets, and
  order; cutover migration proves semantic parity and atomic failure.
- Static reference check proves no active contribution table, old column, old
  RPC, route, normalization version, legacy flag, or projection-repair caller.

No broad browser suite, database reset, new test framework, or production data
inspection is required to prove the design.

## 8. Implementation slices

Two PRs are sufficient. A third cleanup PR would prolong compatibility without
adding safety.

### PR 1: Authoritative resolver, document projector, and pure converter

- **Scope:** Extract `resolveShoppingIngredient()` from the current generation
  path and make `generateShoppingList()` consume it without behavior change.
  Add the exact `ShoppingDocumentV1` validator, pure projector, narrow mutation
  reducers, and `convertShoppingPersistenceV1()` with local fixtures. Do not
  change persistence.
- **Main files:** `web/src/lib/shopping-list.ts`,
  `shopping-list-normalization.ts`,
  `shopping-ingredient-canonicalization.ts`,
  `ingredient-exclusion-families.ts`, a new small
  `shopping-document.ts`, and focused co-located tests.
- **Schema impact:** None.
- **Expected deletions:** Duplicate generation-time key/category/family branches
  proven redundant; no persistence compatibility is deleted yet.
- **Focused tests:** Resolver matrix, deterministic document projection,
  mutation reducers, converter semantic fixtures, and current generation
  equivalence.
- **Entry state:** Shopping normalization, classification, and identity are
  spread across generation, contribution merging, and projection repair.
- **Exit state:** One production-used resolver defines target keys; the
  projector and converter are proven without creating a second runtime
  persistence authority.

### PR 2: Atomic document cutover and physical cleanup

- **Scope:** Add migration 018 for the document/revision contract, convert and
  validate all rows, cut hooks/UI/recipe deletion/Pantry move to document CAS,
  and delete every old table, column, RPC, route, helper, test, script, and doc
  listed above in the same reviewed release.
- **Main files:** one migration, generated/database types, Shopping hooks and
  component orchestration, recipe deletion integration, Pantry bridge,
  Supabase tests/schema docs, and the deletion inventory.
- **Schema impact:** Tier 3 replacement: one JSON document plus revision replaces
  the hybrid tables/projection/config fields.
- **Expected deletions:** Contribution and command tables, all projection
  columns, both apply RPCs/state RPC, command route/client, override inference,
  revision/idempotency/legacy/key-repair paths, derived row IDs, delayed Undo,
  and split Shopping config/cache logic.
- **Focused tests:** Converter/migration atomicity, complete mutation contract,
  one-replay CAS, cross-table Pantry atomicity, recipe-delete behavior, and no
  old runtime references.
- **Entry state:** Proven resolver/projector/converter with old persistence still
  sole runtime authority.
- **Exit state:** One document is the only Shopping authority and no live
  contribution/projection compatibility remains.

## 9. Decision table

| Decision | Recommendation | Reason | Risk | Verification |
| --- | --- | --- | --- | --- |
| Persistence authority | One `ShoppingDocumentV1` row | Smallest model retaining reversible recipe operations and explicit edits | Whole-document rewrite | Payload fixture and one-write hook tests |
| Recipe multiplicity | One active entry per recipe UUID | Matches current product and prevents accidental double-add | Future true duplicate-meal need | Repeated-add replacement tests |
| Recipe content timing | Freeze resolved inputs at add/refresh | Recipe edits should not silently alter an active list | Stale name/content until refresh | Re-add/rescale fixtures |
| Pantry/exclusion timing | Recalculate current classifications | Environmental state is not ingredient identity | Rows can move after preference/inventory changes | Classification and restore tests |
| User edits | Persist explicit overrides when actions occur | Removes reverse inference | Key drift | Aggregate-key stability matrix |
| Derived identity | Deterministic `aggregateKey` | No mutable persisted row ID needed | Resolver changes | Versioned golden keys |
| Manual identity | Persisted UUID | Stable targeting and replay | Duplicate user-visible names | Manual reducer/UI tests |
| Category identity | Presentation, not aggregate identity | Equivalent ingredients should merge regardless of default aisle | Conflicting defaults need deterministic choice | Conflict fixture and override test |
| Concurrency | One revision CAS, one refetch/replay | Sufficient for stale personal tabs/devices | Second conflict surfaces to user | Two-conflict integration test |
| Undo | Immediate action plus inverse write | Survives navigation and refresh | Inverse can itself conflict | CAS Undo test and visible failure |
| Migration | Pure converter proof, then one cutover | No dual write/lazy conversion | Tier 3 key/data conversion | Semantic parity and atomic failure fixtures |
| Old contribution table | Convert and drop in cutover PR | An unwritten retained copy is stale, not rollback safety | Post-cutover rollback requires existing runbook | Pre-commit abort boundary and cutover checks |
| Performance claim | Simplicity/reliability first | Full JSON remains the write unit | Payload may not shrink materially | Representative document measurement |

**Exact next implementation slice:** implement PR 1 only: add the
production-used `resolveShoppingIngredient()` boundary, `ShoppingDocumentV1`
validator/projector and narrow mutation reducers, plus
`convertShoppingPersistenceV1()` fixtures proving current rendered semantics.
Make no schema or persistence write-path change in that slice.
