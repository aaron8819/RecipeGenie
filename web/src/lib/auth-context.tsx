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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const queryClient = useQueryClient()
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    const supabase = getSupabase()

    // Get initial session
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

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Handle session expiry: if we had a session but now don't, and it's not a sign out
      const previousSession = sessionRef.current
      const hasSession = !!session

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
