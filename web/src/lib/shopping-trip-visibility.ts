import type { ShoppingBucket, ShoppingDocumentV3 } from './shopping-document';

/** Promote only retained, unambiguous choices. Missing history is not a choice. */
export function recoverTripVisibility(document: ShoppingDocumentV3): ShoppingDocumentV3 {
  if (document.schemaVersion !== 4) return document;
  const choices = new Map<string, Set<ShoppingBucket>>();
  const add = (key: string, bucket: ShoppingBucket) => {
    const values = choices.get(key) ?? new Set<ShoppingBucket>();
    values.add(bucket); choices.set(key, values);
  };
  for (const entry of Object.values(document.recipeEntries)) for (const ingredient of entry.ingredients) {
    const override = document.itemOverrides[ingredient.aggregateKey];
    if (override?.suppressed) add(ingredient.purchaseKey, 'excluded');
    else if (override?.bucket) add(ingredient.purchaseKey, override.bucket);
  }
  for (const item of document.manualItems) {
    if (item.identity && item.identity.meaning !== 'legacyIndependent' && item.bucket !== 'items') {
      add(item.identity.purchaseKey, item.bucket);
    }
  }
  const visibility = { ...document.tripVisibility };
  for (const [key, values] of choices) {
    if (!Object.hasOwn(visibility, key) && values.size === 1) visibility[key] = [...values][0];
  }
  return Object.keys(visibility).length ? { ...document, tripVisibility: visibility } : document;
}
