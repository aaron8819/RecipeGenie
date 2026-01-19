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
    enabled: !isGuest,
  })
}

/**
 * Hook to add a pantry item
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
    onSuccess: (newItem) => {
      queryClient.setQueriesData<PantryItem[]>(
        { queryKey: PANTRY_KEY },
        (old) => {
          if (!old) return [newItem]
          if (old.some((p) => p.item === newItem.item)) return old
          return [...old, newItem].sort((a, b) => a.item.localeCompare(b.item))
        }
      )
    },
  })
}

/**
 * Hook to remove a pantry item
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
    onSuccess: (removedItem) => {
      queryClient.setQueriesData<PantryItem[]>(
        { queryKey: PANTRY_KEY },
        (old) => old?.filter((p) => p.item !== removedItem)
      )
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
    enabled: !isGuest,
  })
}

/**
 * Hook to add an excluded keyword
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
    onSuccess: (newKeyword) => {
      queryClient.setQueriesData<string[]>(
        { queryKey: [...CONFIG_KEY, "excluded_keywords"] },
        (old) => (old ? [...old, newKeyword] : [newKeyword])
      )
    },
  })
}

/**
 * Hook to remove an excluded keyword
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
    onSuccess: (removedKeyword) => {
      queryClient.setQueriesData<string[]>(
        { queryKey: [...CONFIG_KEY, "excluded_keywords"] },
        (old) => old?.filter((k) => k !== removedKeyword)
      )
    },
  })
}
