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

export async function persistShoppingMutationWithReplay({
  initial,
  mutation,
  write,
  refetch,
  onRefetched,
  forceWrite = false,
}: {
  initial: ShoppingDocumentStateV3
  mutation: ShoppingDocumentMutation
  write: ShoppingDocumentCasWrite
  refetch: () => Promise<ShoppingDocumentStateV3>
  onRefetched?: (state: ShoppingDocumentStateV3) => void
  forceWrite?: boolean
}): Promise<ShoppingDocumentStateV3> {
  const firstNext = applyShoppingDocumentMutation(initial, mutation)
  if (firstNext === initial && !forceWrite) return initial

  const firstWrite = await write(initial, firstNext)
  if (firstWrite) return firstWrite

  const fresh = await refetch()
  onRefetched?.(fresh)
  const replayed = applyShoppingDocumentMutation(fresh, mutation)
  if (replayed === fresh && !forceWrite) return fresh

  const retry = await write(fresh, replayed)
  if (retry) return retry

  throw new ShoppingDocumentConflictError()
}
