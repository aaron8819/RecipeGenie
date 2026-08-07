import {
  applyShoppingDocumentMutation,
  type ShoppingDocumentMutation,
  type ShoppingDocumentStateV1,
} from './shopping-document'

export class ShoppingDocumentConflictError extends Error {
  constructor() {
    super('Shopping changed in another session. Review the latest list and try again.')
    this.name = 'ShoppingDocumentConflictError'
  }
}

export type ShoppingDocumentCasWrite = (
  current: ShoppingDocumentStateV1,
  next: ShoppingDocumentStateV1
) => Promise<ShoppingDocumentStateV1 | null>

export async function persistShoppingMutationWithReplay({
  initial,
  mutation,
  write,
  refetch,
  onRefetched,
  forceWrite = false,
}: {
  initial: ShoppingDocumentStateV1
  mutation: ShoppingDocumentMutation
  write: ShoppingDocumentCasWrite
  refetch: () => Promise<ShoppingDocumentStateV1>
  onRefetched?: (state: ShoppingDocumentStateV1) => void
  forceWrite?: boolean
}): Promise<ShoppingDocumentStateV1> {
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
