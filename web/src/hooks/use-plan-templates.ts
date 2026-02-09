'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuthContext } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase/client';
import type { PlanTemplate } from '@/types/database';

const TEMPLATES_KEY = ['plan-templates'];

/**
 * Fetch all plan templates for the current user.
 */
export function usePlanTemplates() {
  const { user } = useAuthContext();

  return useQuery({
    queryKey: [...TEMPLATES_KEY, user?.id],
    queryFn: async () => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('plan_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as PlanTemplate[];
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
        // @ts-expect-error - Supabase infers insert params as never
        .insert({
          user_id: user!.id,
          name,
          recipe_ids: recipeIds,
          day_assignments: dayAssignments || null,
          category_selection:
            categorySelection || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PlanTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: TEMPLATES_KEY,
      });
    },
  });
}

/**
 * Rename a plan template.
 */
export function useRenamePlanTemplate() {
  const queryClient = useQueryClient();

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
        // @ts-expect-error - Supabase infers update params as never
        .update({ name })
        .eq('id', templateId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: TEMPLATES_KEY,
      });
    },
  });
}

/**
 * Delete a plan template.
 */
export function useDeletePlanTemplate() {
  const queryClient = useQueryClient();

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
        queryKey: TEMPLATES_KEY,
      });
    },
  });
}
