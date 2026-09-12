import { normalizeQuantityV1 } from './recipe-quantity'
import type { QuantityV1 } from '@/types/database'

/** Shadow V4 content envelope. This is not accepted by the V3 runtime writer.
 * Raw provenance is immutable through safe edits; null history means unavailable.
 */
export interface LegacyIndependentNeed {
  kind: 'legacyIndependent'
  id: string
  version: number
  raw: Record<string, unknown>
  displayName: string
  quantity: QuantityV1 | null
  categoryEvidence: string[]
  orderEvidence: string[][]
  previousChecked: boolean
  sourceHistory: null
  unresolvedReasons: string[]
}
export function isLegacyIndependentNeed(value: unknown): value is LegacyIndependentNeed {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string' && Boolean(s))
  return v.kind === 'legacyIndependent' && typeof v.id === 'string' && Boolean(v.id) &&
    Number.isSafeInteger(v.version) && (v.version as number) >= 0 &&
    Boolean(v.raw && typeof v.raw === 'object' && !Array.isArray(v.raw)) &&
    typeof v.displayName === 'string' && Boolean(v.displayName.trim()) &&
    (v.quantity === null || normalizeQuantityV1(v.quantity) !== null) &&
    strings(v.categoryEvidence) && Array.isArray(v.orderEvidence) && v.orderEvidence.every(strings) &&
    typeof v.previousChecked === 'boolean' && v.sourceHistory === null &&
    strings(v.unresolvedReasons) && v.unresolvedReasons.length > 0
}

export function editLegacyIndependentNeed(
  current: LegacyIndependentNeed,
  expectedVersion: number,
  changes: { displayName?: string; quantity?: QuantityV1 | null; previousChecked?: boolean },
): { status: 'Applied' | 'Unchanged'; need: LegacyIndependentNeed } |
   { status: 'Conflict' | 'InvalidInput' } {
  if (current.version !== expectedVersion) return { status: 'Conflict' }
  if (Object.keys(changes).some(key => !['displayName', 'quantity', 'previousChecked'].includes(key))) return { status: 'InvalidInput' }
  const need = structuredClone({ ...current, ...changes })
  if (!isLegacyIndependentNeed(need)) return { status: 'InvalidInput' }
  if (JSON.stringify(need) === JSON.stringify(current)) return { status: 'Unchanged', need }
  need.version++
  return { status: 'Applied', need }
}
