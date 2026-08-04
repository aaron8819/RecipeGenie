# Canonical recipe structure design

Scope: design and read-only production-data preflight only. This report was
prepared from `origin/main` at
`b5b2b11cee07f3cd9dcfa3c768faa5954b3077db`, including PR #38. No application
code, database schema, migration, deployment, or production data was changed.

The production preflight ran on 2026-08-03 against the explicitly configured
Recipe Genie Supabase project `eyaoahwzixqetjgfghsh`. It verified migration
`015`, set both the database session default and transaction to read-only, and
returned aggregate structural counts only. It did not select or print recipe
names, recipe IDs, user IDs, ingredient text, instruction text, notes, email
addresses, or credentials.

## 1. Executive conclusion

Canonicalization is justified. Recipe Genie should persist ordered ingredient
sections and ordered instruction sections, and every internal feature should
consume that same sectioned shape. Flat arrays are legitimate only when an
external format requires them.

The exact recommendation is:

```ts
export type CanonicalIngredient = Omit<Ingredient, "groupLabel">

export type IngredientSection = {
  label: string | null
  ingredients: CanonicalIngredient[]
}

export type InstructionSection = {
  label: string | null
  steps: string[]
}

export type RecipeStructure = {
  ingredientSections: IngredientSection[]
  instructionSections: InstructionSection[]
}
```

Persist the two arrays in `recipes.ingredient_sections` and
`recipes.instruction_sections`. Keep `recipes.notes` as the existing separate
first-class array. Do not introduce a generic document column, section IDs,
ingredient IDs, explicit order fields, schema-version flags, or another
normalization layer.

The main value is removal of ambiguity: one write shape, one read shape, one
editor shape, and no permanent precedence or fallback rules. The runtime
performance gain is secondary. The material improvements are fewer
transformations, approximately 30 KB of currently duplicated flat instruction
payload across the 93 grouped production rows, removal of repeated ingredient
section labels, and a smaller test/compatibility surface.

The main risk is not malformed production data; the preflight found none. The
main risk is coordinating a Tier 3 schema/application cutover without allowing
an old writer to create post-backfill legacy-only changes. Use a controlled
write pause, fail-closed conversion, and one section-only release. Do not solve
that short deployment problem with long-lived dual writes or fallback reads.

Recommended order:

1. Add the pure converter, invariants, exhaustive fixtures, and checked-in
   count-only preflight. Do not wire them into runtime reads or writes.
2. In one coordinated cutover, add and backfill the canonical columns, convert
   share snapshots, replace the share acceptance contract, and switch every
   active application path to sections only. Leave old columns present but
   inactive for a short verification window.
3. In a second, immediately following cleanup PR, prove no readers/writers
   remain, drop the old columns, remove conversion-only code and compatibility
   tests, and regenerate database types.

Steps 2 and 3 should be two short sequential PRs. Combining them would remove
the best post-cutover comparison evidence at the moment it is most useful.
Leaving old columns for a short window is not a dual architecture: the cutover
application must neither read nor write them.

## 2. Current representations

### 2.1 Persisted and application types

| Concept | Exact representation | Origin / persistence | Active consumers | Classification | Can disagree? |
| --- | --- | --- | --- | --- | --- |
| Ingredient | `Ingredient` in `web/src/types/database.ts` | App-facing item with legacy `amount`/`unit`, structured quantity metadata, and optional `groupLabel` | Dialog, detail, scaling, Shopping, export, sharing | Canonical ingredient content plus legacy section encoding | `groupLabel` can disagree with parser group arrays before save; no separate persisted ingredient-group column exists |
| Flat ingredients | `Recipe.ingredients: Ingredient[]`; `recipes.ingredients JSONB` | Parser flattening, manual form, URL import, recipe writes | Every recipe read; Shopping and scaling consume it directly | Persisted authority today | It cannot disagree with a second persisted ingredient array because none exists |
| Parsed ingredient groups | `ParsedIngredientGroup[]`; `ParsedRecipe.ingredientGroups` in `recipe-parser.ts` | Markdown/plain-text parser | Import preview only; flattened before form/persistence | Transient derived structure | Yes, parser also returns flat `ingredients` |
| Ingredient section label | `Ingredient.groupLabel?: string` | Parser copies the group label onto every ingredient | Detail regrouping; duplicate analysis | Legacy indirect structure | Repetition loses explicit boundaries and increases payload |
| Flat instructions | `Recipe.instructions: string[]`; `recipes.instructions TEXT[]` | Parser, dialog submission, share snapshots | Fallback hydration, legacy notes parsing, external export | Legacy persisted copy | Yes, it can conflict with `instruction_groups` |
| Grouped instructions | `RecipeInstructionGroup[]`; `Recipe.instruction_groups`; `recipes.instruction_groups JSONB` | Parser/editor and dialog submission | Detail/editor/export prefer it | Intended structure authority today | Yes, flat instructions remain separately writable |
| Form instructions | `RecipeDialogFormValues.instructionGroups` | Manual create, edit hydration, import apply | Instruction editor and submission | Canonical in the current editor only | Submission immediately duplicates it |
| Notes | `Recipe.notes`; `recipes.notes JSONB` | Manual/import/share | Detail/editor/share | Canonical first-class notes | Empty notes still fall back to a `Notes:` tail inside flat instructions |
| Share structure | `RecipeShareSnapshot.ingredients`, `.instructions`, `.instruction_groups`; `recipe_shares.source_recipe_snapshot` | `buildRecipeShareSnapshot()` | `accept_recipe_share()` and inbox display | Durable copy snapshot with legacy duplication | Yes, the SQL validator and copy path support both instruction forms |

