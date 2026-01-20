"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { PantryItem } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultConfig } from "@/lib/guest-storage"

const PANTRY_KEY = ["pantry"]
const CONFIG_KEY = ["user_config"]

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Hook to fetch all pantry items
 */
export function usePantryItems() {
  const { isGuest } = useAuthContext()

  return useQuery({
    queryKey: [...PANTRY_KEY, isGuest],
    queryFn: async () => {
      if (isGuest) return [] as PantryItem[]

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("pantry_items")
        .select("*")
        .order("item", { ascending: true })

      if (error) throw error
      return data as PantryItem[]
    },
    initialData: isGuest ? [] : undefined,
    // Show cached data immediately while refetching (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    enabled: !isGuest,
  })
}

/**
 * Hook to add a pantry item
 * Implements optimistic updates for instant UI feedback
 */
export function useAddPantryItem() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (itemName: string) => {
      const normalizedItem = itemName.toLowerCase().trim()
      const now = new Date().toISOString()

      if (isGuest) {
        return { user_id: "guest", item: normalizedItem, created_at: now } as PantryItem
      }

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("pantry_items")
        .insert({ user_id: user?.id, item: normalizedItem })
        .select()
        .single()

      if (error) throw error
      return data as PantryItem
    },
    // Optimistic update
    onMutate: async (itemName) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: PANTRY_KEY })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<PantryItem[]>({ queryKey: PANTRY_KEY })

      const normalizedItem = itemName.toLowerCase().trim()
      const now = new Date().toISOString()
      const optimisticItem: PantryItem = {
        user_id: isGuest ? "guest" : user?.id || "",
        item: normalizedItem,
        created_at: now,
      }

      // Optimistically add to all pantry queries
      queryClient.setQueriesData<PantryItem[]>(
        { queryKey: PANTRY_KEY },
        (old) => {
          if (!old) return [optimisticItem]
          if (old.some((p) => p.item === normalizedItem)) return old
          return [...old, optimisticItem].sort((a, b) => a.item.localeCompare(b.item))
        }
      )

      return { previousQueries }
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (newItem) => {
      // Update with server response
      queryClient.setQueriesData<PantryItem[]>(
        { queryKey: PANTRY_KEY },
        (old) => {
          if (!old) return [newItem]
          // Replace optimistic with real data
          const filtered = old.filter((p) => p.item !== newItem.item)
          return [...filtered, newItem].sort((a, b) => a.item.localeCompare(b.item))
        }
      )
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: PANTRY_KEY })
    },
  })
}

/**
 * Hook to remove a pantry item
 * Implements optimistic updates for instant UI feedback
 */
export function useRemovePantryItem() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (itemName: string) => {
      const normalizedItem = itemName.toLowerCase().trim()

      if (isGuest) return normalizedItem

      const supabase = getSupabase()
      const { error } = await supabase
        .from("pantry_items")
        .delete()
        .eq("user_id", user?.id)
        .eq("item", normalizedItem)

      if (error) throw error
      return normalizedItem
    },
    // Optimistic update
    onMutate: async (itemName) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: PANTRY_KEY })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<PantryItem[]>({ queryKey: PANTRY_KEY })

      const normalizedItem = itemName.toLowerCase().trim()

      // Optimistically remove from all pantry queries
      queryClient.setQueriesData<PantryItem[]>(
        { queryKey: PANTRY_KEY },
        (old) => old?.filter((p) => p.item !== normalizedItem)
      )

      return { previousQueries }
    },
    onError: (err, itemName, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (removedItem) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: PANTRY_KEY })
    },
  })
}

/**
 * Hook to fetch excluded keywords
 */
export function useExcludedKeywords() {
  const { isGuest } = useAuthContext()

  return useQuery({
    queryKey: [...CONFIG_KEY, "excluded_keywords", isGuest],
    queryFn: async () => {
      if (isGuest) return [] as string[]

      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .single()

      if (error) {
        console.warn("Config not found:", error.message)
        return []
      }
      return (data?.excluded_keywords as string[]) || []
    },
    initialData: isGuest ? [] : undefined,
    // Show cached data immediately while refetching (stale-while-revalidate)
    placeholderData: (previousData) => previousData,
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    enabled: !isGuest,
  })
}

