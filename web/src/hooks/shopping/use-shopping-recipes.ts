"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuthContext } from "@/lib/auth-context"
import { getActivePrincipalId } from "@/lib/principal-session"
import { principalId, shoppingKeys } from "@/lib/query-keys"
import {
  runRecipeContributionCommand,
  type RecipeContributionCommandResult,
} from "@/lib/shopping-contribution-client"
import { SHOPPING_LIST_WRITE_SCOPE_ID } from "./shared"

export type RecipeContributionIdentity = {
  recipeId: string
  recipeName: string
}

function reconcileAuthoritativeResult(
  queryClient: ReturnType<typeof useQueryClient>,
  ownerUserId: string,
  result: RecipeContributionCommandResult
) {
  if (getActivePrincipalId() !== ownerUserId) return
  queryClient.setQueryData(
    shoppingKeys.detail(ownerUserId),
    result.shopping_list
  )
}

export function useRemoveRecipeItems() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)

  return useMutation({
    scope: { id: `${SHOPPING_LIST_WRITE_SCOPE_ID}:${ownerUserId}` },
    mutationFn: async (identity: RecipeContributionIdentity) => {
      const result = await runRecipeContributionCommand("DELETE", {
        recipeIds: [identity.recipeId],
        idempotencyKey: crypto.randomUUID(),
      })
      return { ...result, ownerUserId, identity }
    },
    onSuccess: (result) => {
      reconcileAuthoritativeResult(queryClient, result.ownerUserId, result)
    },
  })
}

export function useAddToShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)

  return useMutation({
    scope: { id: `${SHOPPING_LIST_WRITE_SCOPE_ID}:${ownerUserId}` },
    mutationFn: async ({
      recipeIds,
      scale = 1,
      idempotencyKey = crypto.randomUUID(),
    }: {
      recipeIds: string[]
      scale?: number
      idempotencyKey?: string
    }) => {
      const result = await runRecipeContributionCommand("POST", {
        recipeIds,
        scale,
        idempotencyKey,
      })
      return {
        ...result,
        ownerUserId,
        added: result.added || 0,
        merged: result.merged || 0,
      }
    },
    onSuccess: (result) => {
      reconcileAuthoritativeResult(queryClient, result.ownerUserId, result)
    },
  })
}
