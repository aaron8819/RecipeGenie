"use client"

import { useState, useEffect } from "react"
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  useAddRecipeToPlan,
  useUserConfig,
  getWeekStartDate,
  navigateWeek,
} from "@/hooks/use-planner"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"

interface AddToPlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe: Recipe | null
}

type WeekOption = "this" | "next" | "custom"

export function AddToPlanDialog({
  open,
  onOpenChange,
  recipe,
}: AddToPlanDialogProps) {
  const { data: config } = useUserConfig()
  const addToPlan = useAddRecipeToPlan()

  const [selectedOption, setSelectedOption] = useState<WeekOption>("this")
  const [customWeekDate, setCustomWeekDate] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  // Calculate week dates
  const thisWeekDate = getWeekStartDate(new Date(), config?.week_start_day || 1)
  const nextWeekDate = navigateWeek(thisWeekDate, "next")

  // Initialize custom week date
  useEffect(() => {
    if (open) {
      setCustomWeekDate(navigateWeek(nextWeekDate, "next"))
      setSelectedOption("this")
      setError(null)
    }
  }, [open, nextWeekDate])

  const getSelectedWeekDate = () => {
    switch (selectedOption) {
      case "this":
        return thisWeekDate
      case "next":
        return nextWeekDate
      case "custom":
        return customWeekDate
    }
  }

  const formatWeekLabel = (dateStr: string) => {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    const endDate = new Date(date)
    endDate.setDate(endDate.getDate() + 6)

    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
    return `${date.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`
  }

  const handleCustomPrev = () => {
    setCustomWeekDate((prev) => navigateWeek(prev, "prev"))
  }

  const handleCustomNext = () => {
    setCustomWeekDate((prev) => navigateWeek(prev, "next"))
  }

  const handleAddToPlan = async () => {
    if (!recipe) return

    setError(null)
    try {
      await addToPlan.mutateAsync({
        weekDate: getSelectedWeekDate(),
        recipeId: recipe.id,
      })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add recipe to plan")
    }
  }

  if (!recipe) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5" />
            Add to Meal Plan
          </DialogTitle>
          <DialogDescription>
            Add &quot;{recipe.name}&quot; to a weekly meal plan
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {/* This Week Option */}
          <button
            type="button"
            onClick={() => setSelectedOption("this")}
            className={cn(
              "w-full p-4 rounded-lg border-2 text-left transition-all",
              selectedOption === "this"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            )}
          >
            <div className="font-medium">This Week</div>
            <div className="text-sm text-muted-foreground">
              {formatWeekLabel(thisWeekDate)}
            </div>
          </button>

          {/* Next Week Option */}
          <button
            type="button"
            onClick={() => setSelectedOption("next")}
            className={cn(
              "w-full p-4 rounded-lg border-2 text-left transition-all",
              selectedOption === "next"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            )}
          >
            <div className="font-medium">Next Week</div>
            <div className="text-sm text-muted-foreground">
              {formatWeekLabel(nextWeekDate)}
            </div>
          </button>

          {/* Custom Week Option */}
          <button
            type="button"
            onClick={() => setSelectedOption("custom")}
            className={cn(
              "w-full p-4 rounded-lg border-2 text-left transition-all",
              selectedOption === "custom"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            )}
          >
            <div className="font-medium">Another Week</div>
            {selectedOption === "custom" ? (
              <div className="flex items-center gap-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCustomPrev()
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="flex-1 text-center text-sm">
                  {formatWeekLabel(customWeekDate)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCustomNext()
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                Select a different week
              </div>
            )}
          </button>
        </div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleAddToPlan} disabled={addToPlan.isPending}>
            {addToPlan.isPending ? "Adding..." : "Add to Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
