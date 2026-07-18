# Recipe workflow reliability map

This document records the focused workflow map used by the version-1 recipe
regression corpus. It is intentionally narrower than the project architecture
documents.

## Authoritative workflow and ownership

| Transition | Authoritative owner | Supporting boundary |
|---|---|---|
| Paste and parse | `web/src/lib/recipe-parser.ts` | `recipe-import.parser.ts` applies local results to the dialog. URL import uses `use-recipe-import.ts` and the server-only `api/recipe-import` route. Neither path uses an external model. |
| Ingredient structure | `recipe-parser.ts` for pasted text | `ingredient-units.ts` owns whole/count aliases. Persisted ingredients retain `originalText`; shopping purchase normalization is separate. |
| Recipe save/edit | `web/src/hooks/use-recipes.ts` | `recipe-dialog.tsx` owns form sequencing and `use-async-submit.ts` suppresses concurrent duplicate submissions. Recipe identity is a client-generated UUID reused across retries. |
| Serving changes | Recipe `servings` persistence in `use-recipes.ts` | Shopping scaling is an explicit contribution-command `scale`; changing the recipe's serving label alone does not infer new ingredient quantities. |
| Meal-plan selection | `web/src/hooks/use-planner.ts` | `lib/meal-planner.ts` is the pure selection algorithm; `weekly_plans` is the durable database owner. |
| Shopping contribution creation/replacement | `api/shopping/recipe-contributions/route.ts` plus `apply_recipe_shopping_contribution_uuid_command` | `generateShoppingList()` creates normalized per-recipe snapshots; `projectShoppingContributions()` is the sole pure reconciliation owner. Hooks only submit commands and install the returned authoritative list. |
| Ingredient purchase normalization | `shopping-list-normalization.ts` | `shopping-list.ts` aggregates and `shopping-list-merging.ts` merges compatible units. This is intentionally downstream of recipe parsing. |
| Pantry/exclusion lifecycle | `use-pantry.ts`, `use-pantry-excluded-keywords.ts`, and `hooks/shopping/use-shopping-pantry.ts` | `move_shopping_item_to_pantry` is the atomic cross-table owner. Shopping restores are row-ID based and contribution overrides preserve bucket choices across replacement. |
| Recipe deletion | `delete_recipe(uuid)` with `lib/recipe-deletion.ts` compatibility handling | `useDeleteRecipe()` owns optimistic cache behavior. The database function removes planner/template/shopping references and the authoritative contribution before deleting the recipe. |

The normalization boundary is unambiguous: recipe parsing creates structured
ingredients; shopping normalization converts those ingredients into purchase
forms. Contribution reconciliation is likewise centralized in
`projectShoppingContributions()` and the UUID command RPC. UI components do not
own either behavior.

## Coverage state

- Parser, normalization, unit conversion, list aggregation, merging, and
  contribution projection have fast Vitest suites.
- Recipe create retry/UUID reconciliation, update normalization, deletion
  compatibility, duplicate-submit suppression, pantry movement, exclusion
  restoration, and contribution-hook cache behavior have hook tests.
- Contribution command revision retry has an API-route integration test.
- UUID authorization, idempotent replay, stale-revision rejection, reference
  integrity, and deletion cleanup have pgTAP coverage under `supabase/tests/`.
- Playwright covers paste/import/save, recipe CRUD, plan selection, plan-to-list
  contribution, duplicate row identity, pantry/exclusion restore, active
  contribution deletion, and the edit/re-add/delete lifecycle.

## Risk-ranked gaps

1. **High — pasted-recipe drift:** previously there was no broad, versioned
   corpus connecting parser output to shopping normalization. Version 1 adds 24
   reviewed fixtures and snapshots.
2. **High — stale contribution after recipe edits:** reconciliation supported
   replacement, but ingredient edit/deletion transitions were not named
   regressions. Unit and Playwright coverage now assert removal of stale rows and
   absence of duplicates.
3. **Medium — save interruption:** duplicate clicks and lost-success retries are
   deterministic hook tests. A literal browser/process termination in the
   middle of a network write remains environment-dependent and is not simulated
   by the local unit suite.
4. **Medium — range semantics:** the recipe schema has one numeric amount and a
   unit string, so ranges are preserved in the unit text while the numeric amount
   is the lower bound. This is deterministic but limits arithmetic and can be
   awkward when combined with other contributions.
5. **Medium — unheaded free-form text:** short, unnumbered instruction lines are
   inherently ambiguous to the rule-based legacy parser and may be classified as
   ingredients. The corpus exposes the current behavior; a confidence/review UX
   would be safer than increasingly broad heuristics.
6. **Low — live URL variability:** URL extraction is deterministic for a fixed
   HTML document, but remote markup, bot protection, and availability cannot be
   guaranteed by a repository fixture.

## Fixture corpus

`web/src/lib/__tests__/fixtures/recipe-workflow.v1.ts` contains 24 realistic
pastes covering Unicode and ASCII fractions, ranges, mixed and missing units,
optional ingredients, garnishes, alternatives, multiple components, duplicates,
instruction-only mentions, preparation notes, malformed spacing, copied text,
serving-count variants, BOM/CRLF input, metadata, and citrus purchase
normalization.

The reviewed snapshot beside `recipe-workflow-fixtures.test.ts` is the explicit
expected contract for title, servings, structured ingredients, instructions,
metadata, warnings, and normalized shopping buckets. Recipe Genie currently has
no model-dependent paste parser. If one is introduced later, its raw quality
evaluation must be kept separate from these deterministic post-processing and
persistence contracts.
