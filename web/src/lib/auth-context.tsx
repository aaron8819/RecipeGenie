"use client"

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { User, Session } from "@supabase/supabase-js"
import {
  isGuestMode as checkGuestMode,
  setGuestMode as setStorageGuestMode,
  getDefaultRecipes,
  getDefaultConfig,
  getDefaultShoppingList,
} from "@/lib/guest-storage"
import { getSupabase } from "@/lib/supabase/client"

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  isAuthenticated: boolean
  isGuest: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  enterGuestMode: () => void
  exitGuestMode: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(false)
  const queryClient = useQueryClient()

  // Initialize guest cache with default data
  const initializeGuestCache = useCallback(() => {
    queryClient.setQueryData(["recipes", null, true], getDefaultRecipes())
    queryClient.setQueryData(["user_config", true], getDefaultConfig())
    queryClient.setQueryData(["pantry", true], [])
    queryClient.setQueryData(["recipe_history", true], [])
    queryClient.setQueryData(["shopping_list", true], getDefaultShoppingList())
    queryClient.setQueryData(["user_config", "categories", true], getDefaultConfig().categories)
    queryClient.setQueryData(["user_config", "excluded_keywords", true], [])
  }, [queryClient])

  // Clear guest cache
  const clearGuestCache = useCallback(() => {
    queryClient.removeQueries({ predicate: (query) => {
      const key = query.queryKey
      return Array.isArray(key) && key[key.length - 1] === true
    }})
  }, [queryClient])

  useEffect(() => {
    const supabase = getSupabase()

    // Check for guest mode first
    if (checkGuestMode()) {
      setIsGuest(true)
      initializeGuestCache()
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setIsGuest(false)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [initializeGuestCache])

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase()
    if (isGuest) {
      setStorageGuestMode(false)
      clearGuestCache()
      setIsGuest(false)
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }, [isGuest, clearGuestCache])

  const signUp = useCallback(async (email: string, password: string) => {
    const supabase = getSupabase()
    if (isGuest) {
      setStorageGuestMode(false)
      clearGuestCache()
      setIsGuest(false)
    }
    
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
  }, [isGuest, clearGuestCache])

  const signOut = useCallback(async () => {
    const supabase = getSupabase()
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const enterGuestMode = useCallback(() => {
    setStorageGuestMode(true)
    initializeGuestCache()
    setIsGuest(true)
  }, [initializeGuestCache])

  const exitGuestMode = useCallback(() => {
    setStorageGuestMode(false)
    clearGuestCache()
    setIsGuest(false)
  }, [clearGuestCache])

  const value: AuthContextType = {
    user,
    session,
    loading,
    isAuthenticated: !!session,
    isGuest,
    signIn,
    signUp,
    signOut,
    enterGuestMode,
    exitGuestMode,
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
