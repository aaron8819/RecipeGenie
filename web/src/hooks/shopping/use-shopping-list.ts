"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuthContext } from "@/lib/auth-context"
import { getActivePrincipalId } from "@/lib/principal-session"
import { principalId, shoppingKeys } from "@/lib/query-keys"
import { normalizeItemName } from "@/lib/shopping-list-normalization"
import { ensureShoppingListRowIds } from "@/lib/shopping-row-identity"
import { getSupabase } from "@/lib/supabase/client"
import { runRecipeContributionCommand } from "@/lib/shopping-contribution-client"
import type { ShoppingItem, ShoppingList } from "@/types/database"
import { SHOPPING_LIST_WRITE_SCOPE_ID } from "./shared"

export function useShoppingList() {
  const { user } = useAuthContext()

  return useQuery({
    queryKey: shoppingKeys.detail(principalId(user?.id)),
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("shopping_list")
        .select("*")
        .maybeSingle()

      if (error) throw error
      if (data) {
        const ensured = ensureShoppingListRowIds(data as ShoppingList)
        if (ensured.changed) {
          const { error: saveError } = await supabase
            .from("shopping_list")
            .update({
              items: ensured.shoppingList.items,
              already_have: ensured.shoppingList.already_have,
              excluded: ensured.shoppingList.excluded,
            })
            .eq("user_id", user!.id)
          if (saveError) throw saveError
        }
        return ensured.shoppingList
      }

      return {
        user_id: user?.id || "",
        items: [],
        already_have: [],
        excluded: [],
        source_recipes: [],
        scale: 1,
        total_servings: 0,
        custom_order: false,
        contribution_revision: 0,
        contribution_overrides: {},
        legacy_items_preserved: true,
        generated_at: new Date().toISOString(),
      } as ShoppingList
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    enabled: Boolean(user),
  })
}

export function preserveCheckedItemsFromExisting(
  generatedItems: ShoppingItem[],
  existingItems: ShoppingItem[]
): ShoppingItem[] {
  const checkedItemNames = new Set(
    existingItems
      .filter((item) => item.checked)
      .map((item) => normalizeItemName(item.item))
  )
  if (checkedItemNames.size === 0) return generatedItems
  return generatedItems.map((item) =>
    checkedItemNames.has(normalizeItemName(item.item))
      ? { ...item, checked: true }
      : item
  )
}

export function useClearShoppingList() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const ownerUserId = principalId(user?.id)

  return useMutation({
    scope: { id: `${SHOPPING_LIST_WRITE_SCOPE_ID}:${ownerUserId}` },
    mutationFn: async () => {
      const result = await runRecipeContributionCommand("DELETE", {
        recipeIds: [],
        clearAll: true,
        idempotencyKey: crypto.randomUUID(),
      })
      return { ...result, ownerUserId }
    },
    onSuccess: (result) => {
      if (getActivePrincipalId() !== result.ownerUserId) return
      queryClient.setQueryData(
        shoppingKeys.detail(result.ownerUserId),
        result.shopping_list
      )
    },
  })
}
