# Recipes Domain Reference

Use this doc when working on recipe CRUD, the recipe dialog, text or URL import, recipe images, tags/categories, cook mode, or recipe sharing.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Current State

- The recipe dialog presentation extraction wave is complete.
- `recipe-dialog.tsx` still owns form/dialog orchestration, import parsing flow, and submit sequencing.
- `recipe-list.tsx` still owns recipe browsing orchestration, including search/filter state, mobile-vs-desktop toolbar structure, and modal coordination.
- Recipe persistence now has first-class support for `prep_time_minutes`, `cook_time_minutes`, `total_time_minutes`, and `notes`, plus additive `instruction_groups` persistence.
- Legacy flat `instructions` remains persisted for compatibility and the current textarea-based edit model.
- The recipe detail dialog is query-backed and action-complete for common follow-up actions:
  - favorite toggle
  - add to plan
  - add to shopping
  - mark made
  - share/edit/delete
- The recipe image storage boundary is now explicit:
  - `getRecipeImageUrl()` is a pure helper.
  - Upload/delete behavior goes through `useRecipeImageStorage()`.

## Key Files

| File | Responsibility |
|------|----------------|
| `web/src/components/recipes/recipe-list.tsx` | Main recipe browsing, filtering, sorting, and dialog orchestration. |
| `web/src/components/recipes/recipe-dialog.tsx` | Main create/edit orchestration for manual entry and imports. |
| `web/src/components/recipes/recipe-dialog-components.tsx` | Presentation-only recipe dialog sections extracted from the main dialog. |
| `web/src/components/recipes/recipe-detail-dialog.tsx` | Query-backed recipe detail, cook-mode entry point, and common follow-up actions. |
| `web/src/components/recipes/share-recipe-dialog.tsx` | Share a recipe with another user. |
| `web/src/components/recipes/shared-recipes-inbox.tsx` | Inbox and sent-share status views. |
| `web/src/hooks/use-recipes.ts` | Recipe CRUD, categories, and tag operations. |
| `web/src/hooks/use-recipe-import.ts` | URL import state management and server round-trip coordination. |
| `web/src/hooks/use-recipe-shares.ts` | Share lifecycle data access and mutations. |
| `web/src/hooks/use-recipe-image-storage.ts` | Upload/delete boundary for Supabase-backed recipe image storage. |
| `web/src/lib/recipe-parser.ts` | Plain-text recipe parsing. |
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

### Recipe images

- Upload and delete flows belong behind `useRecipeImageStorage()`.
- Rendering an image URL is safe through `getRecipeImageUrl()`.
- Treat storage writes as a hook-owned concern, not a component concern.

### Imports

- Text parsing is local and deterministic.
- URL import remains server-side because it needs SSRF protection, rate limiting, and HTML/JSON-LD extraction.
- Import apply/save/reopen parity now preserves structured recipe times and notes directly, and preserves grouped instructions through additive `instruction_groups`.

### Sharing

- Share acceptance creates a recipient-owned copy from the snapshot payload.
- Sharing is not a live-sync relationship between users.
- Share snapshots now include recipe times, notes, and grouped instructions.

### Recipe structure compatibility

- `recipe-structure.ts` is the canonical compatibility layer for recipe notes and grouped instructions.
- When `instruction_groups` exists, render/export/cook flows should prefer it.
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
npx playwright test recipes.spec.ts --project=chromium
```

Last updated: 2026-03-10
