import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  replacePlannedRecipe,
  type ReplacePlannedRecipeInput,
} from '../use-replace-planned-recipe';
import type { getSupabase } from '@/lib/supabase/client';

const input: ReplacePlannedRecipeInput = {
  weekDate: '2026-09-28',
  oldRecipeId: 'old',
  replacementRecipeId: 'new',
  expectedDayOfWeek: 1,
  dayOfWeek: 4,
};
let plan: {
  user_id: string;
  week_date: string;
  recipe_uuids: string[];
  made_recipe_uuids: string[];
  day_assignment_recipe_uuids: Record<string, number>;
  scale: number;
};
let conflict: boolean;
const updates = vi.fn();
const filters = vi.fn();
const client = {
  from: () => {
    let payload: Record<string, unknown> | undefined;
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters(column, value);
        return chain;
      },
      filter: (column: string, _operator: string, value: unknown) => {
        filters(column, value);
        return chain;
      },
      update: (values: Record<string, unknown>) => {
        payload = values;
        updates(values);
        return chain;
      },
      maybeSingle: async () => ({
        data: payload ? (conflict ? null : { ...plan, ...payload }) : plan,
        error: null,
      }),
    };
    return chain;
  },
} as unknown as ReturnType<typeof getSupabase>;

beforeEach(() => {
  updates.mockClear();
  filters.mockClear();
  conflict = false;
  plan = {
    user_id: 'owner',
    week_date: input.weekDate,
    recipe_uuids: ['other', 'old'],
    made_recipe_uuids: ['other'],
    day_assignment_recipe_uuids: { old: 1, other: 3 },
    scale: 2,
  };
});

describe('guarded planned recipe replacement', () => {
  it('writes membership and chosen day together, preserving unrelated data', async () => {
    const result = await replacePlannedRecipe(client, 'owner', input);
    expect(updates).toHaveBeenCalledExactlyOnceWith({
      recipe_uuids: ['other', 'new'],
      day_assignment_recipe_uuids: { other: 3, new: 4 },
    });
    expect(result.made_recipe_ids).toEqual(['other']);
    expect(result.scale).toBe(2);
    expect(filters).toHaveBeenCalledWith('user_id', 'owner');
    expect(filters).toHaveBeenCalledWith('recipe_uuids', '{other,old}');
    expect(filters).toHaveBeenCalledWith('made_recipe_uuids', '{other}');
    expect(filters).toHaveBeenCalledWith(
      'day_assignment_recipe_uuids',
      JSON.stringify({ old: 1, other: 3 }),
    );
  });
  it('stops when any guarded plan state changes before the write', async () => {
    conflict = true;
    await expect(replacePlannedRecipe(client, 'owner', input)).rejects.toThrow(
      'plan changed',
    );
    expect(updates).toHaveBeenCalledTimes(1);
  });
  it('rejects a cooked source without writing', async () => {
    plan.made_recipe_uuids.push('old');
    await expect(replacePlannedRecipe(client, 'owner', input)).rejects.toThrow(
      'cooked meal',
    );
    expect(updates).not.toHaveBeenCalled();
  });
  it('rejects duplicate membership and stale or moved source meals', async () => {
    await expect(
      replacePlannedRecipe(client, 'owner', {
        ...input,
        replacementRecipeId: 'other',
      }),
    ).rejects.toThrow('already planned');
    await expect(
      replacePlannedRecipe(client, 'owner', {
        ...input,
        oldRecipeId: 'missing',
      }),
    ).rejects.toThrow('no longer');
    await expect(
      replacePlannedRecipe(client, 'owner', { ...input, expectedDayOfWeek: 2 }),
    ).rejects.toThrow('moved');
    expect(updates).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated and invalid-day requests', async () => {
    await expect(replacePlannedRecipe(client, null, input)).rejects.toThrow(
      'Sign in',
    );
    await expect(
      replacePlannedRecipe(client, 'owner', { ...input, dayOfWeek: 7 }),
    ).rejects.toThrow('scheduled day');
    expect(updates).not.toHaveBeenCalled();
  });
});
