'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecipeShare } from '@/types/database';
import { useAuthContext } from '@/lib/auth-context';
import { principalId, recipeKeys, shareKeys } from '@/lib/query-keys';

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
    queryKey: shareKeys.inbox(principalId(user?.id)),
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
    queryKey: shareKeys.sent(principalId(user?.id)),
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
  const ownerUserId = principalId(user?.id);

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
      queryClient.invalidateQueries({ queryKey: shareKeys.sent(ownerUserId) });
    },
  });
}

export function useAcceptRecipeShare() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const ownerUserId = principalId(user?.id);

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
      queryClient.invalidateQueries({ queryKey: shareKeys.inbox(ownerUserId) });
      queryClient.invalidateQueries({ queryKey: shareKeys.sent(ownerUserId) });
      queryClient.invalidateQueries({ queryKey: recipeKeys.all(ownerUserId) });
    },
  });
}

export function useDeclineRecipeShare() {
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const ownerUserId = principalId(user?.id);

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
      queryClient.invalidateQueries({ queryKey: shareKeys.inbox(ownerUserId) });
      queryClient.invalidateQueries({ queryKey: shareKeys.sent(ownerUserId) });
    },
  });
}
