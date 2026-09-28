import type { PantryItem } from '@/types/database'
import { projectShoppingDocument, type ShoppingDocumentV3 } from './shopping-document'
import { resolveShoppingIngredientSemantics } from './shopping-ingredient-semantics'
import { normalizeUnit } from './shopping-list-normalization'

export function manualShoppingQuantity(amount?: number | null, unit?: string) {
  return amount == null && !unit
    ? null
    : { amount: amount ?? null, unit: normalizeUnit(unit || '') }
}

type ManualPurchaseIntent = {
  rowRef: string
  purchaseKey: string
} & ({ type: 'add'; pantryItems: PantryItem[] } | { type: 'edit' })

/** V3 compatibility policy, not the future extra/rebind contract.
 * Add checks active purchases with a successful explicit Pantry snapshot.
 * Rebind checks every projected bucket; same-identity amount edits stay legal.
 * Call again against fresh state before CAS replay. This is not server authority.
 */
export function validateManualPurchaseIntent(
  document: ShoppingDocumentV3,
  intent: ManualPurchaseIntent,
): 'Allowed' | 'Conflict' | 'TargetGone' {
  if (document.schemaVersion === 4) return intent.type === 'edit' &&
    !document.manualItems.some(item => `manual:${item.id}` === intent.rowRef && !item.identity?.removed)
    ? 'TargetGone' : 'Allowed'
  if (intent.type === 'edit') {
    const manual = document.manualItems.find(item => `manual:${item.id}` === intent.rowRef)
    if (!manual) return 'TargetGone'
    const current = resolveShoppingIngredientSemantics({
      item: manual.displayName, unit: manual.quantity?.unit,
    })
    if (current.purchaseKey === intent.purchaseKey) return 'Allowed'
  }
  const projection = projectShoppingDocument(
    document, intent.type === 'add' ? intent.pantryItems : [],
  )
  const rows = intent.type === 'add' ? projection.items : projection.rows
  return rows.some(row => row.rowRef !== intent.rowRef &&
    row.orderingKey === intent.purchaseKey) ? 'Conflict' : 'Allowed'
}
