"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { PantryItem } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { normalizePantryItemName, parsePantryCandidates, getPantryFailureInput } from "@/lib/pantry"
import { getSupabase } from "@/lib/supabase/client"
import { pantryKeys, principalId } from "@/lib/query-keys"

export const PANTRY_WRITE_SCOPE_ID = "pantry-write"
type SupabaseWriteError = { code?: string; message: string } | null

export type PantryAddOutcomeStatus = "success" | "duplicate" | "failure"

export interface PantryAddOutcome {
  input: string
  normalizedItem: string
  status: PantryAddOutcomeStatus
  item?: PantryItem
  error?: string
}

export interface PantryAddResult {
  outcomes: PantryAddOutcome[]
  unresolvedInput: string
}

function sortPantryItems(items: PantryItem[]): PantryItem[] {
  return [...items].sort((a, b) => a.item.localeCompare(b.item))
}

function createOptimisticPantryItem(userId: string, item: string): PantryItem {
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: userId,
    item,
    created_at: new Date().toISOString(),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505"
}

async function insertPantryItem(
  userId: string,
  item: string,
  id?: string
): Promise<PantryItem> {
  const supabase = getSupabase()
  const pantryInsert = supabase.from("pantry_items") as unknown as {
    insert: (values: { id?: string; user_id: string; item: string }) => {
      select: () => {
        single: () => Promise<{ data: PantryItem | null; error: SupabaseWriteError }>
      }
    }
  }

  const { data, error } = await pantryInsert
    .insert(id ? { id, user_id: userId, item } : { user_id: userId, item })
    .select()
    .single()

  if (error) throw error
  return data as PantryItem
}

/**
 * Hook to fetch all pantry items
 */
export function usePantryItems() {
  const { user, loading } = useAuthContext()
  const pantryKey = pantryKeys.list(principalId(user?.id))

  return useQuery({
    queryKey: pantryKey,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("pantry_items")
        .select("*")
        .order("item", { ascending: true })

      if (error) throw error
      return data as PantryItem[]
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000,
    enabled: !loading && !!user,
  })
}

/**
 * Hook to add pantry items from raw comma-separated input.
 * Returns structured per-item outcomes instead of swallowing failures.
 */
export function useAddPantryItems() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const pantryKey = pantryKeys.list(principalId(user?.id))

  return useMutation({
    scope: { id: `${PANTRY_WRITE_SCOPE_ID}:${principalId(user?.id)}` },
    mutationFn: async (rawInput: string): Promise<PantryAddResult> => {
      const candidates = parsePantryCandidates(rawInput)
      const knownItems = new Set(
        (queryClient.getQueryData<PantryItem[]>(pantryKey) || []).map((item) => item.item)
      )
      const outcomes: PantryAddOutcome[] = []
      const insertedItems: PantryItem[] = []

      for (const candidate of candidates) {
        const normalizedItem = normalizePantryItemName(candidate)
        if (knownItems.has(normalizedItem)) {
          outcomes.push({
            input: candidate,
            normalizedItem,
            status: "duplicate",
          })
          continue
        }

        try {
          const insertedItem = await insertPantryItem(user!.id, normalizedItem, crypto.randomUUID())
          knownItems.add(normalizedItem)
          insertedItems.push(insertedItem)
          outcomes.push({
            input: candidate,
            normalizedItem,
            status: "success",
            item: insertedItem,
          })
        } catch (error) {
          if (isUniqueViolation(error)) {
            knownItems.add(normalizedItem)
            outcomes.push({
              input: candidate,
              normalizedItem,
              status: "duplicate",
            })
            continue
          }

          outcomes.push({
            input: candidate,
            normalizedItem,
            status: "failure",
            error: error instanceof Error ? error.message : "Failed to add pantry item",
          })
        }
      }

      if (insertedItems.length > 0) {
        queryClient.setQueryData<PantryItem[]>(
          pantryKey,
          (old) => sortPantryItems([...(old || []), ...insertedItems.filter((item) =>
            !(old || []).some((existing) => existing.id === item.id)
          )])
        )
      }

      return {
        outcomes,
        unresolvedInput: getPantryFailureInput(outcomes),
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pantryKey })
    },
  })
}

/**
 * Hook to restore a previously removed pantry item.
 * Reuses the same item id so undo targets the exact entity.
 */
export function useRestorePantryItem() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const pantryKey = pantryKeys.list(principalId(user?.id))

  return useMutation({
    scope: { id: `${PANTRY_WRITE_SCOPE_ID}:${principalId(user?.id)}` },
    mutationFn: async (item: PantryItem) => {
      try {
        return await insertPantryItem(user!.id, item.item, item.id)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error

        const supabase = getSupabase()
        const { data, error: fetchError } = await supabase
          .from("pantry_items")
          .select("*")
          .eq("user_id", user!.id)
          .eq("item", item.item)
          .single()

        if (fetchError) throw fetchError
        return data as PantryItem
      }
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: pantryKey })
      const previousPantry = queryClient.getQueryData<PantryItem[]>(pantryKey)

      queryClient.setQueryData<PantryItem[]>(
        pantryKey,
        (old) => {
          if (!old) return [item]
          if (old.some((existing) => existing.id === item.id || existing.item === item.item)) {
            return old
          }
          return sortPantryItems([...old, item])
        }
      )

      return { ownerUserId: principalId(user?.id), previousPantry }
    },
    onError: (_error, _item, context) => {
      if (context?.previousPantry) {
        queryClient.setQueryData(pantryKey, context.previousPantry)
      }
    },
    onSuccess: (restoredItem) => {
      queryClient.setQueryData<PantryItem[]>(
        pantryKey,
        (old) => {
          const next = (old || []).filter((candidate) => candidate.id !== restoredItem.id && candidate.item !== restoredItem.item)
          return sortPantryItems([...next, restoredItem])
        }
      )
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pantryKey })
    },
  })
}

/**
 * Hook to remove a pantry item using stable row identity.
 */
export function useRemovePantryItem() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()
  const pantryKey = pantryKeys.list(principalId(user?.id))

  return useMutation({
    scope: { id: `${PANTRY_WRITE_SCOPE_ID}:${principalId(user?.id)}` },
    mutationFn: async (item: PantryItem) => {
      const supabase = getSupabase()
      const { error } = await supabase
        .from("pantry_items")
        .delete()
        .eq("user_id", user!.id)
        .eq("id", item.id)

      if (error) throw error
      return item
    },
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: pantryKey })
      const previousPantry = queryClient.getQueryData<PantryItem[]>(pantryKey)

      queryClient.setQueryData<PantryItem[]>(
        pantryKey,
        (old) => old?.filter((candidate) => candidate.id !== item.id)
      )

      return { ownerUserId: principalId(user?.id), previousPantry }
    },
    onError: (_error, _item, context) => {
      if (context?.previousPantry) {
        queryClient.setQueryData(pantryKey, context.previousPantry)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: pantryKey })
    },
  })
}

export function createPendingPantryUndoItem(itemName: string, userId: string): PantryItem {
  return createOptimisticPantryItem(userId, normalizePantryItemName(itemName))
}
