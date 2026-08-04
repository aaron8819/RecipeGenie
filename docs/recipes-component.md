# Recipes Domain Reference

Use this doc when working on recipe CRUD, recipe detail, the recipe form
dialog, text or URL import, recipe images, tags/categories, or recipe sharing.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Current State

- The recipe dialog presentation extraction wave is complete.
- `recipe-dialog.tsx` still owns form/dialog orchestration, import parsing flow, and submit sequencing.
- `recipe-list.tsx` still owns recipe browsing orchestration, including
  search/filter state and mobile-vs-desktop toolbar structure.
- Recipe persistence uses ordered `ingredient_sections` and
  `instruction_sections` as its only structure authority. Times, notes, and
  authored yield metadata remain separate first-class fields.
- Section and item order are authoritative. Labels are `string | null`, may
  repeat, and are never encoded on canonical ingredient objects.
- The physical `ingredients`, `instructions`, and `instruction_groups` columns
  are frozen migration evidence. Runtime code neither reads nor writes them,
  and there is no synchronization trigger or dual-write path.
- `/recipes/[id]` is the canonical, query-backed full-page detail route.
  Recipes, Planner, and Shopping all navigate to the same detail component.
- Recipe detail is action-complete for common follow-up actions:
  - favorite toggle
  - add to plan
  - add to shopping
  - mark made
  - share/edit/delete
  - serving adjustment and print
- Yield adjustment scales displayed quantities locally with exact rational
  arithmetic and never mutates the stored recipe. The selected yield is also
  used when adding that recipe to Shopping. Recipe detail does not have an
  ingredient checklist or completion state.
- The recipe image storage boundary is now explicit:
  - `getRecipeImageUrl()` is a pure helper.
  - Upload/delete behavior goes through `useRecipeImageStorage()`.

## Key Files

| File | Responsibility |
|------|----------------|
| `web/src/app/(authenticated)/recipes/[id]/page.tsx` | Canonical recipe-detail route. |
| `web/src/components/recipes/recipe-list.tsx` | Main recipe browsing, filtering, and sorting orchestration. |
| `web/src/components/recipes/recipe-dialog.tsx` | Main create/edit orchestration for manual entry and imports. |
| `web/src/components/recipes/recipe-dialog-components.tsx` | Presentation-only recipe dialog sections extracted from the main dialog. |
| `web/src/components/recipes/recipe-detail-page.tsx` | Shared responsive detail experience, query states, and follow-up actions. |
| `web/src/lib/recipe-detail-navigation.ts` | Safe canonical-route and history-return helpers. |
| `web/src/components/recipes/share-recipe-dialog.tsx` | Share a recipe with another user. |
| `web/src/components/recipes/shared-recipes-inbox.tsx` | Inbox and sent-share status views. |
| `web/src/hooks/use-recipes.ts` | Recipe CRUD, categories, and tag operations. |
| `web/src/hooks/use-recipe-import.ts` | URL import state management and server round-trip coordination. |
| `web/src/hooks/use-recipe-shares.ts` | Share lifecycle data access and mutations. |
| `web/src/hooks/use-recipe-image-storage.ts` | Upload/delete boundary for Supabase-backed recipe image storage. |
| `web/src/lib/recipe-parser.ts` | Plain-text recipe parsing. |
| `web/src/lib/recipe-quantity.ts` | Canonical exact quantity/yield parsing, legacy adaptation, scaling, and display formatting. |
| `web/src/lib/recipe-structure.ts` | Canonical structure validation, one-time legacy conversion, editor-boundary conversion, and ordered flattening for external consumers. |
| `web/src/lib/recipe-url-parser.ts` | Server-side URL fetch and recipe extraction. |
| `web/src/lib/supabase/storage.ts` | Storage helpers including pure `getRecipeImageUrl()`. |

## Boundaries

- Components must not call Supabase directly.
- Hooks own recipe reads, writes, and mutations.
- Parser/export/storage helper modules stay free of React concerns.
- Components and selectors may call `getRecipeImageUrl()` because it is a pure URL helper.
- Components should not start calling storage upload/delete functions directly.

## Important Behaviors

### Tag filtering