The generated database type in `web/src/types/database.generated.ts` mirrors the
three current structure columns. `Recipe`, `RecipeInsert`, and `RecipeUpdate` in
`web/src/types/database.ts` replace their JSON types with handwritten
`Ingredient[]` and `RecipeInstructionGroup[]` types. `mapRecipeRow()` in
`web/src/lib/recipe-identity.ts` normalizes only ingredients and yield metadata;
it passes instructions, notes, and instruction groups through the row spread.

### 2.2 Active flow map

| Flow | Exact source and function | Shape transition / current source of truth |
| --- | --- | --- |
| Manual create | `recipe-dialog.tsx`; `RecipeDialogFormValues`; `buildNewRecipeDialogFormValues()` | Flat ingredient rows plus grouped instruction form state |
| Markdown/plain-text import | `recipe-parser.ts`; `ParsedRecipe`; `parseRecipeText()` | Builds `ingredientGroups` and `instructionGroups`, then also returns flat `ingredients` and `instructions` |
| URL import | `recipe-url-parser.ts`; `ExtractedRecipe`; `parseRecipeInstructions()` | Returns flat ingredients and instructions; `HowToSection.name` is discarded |
| Import API | `api/recipe-import/route.ts`; `useImportRecipeFromUrl()` | Carries the flat `ExtractedRecipe` DTO over an internal HTTP boundary |
| Validation | `recipe-data-validation.ts`; `normalizeIngredient()`, `normalizeIngredients()`, `normalizeInstructionGroups()`, `normalizeRecipeShareSnapshot()` | Validates the flat ingredient array and flat/grouped share fields independently |
| Dialog hydration | `recipe-dialog.defaults.ts`; `buildEditingRecipeDialogFormValues()` | Regroups instructions with `buildInstructionEditorGroups()`; ingredients remain flat with label badges |
| Import apply / replacement | `applyParsedRecipeToFormValues()` and `applyPreviewToCurrentForm()` | Uses parsed flat ingredients and parsed groups; replacement preserves category/tags/image and identity as documented |
| Save payload | `buildRecipeSubmissionData()` | Writes flat ingredients; flattens instruction groups to `instructions`; also writes `instruction_groups` |
| Create/update | `useCreateRecipe()`, `normalizeRecipeUpdates()`, `useUpdateRecipe()` | Direct Supabase insert/update of both instruction representations |
| Database | `001_baseline.sql`, `002_recipe_structure_parity.sql`, `014_add_recipe_yield_metadata.sql` | Flat ingredients and instructions are non-null; grouped instructions are nullable; share acceptance copies all forms |
| Query mapping | `useRecipes()`, `useRecipe()`, `mapRecipeRow()` | Both hooks use `select("*")`; list, planner, and detail caches receive full content |
| Recipe detail / print | `recipe-detail-page.tsx`; `getRecipeIngredientGroups()`, `getRecipeInstructionGroups()`, `getRecipeNotes()` | Ingredients are globally regrouped by trimmed label; instructions prefer groups then parse flat labels; print uses the same DOM |
| Serving scaling | `assertRecipeScalingFeasible()` and `formatRecipeQuantity()` calls in `RecipeDetailContent` | Operates on the flat ingredient array; stored data is not mutated |
| Ingredient resolution | `matchIngredientExclusionFamily()`, `normalizeShoppingPurchase()` in `generateShoppingList()` | Ingredient-level decisions ignore section labels |
| Shopping generation | `shopping-list.ts`; `generateShoppingList()` | Iterates `recipe.ingredients` and derives purchase occurrences; the contribution route fetches `recipes.select("*")` |
| Sharing | `recipe-sharing.ts`; `buildRecipeShareSnapshot()`; `api/recipe-shares/route.ts` | Snapshot duplicates flat/grouped instruction structure; acceptance revalidates and copies both in SQL |
| JSON export | `recipe-export.ts`; `recipesToSchemaOrg()` | `recipeIngredient` is flat; `getFlatRecipeInstructions()` emits `HowToStep[]`; current code does not emit `HowToSection` |
| Text/Markdown/clipboard export | No active implementation found | No compatibility requirement exists today |
| History/planner/template references | `use-planner.ts`, `use-plan-templates.ts`, migrations 009–012 | Persist recipe UUIDs and metadata references, not recipe structure; they must retain identity but need no content conversion |

### 2.3 Dual reads, dual writes, and compatibility paths

There is one application dual-write builder and two copy boundaries:

1. `buildRecipeSubmissionData()` writes `instructions` and
   `instruction_groups` on every save.
2. `buildRecipeShareSnapshot()` copies both forms into a durable snapshot.
3. `accept_recipe_share()` validates and inserts both forms.

There are at least eight active structure converters/fallbacks:

- `flattenIngredientGroups()`
- `flattenInstructionGroupsForCurrentModel()`
- `getRecipeIngredientGroups()`
- `getRecipeInstructionGroups()`
- `getFlatRecipeInstructions()`
- `buildInstructionEditorGroups()`
- `splitLegacyNotesFromInstructions()` / `parseInstructionLines()`
- URL `parseRecipeInstructions()` flattening of `HowToSection`

`getRecipeIngredientGroups()` uses a `Map<label, index>`, so it globally
coalesces equal labels even when they occur in separate non-consecutive runs.
This is the behavior the migration must not copy. The legacy ingredient array
can preserve non-consecutive runs by order, but it cannot prove that two
adjacent ingredients with the same label came from separate same-label
sections.

