"use client"

import React from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "./button"

interface EmptyStateAction {
  label: string
  onClick: () => void
  variant?: "default" | "outline"
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: EmptyStateAction
  secondaryAction?: EmptyStateAction
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="max-w-sm mb-6 text-foreground/80">{description}</p>
      {(action || secondaryAction) && (
        <div className="flex w-full max-w-md flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
          {action && (
            <Button onClick={action.onClick} variant={action.variant || "default"} className="w-full sm:w-auto">
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={secondaryAction.onClick}
              variant={secondaryAction.variant || "outline"}
              className="w-full sm:w-auto"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
