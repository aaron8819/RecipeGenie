# Pantry Domain Reference

Use this doc when working on pantry items, shopping exclusions, pantry-driven recipe matching, or pantry-to-shopping flows.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Key Files

| File | Responsibility |
|------|----------------|
| `web/src/components/pantry/pantry-list.tsx` | Main pantry UI for pantry items, built-in family exclusions, and exact exclusions. |
| `web/src/components/pantry/what-can-i-make.tsx` | Pantry-driven recipe-match view. |
| `web/src/hooks/use-pantry.ts` | Pantry item and excluded-keyword data access. |
| `web/src/hooks/use-pantry-match.ts` | Pantry match orchestration against recipe data. |
| `web/src/hooks/shopping/use-shopping-pantry.ts` | Pantry-to-shopping bridge flows. |
| `web/src/lib/pantry-matcher.ts` | Pantry matching logic. |
| `web/src/lib/shopping-list.ts` | Downstream consumer of pantry data when generating shopping lists. |
| `web/src/lib/shopping-categories.ts` | Exact-match excluded-keyword helper logic. |

## Boundaries

- Components must not access Supabase directly.
- Hooks own pantry reads and writes.
- Pantry matching and excluded-keyword helpers stay pure.
- Cross-domain pantry and shopping movement logic belongs in hooks, not components.

## Important Behaviors

### Pantry items

- Pantry items are normalized case-insensitively.
- Pantry presence affects shopping generation by moving matching ingredients into `already_have`.

### Excluded keywords

- Exact-exclusion matching uses the whole normalized ingredient name, is
  case-insensitive, and does not perform substring matching.
- This is intentionally stricter than fuzzy pantry matching.

### Always-excluded families

- The Pantry excluded-items card exposes only the opt-in Salt variants and
  Black pepper variants settings. Their fixed alias lists are explained beside
  accessible checkboxes and are persisted independently in `user_config`.
- Settings affect newly generated recipe contributions only. Clear/reset plus
  regeneration is the reliable boundary for rebuilding a shopping list under
  current settings.
- Exact exclusions remain a separate section and count; changing a family
  setting does not change `excluded_keywords`.

### What Can I Make

- Pantry matching checks primary ingredient names and `alternatives[]`.
- Excluded keywords do not participate in recipe-match scoring.

## Relationship To Other Docs

- See [`shopping-component.md`](./shopping-component.md) for the downstream shopping behavior that consumes pantry data.
- See [`./project_overview.md`](./project_overview.md) for the broader architecture map.

Last updated: 2026-08-01