### 2.4 Existing tests that encode the dual model

The following tests should be rewritten around canonical sections rather than
retained as compatibility requirements:

- `recipe-parser.test.ts`: “preserves grouped instructions and notes
  losslessly in the current flat model fallback” and the assertions that every
  parsed result simultaneously has `ingredientGroups`/`ingredients` and
  `instructionGroups`/`instructions`.
- `recipe-dialog-helpers.test.ts`: “builds new form defaults and submission
  payloads,” “preserves ingredient group labels through normalization and
  submission,” “round-trips ... grouped instructions,” and the assertions that
  submission contains both `instructions` and `instruction_groups`.
- `recipe-url-parser.test.ts`: “should handle HowToSection instructions”
  currently proves label loss; it should instead prove section preservation.
- `recipe-sharing.test.ts`: “creates a share snapshot from recipe fields”
  expects both instruction forms.
- `recipe-export.test.ts`: “should produce HowToStep instructions” assumes all
  internal instructions are flat; it should cover `HowToSection` plus the
  ungrouped flat boundary case.
- `recipe-detail-page.test.tsx`: fixtures define flat ingredients with
  `groupLabel` and both instruction forms; rewrite them with canonical arrays.
- `privileged_rpc_security.sql`: `snapshot_validation_cases` and accepted-copy
  assertions validate `instructions` plus optional `instruction_groups`; replace
  them with exact canonical-section cases. Delete the legacy `{}` snapshot
  acceptance cases because production contains no such snapshot.
- `recipe-import-browser.spec.ts`: persisted-row assertions should require the
  two canonical columns and prove legacy columns are no longer written.

Quantity, package, yield, UUID identity, sharing authorization, Shopping
normalization, and planner-reference tests remain valid and must not be folded
into this structural rewrite.

## 3. Data preflight

### 3.1 Safe methodology

The preflight used the configured production Session Pooler only after
`npm run rg:doctor` confirmed the repository, explicit project ref, local link,
database endpoint class, PostgreSQL tooling, and migration tip expectations.
The generic production-verification wrapper could not run because its optional
production URL and expected Git SHA inputs were absent; this did not prevent the
explicitly requested database-only read.

The SQL:

- required the expected project ref `eyaoahwzixqetjgfghsh` before connecting;
- set `default_transaction_read_only=on` in `PGOPTIONS`;
- opened `BEGIN TRANSACTION READ ONLY`;
- used bounded statement and lock timeouts;
- verified `public.recipes`, `public.recipe_shares`, migration `015`, and the
  three current structure columns;
- called existing immutable private validators only to classify JSON shape;
- grouped only by anonymous structural predicates; and
- rolled back after returning one aggregate JSON result.

No samples were emitted. The query deliberately did not hash or output row
identities because counts were sufficient.

### 3.2 Production results

| Structural category | Count | Interpretation |
| --- | ---: | --- |
| Total recipe rows | 296 | Point-in-time production population |
| Rows not deterministically convertible | 0 | No preflight blocker |
| Entirely empty recipe rows | 0 | Two recipes have no instructions, but they have ingredient content |
| Ingredient rows using current flat column | 296 | Every row |
| Separate grouped-ingredient column rows | 0 | Such a column does not exist |
| Ingredient rows with no nonempty `groupLabel` | 280 | One unlabeled target section per nonempty recipe |
| Ingredient rows with embedded labels | 16 | Convert by consecutive runs |
| All ingredient items labeled | 12 | No leading/trailing unlabeled run |
| Mixed labeled and unlabeled items | 4 | Preserve every ordered run, including unlabeled runs |
| Malformed ingredient top levels/items | 0 | None |
| Unexpected null ingredient items | 0 | None |
| Legacy string-only ingredient items | 0 | None |
| Invalid/null/blank `groupLabel` properties | 0 | None |
| Non-consecutive repeated ingredient labels | 0 | No production row exercises the highest-risk repeated-label case |
| Rows with repeated unlabeled runs | 1 | Preserve separate null-labeled runs around labeled runs |
| Total derived ingredient runs | 343 | 285 unlabeled, 58 labeled; maximum six runs in one recipe |
| Flat-only instruction rows | 201 | `instruction_groups` absent; convert flat once |
| Grouped-only instruction rows | 0 | None |
| Rows with both instruction forms | 93 | Current dual persistence |
| Both forms equivalent | 93 | All dual rows agree after ordered step normalization |
| Both forms conflicting | 0 | No conflict remediation needed |
| Rows with neither nonempty instruction form | 2 | Canonical `instructionSections: []` |
| Null `instruction_groups` rows | 203 | The 201 flat-only plus two empty rows |
| Empty/malformed `instruction_groups` rows | 0 / 0 | None |
| Null/blank flat instruction items | 0 / 0 | None |
| Empty instruction group objects | 0 | None |
| Repeated/consecutive/non-consecutive instruction labels | 0 / 0 / 0 | None |
| Legacy `Notes:` markers in flat instructions | 0 | Compatibility path has no production use |
| Legacy flat instruction section-label lines | 0 | Flat-only rows are ordinary step arrays |
| Nonempty/empty notes rows | 19 / 277 | All notes arrays valid; no blank entries |
| Share rows | 4 | Three accepted, one pending |
| Share snapshots with legacy ingredients/instructions | 4 / 4 | All require snapshot conversion |
| Share snapshots with instruction groups | 0 | No snapshot dual conflict |
| Legacy empty `{}` share snapshots | 0 | Its acceptance compatibility can be deleted |

