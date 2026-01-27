"use client"

import { UtensilsCrossed, CalendarDays, ShoppingCart, Package } from "lucide-react"
import { cn } from "@/lib/utils"

const tabs = [
  { id: "planner", label: "Planner", icon: CalendarDays },
  { id: "recipes", label: "Recipes", icon: UtensilsCrossed },
  { id: "shopping", label: "Shopping", icon: ShoppingCart },
  { id: "pantry", label: "Pantry", icon: Package },
] as const

interface BottomNavProps {
  activeTab: string
  onTabChange: (tab: string) => void
}

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 backdrop-blur-md safe-area-bottom md:hidden">
      <div className="flex h-16 items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id

          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-4 py-2 transition-all duration-150",
                "min-w-[64px] rounded-lg",
                "active:scale-95",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5 transition-transform duration-150",
                  isActive && "scale-110"
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
