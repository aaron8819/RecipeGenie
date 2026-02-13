'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecipeShare } from '@/types/database';
import { useAuthContext } from '@/lib/auth-context';

function sharesKey(userId: string | undefined) {
  return ['recipe_shares', userId] as const;
}

function inboxKey(userId: string | undefined) {
  return [...sharesKey(userId), 'inbox'] as const;
}

function sentKey(userId: string | undefined) {
  return [...sharesKey(userId), 'sent'] as const;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const json = await response.json();
    if (json?.error && typeof json.error === 'string') {
      return json.error;
    }
  } catch {
    // noop
  }
  return `Request failed (${response.status})`;
}

export function useIncomingRecipeShares() {
  const { user } = useAuthContext();

  return useQuery({
    queryKey: inboxKey(user?.id),
    queryFn: async () => {
      const response = await fetch('/api/recipe-shares/inbox');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      return (await response.json()) as RecipeShare[];
    },
    enabled: !!user,
    staleTime: 15 * 1000,
  });
}

export function useSentRecipeShares() {
  const { user } = useAuthContext();

  return useQuery({
    queryKey: sentKey(user?.id),
    queryFn: async () => {
      const response = await fetch('/api/recipe-shares/sent');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      return (await response.json()) as RecipeShare[];
    },
    enabled: !!user,
    staleTime: 15 * 1000,
  });
}

export function useCreateRecipeShare() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  return useMutation({
    mutationFn: async (input: {
      recipeId: string;
      recipientEmail: string;
      message?: string;
    }) => {
      const response = await fetch('/api/recipe-shares', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      return (await response.json()) as {
        id: string;
        status: string;
        deduplicated?: boolean;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sentKey(user?.id) });
    },
  });
}

export function useAcceptRecipeShare() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  return useMutation({
    mutationFn: async (shareId: string) => {
      const response = await fetch(`/api/recipe-shares/${shareId}/accept`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      return (await response.json()) as { acceptedRecipeId: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKey(user?.id) });
      queryClient.invalidateQueries({ queryKey: sentKey(user?.id) });
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useDeclineRecipeShare() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();

  return useMutation({
    mutationFn: async (shareId: string) => {
      const response = await fetch(`/api/recipe-shares/${shareId}/decline`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      return (await response.json()) as { status: string; id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inboxKey(user?.id) });
      queryClient.invalidateQueries({ queryKey: sentKey(user?.id) });
    },
  });
}

export const RECIPE_SHARES_KEY = {
  sharesKey,
  inboxKey,
  sentKey,
};