### 3.3 Payload observations

These are serialization estimates, not runtime benchmarks:

- Recipe ingredient JSON text is approximately 177,844 bytes. Repeated
  `groupLabel` properties account for approximately 12,123 serialized text
  bytes. Actual JSONB on-disk compression/alignment differs.
- Flat recipe instructions occupy approximately 89,889 JSONB-equivalent bytes.
  `instruction_groups` occupy approximately 31,742 bytes.
- The removable flat copies on the 93 grouped rows account for approximately
  30,010 bytes before protocol and cache overhead.
- Existing share snapshots contain approximately 4,693 bytes of flat
  instructions and no grouped instruction payload. Future snapshots would
  otherwise duplicate grouped content.

The migration value is reliability and reduced ambiguity, not a claim of
meaningful query latency improvement for 296 rows.

### 3.4 Blocking anomalies and uncertainty

There are no structural data blockers at this snapshot. The result does not
prove that production cannot change before implementation. The same preflight
must run under the cutover write pause immediately before migration, and the
migration must repeat the fail-closed invariants inside its transaction.

Two uncertainties remain by definition:

1. Adjacent same-label ingredient section boundaries were never persisted and
   cannot be reconstructed. The converter can preserve only maximal
   consecutive runs. This is not a preflight defect.
2. The database preflight verified project/ledger identity but not the deployed
   application SHA because the release URL/SHA inputs were unavailable. The
   implementation rollout must bind its own exact commit and deployment using
   the repository release workflow.

## 4. Canonical contract

### 4.1 TypeScript shape

```ts
export type CanonicalIngredient = Omit<Ingredient, "groupLabel">

export type IngredientSection = {
  label: string | null
  ingredients: CanonicalIngredient[]
}

export type InstructionSection = {
  label: string | null
  steps: string[]
}

export type RecipeStructure = {
  ingredientSections: IngredientSection[]
  instructionSections: InstructionSection[]
}

export type RecipeContent = RecipeStructure & {
  notes: string[]
}
```

`Recipe`, create input, update input, parser output, URL-import output, share
snapshot, dialog state, and detail props all compose the same
`RecipeStructure`. Database rows remain snake_case at the persistence seam;
`mapRecipeRow()` maps them once to camelCase. Do not retain app-facing
`ingredients`, `instructions`, or `instruction_groups` aliases.

### 4.2 Database shape

```sql
ingredient_sections jsonb not null default '[]'::jsonb,
instruction_sections jsonb not null default '[]'::jsonb
```

The migration adds two exact immutable validation functions in `private` and
uses them in `CHECK` constraints and the share-snapshot validator:

```text
private.recipe_ingredient_sections_are_valid(jsonb)
private.recipe_instruction_sections_are_valid(jsonb)
```

The validators are narrow schema validators, not a general JSON framework.
They enforce:

- top-level array;
- no more than 500 sections;
- every section is an object with exactly `label` plus
  `ingredients` or `steps`;
- `label` is JSON `null` or a trimmed nonempty string of at most 128
  characters;
- no empty sections;
- at most 500 total ingredients or 2,000 total steps;
- every step is a trimmed nonempty string of at most 10,000 characters; and
- every ingredient passes the existing quantity/package/ingredient validator
  and has no `groupLabel` property.

`recipes.notes JSONB NOT NULL DEFAULT '[]'` remains unchanged. This task does
not combine notes into a generic structure object.

### 4.3 Invariants and exact choices

| Question | Contract |
| --- | --- |
| Section IDs | None. No current feature references a section independently across persistence boundaries. UI keys may use transient indexes during editing. |
| Ordering | Array order only: section order, then ingredient/step order. No `position` field. |
| Labels | Always present as `string | null`; strings are trimmed, nonempty, case-preserving, and at most 128 characters. Empty string is invalid persisted state. |
| Ungrouped recipe | One nonempty section with `label: null`. |
| No ingredients/instructions | The corresponding top-level array is `[]`. Current product validation may still require an ingredient for manual save. |
| Blank sections | Allowed only as transient editor scaffolding; removed before validation. Never persisted. |
| Duplicate labels | Allowed. Labels are display text, not identity. |
| Consecutive equal labels | Preserved as separate sections when an explicit sectioned source encoded them. Legacy flat ingredient rows cannot prove that boundary and become one maximal run. |
| Ingredient `groupLabel` | Removed from `CanonicalIngredient`, persistence, validation, sharing, and export extension. |
| Ingredient identity | Unchanged: ingredients still have no persisted ID. Shopping's recipe/global-ordinal source key uses the canonical flattened order. |
| Instruction identity | Steps remain plain strings; no IDs or rich-text document model. |
| Null items | Invalid. The migration fails closed rather than dropping them. |
| Malformed legacy values | Invalid top levels, objects, labels, ingredients, steps, or notes abort the migration. No partial row conversion. |
| Notes | Separate `string[]`; explicit nonempty notes win, with one-time legacy-tail extraction only when the explicit array is empty. |

## 5. Conversion specification

### 5.1 Precedence algorithm

For each recipe row, the converter is pure and returns either one complete
`RecipeContent` or a typed conversion error. It never returns partially
converted content.

1. Validate the current top-level fields and every nested item. Bounded legacy
   string ingredients may be adapted using the existing hydration rule; null or
   malformed items fail.
