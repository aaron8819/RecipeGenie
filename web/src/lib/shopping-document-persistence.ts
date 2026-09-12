import {
  applyShoppingDocumentMutation,
  type ShoppingDocumentMutation,
  type ShoppingDocumentStateV3,
} from './shopping-document'

export class ShoppingDocumentConflictError extends Error {
  constructor() {
    super('Shopping changed in another session. Review the latest list and try again.')
    this.name = 'ShoppingDocumentConflictError'
  }
}

export type ShoppingDocumentCasWrite = (
  current: ShoppingDocumentStateV3,
  next: ShoppingDocumentStateV3
) => Promise<ShoppingDocumentStateV3 | null>

export type ShoppingDocumentReplayValidator = (
  fresh: ShoppingDocumentStateV3
) => Promise<void> | void

export async function persistShoppingMutationWithReplay({
  initial,
  mutation,
  write,
  refetch,
  onRefetched,
  validateReplay,
  forceWrite = false,
  onResolved,
}: {
  initial: ShoppingDocumentStateV3
  mutation: ShoppingDocumentMutation
  write: ShoppingDocumentCasWrite
  refetch: () => Promise<ShoppingDocumentStateV3>
  onRefetched?: (state: ShoppingDocumentStateV3) => void
  validateReplay?: ShoppingDocumentReplayValidator
  forceWrite?: boolean
  onResolved?: (before: ShoppingDocumentStateV3, after: ShoppingDocumentStateV3) => void
}): Promise<ShoppingDocumentStateV3> {
  const resolved = (before: ShoppingDocumentStateV3, after: ShoppingDocumentStateV3) => {
    onResolved?.(before, after)
    return after
  }
  const firstNext = applyShoppingDocumentMutation(initial, mutation)
  if (firstNext === initial && !forceWrite) return resolved(initial, initial)

  const firstWrite = await write(initial, firstNext)
  if (firstWrite) return resolved(initial, firstWrite)

  const fresh = await refetch()
  onRefetched?.(fresh)
  await validateReplay?.(fresh)
  const replayed = applyShoppingDocumentMutation(fresh, mutation)
  if (replayed === fresh && !forceWrite) return resolved(fresh, fresh)

  const retry = await write(fresh, replayed)
  if (retry) return resolved(fresh, retry)

  throw new ShoppingDocumentConflictError()
}
