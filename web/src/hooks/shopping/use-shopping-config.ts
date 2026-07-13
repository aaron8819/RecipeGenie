"use client"

/**
 * Shopping configuration hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { UserConfig } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { CONFIG_KEY } from "./shared"

/**
 * Hook to fetch user config for shopping settings
 */
export function useShoppingConfig() {
  return useQuery({
    queryKey: [...CONFIG_KEY],
    queryFn: async () => {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from("user_config")
        .select("*")
        .maybeSingle()

      if (error) throw error
      return data as UserConfig | null
    },
  })
}

/**
 * Hook to update user config for shopping settings
 */
export function useUpdateShoppingConfig() {
  const queryClient = useQueryClient()
  const { user } = useAuthContext()

  return useMutation({
    mutationFn: async (updates: Partial<UserConfig>) => {
      const supabase = getSupabase()

      // Check if config exists
      const { data: existingConfig } = await supabase
        .from("user_config")
        .select("user_id")
        .eq("user_id", user!.id)
        .maybeSingle()

      if (existingConfig) {
        const { error } = await supabase
          .from("user_config")
          // This is a known issue with Supabase type inference in certain contexts
          .update(updates)
          .eq("user_id", user!.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("user_config")
          // This is a known issue with Supabase type inference in certain contexts
          .insert({
            user_id: user!.id,
            ...updates,
          })
        if (error) throw error
      }

      return updates
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONFIG_KEY })
    },
  })
}
