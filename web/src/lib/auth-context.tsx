"use client"

import { createContext, Fragment, useContext, useEffect, useState, useCallback, ReactNode, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { User, Session } from "@supabase/supabase-js"
import { getSupabase } from "@/lib/supabase/client"
import { removeForeignPrincipalQueries, removePrincipalQueries } from "@/lib/principal-cache"
import { isPrincipalQueryKey, UNRESOLVED_PRINCIPAL } from "@/lib/query-keys"
import { setActivePrincipalId } from "@/lib/principal-session"

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  isAuthenticated: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  resendConfirmation: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function hasPrincipalChanged(
  previousSession: Session | null,
  nextSession: Session | null
): boolean {
  return !!previousSession?.user.id && previousSession.user.id !== nextSession?.user.id
}

// initialSession: pass the server-read session to skip the client-side getSession()
// round-trip. Provide Session (authenticated), null (known unauthenticated), or
// omit (undefined) to fall back to the original client-side fetch.
export function AuthProvider({
  children,
  initialSession,
}: {
  children: ReactNode
  initialSession?: Session | null
}) {
  const hasInitialSession = initialSession !== undefined
  const [user, setUser] = useState<User | null>(hasInitialSession ? (initialSession?.user ?? null) : null)
  const [session, setSession] = useState<Session | null>(hasInitialSession ? (initialSession ?? null) : null)
  // If the server provided the session (even null), we already know auth state — no loading needed.
  const [loading, setLoading] = useState(!hasInitialSession)
  const queryClient = useQueryClient()
  // Initialise ref from server session so onAuthStateChange sees the correct previous value.
  const sessionRef = useRef<Session | null>(initialSession ?? null)
  // Capture prop at mount so the effect dep array stays stable (no object-identity churn).
  const initialSessionRef = useRef(initialSession)
  const activeUserIdRef = useRef<string | null>(initialSession?.user.id ?? null)
  setActivePrincipalId(activeUserIdRef.current)

  const applySession = useCallback((nextSession: Session | null) => {
    const previousSession = sessionRef.current
    const previousUserId = previousSession?.user.id ?? null
    const nextUserId = nextSession?.user.id ?? null

    activeUserIdRef.current = nextUserId
    setActivePrincipalId(nextUserId)
    sessionRef.current = nextSession
    setSession(nextSession)
    setUser(nextSession?.user ?? null)
    setLoading(false)

    if (previousUserId && hasPrincipalChanged(previousSession, nextSession)) {
      void removePrincipalQueries(queryClient, previousUserId).then(() => {
        removeForeignPrincipalQueries(queryClient, nextUserId)
      })
    } else if (!previousUserId && nextUserId) {
      removeForeignPrincipalQueries(queryClient, nextUserId)
    }
  }, [queryClient])

  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "added" && event.type !== "updated") return

    const { queryKey } = event.query
    if (!isPrincipalQueryKey(queryKey)) return

    const ownerUserId = queryKey[1]
    if (ownerUserId === UNRESOLVED_PRINCIPAL || ownerUserId === activeUserIdRef.current) return

    queryClient.removeQueries({ queryKey, exact: true })
  }), [queryClient])

  useEffect(() => {
    const supabase = getSupabase()

    // Skip client-side session fetch when the server already provided it.
    // initialSessionRef.current is undefined only when the prop was omitted.
    if (initialSessionRef.current === undefined) {
      supabase.auth.getSession()
        .then(({ data: { session } }) => {
          applySession(session)
        })
        .catch((error) => {
          console.error("Failed to fetch session:", error)
          // Still exit loading state to prevent app freeze
          setLoading(false)
        })
    }

    // Listen for auth changes (sign in, sign out, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session)
    })

    return () => subscription.unsubscribe()
  }, [applySession])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase()

    // Get the current origin for the redirect URL
    const redirectUrl = typeof window !== 'undefined' 
      ? `${window.location.origin}/auth/callback`
      : '/auth/callback'
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    })
    if (error) {
      // Provide more user-friendly error messages
      let errorMessage = error.message
      if (error.message.includes('Database error')) {
        errorMessage = 'Database error saving new user. Please try again or contact support.'
      } else if (error.message.includes('User already registered')) {
        errorMessage = 'An account with this email already exists. Please sign in instead.'
      } else if (error.message.includes('Password')) {
        errorMessage = 'Password must be at least 6 characters long.'
      }
      throw new Error(errorMessage)
    }
  }, [])

  const resendConfirmation = useCallback(async (email: string) => {
    const supabase = getSupabase()
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getSupabase()
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const value: AuthContextType = {
    user,
    session,
    loading,
    isAuthenticated: !!session,
    signIn,
    signUp,
    resendConfirmation,
    signOut,
  }

  return (
    <AuthContext.Provider value={value}>
      <Fragment key={user?.id ?? "unauthenticated"}>
        {children}
      </Fragment>
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider")
  }
  return context
}
