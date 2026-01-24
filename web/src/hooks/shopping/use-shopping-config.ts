"use client"

/**
 * Shopping configuration hooks
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { UserConfig } from "@/types/database"
import { useAuthContext } from "@/lib/auth-context"
import { getDefaultConfig } from "@/lib/guest-storage"
import { getSupabase } from "@/lib/supabase/client"
import { CONFIG_KEY } from "./shared"

/**
 * Hook to fetch user config for shopping settings
 */
export function useShoppingConfig() {
  const { isGuest } = useAuthContext()

  return useQuery({
    queryKey: [...CONFIG_KEY, isGuest],
    queryFn: async () => {
      if (isGuest) {
        return getDefaultConfig() as UserConfig
      }

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
  const { isGuest, user } = useAuthContext()

  return useMutation({
    mutationFn: async (updates: Partial<UserConfig>) => {
      if (isGuest) {
        // Guest mode doesn't persist config changes
        return updates
      }

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
          // @ts-expect-error - TypeScript incorrectly infers update parameter type as 'never'
          // This is a known issue with Supabase type inference in certain contexts
          .update(updates)
          .eq("user_id", user!.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from("user_config")
          // @ts-expect-error - TypeScript incorrectly infers insert parameter type as 'never'
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
