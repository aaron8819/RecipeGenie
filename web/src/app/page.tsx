"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { RecipeList } from "@/components/recipes"
import { AuthForm } from "@/components/auth/auth-form"
import { useRecipes } from "@/hooks/use-recipes"

// Non-default tabs are lazily mounted: components (and their query hooks) are not
// instantiated until the user first activates that tab, eliminating the 10+ concurrent
// Supabase queries that previously fired on every page load.
const TabLoader = () => (
  <div className="flex-1 flex items-center justify-center">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
)
const MealPlanner = dynamic(
  () => import("@/components/planner").then((m) => m.MealPlanner),
  { ssr: false, loading: TabLoader }
)
const PantryList = dynamic(
  () => import("@/components/pantry").then((m) => m.PantryList),
  { ssr: false, loading: TabLoader }
)
const ShoppingListView = dynamic(
  () => import("@/components/shopping").then((m) => m.ShoppingListView),
  { ssr: false, loading: TabLoader }
)
import { Header, BottomNav, FirstRunOnboarding } from "@/components/layout"
import { useFirstRunOnboarding } from "@/components/layout/first-run-onboarding"
import { useAuthContext } from "@/lib/auth-context"
import { getSupabase } from "@/lib/supabase/client"

const VALID_TABS = ["recipes", "planner", "pantry", "shopping"] as const
const STORAGE_KEY = "recipe-genie-active-tab"

// SSR-safe: same value on server and first client paint to avoid hydration mismatch
const DEFAULT_TAB = "recipes"

function getStoredTab(): string {
  if (typeof window === "undefined") return DEFAULT_TAB
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored && VALID_TABS.includes(stored as (typeof VALID_TABS)[number])
    ? stored
    : DEFAULT_TAB
}

