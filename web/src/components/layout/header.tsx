"use client"

import { useEffect, useState } from "react"
import { LogOut, UtensilsCrossed, HelpCircle } from "lucide-react"
import { OnboardingDialog } from "./onboarding-dialog"
import { cn } from "@/lib/utils"

const NAV_TABS = [
  { id: "planner", label: "Planner" },
  { id: "recipes", label: "Recipes" },
  { id: "shopping", label: "Shopping" },
  { id: "pantry", label: "Pantry" },
] as const

function getInitials(email: string | undefined): string {
  if (!email) return "?"
  const local = email.split("@")[0] || ""
  if (local.length >= 2) return local.slice(0, 2).toUpperCase()
  return local[0]?.toUpperCase() || "?"
}

interface HeaderProps {
  userEmail?: string
  onSignOut: () => void
  activeTab?: string
  onTabChange?: (tab: string) => void
}

export function Header({
  userEmail,
  onSignOut,
  activeTab,
  onTabChange,
}: HeaderProps) {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    return window.matchMedia("(min-width: 768px)").matches
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(min-width: 768px)")
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    setIsDesktop(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return (
    <>
      <header
        className={cn(
          "z-50 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 sm:px-6 py-4",
          isDesktop && "fixed top-0 left-0 right-0"
        )}
      >
        <div className="w-full flex items-center justify-between">
          {/* Left: logo, app name, help — flush to left padding; logo/text navigate to planner */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => onTabChange?.("planner")}
              className="flex items-center gap-2 flex-shrink-0 rounded-lg -m-1 p-1 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label="Go to Planner"
            >
              <div className="bg-primary p-2 rounded-lg flex-shrink-0">
                <UtensilsCrossed className="h-5 w-5 text-primary-foreground" />
              </div>
              <h1 className="font-display text-xl sm:text-2xl text-primary flex-shrink-0">
                Recipe Genie
              </h1>
            </button>
            <OnboardingDialog
              trigger={
                <button
                  type="button"
                  className="p-1.5 rounded-md text-slate-500 hover:text-primary hover:bg-stone-100 transition-colors flex-shrink-0"
                  aria-label="Help"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              }
            />
          </div>

          {/* Center: nav tabs — Stitch: gap-8, centered via justify-between */}
          {onTabChange && isDesktop && (
            <nav className="flex items-center justify-center gap-8 text-sm font-medium flex-shrink-0">
              {NAV_TABS.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange(tab.id)}
                    className={cn(
                      "pb-1 transition-colors flex-shrink-0",
                      isActive
                        ? "text-primary border-b-2 border-primary"
                        : "text-slate-500 hover:text-primary"
                    )}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          )}

          {/* Right: avatar, sign out — flush to right padding */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <div
              className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-accent-foreground font-bold text-xs flex-shrink-0"
              title={userEmail}
            >
              {getInitials(userEmail)}
            </div>
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              className="text-sm font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors flex-shrink-0"
            >
              {isDesktop && <span>Sign Out</span>}
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
    </>
  )
}

