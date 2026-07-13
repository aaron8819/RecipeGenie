"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UserConfig } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { DEFAULT_USER_CONFIG, resolveUserConfig } from "@/lib/user-config"
import { normalizePantryItemName } from "@/lib/pantry"

export const CONFIG_KEY = ["user_config"]
const CATEGORY_QUERY_KEY = [...CONFIG_KEY, "categories"]
const DEFAULT_CATEGORY_ORDER = ["chicken", "beef", "lamb", "turkey", "vegetarian"]
export const USER_CONFIG_WRITE_SCOPE_ID = "user-config-write"

function sortDefaultCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    const indexA = DEFAULT_CATEGORY_ORDER.indexOf(a)
    const indexB = DEFAULT_CATEGORY_ORDER.indexOf(b)
    if (indexA === -1 && indexB === -1) return a.localeCompare(b)
    if (indexA === -1) return 1
    if (indexB === -1) return -1
    return indexA - indexB
  })
}

export function useUserConfig(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...CONFIG_KEY],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase.from("user_config").select("*").single()
      return resolveUserConfig(data as UserConfig | null, error)
    },
    enabled: options?.enabled ?? true,
  })
}

export function useUpdateUserConfig() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (updates: Partial<UserConfig>) => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .update(updates)
        .eq("user_id", user!.id)
        .select()
        .single()

      if (!error) {
        return data as UserConfig
      }

      if (error.code === "PGRST116") {
        const { data: upsertData, error: upsertError } = await supabase
          .from("user_config")
          .upsert({ user_id: user!.id, ...updates }, { onConflict: "user_id" })
          .select()
          .single()

        if (upsertError) throw upsertError
        return upsertData as UserConfig
      }

      throw error
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...CONFIG_KEY], data)
    },
  })
}

function normalizeExcludedKeywords(keywords: string[]): string[] {
  return Array.from(
    new Set(
      keywords
        .map((keyword) => normalizePantryItemName(keyword))
        .filter((keyword) => keyword.length > 0)
    )
  )
}

function buildOptimisticUserConfig(
  current: UserConfig | undefined,
  userId: string,
  excludedKeywords: string[]
): UserConfig {
  const baseConfig = current
    ? { ...current }
    : { ...DEFAULT_USER_CONFIG, user_id: userId }

  return {
    ...baseConfig,
    user_id: userId,
    excluded_keywords: excludedKeywords,
  }
}

export function useUpdateExcludedKeywords() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    scope: { id: USER_CONFIG_WRITE_SCOPE_ID },
    mutationFn: async (keywords: string[]) => {
      const excludedKeywords = normalizeExcludedKeywords(keywords)
      const supabase = getSupabase()

      const { data, error } = await supabase
        .from("user_config")
        .update({ excluded_keywords: excludedKeywords })
        .eq("user_id", user!.id)
        .select()
        .single()

      if (!error) {
        return resolveUserConfig(data as UserConfig | null, null)
      }

      if (error.code === "PGRST116") {
        const { data: upsertData, error: upsertError } = await supabase
          .from("user_config")
          .upsert(
            {
              ...DEFAULT_USER_CONFIG,
              user_id: user!.id,
              excluded_keywords: excludedKeywords,
            },
            { onConflict: "user_id" }
          )
          .select()
          .single()

        if (upsertError) throw upsertError
        return resolveUserConfig(upsertData as UserConfig | null, null)
      }

      throw error
    },
    onMutate: async (keywords) => {
      const excludedKeywords = normalizeExcludedKeywords(keywords)

      await queryClient.cancelQueries({ queryKey: [...CONFIG_KEY] })
      const previousConfig = queryClient.getQueryData<UserConfig>([...CONFIG_KEY])

      queryClient.setQueryData<UserConfig>(
        [...CONFIG_KEY],
        buildOptimisticUserConfig(previousConfig, user!.id, excludedKeywords)
      )

      return { previousConfig }
    },
    onError: (_error, _keywords, context) => {
      if (context?.previousConfig) {
        queryClient.setQueryData([...CONFIG_KEY], context.previousConfig)
        return
      }

      queryClient.removeQueries({ queryKey: [...CONFIG_KEY], exact: true })
    },
    onSuccess: (data) => {
      queryClient.setQueryData([...CONFIG_KEY], data)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [...CONFIG_KEY] })
    },
  })
}

export function useCategories() {
  return useQuery({
    queryKey: CATEGORY_QUERY_KEY,
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase.from("user_config").select("categories").single()

      if (error) {
        console.warn("Config not found, using defaults:", error.message)
        return sortDefaultCategories(["chicken", "beef", "lamb", "turkey", "vegetarian"])
      }

      const typedData = data as { categories?: string[] } | null
      const userCategories = typedData?.categories || []
      return userCategories.length > 0
        ? userCategories
        : sortDefaultCategories(["chicken", "beef", "lamb", "turkey", "vegetarian"])
    },
    staleTime: Infinity,
  })
}
