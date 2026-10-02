import { isAlreadyInShoppingListError } from './shopping-feedback';
import { createShoppingManualItemId } from './shopping-row-reference';

// Both entry points use the same comma splitting, duplicate feedback and retry draft.
export async function addShoppingDraft(
  draft: string,
  add: (item: { itemName: string; rowId: string }) => Promise<unknown>,
) {
  const items = draft
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const added: string[] = [];
  const duplicates: string[] = [];
  const failed: string[] = [];
  for (const itemName of items) {
    try {
      await add({ itemName, rowId: createShoppingManualItemId() });
      added.push(itemName);
    } catch (error) {
      (isAlreadyInShoppingListError(error) ? duplicates : failed).push(
        itemName,
      );
    }
  }
  const messages: string[] = [];
  if (added.length)
    messages.push(
      added.length === 1
        ? `Added "${added[0]}" to shopping list`
        : `Added ${added.length} items to shopping list`,
    );
  if (duplicates.length)
    messages.push(
      duplicates.length === 1
        ? `"${duplicates[0]}" was already on the shopping list`
        : `${duplicates.length} items were already on the shopping list`,
    );
  if (failed.length)
    messages.push(
      failed.length === 1
        ? `Could not add "${failed[0]}"`
        : `Could not add ${failed.length} items`,
    );
  return {
    draft: failed.join(', '),
    tone: failed.length
      ? ('error' as const)
      : duplicates.length
        ? ('warning' as const)
        : ('success' as const),
    message:
      messages.join('; ') || 'Enter an item or paste a comma-separated list.',
  };
}