2. Normalize explicit notes. If the explicit notes array is valid and nonempty,
   use it. If it is valid and empty, extract the one-time legacy `Notes:` tail
   from flat instructions. A malformed notes value fails.
3. Build ingredient sections from maximal consecutive runs of the trimmed
   `groupLabel` value (`null` for absent/blank legacy labels). Strip
   `groupLabel` from each copied ingredient. Never group globally by label.
4. If valid `instruction_groups` contains at least one nonempty group, it is
   authoritative. Normalize it one-for-one, preserving duplicate and
   consecutive equal labels. Otherwise parse flat instructions once using the
   current section-label heuristic after removing the legacy notes tail.
5. Record structural classification and any precedence decision in aggregate
   output. Do not emit content or identifiers.

Grouped instructions win a valid flat/group conflict because the current
editor, detail, and export paths already prefer them. This is an explicit
product-behavior precedence, not a convenience choice. Production currently
has zero conflicts. A malformed non-null grouped form does not fall back; it
fails closed.

### 5.2 Deterministic rule table

| Current state | Canonical result | Failure / evidence rule |
| --- | --- | --- |
| 1. Flat-only ingredients with no labels | One `label: null` section preserving item order | Empty array becomes `[]` |
| 2. Grouped-only ingredients | Not representable in the current database. At parser/import boundaries, copy each explicit group one-for-one and strip item-level labels | No migration-row category exists; preflight reports zero/N/A |
| 3. Flat and grouped ingredients both present and equivalent | Not representable in the current database. A temporary boundary adapter may accept both only when normalized section flattening equals the flat array | Delete the flat derivative at that boundary |
| 4. Flat and grouped ingredients conflict | Reject the boundary input; neither source silently wins | No persisted production category exists |
| 5. Ingredient rows with `groupLabel` | Partition by maximal consecutive trimmed-label runs; copy each run to one section; remove `groupLabel` | Invalid label types/lengths fail; production has zero |
| 6. Repeated non-consecutive ingredient labels | Preserve each run as a separate section in original order | Never use a global label map; production has zero but fixtures are required |
| 7. Consecutive equal ingredient labels | Current flat rows become one maximal run because no boundary exists. Explicit sectioned parser/import input preserves separate sections | Document as irrecoverable legacy ambiguity |
| 8. Missing/null ingredient arrays | SQL NULL is impossible today. JSON null/non-array fails closed. The explicitly supported empty recipe is `[]` | Do not reinterpret malformed JSON null as empty |
| 9. Empty recipe content | `ingredientSections: []`, `instructionSections: []`, `notes: []` as applicable | Valid even if the create UI normally requires ingredients |
| 10. Flat-only instructions | Remove a legacy notes tail, parse recognized section-label lines once, preserve order, and create one or more sections | Null/non-string items fail; blank legacy strings are dropped deterministically |
| 11. Grouped-only instructions | Copy each valid nonempty group one-for-one; missing label becomes `null` | Preserve duplicate and consecutive equal labels |
| 12. Both instruction forms equivalent | Use normalized grouped sections; discard flat copy | Production: 93 rows |
| 13. Both instruction forms inconsistent | Use valid nonempty grouped sections; record a conflict count and require it to match the reviewed preflight expectation | Production: zero. Any new conflict before cutover is ACTION REQUIRED for review, even though precedence is defined |
| 14. Malformed section objects | Fail the entire migration transaction | No fallback from malformed non-null grouped data; production: zero |
| 15. Unexpected null items | Fail the entire migration transaction | Never drop an ingredient or step silently; production: zero |
| 16. Missing/null/empty grouped instructions | If absent, JSON null, or normalized empty, use valid flat instructions; if both are empty, use `[]` | Production: 203 absent, zero JSON null/empty arrays |
| 17. Repeated instruction labels | Preserve every group object in order, including consecutive equal labels | Production: zero; fixtures required |
| 18. Legacy `Notes:` tail | Only when explicit notes normalize to empty, move the tail into notes and remove it from fallback flat instructions | Production: zero; keep fixture coverage until migration completes |
| 19. Empty/blank legacy groups or steps | Trim strings, drop blank steps, then omit a section with no remaining content | Count and report; production has zero empty groups/blank steps |
| 20. Historical imports with unusual grouping | Preserve explicit parser section order. For persisted ingredients, preserve consecutive runs including repeated unlabeled runs | The one production row with repeated unlabeled runs remains distinct around intervening labels |

Share snapshot conversion uses the same rules. All four production snapshots
have flat legacy ingredients/instructions, none has grouped instructions, and
none is `{}`. Convert all four in place; this includes the one pending snapshot
that can still be accepted. Snapshot identity, sender/recipient ownership,
message, status, timestamps, and accepted/source recipe UUIDs remain unchanged.

## 6. Boundary derivations

