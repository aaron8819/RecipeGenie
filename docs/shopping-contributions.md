# Authoritative recipe shopping contributions

## Decision

Recipe Genie uses a hybrid transitional model:

- `shopping_recipe_contributions` is the authority for recipe-derived quantities.
- Each `(user_id, recipe_id)` row is one active frozen contribution snapshot.
- `shopping_list` remains the rendered compatibility projection used by the current UI and existing manual-item, check, order, exclusion, and pantry operations.
- `contribution_revision` protects projection replacement from lost updates.
- `contribution_overrides` preserves explicit manual quantity, presentation, order, and lifecycle choices across recomputation.

An embedded-only model was rejected because one mutable JSON value cannot constrain per-recipe identity or prevent concurrent lost updates. Full relational normalization of every shopping item was rejected because it would unnecessarily redesign manual shopping, pantry, ordering, and undo behavior. The hybrid makes recipe quantities reversible now while leaving those unrelated behaviors intact.

## Contribution contract

Identity is `(authenticated user, recipe ID)`. The product currently supports one active shopping contribution per recipe; Planner recipe IDs are also unique, so no plan-entry multiplicity exists to preserve.

- First add creates a contribution.
- Repeating the same recipe and servings replaces the same row and is quantitatively idempotent.
- Repeating with a different scale replaces the frozen snapshot and recomputes the projection.
- Removal deletes that contribution and recomputes from the remaining snapshots.
- Recipe deletion first removes any active contribution through the same command; the database foreign key restricts direct deletion while a contribution exists so projection drift cannot be created by cascade.
- Concurrent commands use optimistic revision checks. The server retries a conflict from fresh state; the last committed replacement of the same recipe wins.
- An idempotency key identifies a request. Retrying a committed request returns the current authoritative list without applying it again.

Snapshots freeze normalized generated items, selected scale/servings, recipe identity, category/classification at generation time, and `normalization_version`. Recipe edits do not silently change an active contribution; an explicit re-add refreshes it.

Structured quantity metadata becomes authoritative only after its compatibility
projection is semantically coherent. Scalar and range amounts, qualifiers,
authored/canonical units, and fixed-package syntax must describe the same
quantity. `exactScaleV1` must equal the numeric contribution scale both at API
input and stored-row hydration. Inconsistent client data is rejected before the
RPC; inconsistent historical structured data fails closed rather than
rendering a contradictory unit or being legitimized by a retry.

## Authority flow

Before:

```text
browser reads aggregate
-> browser incrementally merges or removes source labels
-> browser replaces the aggregate row
```

After:

```text
browser sends recipe IDs, scale, and idempotency key
-> authenticated server generates frozen per-recipe snapshots
-> RPC locks the user's list and validates revision and recipe ownership
-> contribution rows are replaced/removed atomically with the projection
-> authoritative result replaces only the invoking principal's cache
```

## Manual-state contract

- Manual-only rows remain separate from recipe contributions and survive recipe add/remove.
- A quantity differing from the prior derived quantity becomes an explicit quantity override.
- Category, display name, checked state, row identity, and custom order are retained from the current projection.
- Moving a derived row to pantry/already-have or excluded retains that lifecycle bucket on regeneration.
- Deleting a derived row records suppression at the next recipe command; undo restores the row before that command commits.
- Clearing the shopping list clears both recipe contributions and manual projection state.
- Existing rows without reconstructable quantitative provenance are preserved as legacy/manual state. A legacy row sourced only by the recipe being explicitly refreshed is safely replaced; mixed-source legacy rows are marked `legacyRecipeProvenance` and retained.

This migration deliberately does not invent per-recipe quantities for old aggregate JSON. That may temporarily leave an ambiguous legacy row beside a newly derived row until the user removes or edits the legacy state, but it cannot silently discard shopping data.
