'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '@/lib/auth-context';
import { getSupabase } from '@/lib/supabase/client';
import { mapWeeklyPlanRow } from '@/lib/recipe-identity';
import { plannerKeys, principalId, recipeKeys } from '@/lib/query-keys';

export interface ReplacePlannedRecipeInput {
  weekDate: string;
  oldRecipeId: string;
  replacementRecipeId: string;
  dayOfWeek: number;
  expectedDayOfWeek: number | null;
}

export async function replacePlannedRecipe(
  supabase: ReturnType<typeof getSupabase>,
  userId: string | null,
  input: ReplacePlannedRecipeInput,
) {
  if (!userId) throw new Error('Sign in to swap a meal.');
  if (
    !Number.isInteger(input.dayOfWeek) ||
    input.dayOfWeek < 0 ||
    input.dayOfWeek > 6
  ) {
    throw new Error('Choose a scheduled day.');
  }
  const { data: plan, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('week_date', input.weekDate)
    .maybeSingle();
  if (error) throw error;
  if (!plan || !plan.recipe_uuids.includes(input.oldRecipeId)) {
    throw new Error(
      'This meal is no longer in the plan. Close and reopen Swap meal.',
    );
  }
  if (plan.made_recipe_uuids.includes(input.oldRecipeId)) {
    throw new Error('A cooked meal cannot be swapped.');
  }
  if (plan.recipe_uuids.includes(input.replacementRecipeId)) {
    throw new Error(
      'That recipe is already planned this week. Choose another recipe.',
    );
  }
  const assignments = plan.day_assignment_recipe_uuids as Record<
    string,
    number
  >;
  if ((assignments[input.oldRecipeId] ?? null) !== input.expectedDayOfWeek) {
    throw new Error(
      'This meal moved to another day. Close and reopen Swap meal.',
    );
  }
  // The RPC compares the same inspected plan fields under lock and serializes
  // with history writes, including cooking from another view.
  const { data: saved, error: saveError } = await supabase.rpc('replace_planned_recipe', {
    p_week_date: input.weekDate,
    p_old_recipe: input.oldRecipeId,
    p_replacement_recipe: input.replacementRecipeId,
    p_day: input.dayOfWeek,
    p_expected_day: input.expectedDayOfWeek,
    p_expected_recipes: plan.recipe_uuids,
    p_expected_made: plan.made_recipe_uuids,
    p_expected_assignments: plan.day_assignment_recipe_uuids,
    p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (saveError) throw new Error(saveError.message);
  if (!saved)
    throw new Error(
      'The plan changed while saving. Close and reopen Swap meal to review it.',
    );
  return mapWeeklyPlanRow(saved);
}

export function useReplacePlannedRecipe() {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const owner = principalId(user?.id);
  return useMutation({
    mutationFn: (input: ReplacePlannedRecipeInput) =>
      replacePlannedRecipe(getSupabase(), user?.id ?? null, input),
    onSuccess: (plan, input) => {
      queryClient.setQueryData(plannerKeys.week(owner, input.weekDate), plan);
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({
        queryKey: plannerKeys.week(owner, input.weekDate),
      });
      void queryClient.invalidateQueries({ queryKey: recipeKeys.all(owner) });
    },
  });
}