| Boundary / feature | Target behavior | Compatibility retained |
| --- | --- | --- |
| Manual create/edit | Form state owns `ingredientSections` and `instructionSections`. New drafts start with one null-labeled section containing one blank row/step. Submit trims, removes blank rows/sections, validates, and writes sections once. Section and item/step reordering are array operations. | Blank scaffolding exists only in form state |
| Paste/Markdown import | `ParsedRecipe` emits canonical sections only. Repeated headings remain separate. Notes stay separate. | Input syntax remains permissive; no flat parser DTO |
| URL import | `ExtractedRecipe` emits canonical sections. Flat `recipeIngredient` becomes one null-labeled ingredient section. `HowToSection.name` becomes the instruction label; flat `HowToStep[]` becomes one null-labeled section. | Standard Schema.org input remains supported |
| Recipe Genie export import | Introduce extension `version: 2` containing canonical ingredient and instruction sections plus existing structured quantity/yield fields. Continue accepting version 1 at this external import boundary and convert its flat ingredients by consecutive `groupLabel` runs. | Read-only v1 import adapter; no v1 fields in persistence or v2 output |
| JSON-LD export | Derive flat `recipeIngredient` strings in canonical order. Emit one `HowToSection` per labeled/multiple instruction section; a single unlabeled section may emit ordinary `HowToStep[]`. | Standard Schema.org fields are boundary derivations, not internal authority |
| Text/Markdown/clipboard | No active recipe export or copy contract exists. If added later, derive from sections and preserve headings where the format supports them. | None today |
| Sharing | `RecipeShareSnapshot` carries canonical arrays once. `accept_recipe_share()` validates and copies them once while allocating a new recipient-owned recipe UUID. | Copy-on-accept identity/ownership behavior is unchanged |
| Detail/print | Render section arrays directly. No regrouping or precedence helper. | Visual numbering can remain global across instruction sections |
| Serving scaling | Validate and format ingredients within their sections; scaling changes quantity display only and never section structure. | All exact/range/package metadata stays unchanged |
| Ingredient resolution | Flatten ingredients once in canonical section/item order immediately before ingredient-level exclusion and purchase normalization. Ignore section labels for identity/matching. | Existing matcher and quantity behavior remain ingredient-level |
| Shopping | `generateShoppingList()` receives the one flattened boundary array or performs the one `flatMap`. Preserve the global ingredient ordinal used in structured-source keys. | Shopping does not store or display recipe section labels |
| Planner/history/templates | Keep UUID references and existing metadata. Summary queries should not request content; full recipe consumers receive canonical sections. | No reference identity changes |
| Internal APIs | Import/share routes use canonical DTOs. There is no public recipe CRUD API contract to preserve. | External Schema.org and v1 import are the only structure compatibility seams |

## 7. Migration and rollback

### 7.1 Step 1: preflight and converter

- Add the canonical types, strict pure validator, deterministic legacy
  converter, and the two boundary flatteners.
- Add exhaustive fixtures for every row in the rule table, including distinct
  consecutive equal sections and the legacy flat ingredient limitation.
- Check in the count-only production preflight under `supabase/verification/`.
- Validate it against synthetic fixtures and rerun it read-only against
  production.
- Do not add columns and do not wire runtime reads/writes.

Exit gate: converter fixtures pass; production counts match or are explicitly
reviewed; `rows_cannot_convert_without_remediation = 0`; instruction conflicts
remain at the reviewed count of zero.

### 7.2 Step 2: atomic cutover

This is Tier 3 and requires separate implementation/production authorization.

Under a controlled write pause:

1. Bind the exact Git SHA, production project ref, deployed release, active
   migration ledger, and authorized target.
2. Obtain recovery evidence through the repository's then-current production
   backup/restore runbook. Do not invent a new backup command for this feature.
3. Rerun the count-only preflight and require the reviewed invariants.
4. Add the two canonical columns and private validators/check constraints.
5. Backfill all recipe rows and all share snapshots inside one transaction.
6. Assert row counts, ordered ingredient/step counts, note counts, UUIDs,
   owners, references, and canonical validation before commit.
7. Replace the share validator and `accept_recipe_share()` with the canonical
   snapshot contract.
8. Deploy the application that reads and writes canonical sections only.
9. End the write pause only after focused persistence, sharing, Shopping, and
   version/ledger verification succeeds.

The migration preserves recipe row IDs/UUIDs, ownership, names, categories,
servings/yield, favorites, tags, times, notes, images, timestamps, history,
planner/template UUID references, Shopping contributions, and share identity.
Only recipe structure columns and snapshot structure change.

Old columns may remain for one short observation window, but they are frozen
rollback evidence. No deployed application, trigger, RPC, or job may read or
write them. Do not add dual-write triggers, fallback reads, lazy conversion,
per-row flags, or background work.

### 7.3 Step 3: cleanup

Drop `recipes.ingredients`, `recipes.instructions`, and
`recipes.instruction_groups`; remove `groupLabel` from ingredient validators and
types; remove the three legacy share snapshot fields; remove one-time
conversion code, note/label fallbacks, and dual-model tests; regenerate database
types; and update canonical documentation.

The exact deletion gate is:

- the deployed exact SHA is the section-only application;
- production migration and project identity match;
- repository-wide call-site search finds no legacy column/property reader or
  writer outside the migration/history artifact;
- create, edit, replacement, Markdown import, URL import, share/accept,
  export, scaling, ingredient resolution, and Shopping focused tests pass;
- a production read-only audit proves all canonical rows/snapshots validate and
  semantic counts match the cutover evidence; and
- no unresolved release warning indicates writes from an older application.

### 7.4 Failure and recovery behavior

- Preflight anomaly: stop before migration. Report aggregate category counts;
  remediate through a separately reviewed, row-specific plan. Do not weaken the
  converter.
- Conversion anomaly inside migration: raise and roll back the entire
  transaction. No partial row or share conversion is allowed.
- Application verification failure before writes resume: keep the write pause,
  correct or roll back the release, and restore schema/data only through the
  authorized recovery plan.
- Defect after canonical writes resume: prefer a forward repair. The frozen old
  columns are not a valid automatic rollback source because they no longer
  receive writes. Content corruption requires the reviewed backup/restore path
  or a separately authorized reverse conversion from canonical data.
