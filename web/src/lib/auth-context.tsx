"use client"

import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { User, Session } from "@supabase/supabase-js"
import { getSupabase } from "@/lib/supabase/client"

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

export function shouldClearQueriesOnAuthEvent(
  previousSession: Session | null,
  nextSession: Session | null,
  event: string
): boolean {
  return !!previousSession && !nextSession && event !== 'SIGNED_OUT'
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

  useEffect(() => {
    const supabase = getSupabase()

    // Skip client-side session fetch when the server already provided it.
    // initialSessionRef.current is undefined only when the prop was omitted.
    if (initialSessionRef.current === undefined) {
      supabase.auth.getSession()
        .then(({ data: { session } }) => {
          sessionRef.current = session
          setSession(session)
          setUser(session?.user ?? null)
          setLoading(false)
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
    } = supabase.auth.onAuthStateChange((event, session) => {
      const previousSession = sessionRef.current

      setSession(session)
      setUser(session?.user ?? null)

      // Handle token refresh failure (session expired and couldn't be refreshed)
      // This happens when TOKEN_REFRESHED fires but session is null, or when
      // the session simply disappears without a SIGNED_OUT event
      if (shouldClearQueriesOnAuthEvent(previousSession, session, event)) {
        console.warn('Session expired or token refresh failed')
        // The middleware will redirect to login on next navigation
        // Clear any stale queries to prevent showing outdated data
        queryClient.clear()
      }

      sessionRef.current = session
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [queryClient])

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

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuthContext must be used within an AuthProvider")
  }
  return context
}
