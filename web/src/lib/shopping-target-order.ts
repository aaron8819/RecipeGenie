import { compareShoppingText } from './shopping-ordering'

export interface PurchasePlacement {
  categoryKey: string
  defaultCategoryKey: string
  policyVersion: string
  version: number
  userOverride?: string
}
export interface PurchaseOrganization {
  categories: string[]
  placements: Record<string, PurchasePlacement>
  sequences: Record<string, string[]>
}
export type PurchaseDestination = { categoryKey: string } & (
  | { at: 'start' | 'end' }
  | { at: 'before' | 'after'; anchor: string; anchorVersion: number }
)

/** Supplied pinned catalog/classifier evidence is identity-owned, never a source hint. */
export function canonicalPurchaseDefault(
  purchaseKey: string,
  policy: { version: string; semantic: Record<string, string>; keyword: Record<string, string>; miscellaneous: string },
): { categoryKey: string; policyVersion: string } {
  const semantic = Object.hasOwn(policy.semantic, purchaseKey) ? policy.semantic[purchaseKey] : undefined
  const keyword = Object.entries(policy.keyword).find(([word]) =>
    ` ${purchaseKey} `.includes(` ${word} `))?.[1]
  return { categoryKey: semantic ?? keyword ?? policy.miscellaneous,
    policyVersion: policy.version }
}

/** Planning only: called in the future content transaction, never during projection. */
export function appendPurchasePlacements(
  organization: PurchaseOrganization,
  incoming: Record<string, { categoryKey: string; policyVersion: string }>,
): { status: 'Applied' | 'Unchanged'; organization: PurchaseOrganization } |
   { status: 'InvalidInput' } {
  const next = structuredClone(organization)
  let changed = false
  for (const key of Object.keys(incoming).sort(compareShoppingText)) {
    if (Object.hasOwn(next.placements, key)) continue
    const entry = incoming[key]
    if (!key || !entry.policyVersion || !next.categories.includes(entry.categoryKey)) return { status: 'InvalidInput' }
    next.placements = { ...next.placements,
      [key]: { ...entry, defaultCategoryKey: entry.categoryKey, version: 0 } }
    const existing = Object.hasOwn(next.sequences, entry.categoryKey) ? next.sequences[entry.categoryKey] : []
    next.sequences = { ...next.sequences, [entry.categoryKey]: [...existing, key] }
    changed = true
  }
  return { status: changed ? 'Applied' : 'Unchanged', organization: next }
}

export function splicePurchasePlacement(
  organization: PurchaseOrganization,
  intent: { key: string; expectedVersion: number; destination: PurchaseDestination },
): { status: 'Applied' | 'Unchanged'; organization: PurchaseOrganization } |
   { status: 'Conflict' | 'TargetGone' | 'InvalidInput' } {
  const moved = Object.hasOwn(organization.placements, intent.key) ? organization.placements[intent.key] : undefined
  const destination = intent.destination
  if (!moved || !organization.categories.includes(destination.categoryKey)) return { status: 'TargetGone' }
  if (moved.version !== intent.expectedVersion) return { status: 'Conflict' }
  if ('anchor' in destination) {
    if (destination.anchor === intent.key) return { status: 'InvalidInput' }
    const anchor = Object.hasOwn(organization.placements, destination.anchor) ? organization.placements[destination.anchor] : undefined
    if (!anchor) return { status: 'TargetGone' }
    if (anchor.version !== destination.anchorVersion || anchor.categoryKey !== destination.categoryKey) return { status: 'Conflict' }
  }
  const next = structuredClone(organization)
  for (const category of Object.keys(next.sequences)) {
    next.sequences[category] = next.sequences[category].filter(key => key !== intent.key)
  }
  const sequence = Object.hasOwn(next.sequences, destination.categoryKey) ? next.sequences[destination.categoryKey] : []
  let index = destination.at === 'start' ? 0 : sequence.length
  if ('anchor' in destination) {
    const anchorIndex = sequence.indexOf(destination.anchor)
    if (anchorIndex < 0) return { status: 'InvalidInput' }
    index = anchorIndex + (destination.at === 'after' ? 1 : 0)
  }
  sequence.splice(index, 0, intent.key)
  next.sequences = { ...next.sequences, [destination.categoryKey]: sequence }
  next.placements = { ...next.placements, [intent.key]: { ...moved, categoryKey: destination.categoryKey,
    userOverride: destination.categoryKey } }
  if (moved.categoryKey === destination.categoryKey && moved.userOverride === destination.categoryKey &&
      sequence.every((key, index) => key === organization.sequences[destination.categoryKey]?.[index])) {
    return { status: 'Unchanged', organization: next }
  }
  next.placements[intent.key].version++
  return { status: 'Applied', organization: next }
}
