import type { ShoppingDocumentStateV3 } from './shopping-document';

export type ShoppingCachedState = ShoppingDocumentStateV3 & {
  // Metadata computed from the persisted JSONB representation, never saved
  // inside the Shopping document or inferred from rounded JS numbers.
  clearUndoAvailable?: boolean;
};

// Only committed states belong in this cache. Optimistic row intents live in
// the component. The caller's owner/document query key defines the identity;
// removing that query also removes its revision history.
export function reconcileShoppingState(
  current: ShoppingDocumentStateV3 | undefined,
  incoming: ShoppingDocumentStateV3,
): ShoppingDocumentStateV3 {
  return current && current.contentRevision > incoming.contentRevision
    ? current : incoming;
}
