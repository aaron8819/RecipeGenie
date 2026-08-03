"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { usePathname } from "next/navigation"
import { AuthForm } from "@/components/auth/auth-form"
import { BottomNav, FirstRunOnboarding, Header } from "@/components/layout"
import { useFirstRunOnboarding } from "@/components/layout/first-run-onboarding"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

function decodeAuthDescription(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "))
  } catch {
    return "Authentication failed. Please try signing in again."
  }
}

function getAuthErrorMessage(
  error: string,
  errorCode: string | null,
  errorDescription: string | null
): string {
  if (errorCode === "otp_expired" || errorCode === "link_expired") {
    return "The confirmation link has expired. Please request a new confirmation email."
  }
  if (errorCode === "pkce_code_verifier_not_found") {
    return "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed."
  }
  if (errorDescription) return decodeAuthDescription(errorDescription)
  if (error === "access_denied") {
    return "Access denied. The confirmation link may be invalid or expired."
  }
  if (error === "pkce_error") {
    return "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed."
  }
  return "Authentication error occurred."
}

export function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const [authError, setAuthError] = useState<string | null>(null)
  const pathname = usePathname()
  const { user, loading, signOut, isAuthenticated } = useAuthContext()
  const { showOnboarding, completeOnboarding } = useFirstRunOnboarding()

  useEffect(() => {
    const url = new URL(window.location.href)
    const code = url.searchParams.get("code")

    if (code && !isAuthenticated) {
      void getSupabase().auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          const isPkceError =
            error.message?.includes("PKCE") ||
            error.message?.includes("code verifier")
          setAuthError(
            isPkceError
              ? "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed."
              : error.message || "Failed to confirm email. Please try signing in directly."
          )
        }
        url.searchParams.delete("code")
        window.history.replaceState({}, "", url.toString())
      })
      return
    }

    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const error = url.searchParams.get("error") || hashParams.get("error")
    if (!error) return

    const errorCode =
      url.searchParams.get("error_code") || hashParams.get("error_code")
    const errorDescription =
      url.searchParams.get("error_description") ||
      hashParams.get("error_description")

    setAuthError(getAuthErrorMessage(error, errorCode, errorDescription))
    url.searchParams.delete("error")
    url.searchParams.delete("error_code")
    url.searchParams.delete("error_description")
    url.hash = ""
    window.history.replaceState({}, "", url.toString())
  }, [isAuthenticated])

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <AuthForm initialError={authError} />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-background pb-[var(--bottom-nav-safe-height)] md:pb-6 md:pt-[var(--header-height)]">
      <div className="recipe-detail-print-hidden">
        <Header userEmail={user?.email} onSignOut={() => void signOut()} />
      </div>

      <div
        className={cn(
          "container mx-auto w-full max-w-full",
          /^\/recipes\/[^/]+$/.test(pathname) ? "p-0" : "px-4 py-4"
        )}
      >
        {children}
      </div>

      <div className="recipe-detail-print-hidden">
        <BottomNav />
      </div>

      <FirstRunOnboarding
        open={showOnboarding}
        onComplete={completeOnboarding}
      />
    </main>
  )
}
