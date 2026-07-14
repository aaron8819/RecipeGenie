import type { QueryClient } from "@tanstack/react-query"
import { isPrincipalQueryFor, isPrincipalQueryKey } from "@/lib/query-keys"

export async function removePrincipalQueries(
  queryClient: QueryClient,
  userId: string
): Promise<void> {
  const predicate = (query: { queryKey: readonly unknown[] }) =>
    isPrincipalQueryFor(query.queryKey, userId)

  await queryClient.cancelQueries({ predicate })
  queryClient.removeQueries({ predicate })
}

export function removeForeignPrincipalQueries(
  queryClient: QueryClient,
  activeUserId: string | null
): void {
  queryClient.removeQueries({
    predicate: (query) =>
      isPrincipalQueryKey(query.queryKey) && query.queryKey[1] !== activeUserId,
  })
}
