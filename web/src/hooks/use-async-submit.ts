"use client"

import { useCallback, useRef, useState } from "react"

interface UseAsyncSubmitOptions {
  getErrorMessage: (error: unknown) => string
}

interface RunAsyncSubmitOptions {
  onError?: (error: unknown) => void
  onSettled?: () => void
  onSuccess?: () => void
}

export function useAsyncSubmit({ getErrorMessage }: UseAsyncSubmitOptions) {
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)

  const clearError = useCallback(() => {
    setError(null)
  }, [])

  const reset = useCallback(() => {
    isSubmittingRef.current = false
    setIsSubmitting(false)
    setError(null)
  }, [])

  const run = useCallback(
    async (
      action: () => Promise<void>,
      options?: RunAsyncSubmitOptions
    ) => {
      if (isSubmittingRef.current) return false

      isSubmittingRef.current = true
      setIsSubmitting(true)
      setError(null)

      try {
        await action()
        options?.onSuccess?.()
        return true
      } catch (submissionError) {
        setError(getErrorMessage(submissionError))
        options?.onError?.(submissionError)
        return false
      } finally {
        isSubmittingRef.current = false
        setIsSubmitting(false)
        options?.onSettled?.()
      }
    },
    [getErrorMessage]
  )

  return {
    clearError,
    error,
    isSubmitting,
    reset,
    run,
  }
}
