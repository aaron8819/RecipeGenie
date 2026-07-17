'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuthContext } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase/client';
import type { PlanTemplate } from '@/types/database';
import { principalId, templateKeys } from '@/lib/query-keys';
import { mapPlanTemplateRow } from '@/lib/recipe-identity';

/**
 * Fetch all plan templates for the current user.
 */
export function usePlanTemplates() {
  const { user } = useAuthContext();

  return useQuery({
    queryKey: templateKeys.list(principalId(user?.id)),
    queryFn: async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('plan_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(mapPlanTemplateRow);
    },
    enabled: !!user,
  });
}

/**
 * Save the current plan as a named template.
 */
export function useSavePlanTemplate() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const ownerUserId = principalId(user?.id);

  return useMutation({
    mutationFn: async ({
      name,
      recipeIds,
      dayAssignments,
      categorySelection,
    }: {
      name: string;
      recipeIds: string[];
      dayAssignments?: Record<string, number> | null;
      categorySelection?: Record<string, number> | null;
    }) => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('plan_templates')
        .insert({
          user_id: user!.id,
          name,
          recipe_uuids: recipeIds,
          day_assignment_recipe_uuids: dayAssignments || null,
          category_selection:
            categorySelection || null,
        })
        .select()
        .single();

      if (error) throw error;
      return mapPlanTemplateRow(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.all(ownerUserId),
      });
    },
  });
}

/**
 * Rename a plan template.
 */
export function useRenamePlanTemplate() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const ownerUserId = principalId(user?.id);

  return useMutation({
    mutationFn: async ({
      templateId,
      name,
    }: {
      templateId: string;
      name: string;
    }) => {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('plan_templates')
        .update({ name })
        .eq('id', templateId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.all(ownerUserId),
      });
    },
  });
}

/**
 * Delete a plan template.
 */
export function useDeletePlanTemplate() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const ownerUserId = principalId(user?.id);

  return useMutation({
    mutationFn: async (templateId: string) => {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('plan_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: templateKeys.all(ownerUserId),
      });
    },
  });
}