- OR-style multi-tag filtering is pushed to the database through the `filter_recipes_by_tags` RPC.
- Additional category/search/favorites filtering may still be applied after the RPC result returns.

### Recipe browsing UX

- Recipe search currently matches recipe `name` and `category`.
- Mobile recipes browsing intentionally separates primary browse controls from utility actions so `Shared` and `Settings` remain visible without horizontal scrolling.

### Recipe detail navigation

- Recipe detail always uses `/recipes/[id]`; do not add source-specific detail
  components or intercepting modal routes.
- Cross-feature links may include only the bounded `from=recipes|planner|shopping`
  source hint. Known sources return through browser history with an accurate
  label; direct, shared, missing, or invalid sources replace to `/recipes`.
- Search, category, tags, favorites, sort, and view mode are canonical query
  parameters on `/recipes`. Parser helpers validate values and fall back safely;
  interactions update the URL so Back, Forward, refresh, and copied links work.
- Recipe navigation does not depend on local storage, session storage, cookies,
  opaque origin tokens, or a remembered active screen.
- Mobile Ingredients, Instructions, and Notes controls are anchor navigation.
  All sections remain in normal document flow.

### Recipe images

- Upload and delete flows belong behind `useRecipeImageStorage()`.
- Rendering an image URL is safe through `getRecipeImageUrl()`.
- Treat storage writes as a hook-owned concern, not a component concern.

### Imports

- Text parsing is local and deterministic.
- Text parsing accepts the existing plain-text formats plus conventional,
  section-aware Markdown. Markdown title markers are removed; category,
  servings, and recipe times are read from the preamble; ingredients,
  instructions, and notes headings are case-insensitive at any heading level;
  and nested ingredient headings become group labels.
- Imported categories are normalized to the existing category model for new
  recipes with a case-insensitive match; unknown categories retain the new
  recipe form's existing fallback. Paste-to-replace continues to preserve the
  current recipe category.
  Markdown ingredient and instruction groups become canonical sections;
  Markdown notes use the separate first-class notes array.
- Imported and manually entered quantities preserve an additive `quantityV1`
  exact/range/qualitative representation, authored unit, and fixed-package
  metadata alongside the legacy amount/unit fields. Existing rows are adapted
  at read time; there is no ingredient JSON rewrite migration.
- Authored yields such as `4 servings`, `4–5 servings`, `12 cookies`, and
  `about 1 loaf` are preserved in nullable `yield_metadata`. The legacy integer
  `servings` column remains the compatibility scaling basis.
- URL import remains server-side because it needs SSRF protection, rate limiting, and HTML/JSON-LD extraction.
- Below the desktop breakpoint, pasted-text import uses a compact input phase followed by a full-height sectioned review inside the same create dialog. The raw source, latest parsed candidate, and canonical editable draft have separate ownership; returning to the source preserves draft corrections, and applying changed source requires confirmation when the draft was corrected.
- Mobile import review reuses the Details, Ingredients, and Instructions section bodies with a sticky Back/Save footer. Desktop keeps the two-column paste preview and stacked create form.
- Entered text or URL source, a parsed candidate, and an applied or corrected draft all count as unsaved import work. Dismissal uses the shared discard confirmation, and keeping work preserves the active phase, section, values, and focus target.
- Import apply/save/reopen parity preserves canonical section boundaries,
  structured recipe times, and notes directly.
- Edit mode has a paste-to-replace flow that reuses the text parser and applies parsed fields to the current recipe draft. It preserves the recipe id, category, tags, and image; replaces name/servings/times when parsed; replaces ingredients only when at least one ingredient is parsed; replaces instructions only when steps are parsed; and keeps existing notes unless parsed notes are present.

### Sharing

- Share acceptance creates a recipient-owned copy from the snapshot payload.
- Sharing is not a live-sync relationship between users.
- Share snapshots contain canonical sections once, plus recipe times, notes,
  yield metadata, and structured ingredient quantities. Legacy keys and `{}`
  snapshots are rejected atomically.

### Quantity and yield compatibility

- `recipe-quantity.ts` is the only scaling and quantity-formatting authority.
  Detail, Shopping, import, manual entry, and export must use it rather than
  converting through floating-point ingredient amounts.
