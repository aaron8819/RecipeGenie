# Shopping Domain Reference

Use this doc when working on shopping-list generation, item state, category management, pantry/excluded-keyword integration, or shopping-specific optimistic flows.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Current State

- The shopping presentation extraction wave is complete.
- `shopping-list.tsx` still owns meaningful orchestration and optimistic UX behavior.
- Shopping logic is intentionally split between hooks for data access and pure library helpers for deterministic list generation.

## Key Files

| File | Responsibility |
|------|----------------|
| `web/src/components/shopping/shopping-list.tsx` | Main shopping UI orchestration, DnD ownership, filtering/grouping orchestration, and optimistic interaction flow. |
| `web/src/components/shopping/shopping-list-components.tsx` | Presentation-only shopping sections extracted from the main component. |
| `web/src/components/shopping/shopping-settings-modal.tsx` | Shopping configuration UI. |
| `web/src/hooks/shopping/use-shopping-list.ts` | Fetch/generate/save the shopping list. |
| `web/src/hooks/shopping/use-shopping-items.ts` | Item add/remove/check/reorder behavior. |
| `web/src/hooks/shopping/use-shopping-recipes.ts` | Remove recipe-derived items from the list. |
| `web/src/hooks/shopping/use-shopping-categories.ts` | Category overrides and custom-category management. |
| `web/src/hooks/shopping/use-shopping-pantry.ts` | Pantry-to-shopping bridge flows. |
| `web/src/hooks/shopping/shared.ts` | Shared shopping optimistic helpers and constants. |
| `web/src/lib/shopping-list.ts` | Main aggregation pipeline for recipes into shopping items. |
| `web/src/lib/shopping-list-normalization.ts` | Unit and ingredient-name normalization. |
| `web/src/lib/shopping-ingredient-canonicalization.ts` | Pure, narrow purchase-identity canonicalization and controlled display pluralization. |
| `web/src/lib/shopping-list-merging.ts` | Merge-compatible-unit logic. |
| `web/src/lib/shopping-categories.ts` | Category lookup and excluded-keyword matching. |
| `web/src/lib/pane-scroll.ts` | Pane-relative scrolling helper for kept-mounted home-tab panes. |

## Boundaries

- Components must not fetch or mutate Supabase directly.
- Hooks own shopping reads, writes, cache invalidation, and optimistic updates.
- Library helpers remain pure and deterministic.
- Multi-step shopping writes use RPCs where the operation must be atomic.

## Important Behaviors

### Shopping generation

Shopping generation takes selected recipes plus pantry/config data and produces three buckets:

- `items`
- `already_have`
- `excluded`

The aggregation pipeline recognizes the two opt-in ingredient exclusion
families from the complete structured ingredient immediately before purchase
normalization, then preserves the existing normalization, compatible-amount
merging, and categorization behavior. Final classification precedence is
pantry, exact excluded keyword, enabled unanimous built-in family, then visible
item. Every occurrence in an aggregate must independently match the same family.

Frozen contribution projection keeps its existing bucket behavior unless a
contributor carries `Salt variants` or `Black pepper variants`. In that case,
the aggregate defaults to excluded only when every contributor is excluded for
that same reason; mixed or unprovable aggregates default to visible. Persisted
lifecycle overrides still win. No family provenance is added to sources and
normalization version 2 is unchanged.

Purchase identity uses an explicit structured canonicalization result: base name,
identity modifiers, preparation modifiers, optionality, display name, and merge
key. Only controlled singular/plural aliases and high-confidence preparation
terms are collapsed. Variety, size, product type, processing state, and effective
shopping category remain identity-defining. New frozen recipe contributions use
normalization version 2; version-1 snapshots are upgraded only in memory during
projection so stored snapshots and existing row IDs remain unchanged.

### Pending state

Per-item pending state matters. Do not disable all shopping actions behind a single mutation-level `isPending` flag when only one item is changing.

### In-pane jump navigation

Shopping runs inside the kept-mounted home tab shell, where the active tab pane is the real `overflow-y-auto` scroller and `body` is locked to the viewport.

- Do not use `scrollIntoView()` for Shopping section jumps or other home-tab in-pane navigation.
- Use `scrollNodeIntoPane()` from `web/src/lib/pane-scroll.ts` so the active pane is scrolled explicitly.
- Mobile jump navigation should avoid smooth scrolling when sticky in-pane UI is present.
- If the Shopping sticky mobile header changes height, re-check the jump offset constants in `shopping-list.tsx`.

### Pantry bridge

Pantry integration is not a presentational concern. Cross-list mutation logic belongs in hooks, especially flows that move items between `items` and `already_have`.

## Intentionally Not Being Refactored Further

- The remaining complexity in `shopping-list.tsx` is mostly orchestration and optimistic UX wiring.
- Do not split that orchestration further unless a clearly pure helper seam or a boundary violation appears.

## Verification

Run from `web/`:

```bash
npm run test -- --run
npx playwright test shopping-list.spec.ts --project=chromium
```

Last updated: 2026-08-01
