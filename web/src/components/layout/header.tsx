"use client"

import { LogOut, HelpCircle } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { OnboardingDialog } from "./onboarding-dialog"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const NAV_ITEMS = [
  { href: "/planner", label: "Planner" },
  { href: "/recipes", label: "Recipes" },
  { href: "/shopping", label: "Shopping" },
  { href: "/pantry", label: "Pantry" },
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
}

export function Header({
  userEmail,
  onSignOut,
}: HeaderProps) {
  const isDesktop = useIsDesktop()
  const pathname = usePathname()

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
            <Link
              href="/planner"
              className="flex items-center gap-2 flex-shrink-0 rounded-lg -m-1 p-1 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label="Go to Planner"
            >
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                <Image
                  src="/recipe-genie-mark-approved.png"
                  alt=""
                  width={27}
                  height={32}
                  className="h-8 w-auto"
                  loading="eager"
                  unoptimized
                  aria-hidden="true"
                  data-slot="recipe-genie-mark"
                />
              </div>
              <h1 className="font-display text-xl sm:text-2xl text-primary flex-shrink-0">
                Recipe Genie
              </h1>
            </Link>
            <OnboardingDialog
              trigger={
                <button
                  type="button"
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-stone-100 hover:text-primary"
                  aria-label="Help"
                >
                  <HelpCircle className="h-4 w-4" />
                </button>
              }
            />
          </div>

          {/* Center: primary routes — Stitch: gap-8, centered via justify-between */}
          {isDesktop && (
            <nav className="flex items-center justify-center gap-8 text-sm font-medium flex-shrink-0">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "pb-1 transition-colors flex-shrink-0",
                      isActive
                        ? "text-primary border-b-2 border-primary"
                        : "text-slate-500 hover:text-primary"
                    )}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          )}

          {/* Right: compact account menu on mobile; full identity/actions on desktop */}
          <div className="hidden items-center gap-4 flex-shrink-0 md:flex">
            <div
              className="h-8 w-8 rounded-full bg-accent flex items-center justify-center text-foreground font-bold text-xs flex-shrink-0"
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-xs font-bold text-foreground md:hidden"
                aria-label="Open account menu"
              >
                {getInitials(userEmail)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="md:hidden">
              <DropdownMenuItem onClick={onSignOut} className="min-h-11">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
    </>
  )
}