- Cleanup failure: roll back the cleanup transaction; the section-only app
  remains valid because it has no dependency on the legacy columns.

Required pre-migration evidence is the exact code/migration hashes, explicit
project/endpoint identity, aligned ledger, count-only structural report,
verified recovery point and restore evidence required by repository policy,
and a clean implementation worktree. Generated evidence containing recipe
content must not be committed.

## 8. Implementation slices

### Slice A — canonical contract, converter, and read-only preflight

**Entry state:** current dual instruction persistence and indirect ingredient
labels; no canonical columns.

**Scope:** add exact types/invariants, pure conversion/flattening functions,
fixture matrix, and count-only SQL preflight. No runtime wiring.

**Files and ownership boundaries:**

- `web/src/types/database.ts`: add `CanonicalIngredient`,
  `IngredientSection`, `InstructionSection`, and `RecipeStructure`; do not yet
  remove legacy `Recipe` fields.
- `web/src/lib/recipe-structure.ts`: add the pure strict validator,
  `convertLegacyRecipeStructure()`, `flattenRecipeIngredients()`, and
  `flattenRecipeInstructions()`. Keep database/network concerns out.
- `web/src/lib/__tests__/recipe-structure.test.ts`: add the full conversion
  table, repeated-label, empty, malformed, null-item, conflict, and count/order
  assertions.
- `supabase/verification/canonical_recipe_structure_preflight.sql`: add the
  exact count-only, read-only classifier with no samples/content.
- `docs/canonical-recipe-structure-design.md`: update only if fixture evidence
  changes a decision.

**Schema impact:** none.

**Expected deletions:** none yet; this slice proves the deletion path.

**Main risk:** converter rules drifting from the later SQL backfill. Mitigate
with the same named fixture categories and expected aggregate counts.

**Focused verification:** canonical validator tests, every conversion category,
consecutive-run preservation, repeated labels, malformed/null rejection,
synthetic SQL classifications, and a fresh read-only production count.

**Exit state:** runtime remains legacy; a complete deterministic converter and
preflight exist; no temporary reads/writes or flags exist.

### Slice B — canonical schema and section-only runtime cutover

**Entry state:** Slice A is green; production preflight has zero blockers;
runtime is still legacy.

**Scope:** one coordinated migration/release switches every active flow and
share snapshot to canonical sections.

**Files and ownership boundaries:**

- generated migration under `supabase/migrations/`: columns, validators,
  fail-closed backfill, snapshot conversion, acceptance RPC replacement, and
  postconditions;
- `web/src/types/database.generated.ts` and `web/src/types/database.ts`:
  canonical row/app types;
- `web/src/lib/recipe-identity.ts`, `web/src/hooks/use-recipes.ts`: one
  database/app mapping seam and section-only payloads;
- `recipe-parser.ts`, `recipe-url-parser.ts`, `use-recipe-import.ts`, import API:
  canonical parser/import DTOs;
- `recipe-dialog.defaults.ts`, `recipe-dialog.tsx`,
  `recipe-dialog-components.tsx`, `recipe-sortable-ingredients.tsx`:
  section-owned form state, labels, ordering, and submit;
- `recipe-detail-page.tsx`, `recipe-export.ts`, `recipe-sharing.ts`, share API:
  direct rendering, boundary export, and canonical snapshots;
- `shopping-list.ts` and contribution route: one ingredient flattening
  boundary;
- focused unit, hook, browser, and pgTAP files named in Sections 2.4 and 9.

**Schema impact:** add/backfill/check two columns and convert share snapshots;
legacy recipe columns remain physically present but inactive.

**Expected deletions:** parser dual outputs; application dual writes;
`getRecipeIngredientGroups()`, `getRecipeInstructionGroups()`,
`buildInstructionEditorGroups()`, `getFlatRecipeInstructions()` as an internal
fallback, and active legacy notes/label parsing.

**Main risk:** rolling-version writes and share acceptance during cutover. Use
the write pause and one release; do not add sync machinery.

**Focused verification:** migration fixtures and postconditions; manual
create/edit/reopen; Markdown/plain-text/URL import; replacement; share/accept;
JSON-LD v1 import/v2 export; detail/print; scaling; ingredient resolution;
Shopping; round-trip persistence; planner/history reference preservation.

**Exit state:** application and SQL acceptance read/write only canonical
sections. Legacy columns exist solely for short-lived comparison. Temporary
compatibility remains only at the external v1 JSON-LD import boundary.

### Slice C — physical cleanup

**Entry state:** exact deployed Slice B release passes the deletion gate.

**Scope:** drop legacy recipe/share fields and remove every one-time converter,
validator branch, fixture expectation, and document statement that describes
the dual model.

**Schema impact:** drop three recipe columns and legacy keys from accepted share
snapshots/validators; regenerate types.

**Expected deletions:** all permanent dual-read/write/fallback code, migration
converter code outside immutable SQL history, legacy `{}` share acceptance,
`groupLabel`, and dual-model tests.

**Main risk:** missed external or SQL reader. The repository-wide call-site and
catalog audit is the hard gate.

**Focused verification:** generated type parity, catalog/call-site audit,
canonical round trips, full focused recipe/import/share/Shopping suite, and
read-only production canonical validation.

**Exit state:** two canonical structure columns, one app-facing section model,
one external v1 import adapter, and pure boundary flatteners only. No internal
temporary compatibility remains.

