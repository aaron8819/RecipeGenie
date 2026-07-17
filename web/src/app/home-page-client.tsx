"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { RecipeList } from "@/components/recipes"
import { AuthForm } from "@/components/auth/auth-form"
import { useRecipes } from "@/hooks/use-recipes"
import { Header, BottomNav, FirstRunOnboarding } from "@/components/layout"
import { useFirstRunOnboarding } from "@/components/layout/first-run-onboarding"
import { useAuthContext } from "@/lib/auth-context"
import { HOME_TAB_NAVIGATE_EVENT, persistHomeTab } from "@/lib/home-navigation"
import { getSupabase } from "@/lib/supabase/client"
import { configurationKeys, historyKeys, pantryKeys, shoppingKeys } from "@/lib/query-keys"
import { mapShoppingListRow } from "@/lib/recipe-identity"
import {
  HOME_DEFAULT_TAB,
  isValidHomeTab,
  normalizeHomeTab,
} from "./home-tab-state"

const TabLoader = () => (
  <div className="flex-1 space-y-4 px-1 py-2" aria-label="Loading page">
    <div className="h-11 w-40 animate-pulse rounded-xl bg-stone-100" />
    <div className="h-24 animate-pulse rounded-2xl border border-stone-100 bg-stone-50" />
    <div className="grid grid-cols-2 gap-3">
      <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
      <div className="h-20 animate-pulse rounded-2xl bg-stone-100" />
    </div>
    <div className="h-40 animate-pulse rounded-2xl border border-stone-100 bg-stone-50" />
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

export function HomePageClient({ initialTab = HOME_DEFAULT_TAB }: { initialTab?: string }) {
  const normalizedInitialTab = normalizeHomeTab(initialTab)
  const [activeTab, setActiveTab] = useState(() => normalizedInitialTab)
  // Tracks which tabs have been activated at least once. A tab is only mounted
  // (and its queries started) on first visit; after that it stays in the DOM.
  const [visited, setVisited] = useState<Set<string>>(
    () => new Set([normalizedInitialTab])
  )
  const [authError, setAuthError] = useState<string | null>(null)
  const { user, loading, signOut, isAuthenticated } = useAuthContext()
  const { showOnboarding, completeOnboarding } = useFirstRunOnboarding()

  const queryClient = useQueryClient()
  const { data: recipes } = useRecipes()
  const visitedRef = useRef(visited)
  visitedRef.current = visited
  const prefetchFiredRef = useRef(false)

  useEffect(() => {
    // Align local persistence with the server-provided initial tab on first mount.
    persistHomeTab(activeTab)
  }, [activeTab])

  useEffect(() => {
    if (!recipes || !user || prefetchFiredRef.current) return
    prefetchFiredRef.current = true

    const nav = navigator as Navigator & { connection?: { effectiveType?: string } }
    const eff = nav.connection?.effectiveType
    if (eff === "2g" || eff === "slow-2g") return

    const userId = user.id

    const prefetch = () => {
      const supabase = getSupabase()

      if (!visitedRef.current.has("planner")) {
        void queryClient.prefetchQuery({
          queryKey: configurationKeys.detail(userId),
          queryFn: async () => {
            const { data, error } = await supabase
              .from("user_config")
              .select("auto_assign_days,categories,category_order,category_overrides,custom_categories,default_selection,enabled_planner_categories,excluded_days,excluded_keywords,history_exclusion_days,onboarding_completed_at,preferred_days,user_id,week_start_day")
              .single()
            if (error && error.code !== "PGRST116") throw error
            return data
          },
          staleTime: 30_000,
        })
        void (async () => {
          const { data: config, error: configError } = await supabase
            .from("user_config")
            .select("history_exclusion_days")
            .single()
          if (configError && configError.code !== "PGRST116") throw configError

          const daysBack = (config as { history_exclusion_days?: number } | null)?.history_exclusion_days ?? 14
          const cutoff = new Date()
          cutoff.setDate(cutoff.getDate() - daysBack)

          await queryClient.prefetchQuery({
            queryKey: historyKeys.recent(userId, daysBack),
            queryFn: async () => {
              const { data, error } = await supabase
                .from("recipe_history")
                .select("recipe_uuid, date_made")
                .eq("user_id", userId)
                .gte("date_made", cutoff.toISOString())
                .order("date_made", { ascending: false })
                .limit(500)
              if (error) throw error
              return (data || []).flatMap((entry) => entry.recipe_uuid ? [{
                recipe_id: entry.recipe_uuid,
                date_made: entry.date_made,
              }] : [])
            },
            staleTime: 30_000,
          })
        })()
      }

      if (!visitedRef.current.has("pantry")) {
        void queryClient.prefetchQuery({
          queryKey: pantryKeys.list(userId),
          queryFn: async () => {
            const { data, error } = await supabase
              .from("pantry_items")
              .select("id,created_at,item,user_id")
              .order("item", { ascending: true })
            if (error) throw error
            return data
          },
          staleTime: 30_000,
        })
      }

      if (!visitedRef.current.has("shopping")) {
        void queryClient.prefetchQuery({
          queryKey: shoppingKeys.detail(userId),
          queryFn: async () => {
            const { data, error } = await supabase
              .from("shopping_list")
              .select("already_have,contribution_overrides,contribution_revision,custom_order,excluded,generated_at,items,legacy_items_preserved,scale,source_recipe_uuids,total_servings,user_id")
              .maybeSingle()
            if (error) throw error
            return data ? mapShoppingListRow(data as never) : data
          },
          staleTime: 30_000,
        })
      }
    }

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(prefetch, { timeout: 2000 })
    } else {
      setTimeout(prefetch, 0)
    }
  }, [recipes, user, queryClient])

  const activateTab = useCallback((tab: string) => {
    if (!isValidHomeTab(tab)) return

    setActiveTab(tab)
    setVisited((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)
      return next
    })
  }, [])

  useEffect(() => {
    const handleNavigateHomeTab = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      if (!detail?.tab || !isValidHomeTab(detail.tab)) return
      activateTab(detail.tab)
    }

    window.addEventListener(HOME_TAB_NAVIGATE_EVENT, handleNavigateHomeTab as EventListener)
    return () => {
      window.removeEventListener(HOME_TAB_NAVIGATE_EVENT, handleNavigateHomeTab as EventListener)
    }
  }, [activateTab])

  useEffect(() => {
    if (typeof window === "undefined") return

    const url = new URL(window.location.href)

    const code = url.searchParams.get("code")
    if (code && !isAuthenticated) {
      const supabase = getSupabase()
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          const isPKCEError =
            error.message?.includes("PKCE") ||
            error.message?.includes("code verifier")
          if (isPKCEError) {
            setAuthError("The confirmation link was opened in a different browser or session. Please try signing in directly - your email may already be confirmed.")
          } else {
            setAuthError(error.message || "Failed to confirm email. Please try signing in directly.")
          }
        }
        url.searchParams.delete("code")
        window.history.replaceState({}, "", url.toString())
      })
      return
    }

    const error = url.searchParams.get("error")
    const errorCode = url.searchParams.get("error_code")
    const errorDescription = url.searchParams.get("error_description")

    const hash = window.location.hash
    const hashParams = new URLSearchParams(hash.substring(1))
    const hashError = hashParams.get("error")
    const hashErrorCode = hashParams.get("error_code")
    const hashErrorDescription = hashParams.get("error_description")

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

      url.searchParams.delete("error")
      url.searchParams.delete("error_code")
      url.searchParams.delete("error_description")
      url.hash = ""
      window.history.replaceState({}, "", url.toString())
    }
  }, [isAuthenticated])

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <AuthForm initialError={authError} />
      </main>
    )
  }

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <main className="flex-1 min-h-0 flex flex-col bg-background md:pb-6 md:pt-[var(--header-height)] smooth-scroll">
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
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto pb-[var(--bottom-nav-safe-height)] md:pb-0 scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          data-home-tab-panel="recipes"
          aria-hidden={activeTab !== "recipes"}
        >
          <RecipeList />
        </div>
        <div
          className={
            activeTab === "planner"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto pb-[var(--bottom-nav-safe-height)] md:pb-0 scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          data-home-tab-panel="planner"
          aria-hidden={activeTab !== "planner"}
        >
          {visited.has("planner") && <MealPlanner />}
        </div>
        <div
          className={
            activeTab === "pantry"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto pb-[var(--bottom-nav-safe-height)] md:pb-0 scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          data-home-tab-panel="pantry"
          aria-hidden={activeTab !== "pantry"}
        >
          {visited.has("pantry") && <PantryList />}
        </div>
        <div
          className={
            activeTab === "shopping"
              ? "flex-1 min-h-0 flex flex-col overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0 scrollbar-thin opacity-100 transition-opacity duration-150 ease-out"
              : "pointer-events-none invisible absolute inset-0 opacity-0 transition-opacity duration-150 ease-out"
          }
          data-home-tab-panel="shopping"
          aria-hidden={activeTab !== "shopping"}
        >
          {visited.has("shopping") && <ShoppingListView />}
        </div>
      </div>

      <BottomNav activeTab={activeTab} onTabChange={activateTab} />

      {isAuthenticated && (
        <FirstRunOnboarding
          open={showOnboarding}
          onComplete={completeOnboarding}
        />
      )}
    </main>
  )
}
