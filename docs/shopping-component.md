# Shopping Domain Reference

Shopping persistence is a single `ShoppingDocumentV1` JSON document per user,
guarded by one `content_revision`. The document stores recipe inputs, manual
items, explicit row overrides, order, and Shopping preferences. Rendered
`items`, `already_have`, and `excluded` rows are projections and are never
persisted.

## Key files

| File | Responsibility |
|------|----------------|
| `web/src/lib/shopping-document.ts` | Strict validator, deterministic projector, and pure mutation reducers. |
| `web/src/lib/shopping-ingredient-resolution.ts` | Resolves canonical Shopping ingredients from recipe structure. |
| `web/src/hooks/shopping/use-shopping-document.ts` | The only runtime Shopping read/write seam; CAS, replay, Pantry bridge, and UI adapters. |
| `web/src/components/shopping/shopping-list.tsx` | Shopping UI orchestration and immediate inverse-write Undo UX. |
| `supabase/migrations/018_shopping_document_cutover.sql` | Atomic legacy conversion and physical schema cutover. |

## Persistence contract

- `shopping_list` contains only `user_id`, `document`, `content_revision`, and
  `updated_at`.
- Every normal mutation applies one pure reducer and writes with
  `WHERE content_revision = expected`, advancing the revision exactly once.
- On conflict the client refetches, replays the same intent once, and retries
  once. A second conflict is surfaced to the user.
- Recipe entries are keyed by immutable recipe UUID and there is at most one
  active entry per recipe.
- Manual IDs and derived aggregate keys produce stable `manual:*` and
  `derived:*` row references. Row-targeted actions fail closed without one.
- Delete, clear, and recipe removal happen immediately. Undo is a new inverse
  document mutation; there is no delayed commit queue.

## Projection and Pantry

Projection combines the document with live Pantry rows. Classification order
is Pantry, exact exclusion, enabled unanimous built-in family, then visible.
Explicit persisted bucket overrides win. Moving a row to Pantry uses
`move_shopping_document_item_to_pantry(...)`, which performs the Shopping CAS
and Pantry insertion in one transaction.

Shopping preferences—including exact exclusions, family toggles, category
overrides, custom categories, and category order—live inside the document.
`user_config` contains planner/onboarding preferences only.

## Verification

Run from `web/`:

```bash
npm run typecheck
npm run test -- --run src/lib/__tests__/shopping-document.test.ts src/lib/__tests__/shopping-document-persistence.test.ts
supabase test db --local --workdir ..
```

Last updated: 2026-08-07
