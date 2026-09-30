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
  const { [input.oldRecipeId]: _removed, ...remainingAssignments } =
    assignments;
  // One guarded UPDATE, never remove/add or an upsert. Existing UUID triggers
  // validate replacement ownership and maintain the legacy mirrors in SQL.
  const { data: saved, error: saveError } = await supabase
    .from('weekly_plans')
    .update({
      recipe_uuids: plan.recipe_uuids.map((id) =>
        id === input.oldRecipeId ? input.replacementRecipeId : id,
      ),
      day_assignment_recipe_uuids: {
        ...remainingAssignments,
        [input.replacementRecipeId]: input.dayOfWeek,
      },
    })
    .eq('user_id', userId)
    .eq('week_date', input.weekDate)
    .filter('recipe_uuids', 'eq', `{${plan.recipe_uuids.join(',')}}`)
    .filter('made_recipe_uuids', 'eq', `{${plan.made_recipe_uuids.join(',')}}`)
    .eq(
      'day_assignment_recipe_uuids',
      JSON.stringify(plan.day_assignment_recipe_uuids),
    )
    .select('*')
    .maybeSingle();
  if (saveError) throw saveError;
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