export default function Home() {
  const [activeTab, setActiveTab] = useState(DEFAULT_TAB)
  // Tracks which tabs have been activated at least once. A tab is only mounted
  // (and its queries started) on first visit; after that it stays in the DOM.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([DEFAULT_TAB]))
  const [authError, setAuthError] = useState<string | null>(null)
  const {
    user,
    loading,
    signOut,
    isAuthenticated,
  } = useAuthContext()
  const { showOnboarding, completeOnboarding } = useFirstRunOnboarding()

  // Prefetch non-active tab data once the Recipes data has loaded.
  const queryClient = useQueryClient()
  const { data: recipes } = useRecipes()
  // Use a ref so the idle callback always sees the latest visited set without
  // adding visited to the effect's dependency array (which would re-run on every tab switch).
  const visitedRef = useRef(visited)
  visitedRef.current = visited
  const prefetchFiredRef = useRef(false)

  useEffect(() => {
    // Only fire once, only after primary data is available and user is authenticated.
    if (!recipes || !user || prefetchFiredRef.current) return
    prefetchFiredRef.current = true

    // Skip on slow connections to avoid wasting limited bandwidth.
    const nav = navigator as Navigator & { connection?: { effectiveType?: string } }
    const eff = nav.connection?.effectiveType
    if (eff === '2g' || eff === 'slow-2g') return

    const userId = user.id  // capture for async closures

    const prefetch = () => {
      const supabase = getSupabase()

      if (!visitedRef.current.has('planner')) {
        void queryClient.prefetchQuery({
          queryKey: ['user_config'],
          queryFn: async () => {
            const { data, error } = await supabase.from('user_config').select('*').single()
            if (error && error.code !== 'PGRST116') throw error
            return data
          },
          staleTime: 30_000,
        })
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 14)
        void queryClient.prefetchQuery({
          queryKey: ['recipe_history'],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('recipe_history')
              .select('recipe_id, date_made')
              .eq('user_id', userId)
              .gte('date_made', cutoff.toISOString())
              .order('date_made', { ascending: false })
              .limit(500)
            if (error) throw error
            return data
          },
          staleTime: 30_000,
        })
      }

      if (!visitedRef.current.has('pantry')) {
        void queryClient.prefetchQuery({
          queryKey: ['pantry'],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('pantry_items')
              .select('*')
              .order('item', { ascending: true })
            if (error) throw error
            return data
          },
          staleTime: 30_000,
        })
      }

      if (!visitedRef.current.has('shopping')) {
        void queryClient.prefetchQuery({
          queryKey: ['shopping_list'],
          queryFn: async () => {
            const { data, error } = await supabase
              .from('shopping_list')
              .select('*')
              .maybeSingle()
            if (error) throw error
            return data
          },
          staleTime: 30_000,
        })
      }
    }

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(prefetch, { timeout: 2000 })
    } else {
      setTimeout(prefetch, 0)
    }
  }, [recipes, user, queryClient])

  // Changes the active tab and marks it as visited so its component is mounted.
  const activateTab = useCallback((tab: string) => {
    setActiveTab(tab)
    setVisited((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [])

  // Restore tab from localStorage after mount (avoids server/client mismatch)
  useEffect(() => {
    activateTab(getStoredTab())
  }, [activateTab])

  // Persist active tab to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeTab)
  }, [activeTab])

  // Check for auth code or errors in URL (from email confirmation links)
  useEffect(() => {
    if (typeof window === "undefined") return

    const url = new URL(window.location.href)
    
    // Check for confirmation code (client-side fallback if server-side failed)
    const code = url.searchParams.get("code")
    if (code && !isAuthenticated) {
      // Try to exchange the code on the client side as a fallback
      // This handles cases where PKCE code verifier wasn't found on server
      const supabase = getSupabase()
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (error) {
          // If client-side also fails, show error
          const isPKCEError = error.message?.includes("PKCE") || 
                              error.message?.includes("code verifier")
          if (isPKCEError) {
            setAuthError("The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed.")
          } else {
            setAuthError(error.message || "Failed to confirm email. Please try signing in directly.")
          }
        }
        // Clean up URL
        url.searchParams.delete("code")
        window.history.replaceState({}, "", url.toString())
      })
      return
    }
    
    // Check query params for errors
    const error = url.searchParams.get("error")
    const errorCode = url.searchParams.get("error_code")
    const errorDescription = url.searchParams.get("error_description")

    // Check hash fragments (Supabase sometimes uses these)
    const hash = window.location.hash
    const hashParams = new URLSearchParams(hash.substring(1))
    const hashError = hashParams.get("error")
    const hashErrorCode = hashParams.get("error_code")
    const hashErrorDescription = hashParams.get("error_description")

    // Use query params first, then hash params
    const finalError = error || hashError
    const finalErrorCode = errorCode || hashErrorCode
    const finalErrorDescription = errorDescription || hashErrorDescription

    if (finalError) {
      let errorMessage = "Authentication error occurred."
      
      if (finalErrorCode === "otp_expired" || finalErrorCode === "link_expired") {
        errorMessage = "The confirmation link has expired. Please request a new confirmation email."
      } else if (finalErrorCode === "pkce_code_verifier_not_found") {
        errorMessage = "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed."
      } else if (finalErrorDescription) {
        errorMessage = decodeURIComponent(finalErrorDescription.replace(/\+/g, " "))
      } else if (finalError === "access_denied") {
        errorMessage = "Access denied. The confirmation link may be invalid or expired."
      } else if (finalError === "pkce_error") {
        errorMessage = "The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed."
      }

      setAuthError(errorMessage)

      // Clean up URL by removing error parameters
      url.searchParams.delete("error")
      url.searchParams.delete("error_code")
      url.searchParams.delete("error_description")
      url.hash = ""
      window.history.replaceState({}, "", url.toString())
    }
  }, [isAuthenticated])

  // Show loading state while checking auth
  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  // Show auth form if not authenticated
  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <AuthForm initialError={authError} />
      </main>
    )
  }

  // Handle sign out
  const handleSignOut = async () => {
    await signOut()
  }

  // Show main app
  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background pb-[var(--bottom-nav-height)] md:pb-6 md:pt-[var(--header-height)] smooth-scroll">
      <Header
        userEmail={user?.email}
        onSignOut={handleSignOut}
        activeTab={activeTab}
        onTabChange={activateTab}
      />

      <div className="container relative mx-auto flex-1 min-h-0 w-full max-w-full px-4 py-4 overflow-hidden flex flex-col">
        <div
          className={
            activeTab === "recipes"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          aria-hidden={activeTab !== "recipes"}
        >
          <RecipeList />
        </div>
        <div
          className={
            activeTab === "planner"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          aria-hidden={activeTab !== "planner"}
        >
          {/* Only mount once first visited — eliminates queries on page load */}
          {visited.has("planner") && <MealPlanner />}
        </div>
        <div
          className={
            activeTab === "pantry"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          aria-hidden={activeTab !== "pantry"}
        >
          {visited.has("pantry") && <PantryList />}
        </div>
        <div
          className={
            activeTab === "shopping"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          aria-hidden={activeTab !== "shopping"}
        >
          {visited.has("shopping") && <ShoppingListView />}
        </div>
      </div>

      <BottomNav activeTab={activeTab} onTabChange={activateTab} />

      {/* First-run onboarding for authenticated users only */}
      {isAuthenticated && (
        <FirstRunOnboarding
          open={showOnboarding}
          onComplete={completeOnboarding}
        />
      )}
    </main>
  )
}
