# Pantry Domain Reference

Use this doc when working on pantry items, Shopping exclusions, or
Pantry-to-Shopping flows.

This is a domain reference. Canonical project-wide boundaries live in [`./ARCHITECTURE_GUARDRAILS.md`](./ARCHITECTURE_GUARDRAILS.md).

## Key Files

| File | Responsibility |
|------|----------------|
| `web/src/components/pantry/pantry-list.tsx` | Main pantry UI for pantry items, built-in family exclusions, and exact exclusions. |
| `web/src/hooks/use-pantry.ts` | Pantry item and excluded-keyword data access. |
| `web/src/hooks/shopping/use-shopping-document.ts` | Document-aware Pantry-to-Shopping bridge flows. |
| `web/src/lib/shopping-ingredient-resolution.ts` | Resolver-produced purchase identity, Pantry candidates, and supported semantic-family evidence. |
| `web/src/lib/shopping-document.ts` | Live Pantry satisfaction and exclusion classification during Shopping projection. |
| `web/src/lib/ingredient-exclusion-families.ts` | Shared Salt and Black pepper family authority. |

## Boundaries

- Components must not access Supabase directly.
- Hooks own pantry reads and writes.
- Pantry satisfaction and exclusion helpers stay pure.
- Cross-domain pantry and shopping movement logic belongs in hooks, not components.

## Important Behaviors

Pantry owns the `/pantry` route and mounts only while that route is active under
the shared authenticated shell.

### Pantry items

- Pantry items are normalized case-insensitively.
- Pantry presence is joined live during Shopping projection and classifies
  matching ingredients as `already_have`.
- Satisfaction uses resolver-produced exact/alternative candidates, bounded
  lemon/lime whole-fruit candidates for explicit juice or zest usage, and the
  shared Salt/Black pepper family evidence.
- Pantry satisfaction is directional and does not change Shopping aggregation
  identity.

### Excluded keywords

- Exact-exclusion matching uses the whole normalized ingredient name, is
  case-insensitive, and does not perform substring matching.
- This is intentionally stricter than fuzzy pantry matching.

### Always-excluded families

- The Pantry excluded-items card exposes only the opt-in Salt variants and
  Black pepper variants settings. Their fixed alias lists are explained beside
  accessible checkboxes and are persisted in `ShoppingDocumentV1.preferences`.
- Settings immediately affect the deterministic Shopping projection; no
  contribution regeneration is required.
- Exact exclusions remain a separate section and count; changing a family
  setting does not change `excluded_keywords`.

### What Can I Make

There is no active "What Can I Make?" implementation. If the feature is
restored, it should consume the resolver-backed Pantry satisfaction contract
rather than introduce a separate matcher.

## Relationship To Other Docs

- See [`shopping-component.md`](./shopping-component.md) for the downstream shopping behavior that consumes pantry data.
- See [`./project_overview.md`](./project_overview.md) for the broader architecture map.

Last updated: 2026-08-07