- Valid structured quantity data wins. Legacy `amount`/`unit` and
  `originalText` are adapted only when structured data is absent or invalid.
- Display formatting is contextual: common kitchen units may convert to a more
  readable exact unit, fixed packages retain their package wording, and
  genuinely impractical quantities receive an approximation or
  hard-to-measure cue.
- Export keeps broad schema.org compatibility and includes a Recipe Genie
  extension so a Recipe Genie export/import round trip retains structured
  quantities and yield metadata.
- URL import consumes structured Recipe Genie extension fields only when the
  complete version 2 envelope has valid canonical ingredient and instruction
  sections plus valid yield metadata. The version 1 adapter is confined to
  this external import boundary. Malformed or unsupported extensions reject
  atomically and import falls back to standard schema.org fields.
- Edit hydration presents a valid structured quantity's authored text in the
  amount control. Saving continues to emit the normalized legacy amount/unit
  projection alongside unchanged authored metadata, while a deliberate amount
  edit rebuilds the affected quantity and invalidates stale original text.
- Package amount and unit edits rebuild count, qualifier, fixed size, canonical
  size unit, and package type together. An edit that no longer describes a
  package deliberately drops package metadata and becomes a coherent ordinary
  ingredient; stale `originalText` cannot overwrite the edit.
- Yield selection is prevalidated across the whole recipe. If any exact,
  ranged, or package-count quantity would exceed the persisted bound, the
  selected yield remains unchanged and Detail shows a bounded error. Shopping
  returns the same controlled error before generating or persisting any
  replacement contribution.

### Canonical recipe structure

- `Recipe.ingredientSections` and `Recipe.instructionSections` are the only
  app-facing structure fields.
- The form converts canonical sections to its sortable editor representation
  once on hydration and converts back once on submission.
- Detail and print render sections directly. Serving changes scale ingredient
  quantities without changing section boundaries.
- Shopping flattens ingredient sections exactly once at its aggregation
  boundary, preserving global item ordinals. Schema.org export similarly
  derives flat strings/`HowToSection` objects only at the external boundary.
- The deterministic legacy converter remains only for migration/preflight and
  the external Recipe Genie version 1 import adapter.

The aggregate-only structural preflight lives at
`supabase/verification/canonical_recipe_structure_preflight.sql`. Its default
path requires the exact Recipe Genie production project reference and migration
ledger through `015`, sets both the session default and transaction read-only,
and always rolls back. For dependency-free local validation against any
PostgreSQL 16 instance, pass
`-v canonical_recipe_structure_fixture_mode=1`; also pass
`-v canonical_recipe_structure_fixture_failure=1` to prove the conflict path
exits nonzero. Production reruns still require repository authorization and
must never use fixture mode.

Slice B is implemented. The later physical removal of frozen legacy columns and
one-time migration-only conversion code remains the separate Slice C described
in `canonical-recipe-structure-design.md`.

### Dialog discard protection

- Unsaved-change discard confirmation applies to both create mode and edit mode.
- Edit-mode dirty detection compares current form values against the loaded recipe snapshot rather than using create-mode heuristics.

## Intentionally Not Being Refactored Further

- The remaining size of `recipe-dialog.tsx` is mostly justified orchestration.
- Do not split it further unless a new pure helper seam or a real boundary violation appears.

## Verification

Run from `web/`:

```bash
npm run test -- --run src/lib/__tests__/recipe-parser.test.ts
npm run test -- --run src/components/recipes/__tests__/recipe-dialog-helpers.test.ts
npm run verify:recipe-import
npx playwright test recipes.spec.ts --project=chromium
npm run test:e2e:inspect
```

Use `verify:recipe-import` when parser, import-dialog, recipe persistence, or
paste-to-replace behavior changes. Parser and dialog unit tests validate the
form-boundary contract; the focused verifier additionally exercises the real
authenticated browser mutations, persisted local rows, refresh/reopen path,
replacement preservation, diagnostics, and cleanup. It is intentionally not
part of the fast general `npm run verify` command.

The local inspection suite covers mobile import state transitions at 360x800,
390x844, 430x932, and 390x420, plus the preserved desktop flow at 1200x800.

Last updated: 2026-08-03
