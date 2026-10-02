"use client"

import { UtensilsCrossed, LayoutDashboard, CalendarDays, ShoppingCart, Package } from "lucide-react"
import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/recipes", label: "Recipes", icon: UtensilsCrossed },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/pantry", label: "Pantry", icon: Package },
] as const

function BottomNavItem({
  item,
  isActive,
  isSelected,
}: {
  item: (typeof navItems)[number]
  isActive: boolean
  isSelected: boolean
}) {
  const { pending } = useLinkStatus()
  const Icon = item.icon
  const isHighlighted = isSelected || pending

  return (
    <>
      <Icon
        className={cn(
          "h-5 w-5 transition-transform duration-150",
          isHighlighted && "scale-110",
          (pending || (isSelected && !isActive)) && "animate-pulse"
        )}
        aria-hidden
      />
      <span
        className={cn(
          "text-xs font-medium transition-colors",
          isHighlighted ? "text-primary" : "text-muted-foreground"
        )}
      >
        {item.label}
      </span>
      {(pending || (isSelected && !isActive)) && (
        <span className="sr-only">Loading {item.label}</span>
      )}
    </>
  )
}

export function BottomNav() {
  const pathname = usePathname()
  const [selectedHref, setSelectedHref] = useState<string | null>(null)

  useEffect(() => {
    setSelectedHref(null)
  }, [pathname])

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 backdrop-blur-md safe-area-bottom lg:hidden"
      aria-label="Bottom navigation"
      style={{ minHeight: "var(--bottom-nav-safe-height)" }}
    >
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)
          const isSelected = selectedHref
            ? selectedHref === item.href
            : isActive

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setSelectedHref(isActive ? null : item.href)}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-1 py-2 transition-all duration-150",
                "min-h-11 min-w-0 flex-1 rounded-lg",
                "active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset",
                isSelected
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BottomNavItem
                item={item}
                isActive={isActive}
                isSelected={isSelected}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
