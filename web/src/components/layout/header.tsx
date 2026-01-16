"use client"

import { Button } from "@/components/ui/button"
import { LogOut, ChefHat } from "lucide-react"

interface HeaderProps {
  userEmail?: string
  onSignOut: () => void
}

export function Header({ userEmail, onSignOut }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur-md">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Recipe Genie</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:inline truncate max-w-[200px]">
            {userEmail}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSignOut}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only sm:ml-2">Sign Out</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
