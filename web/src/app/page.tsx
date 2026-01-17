"use client"

import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { RecipeList } from "@/components/recipes"
import { PantryList } from "@/components/pantry"
import { MealPlanner } from "@/components/planner"
import { ShoppingListView } from "@/components/shopping"
import { AuthForm } from "@/components/auth/auth-form"
import { Header, BottomNav } from "@/components/layout"
import { useAuthContext } from "@/lib/auth-context"

const VALID_TABS = ["recipes", "planner", "pantry", "shopping"] as const
const STORAGE_KEY = "recipe-genie-active-tab"

function getInitialTab(): string {
  if (typeof window === "undefined") return "recipes"
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored && VALID_TABS.includes(stored as typeof VALID_TABS[number]) ? stored : "recipes"
}

export default function Home() {
  const [activeTab, setActiveTab] = useState(getInitialTab)

  // Persist active tab to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeTab)
  }, [activeTab])

  const { 
    user, 
    loading, 
    signOut, 
    isAuthenticated, 
    isGuest, 
    enterGuestMode,
    exitGuestMode 
  } = useAuthContext()

  // Show loading state while checking auth
  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    )
  }

  // Show auth form if not authenticated and not in guest mode
  if (!isAuthenticated && !isGuest) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <AuthForm onGuestMode={enterGuestMode} />
      </main>
    )
  }

  // Handle sign out - also handles guest mode exit
  const handleSignOut = async () => {
    if (isGuest) {
      exitGuestMode()
    } else {
      await signOut()
    }
  }

  // Show main app if authenticated or in guest mode
  return (
    <main className="min-h-screen bg-background pb-20">
      <Header 
        userEmail={isGuest ? "Guest" : user?.email} 
        onSignOut={handleSignOut}
        isGuest={isGuest}
      />

      <div className="container mx-auto px-4 py-4">
        {activeTab === "recipes" && <RecipeList />}
        {activeTab === "planner" && <MealPlanner />}
        {activeTab === "pantry" && <PantryList />}
        {activeTab === "shopping" && <ShoppingListView />}
      </div>

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </main>
  )
}
