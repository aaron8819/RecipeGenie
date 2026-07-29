# Recipes Domain Reference

Use this doc when working on recipe CRUD, recipe detail, the recipe form
dialog, text or URL import, recipe images, tags/categories, or recipe sharing.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Current State

- The recipe dialog presentation extraction wave is complete.
- `recipe-dialog.tsx` still owns form/dialog orchestration, import parsing flow, and submit sequencing.
- `recipe-list.tsx` still owns recipe browsing orchestration, including
  search/filter state and mobile-vs-desktop toolbar structure.
- Recipe persistence now has first-class support for `prep_time_minutes`, `cook_time_minutes`, `total_time_minutes`, and `notes`, plus additive `instruction_groups` persistence.
- Ingredient `groupLabel` metadata is preserved in the existing `ingredients`
  JSON payload. The final detail view groups only non-empty ingredients by
  normalized stored labels. First appearance determines group order, and
  ingredient order remains stable within each group. Unlabeled ingredients use
  one headingless group at their first appearance, while legacy recipes with
  only unlabeled ingredients render as one ordinary list.
- Legacy flat `instructions` remains persisted for compatibility and the current textarea-based edit model.
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
| `web/src/app/recipes/[id]/page.tsx` | Canonical recipe-detail route. |
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
| `web/src/lib/recipe-structure.ts` | Compatibility helpers for notes, grouped instructions, and flat/grouped rendering. |
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
- Source navigation records only a safe home-tab enum and an opaque
  same-session origin token. Matching origins return through browser history.
  That validated session return context survives a refresh, so a refreshed
  detail page can still return to Recipes, Planner, or Shopping through browser
  history with an accurate source-aware label. A genuinely direct or shared
  URL without matching session context ignores route text as return authority
  and safely falls back to Recipes.
- If browser local storage cannot record that direct/shared fallback, a
  session cookie keeps the server-selected Recipes tab authoritative until
  local tab persistence catches up. Ordinary home visits still restore valid
  Planner and Shopping tab preferences.
- Recipes restores its supported filters, sorting, view mode, and scroll
  position from validated versioned session storage. Planner restores its
  selected week and mobile week tab through the same kind of validated
  session-scoped state; restored Planner dates must be real canonical
  `YYYY-MM-DD` Gregorian calendar dates.
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
  Markdown ingredient groups are persisted through each ingredient's
  `groupLabel`; Markdown notes use the existing first-class notes array.
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
- Import apply/save/reopen parity now preserves structured recipe times and notes directly, and preserves grouped instructions through additive `instruction_groups`.
- Edit mode has a paste-to-replace flow that reuses the text parser and applies parsed fields to the current recipe draft. It preserves the recipe id, category, tags, and image; replaces name/servings/times when parsed; replaces ingredients only when at least one ingredient is parsed; replaces instructions only when steps are parsed; and keeps existing notes unless parsed notes are present.

### Sharing

- Share acceptance creates a recipient-owned copy from the snapshot payload.
- Sharing is not a live-sync relationship between users.
- Share snapshots now include recipe times, notes, grouped instructions, yield
  metadata, and structured ingredient quantities.

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
  envelope is a non-array object with numeric `version: 1`. Missing, malformed,
  or unsupported versions are ignored as a whole; import falls back to
  standard schema.org fields without partially trusting extension data.
- Edit hydration presents a valid structured quantity's authored text in the
  amount control. Saving continues to emit the normalized legacy amount/unit
  projection alongside unchanged authored metadata, while a deliberate amount
  edit rebuilds the affected quantity and invalidates stale original text.

### Recipe structure compatibility

- `recipe-structure.ts` is the canonical compatibility layer for ingredient
  groups, recipe notes, and grouped instructions.
- When `instruction_groups` exists, render and export flows should prefer it.
- Older recipes that only have flat `instructions` must continue to render correctly.
- Legacy `Notes:` label lines inside flat instructions are still supported at hydration/render time and should not be reintroduced into persisted notes-aware recipes.

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

Last updated: 2026-07-29
