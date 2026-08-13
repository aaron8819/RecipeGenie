"use client"

import {
  CalendarDays,
  HelpCircle,
  LogOut,
  Package,
  ShoppingCart,
  UtensilsCrossed,
} from "lucide-react"
import Image from "next/image"
import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"
import { OnboardingDialog } from "./onboarding-dialog"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/recipes", label: "Recipes", icon: UtensilsCrossed },
  { href: "/shopping", label: "Shopping", icon: ShoppingCart },
  { href: "/pantry", label: "Pantry", icon: Package },
] as const

function getInitials(email: string | undefined): string {
  if (!email) return "?"
  const local = email.split("@")[0] || ""
  if (local.length >= 2) return local.slice(0, 2).toUpperCase()
  return local[0]?.toUpperCase() || "?"
}

function DesktopNavItemContent({
  item,
}: {
  item: (typeof NAV_ITEMS)[number]
}) {
  const { pending } = useLinkStatus()
  const Icon = item.icon

  return (
    <>
      <Icon
        className={cn("h-5 w-5 shrink-0", pending && "motion-safe:animate-pulse")}
        aria-hidden
      />
      <span>{item.label}</span>
      {pending ? (
        <span className="sr-only">Loading {item.label}</span>
      ) : null}
    </>
  )
}

interface DesktopSidebarProps {
  userEmail?: string
  onSignOut: () => void
}

export function DesktopSidebar({
  userEmail,
  onSignOut,
}: DesktopSidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border-warm bg-shell lg:flex"
      aria-label="Recipe Genie desktop navigation"
      data-slot="desktop-sidebar"
    >
      <div className="border-b border-border-warm px-6 py-7">
        <Link
          href="/planner"
          aria-label="Go to Planner"
          className="flex flex-col items-center rounded-lg text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-shell"
        >
          <Image
            src="/recipe-genie-lockup.png"
            alt=""
            width={689}
            height={576}
            className="h-auto w-[6.25rem]"
            priority
            unoptimized
            aria-hidden="true"
            data-slot="recipe-genie-lockup"
          />
        </Link>
      </div>

      <nav
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-6"
        aria-label="Primary navigation"
      >
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-shell",
                isActive
                  ? "bg-brand-primary text-white"
                  : "text-text-variant hover:bg-surface-raised hover:text-brand-primary"
              )}
            >
              <DesktopNavItemContent item={item} />
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-border-warm p-4">
        <div className="mb-3 flex min-w-0 items-center gap-3 px-2">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-peach text-xs font-bold text-brand-primary"
            aria-hidden="true"
          >
            {getInitials(userEmail)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-text-variant">
              Account
            </p>
            <p className="truncate text-sm text-text-variant" title={userEmail}>
              {userEmail || "Signed in"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <OnboardingDialog
            trigger={
              <button
                type="button"
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-text-variant transition-colors hover:bg-surface-raised hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-shell"
              >
                <HelpCircle className="h-4 w-4" aria-hidden />
                Help
              </button>
            }
          />
          <button
            type="button"
            onClick={onSignOut}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-text-variant transition-colors hover:bg-surface-raised hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-shell"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      </div>
    </aside>
  )
}
