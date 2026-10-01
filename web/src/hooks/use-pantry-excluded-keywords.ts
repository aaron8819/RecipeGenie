'use client';

import { parsePantryCandidates, getPantryFailureInput } from '@/lib/pantry';
import { createShoppingPurchaseKey } from '@/lib/shopping-list-normalization';
import { useSetShoppingExclusion, useShoppingConfig } from '@/hooks/use-shopping';

export type PantryKeywordOutcomeStatus = 'success' | 'duplicate' | 'failure';
export interface PantryKeywordOutcome {
  input: string;
  normalizedKeyword: string;
  status: PantryKeywordOutcomeStatus;
  error?: string;
}
export interface PantryKeywordMutationResult {
  outcomes: PantryKeywordOutcome[];
  unresolvedInput: string;
}

export function usePantryExcludedKeywords() {
  const config = useShoppingConfig();
  const update = useSetShoppingExclusion();
  const add = async (rawInput: string): Promise<PantryKeywordMutationResult> => {
    const outcomes: PantryKeywordOutcome[] = [];
    // Capture this mutation closure for the whole submission, including its owner.
    for (const input of parsePantryCandidates(rawInput)) {
      const normalizedKeyword = createShoppingPurchaseKey(input);
      try {
        const result = await update.mutateAsync({ keyword: input, enabled: true });
        outcomes.push({ input, normalizedKeyword, status: result === 'applied' ? 'success' : 'duplicate' });
      } catch (error) {
        // The document hook owns the visible error toast; retain failed input.
        outcomes.push({ input, normalizedKeyword, status: 'failure',
          error: error instanceof Error ? error.message : 'Could not save this exclusion.' });
      }
    }
    return { outcomes, unresolvedInput: getPantryFailureInput(outcomes) };
  };
  const remove = async (keyword: string) => {
    await update.mutateAsync({ keyword, enabled: false });
    return createShoppingPurchaseKey(keyword);
  };
  return {
    data: config.data?.excluded_keywords ?? [],
    isLoading: config.isLoading,
    isFetching: config.isFetching,
    addKeywords: {
      mutateAsync: add,
      mutate: (input: string) => { void add(input); },
      isPending: update.isPending,
    },
    removeKeyword: {
      mutateAsync: remove,
      // The mutation hook reports the error; fire-and-forget callers need no rejection.
      mutate: (keyword: string) => { void remove(keyword).catch(() => {}); },
      isPending: update.isPending,
    },
  };
}
