"use client"

import { Button } from "@/components/ui/button"
import { LogOut, UtensilsCrossed, HelpCircle, AlertTriangle } from "lucide-react"
import { OnboardingDialog } from "./onboarding-dialog"
import { cn } from "@/lib/utils"

const NAV_TABS = [
  { id: "planner", label: "Planner" },
  { id: "recipes", label: "Recipes" },
  { id: "shopping", label: "Shopping" },
  { id: "pantry", label: "Pantry" },
] as const

function getInitials(email: string | undefined, isGuest: boolean): string {
  if (isGuest) return "G"
  if (!email) return "?"
  const local = email.split("@")[0] || ""
  if (local.length >= 2) return local.slice(0, 2).toUpperCase()
  return local[0]?.toUpperCase() || "?"
}

interface HeaderProps {
  userEmail?: string
  onSignOut: () => void
  isGuest?: boolean
  onSignUpClick?: () => void
  activeTab?: string
  onTabChange?: (tab: string) => void
}

export function Header({
  userEmail,
  onSignOut,
  isGuest,
  onSignUpClick,
  activeTab,
  onTabChange,
}: HeaderProps) {
  return (
    <>
      <header className="md:fixed md:top-0 md:left-0 md:right-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 sm:px-6 py-4">
        <div className="w-full flex items-center justify-between">
          {/* Left: logo, app name, help — flush to left padding */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="bg-primary p-2 rounded-lg flex-shrink-0">
              <UtensilsCrossed className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-xl sm:text-2xl text-primary flex-shrink-0">
              Recipe Genie
            </h1>
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
          {onTabChange && (
            <nav className="hidden md:flex items-center justify-center gap-8 text-sm font-medium flex-shrink-0">
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
              title={isGuest ? "Guest" : userEmail}
            >
              {getInitials(userEmail, !!isGuest)}
            </div>
            <button
              type="button"
              onClick={onSignOut}
              className="text-sm font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors flex-shrink-0"
            >
              {isGuest ? "Exit" : "Sign Out"}
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Guest Mode Warning Banner */}
      {isGuest && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
          <div className="container mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                <strong>Guest Mode</strong> — Your data is temporary and will be lost when you close this tab.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onSignUpClick}
              className="flex-shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100 hover:text-amber-900"
            >
              Sign up to save your data
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
