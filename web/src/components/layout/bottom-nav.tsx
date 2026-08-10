"use client"

import { UtensilsCrossed, CalendarDays, ShoppingCart, Package } from "lucide-react"
import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/recipes", label: "Recipes", icon: UtensilsCrossed },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/pantry", label: "Pantry", icon: Package },
] as const

function BottomNavItem({
  item,
  isActive,
}: {
  item: (typeof navItems)[number]
  isActive: boolean
}) {
  const { pending } = useLinkStatus()
  const Icon = item.icon
  const isHighlighted = isActive || pending

  return (
    <>
      <Icon
        className={cn(
          "h-5 w-5 transition-transform duration-150",
          isHighlighted && "scale-110",
          pending && "animate-pulse"
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
      {pending && <span className="sr-only">Loading {item.label}</span>}
    </>
  )
}

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card/95 backdrop-blur-md safe-area-bottom md:hidden"
      aria-label="Bottom navigation"
      style={{ minHeight: "var(--bottom-nav-safe-height)" }}
    >
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 px-4 py-2 transition-all duration-150",
                "min-w-[64px] rounded-lg",
                "active:scale-95",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BottomNavItem item={item} isActive={isActive} />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
