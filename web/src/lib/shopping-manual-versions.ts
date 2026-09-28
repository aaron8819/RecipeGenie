import { canonicalShoppingPayload, type ShoppingCommand } from './shopping-command';
import type { ShoppingManualItemV1 } from './shopping-document';

/** Old records start all fields at their existing whole-item version. */
function manualFieldVersions(item: ShoppingManualItemV1) {
  return item.identity?.fieldVersions ?? {
    displayName: item.identity?.version ?? 0,
    quantity: item.identity?.version ?? 0,
    guard: item.identity?.version ?? 0,
  };
}

function independentManualEdit(mutation: ShoppingCommand['mutation'], item: ShoppingManualItemV1) {
  return mutation.type === 'editManualItem' && item.identity?.meaning !== 'legacyIndependent' &&
    Object.keys(mutation.changes).every(key => key === 'displayName' || key === 'quantity');
}

export function manualEditMatches(current: ShoppingManualItemV1, observed: ShoppingManualItemV1,
  mutation: Extract<ShoppingCommand['mutation'], { type: 'editManualItem' }>) {
  if (!independentManualEdit(mutation, current)) return canonicalShoppingPayload(current) === canonicalShoppingPayload(observed);
  if (current.id !== observed.id || !observed.identity || current.identity!.removed || observed.identity.removed ||
    current.identity!.purchaseKey !== observed.identity.purchaseKey ||
    current.identity!.policyVersion !== observed.identity.policyVersion || observed.identity.meaning === 'legacyIndependent') return false;
  const actual = manualFieldVersions(current), expected = manualFieldVersions(observed);
  return actual.guard === expected.guard && (['displayName', 'quantity'] as const).every(field =>
    !Object.hasOwn(mutation.changes, field) || (actual[field] === expected[field] &&
      canonicalShoppingPayload(current[field]) === canonicalShoppingPayload(observed[field])));
}

/** Called for every changed manual, including bridge/visibility and restoration. */
export function advanceManualFieldVersions(before: ShoppingManualItemV1, after: ShoppingManualItemV1,
  mutation: ShoppingCommand['mutation']) {
  const versions = manualFieldVersions(before);
  after.identity!.fieldVersions = {
    displayName: versions.displayName + Number(before.displayName !== after.displayName),
    quantity: versions.quantity + Number(canonicalShoppingPayload(before.quantity) !== canonicalShoppingPayload(after.quantity)),
    guard: versions.guard + Number(!independentManualEdit(mutation, before)),
  };
}
