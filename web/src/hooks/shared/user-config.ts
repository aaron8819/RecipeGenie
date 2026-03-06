"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { UserConfig } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { resolveUserConfig } from "@/lib/user-config"

const CONFIG_KEY = ["user_config"]
const CATEGORY_QUERY_KEY = [...CONFIG_KEY, "categories"]
const DEFAULT_CATEGORY_ORDER = ["chicken", "beef", "lamb", "turkey", "vegetarian"]

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
        // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
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
          // @ts-expect-error - TypeScript incorrectly infers upsert parameter type as 'never'
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
