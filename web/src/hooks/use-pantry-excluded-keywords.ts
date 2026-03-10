"use client"

import { useCallback, useMemo } from "react"
import { parsePantryCandidates, normalizePantryItemName, getPantryFailureInput } from "@/lib/pantry"
import {
  useUpdateExcludedKeywords,
  useUserConfig,
} from "@/hooks/shared/user-config"

export type PantryKeywordOutcomeStatus = "success" | "duplicate" | "failure"

export interface PantryKeywordOutcome {
  input: string
  normalizedKeyword: string
  status: PantryKeywordOutcomeStatus
  error?: string
}

export interface PantryKeywordMutationResult {
  outcomes: PantryKeywordOutcome[]
  unresolvedInput: string
}

export function usePantryExcludedKeywords() {
  const configQuery = useUserConfig()
  const updateExcludedKeywords = useUpdateExcludedKeywords()

  const excludedKeywords = useMemo(
    () => configQuery.data?.excluded_keywords ?? [],
    [configQuery.data]
  )

  const addKeywordsMutateAsync = useCallback(
    async (rawInput: string): Promise<PantryKeywordMutationResult> => {
      const candidates = parsePantryCandidates(rawInput)
      const currentKeywords = new Set(excludedKeywords)
      const outcomes: PantryKeywordOutcome[] = []
      const nextKeywords = [...excludedKeywords]

      for (const candidate of candidates) {
        const normalizedKeyword = normalizePantryItemName(candidate)
        if (currentKeywords.has(normalizedKeyword)) {
          outcomes.push({
            input: candidate,
            normalizedKeyword,
            status: "duplicate",
          })
          continue
        }

        currentKeywords.add(normalizedKeyword)
        nextKeywords.push(normalizedKeyword)
        outcomes.push({
          input: candidate,
          normalizedKeyword,
          status: "success",
        })
      }

      const didChange = outcomes.some((outcome) => outcome.status === "success")
      if (didChange) {
        try {
          await updateExcludedKeywords.mutateAsync(nextKeywords)
        } catch (error) {
          return {
            outcomes: outcomes.map((outcome) =>
              outcome.status === "success"
                ? {
                    ...outcome,
                    status: "failure",
                    error: error instanceof Error ? error.message : "Failed to update excluded keywords",
                  }
                : outcome
            ),
            unresolvedInput: getPantryFailureInput(
              outcomes.map((outcome) =>
                outcome.status === "success"
                  ? { ...outcome, status: "failure" }
                  : outcome
              )
            ),
          }
        }
      }

      return {
        outcomes,
        unresolvedInput: getPantryFailureInput(outcomes),
      }
    },
    [excludedKeywords, updateExcludedKeywords]
  )

  const removeKeywordMutateAsync = useCallback(
    async (keyword: string) => {
      const normalizedKeyword = normalizePantryItemName(keyword)
      const nextKeywords = excludedKeywords.filter(
        (currentKeyword) => currentKeyword !== normalizedKeyword
      )

      await updateExcludedKeywords.mutateAsync(nextKeywords)
      return normalizedKeyword
    },
    [excludedKeywords, updateExcludedKeywords]
  )

  return {
    data: excludedKeywords,
    isLoading: configQuery.isLoading,
    isFetching: configQuery.isFetching,
    addKeywords: {
      mutateAsync: addKeywordsMutateAsync,
      mutate: (rawInput: string) => {
        void addKeywordsMutateAsync(rawInput)
      },
      isPending: updateExcludedKeywords.isPending,
    },
    removeKeyword: {
      mutateAsync: removeKeywordMutateAsync,
      mutate: (keyword: string) => {
        void removeKeywordMutateAsync(keyword)
      },
      isPending: updateExcludedKeywords.isPending,
    },
  }
}
