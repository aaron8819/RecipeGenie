import type { RationalV1 } from '@/types/database'
import { normalizeRationalV1 } from './recipe-quantity'

/** Pure target basis. Producers supply canonical purchase/material/unit keys.
 * No source IDs, titles, display rounding, density or package-content conversion.
 * Runtime acknowledgement and dependency fencing activate in Slice 8.
 */
export type CoveragePart = {
  purchaseKey: string
  materialKey: string
  unit: string
} & (
  | { kind: 'scalar'; amount: RationalV1 }
  | { kind: 'package'; descriptor: string; size: RationalV1; sizeUnit: string; amount: RationalV1 }
  | { kind: 'range'; minimum: RationalV1; maximum: RationalV1 }
  | { kind: 'token'; token: string }
)
export interface ShoppingCoverageBasis {
  comparisonVersion: 1
  parts: CoveragePart[]
}

type Exact = { n: bigint; d: bigint }
function exact(value: RationalV1): Exact | null {
  const normalized = normalizeRationalV1(value)
  return normalized ? { n: BigInt(normalized.numerator), d: BigInt(normalized.denominator) } : null
}
function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b]
  return a
}
function add(a: Exact, b: Exact): Exact {
  const n = a.n * b.d + b.n * a.d
  const d = a.d * b.d
  const divisor = gcd(n, d)
  return { n: n / divisor, d: d / divisor }
}
function partsByMeaning(basis: ShoppingCoverageBasis): Map<string, Exact> | null {
  if (basis.comparisonVersion !== 1 || !Array.isArray(basis.parts)) return null
  const result = new Map<string, Exact>()
  for (const part of basis.parts) {
    if (!part || typeof part.purchaseKey !== 'string' || !part.purchaseKey ||
        typeof part.materialKey !== 'string' || typeof part.unit !== 'string') return null
    const key: unknown[] = [part.purchaseKey, part.materialKey, part.unit, part.kind]
    let amount: Exact | null = { n: 1n, d: 1n }
    if (part.kind === 'scalar' || part.kind === 'package') {
      amount = exact(part.amount)
      if (part.kind === 'package') {
        const size = exact(part.size)
        if (typeof part.descriptor !== 'string' || !part.descriptor || !size || size.n <= 0n ||
            typeof part.sizeUnit !== 'string' || !part.sizeUnit) return null
        key.push(part.descriptor, `${size.n}/${size.d}`, part.sizeUnit)
      }
    } else if (part.kind === 'range') {
      const min = exact(part.minimum), max = exact(part.maximum)
      if (!min || !max || min.n < 0n || min.n * max.d > max.n * min.d) return null
      key.push(`${min.n}/${min.d}`, `${max.n}/${max.d}`)
    } else if (part.kind === 'token') {
      if (typeof part.token !== 'string' || !part.token) return null
      key.push(part.token)
    } else return null
    if (!amount || amount.n < 0n) return null
    if (amount.n === 0n) continue
    const serialized = JSON.stringify(key)
    result.set(serialized, add(result.get(serialized) ?? { n: 0n, d: 1n }, amount))
  }
  return result
}

export function isShoppingCoverageBasis(value: unknown): value is ShoppingCoverageBasis {
  return Boolean(value && typeof value === 'object' &&
    partsByMeaning(value as ShoppingCoverageBasis))
}

export function compareShoppingCoverage(
  obtained: ShoppingCoverageBasis,
  current: ShoppingCoverageBasis,
): 'Covered' | 'RequirementChanged' | 'Empty' | 'InvalidInput' {
  const saved = partsByMeaning(obtained), needed = partsByMeaning(current)
  if (!saved || !needed) return 'InvalidInput'
  if (!needed.size) return 'Empty'
  for (const [key, amount] of needed) {
    const available = saved.get(key)
    if (!available || available.n * amount.d < amount.n * available.d) return 'RequirementChanged'
  }
  return 'Covered'
}

/** Planning only; dependency and acknowledgement versions require atomic validation. */
export function planShoppingAcknowledgement(input: {
  expectedVersion: number
  currentVersion: number
  inspected: ShoppingCoverageBasis
  current: ShoppingCoverageBasis | null
  availability: 'available' | 'unavailable'
}): { status: 'Checked'; obtained: ShoppingCoverageBasis } |
    { status: 'Conflict' | 'TargetGone' | 'RequirementChanged' | 'InvalidInput' | 'DependencyUnavailable' } {
  if (input.availability === 'unavailable') return { status: 'DependencyUnavailable' }
  if (input.current === null) return { status: 'TargetGone' }
  if (input.expectedVersion !== input.currentVersion) return { status: 'Conflict' }
  const comparison = compareShoppingCoverage(input.inspected, input.current)
  if (comparison === 'Empty') return { status: 'TargetGone' }
  return comparison === 'Covered'
    ? { status: 'Checked', obtained: structuredClone(input.inspected) }
    : { status: comparison }
}
