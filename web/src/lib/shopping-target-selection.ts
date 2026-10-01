import type { RationalV1, Recipe } from '@/types/database'
import { normalizeScaleRatioV1 } from './recipe-quantity'

/** New captures use supplied occurrence IDs. Old evidence must use unavailable,
 * never manufactured original history. No clock, UUID generator or live lookup.
 */
export interface ShoppingSourceCapture {
  recipeId: string
  sourceRevision: string
  snapshot: Recipe
  occurrenceIds: string[]
  semanticsVersion: string
}
export interface TargetSelection {
  version: number
  scale: RationalV1
  source: ShoppingSourceCapture
}
export function replaceTargetSelection(
  current: TargetSelection | undefined,
  intent: { expectedVersion: number | null; tripId: string; source: ShoppingSourceCapture; scale: RationalV1 },
  context: { tripId: string; ownedSourceRevision: string | null },
): { status: 'Applied' | 'Unchanged'; selection: TargetSelection } |
   { status: 'TripEnded' | 'TargetGone' | 'Conflict' | 'InvalidInput' } {
  if (intent.tripId !== context.tripId) return { status: 'TripEnded' }
  if (context.ownedSourceRevision === null) return { status: 'TargetGone' }
  if (context.ownedSourceRevision !== intent.source.sourceRevision ||
      (current?.version ?? null) !== intent.expectedVersion ||
      (current && current.source.recipeId !== intent.source.recipeId)) return { status: 'Conflict' }
  const scale = normalizeScaleRatioV1(intent.scale)
  const source = intent.source
  const count = source.snapshot.ingredientSections.reduce((sum, section) => sum + section.ingredients.length, 0)
  if (!scale || !source.recipeId || source.recipeId !== source.snapshot.id ||
      !source.sourceRevision || !source.semanticsVersion ||
      source.occurrenceIds.length !== count || source.occurrenceIds.some(id => !id) ||
      new Set(source.occurrenceIds).size !== count) return { status: 'InvalidInput' }
  if (current && JSON.stringify(current.scale) === JSON.stringify(scale) &&
      JSON.stringify(current.source) === JSON.stringify(source)) {
    return { status: 'Unchanged', selection: structuredClone(current) }
  }
  return { status: 'Applied', selection: { version: (current?.version ?? -1) + 1,
    scale, source: structuredClone(source) } }
}