/**
 * Hook to add an excluded keyword
 * Implements optimistic updates for instant UI feedback
 */
export function useAddExcludedKeyword() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (keyword: string) => {
      const normalizedKeyword = keyword.toLowerCase().trim()

      if (isGuest) {
        const current = queryClient.getQueryData<string[]>([...CONFIG_KEY, "excluded_keywords", true]) || []
        if (current.includes(normalizedKeyword)) {
          throw new Error("Keyword already exists")
        }
        return normalizedKeyword
      }

      const supabase = getSupabase()
      const { data: config } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .eq("user_id", user?.id)
        .maybeSingle()

      const currentKeywords = (config?.excluded_keywords as string[]) || []
      if (currentKeywords.includes(normalizedKeyword)) {
        throw new Error("Keyword already exists")
      }

      if (config) {
        // Update existing config
        const { error } = await supabase
          .from("user_config")
          .update({ excluded_keywords: [...currentKeywords, normalizedKeyword] })
          .eq("user_id", user?.id)
        if (error) throw error
      } else {
        // Insert new config (shouldn't happen normally, but handle it)
        const { error } = await supabase
          .from("user_config")
          .insert({
            user_id: user?.id,
            excluded_keywords: [normalizedKeyword],
            categories: ["chicken", "turkey", "steak", "beef", "lamb", "vegetarian"],
            default_selection: { chicken: 2, turkey: 1, steak: 1 },
            category_overrides: {},
            history_exclusion_days: 10,
            week_start_day: 1,
          })
        if (error) throw error
      }
      return normalizedKeyword
    },
    // Optimistic update
    onMutate: async (keyword) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: [...CONFIG_KEY, "excluded_keywords"] })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<string[]>({ queryKey: [...CONFIG_KEY, "excluded_keywords"] })

      const normalizedKeyword = keyword.toLowerCase().trim()

      // Optimistically add to all excluded keywords queries
      queryClient.setQueriesData<string[]>(
        { queryKey: [...CONFIG_KEY, "excluded_keywords"] },
        (old) => {
          if (!old) return [normalizedKeyword]
          if (old.includes(normalizedKeyword)) return old
          return [...old, normalizedKeyword]
        }
      )

      return { previousQueries }
    },
    onError: (err, keyword, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (newKeyword) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: [...CONFIG_KEY, "excluded_keywords"] })
    },
  })
}

/**
 * Hook to remove an excluded keyword
 * Implements optimistic updates for instant UI feedback
 */
export function useRemoveExcludedKeyword() {
  const queryClient = useQueryClient()
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (keyword: string) => {
      const normalizedKeyword = keyword.toLowerCase().trim()

      if (isGuest) return normalizedKeyword

      const supabase = getSupabase()
      const { data: config } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .eq("user_id", user?.id)
        .maybeSingle()

      if (!config) {
        // Config doesn't exist, nothing to remove
        return normalizedKeyword
      }

      const currentKeywords = (config.excluded_keywords as string[]) || []
      const updatedKeywords = currentKeywords.filter((k) => k !== normalizedKeyword)

      const { error } = await supabase
        .from("user_config")
        .update({ excluded_keywords: updatedKeywords })
        .eq("user_id", user?.id)

      if (error) throw error
      return normalizedKeyword
    },
    // Optimistic update
    onMutate: async (keyword) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: [...CONFIG_KEY, "excluded_keywords"] })

      // Snapshot previous values for rollback
      const previousQueries = queryClient.getQueriesData<string[]>({ queryKey: [...CONFIG_KEY, "excluded_keywords"] })

      const normalizedKeyword = keyword.toLowerCase().trim()

      // Optimistically remove from all excluded keywords queries
      queryClient.setQueriesData<string[]>(
        { queryKey: [...CONFIG_KEY, "excluded_keywords"] },
        (old) => old?.filter((k) => k !== normalizedKeyword)
      )

      return { previousQueries }
    },
    onError: (err, keyword, context) => {
      // Rollback on error
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data)
        })
      }
    },
    onSuccess: (removedKeyword) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: [...CONFIG_KEY, "excluded_keywords"] })
    },
  })
}
