"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { AuthProvider } from "@/lib/auth-context"
import { UndoToastProvider } from "@/components/ui/undo-toast"
import { ErrorBoundary } from "@/components/error-boundary"

export function Providers({
  children,
  initialSession,
}: {
  children: React.ReactNode
  initialSession?: Session | null
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  )

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider initialSession={initialSession}>
          <UndoToastProvider>{children}</UndoToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
