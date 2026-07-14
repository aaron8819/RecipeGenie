/**
 * Shared constants and helpers for shopping hooks
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query"

// React Query mutation scope ID to serialize shopping_list writes and avoid lost updates.
export const SHOPPING_LIST_WRITE_SCOPE_ID = "shopping-list-write"

export async function cancelQueriesAndSnapshot<TData>(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<{ previousData: TData | undefined }> {
  await queryClient.cancelQueries({ queryKey: [...queryKey] })

  return {
    previousData: queryClient.getQueryData<TData>([...queryKey]),
  }
}

export async function cancelQueriesAndSnapshotMany<
  TSnapshots extends Record<string, unknown>,
>(
  queryClient: QueryClient,
  queryKeys: { [K in keyof TSnapshots]: QueryKey }
): Promise<{ [K in keyof TSnapshots]: TSnapshots[K] | undefined }> {
  const entries = Object.entries(queryKeys) as Array<[keyof TSnapshots, QueryKey]>

  await Promise.all(
    entries.map(([, queryKey]) =>
      queryClient.cancelQueries({ queryKey: [...queryKey] })
    )
  )

  const snapshots = {} as { [K in keyof TSnapshots]: TSnapshots[K] | undefined }

  for (const [name, queryKey] of entries) {
    snapshots[name] = queryClient.getQueryData<TSnapshots[typeof name]>([
      ...queryKey,
    ])
  }

  return snapshots
}

export function setOptimisticQueryData<TData>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: (old: TData | undefined) => TData | undefined
): void {
  queryClient.setQueryData<TData>([...queryKey], updater)
}

export function rollbackQueryData<TData>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  previousData: TData | undefined
): void {
  if (previousData) {
    queryClient.setQueryData([...queryKey], previousData)
  }
}

export function rollbackQueryDataMany<
  TSnapshots extends Record<string, unknown>,
>(
  queryClient: QueryClient,
  queryKeys: { [K in keyof TSnapshots]: QueryKey },
  snapshots: { [K in keyof TSnapshots]?: TSnapshots[K] | undefined }
): void {
  const entries = Object.entries(queryKeys) as Array<[keyof TSnapshots, QueryKey]>

  for (const [name, queryKey] of entries) {
    const previousData = snapshots[name]
    if (previousData) {
      queryClient.setQueryData([...queryKey], previousData)
    }
  }
}

export function reconcileQueryData<TData>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  updater: (old: TData | undefined) => TData | undefined
): void {
  queryClient.setQueryData<TData>([...queryKey], updater)
}

export function invalidateQuery(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: [...queryKey] })
}
