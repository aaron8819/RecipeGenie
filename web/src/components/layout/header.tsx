"use client"

import { HelpCircle, LogOut } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { OnboardingDialog } from "./onboarding-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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

export function Header({ userEmail, onSignOut }: HeaderProps) {
  return (
    <header className="z-50 border-b border-stone-200 bg-white/80 px-4 py-4 backdrop-blur-md sm:px-6 lg:hidden">
      <div className="flex w-full items-center justify-between">
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link
            href="/planner"
            className="-m-1 flex flex-shrink-0 cursor-pointer items-center gap-2 rounded-lg p-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
            aria-label="Go to Planner"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
              <Image
                src="/recipe-genie-mark.png"
                alt=""
                width={462}
                height={426}
                className="h-8 w-auto"
                loading="eager"
                unoptimized
                aria-hidden="true"
                data-slot="recipe-genie-mark"
              />
            </div>
          </Link>
          <OnboardingDialog
            trigger={
              <button
                type="button"
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-stone-100 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
                aria-label="Help"
              >
                <HelpCircle className="h-4 w-4" aria-hidden />
              </button>
            }
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-xs font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
              aria-label="Open account menu"
            >
              {getInitials(userEmail)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onSignOut} className="min-h-11">
              <LogOut className="mr-2 h-4 w-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
