"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { createBrowserClient } from "@supabase/ssr"
import type { PantryItem } from "@/types/database"

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
  return useQuery({
    queryKey: PANTRY_KEY,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("pantry_items")
        .select("*")
        .order("item", { ascending: true })

      if (error) throw error
      return data as PantryItem[]
    },
  })
}

/**
 * Hook to add a pantry item
 */
export function useAddPantryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (itemName: string) => {
      const supabase = getSupabase()
      const normalizedItem = itemName.toLowerCase().trim()

      const { data, error } = await supabase
        .from("pantry_items")
        .insert({ item: normalizedItem })
        .select()
        .single()

      if (error) throw error
      return data as PantryItem
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PANTRY_KEY })
    },
  })
}

/**
 * Hook to remove a pantry item
 */
export function useRemovePantryItem() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (itemName: string) => {
      const supabase = getSupabase()
      const { error } = await supabase
        .from("pantry_items")
        .delete()
        .eq("item", itemName.toLowerCase().trim())

      if (error) throw error
      return itemName
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PANTRY_KEY })
    },
  })
}

/**
 * Hook to fetch excluded keywords
 */
export function useExcludedKeywords() {
  return useQuery({
    queryKey: [...CONFIG_KEY, "excluded_keywords"],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .eq("id", 1)
        .single()

      if (error) {
        console.warn("Config not found:", error.message)
        return []
      }
      return (data?.excluded_keywords as string[]) || []
    },
  })
}

/**
 * Hook to add an excluded keyword
 */
export function useAddExcludedKeyword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (keyword: string) => {
      const supabase = getSupabase()
      const normalizedKeyword = keyword.toLowerCase().trim()

      // First get current keywords
      const { data: config } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .eq("id", 1)
        .single()

      const currentKeywords = (config?.excluded_keywords as string[]) || []

      if (currentKeywords.includes(normalizedKeyword)) {
        throw new Error("Keyword already exists")
      }

      const { error } = await supabase
        .from("user_config")
        .update({ excluded_keywords: [...currentKeywords, normalizedKeyword] })
        .eq("id", 1)

      if (error) throw error
      return normalizedKeyword
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY })
    },
  })
}

/**
 * Hook to remove an excluded keyword
 */
export function useRemoveExcludedKeyword() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (keyword: string) => {
      const supabase = getSupabase()
      const normalizedKeyword = keyword.toLowerCase().trim()

      // First get current keywords
      const { data: config } = await supabase
        .from("user_config")
        .select("excluded_keywords")
        .eq("id", 1)
        .single()

      const currentKeywords = (config?.excluded_keywords as string[]) || []
      const updatedKeywords = currentKeywords.filter(
        (k: string) => k !== normalizedKeyword
      )

      const { error } = await supabase
        .from("user_config")
        .update({ excluded_keywords: updatedKeywords })
        .eq("id", 1)

      if (error) throw error
      return keyword
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY })
    },
  })
}