## 9. Decision table

| Decision | Recommendation | Reason | Risk | Verification |
| --- | --- | --- | --- | --- |
| Canonical model | Ordered ingredient and instruction section arrays | Matches editor/import fidelity and removes dual authority | Broad coordinated cutover | Round-trip and migration fixtures |
| Database layout | Two JSONB columns, notes retained separately | Smallest schema matching actual domains | JSON shape enforcement | Private validators + CHECK constraints |
| Single structure JSON document | Reject | Adds nesting/versioning without a consumer need | New generalized document model | N/A |
| Section IDs | Reject | No cross-boundary section identity requirement | Index keys change during reorder, which is acceptable | UI reorder tests |
| Order fields | Reject | Array order is already durable and sufficient | Accidental sorting | Exact order fixtures |
| Labels | Explicit `string | null`; trim, case-preserve | Removes missing/empty ambiguity | Legacy blank labels | Converter normalization and constraints |
| Blank persisted sections | Reject | They carry no recipe content and complicate every consumer | Label-only historical group | Preflight count + fail/normalization fixture |
| Duplicate labels | Allow and preserve | Labels are display text, not identity | Consumers may globally merge | Repeated/consecutive-label tests |
| Ingredient `groupLabel` | Remove | Section owns label once | Migration boundary ambiguity | Consecutive-run fixtures |
| Adjacent same-label legacy ingredients | One maximal run | No stored boundary exists | Cannot recover original intent | Explicit limitation in audit/result |
| Instruction conflict | Valid nonempty groups win, conflict count reviewed | Matches current editor/detail/export precedence | Hidden flat-only content | Preflight + conflict fixture + audit count |
| Malformed non-null grouped data | Fail closed | Fallback could discard evidence | Blocks migration if new anomaly appears | Migration rollback fixture |
| Empty recipes | Represent with `[]` | Exact, non-null, no fake blank section | Some UI requires an ingredient | DB/app validation separation tests |
| Ingredient/step IDs | Reject | No demonstrated need; identity semantics remain unchanged | Future fine-grained collaboration would require redesign | Current feature inventory |
| Instruction representation | Plain strings | No rich-text requirement | Formatting remains plain | Import/export/detail tests |
| Shopping boundary | One ordered ingredient flattening | Shopping is ingredient-level and needs no section labels | Global ordinal drift | Flatten-order and Shopping source-key tests |
| Export compatibility | Standard Schema.org derivation plus v2 Recipe Genie envelope; read v1 only | Preserves real external compatibility without internal dual persistence | Old third-party v1 writers | v1 import/v2 round-trip tests |
| Cutover topology | Write pause, atomic backfill, section-only release | Avoids old/new writer disagreement simply | Requires operational coordination | Exact-SHA/ledger/release checks |
| Cleanup timing | Second immediate PR after verification | Keeps comparison evidence without permanent compatibility | Frozen old columns become stale after writes | Hard deletion gate |
| Rollback | Fail before commit; forward repair after writes; backup restore for corruption | Old columns are not kept synchronized | Recovery evidence may be unavailable | Authorized backup/restore gate |

## Exact recommended first implementation slice

Implement **Slice A — canonical contract, converter, and read-only preflight**
only. Start from the latest `origin/main` in an isolated
`codex/canonical-recipe-structure-converter` worktree. Do not modify runtime
recipe reads/writes, schema, migrations, generated database types, or
production data.

1. In `web/src/types/database.ts`, add exactly
   `CanonicalIngredient = Omit<Ingredient, "groupLabel">`,
   `IngredientSection`, `InstructionSection`, and `RecipeStructure` with
   required nullable labels and ordered arrays. Do not change `Recipe` yet.
2. In `web/src/lib/recipe-structure.ts`, add pure
   `validateRecipeStructure()`, `convertLegacyRecipeStructure()`,
   `flattenRecipeIngredients()`, and `flattenRecipeInstructions()` implementing
   Section 5 exactly. The converter must return a typed error for malformed
   top levels, malformed section objects, null items, invalid ingredient
   metadata, or malformed notes; it must never silently drop a nonblank item.
3. In `web/src/lib/__tests__/recipe-structure.test.ts`, add table-driven fixtures
   for every numbered row in Section 5.2. Explicitly prove maximal consecutive
   ingredient runs, non-consecutive repeated labels, explicit consecutive equal
   sections, grouped/flat instruction equivalence and conflict precedence,
   empty content, legacy `Notes:` extraction, blank-section normalization, and
   fail-closed malformed/null behavior. Assert ingredient, step, note, and
   section order/counts.
4. Add `supabase/verification/canonical_recipe_structure_preflight.sql`. It must
   open a read-only transaction, emit one aggregate JSON value, reproduce every
   Section 3 category, include recipe/share counts and serialized-byte
   estimates, emit no row samples or content, and roll back. Validate it against
   synthetic fixtures before any authorized production read.
5. Run the focused TypeScript tests and SQL fixture validation, then rerun the
   production preflight read-only. Require 296 total recipe rows, zero
   non-deterministically convertible rows, 93 equivalent dual instruction rows,
   zero instruction conflicts, zero malformed/null items, four convertible
   share snapshots, and no newly introduced category. If counts changed, stop
   and report aggregate differences rather than weakening expectations.
6. Update this design only if implementation evidence changes a decision. End
   with no runtime wiring, no dual writes, no fallback reads, no schema change,
   no migration, no production write, and a clean committed/pushed design
   branch ready for the separately authorized atomic cutover.
