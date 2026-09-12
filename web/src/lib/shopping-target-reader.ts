import { isShoppingCoverageBasis, type ShoppingCoverageBasis } from './shopping-coverage'
import { isLegacyIndependentNeed, type LegacyIndependentNeed } from './shopping-target-legacy'
import type { PurchaseOrganization } from './shopping-target-order'
import { validateShoppingDocumentV3, type ShoppingDocumentV3 } from './shopping-document'

/** Candidate V4 content fixture, not the final service/receipt wire schema.
 * Slice 6 must add protocol/dependency fencing before any target writes.
 * Keeping the version separate prevents interpreting V3 flags as coverage.
 */
export interface ShoppingTargetContentV4 {
  schemaVersion: 4
  tripId: string
  contentEpoch: number
  frozenEvidence: ShoppingDocumentV3
  organization: PurchaseOrganization
  needs: { id: string; kind: 'recipe' | 'extra' | 'reminder'; basis: ShoppingCoverageBasis }[]
  legacyIndependent: LegacyIndependentNeed[]
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string' && Boolean(value)
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

export function readShoppingTargetContent(value: unknown):
  { status: 'Supported'; content: ShoppingTargetContentV4 } |
  { status: 'Malformed' | 'UnsupportedDocument'; original: unknown } {
  const fail = () => ({ status: 'Malformed' as const, original: value })
  if (!record(value)) return fail()
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== 4) {
    return { status: 'UnsupportedDocument', original: value }
  }
  if (value.schemaVersion !== 4 || !text(value.tripId) || !version(value.contentEpoch) ||
      Object.keys(value).some(key => !['schemaVersion', 'tripId', 'contentEpoch', 'frozenEvidence', 'organization', 'needs', 'legacyIndependent'].includes(key)) ||
      !validateShoppingDocumentV3(value.frozenEvidence).ok || !record(value.organization) ||
      !Array.isArray(value.needs) || !Array.isArray(value.legacyIndependent)) return fail()
  const org = value.organization
  if (!Array.isArray(org.categories) || !org.categories.every(text) ||
      new Set(org.categories).size !== org.categories.length ||
      !record(org.placements) || !record(org.sequences)) return fail()
  const seen = new Set<string>()
  for (const [category, sequence] of Object.entries(org.sequences)) {
    if (!org.categories.includes(category) || !Array.isArray(sequence)) return fail()
    for (const key of sequence) {
      if (!text(key) || seen.has(key)) return fail()
      const placement = org.placements[key]
      if (!record(placement) || placement.categoryKey !== category ||
          !text(placement.defaultCategoryKey) || !org.categories.includes(placement.defaultCategoryKey) || !text(placement.policyVersion) ||
          !version(placement.version) || (placement.userOverride !== undefined && placement.userOverride !== category) ||
          (placement.userOverride === undefined && placement.defaultCategoryKey !== category)) return fail()
      seen.add(key)
    }
  }
  if (Object.keys(org.placements).some(key => !seen.has(key))) return fail()
  const ids = new Set<string>()
  for (const need of value.needs) {
    if (!record(need) || !text(need.id) || ids.has(need.id) ||
        !['recipe', 'extra', 'reminder'].includes(need.kind as string) || !isShoppingCoverageBasis(need.basis) ||
        need.basis.parts.some(part => !seen.has(part.purchaseKey))) return fail()
    ids.add(need.id)
  }
  for (const legacy of value.legacyIndependent) {
    if (!isLegacyIndependentNeed(legacy) || ids.has(legacy.id)) return fail()
    ids.add(legacy.id)
  }
  return { status: 'Supported', content: structuredClone(value) as unknown as ShoppingTargetContentV4 }
}
