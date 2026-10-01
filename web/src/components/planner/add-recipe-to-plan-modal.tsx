"use client"

import { useState, useMemo } from "react"
import { Search } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useRecipes, useCategories } from "@/hooks/use-recipes"
import { useAddRecipeToPlan, useWeeklyPlan } from "@/hooks/use-planner"
import { getWeekDays } from "./meal-planner.utils"
import { useAsyncSubmit } from "@/hooks/use-async-submit"
import type { Recipe } from "@/types/database"
import { cn, getErrorMessage } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface AddRecipeToPlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekDate: string
  /** When adding from a specific day's "Add Meal", pass that day index (0–6, relative to week start). */
  targetDayIndex?: number | null
  /** Week start day (0=Sunday, 1=Monday, etc.) for converting to day-of-week. */
  weekStartDay?: number
  onCloseAutoFocus?: (event: Event) => void
  onAdded?: () => void
}

export function AddRecipeToPlanModal({
  open,
  onOpenChange,
  weekDate,
  targetDayIndex = null,
  weekStartDay = 1,
  onCloseAutoFocus,
  onAdded,
}: AddRecipeToPlanModalProps) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)

  const { data: recipes } = useRecipes({
    search: search || null,
    category,
  })
  const { data: categories } = useCategories()
  const addToPlan = useAddRecipeToPlan()
  const { data: plan } = useWeeklyPlan(weekDate)
  const days = weekDate ? getWeekDays(weekDate) : []
  const selectedDate = targetDayIndex != null ? days[targetDayIndex]?.date : undefined
  const formatDate = (date: Date) => date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  })
  const {
    clearError: clearSubmissionError,
    error: submissionError,
    isSubmitting,
    reset: resetSubmissionState,
    run,
  } = useAsyncSubmit({
    getErrorMessage: (error) => getErrorMessage(error, "Failed to add recipe to this plan"),
  })

  // Reset state when modal opens
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearch("")
      setCategory(null)
      setSelectedRecipeId(null)
      resetSubmissionState()
    }
    onOpenChange(open)
  }

  const handleAddToPlan = async () => {
    if (!selectedRecipeId || !weekDate || isSubmitting) return

    await run(async () => {
      await addToPlan.mutateAsync({
        weekDate,
        recipeId: selectedRecipeId,
        dayOfWeek: targetDayIndex != null ? (weekStartDay + targetDayIndex) % 7 : undefined,
      })
      onAdded?.()
      handleOpenChange(false)
    })
  }

  const selectedRecipe = useMemo(() => {
    return recipes?.find(r => r.id === selectedRecipeId)
  }, [recipes, selectedRecipeId])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl max-h-[90dvh] flex flex-col overflow-hidden bg-shell p-6 sm:p-8" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle className="font-display text-3xl font-semibold">
            Add Recipe to Plan
          </DialogTitle>
          <DialogDescription>
            {selectedDate ? `Choose a recipe for ${formatDate(selectedDate)}.` :
              `Choose a recipe for the week of ${days[0] ? formatDate(days[0].date) : weekDate}.`}
          </DialogDescription>
        </DialogHeader>

        {/* Search and Filter */}
        <div className="flex shrink-0 flex-col gap-2 mt-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search recipes..."
              aria-label="Search recipes to add"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                if (submissionError) clearSubmissionError()
              }}
              className="h-11 pl-9"
            />
          </div>
          <Select
            value={category || "all"}
            onValueChange={(v) => {
              setCategory(v === "all" ? null : v)
              if (submissionError) clearSubmissionError()
            }}
          >
            <SelectTrigger className="h-11 w-full sm:w-[160px]" aria-label="Filter recipes by category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories?.map((cat: string) => (
                <SelectItem key={cat} value={cat} className="capitalize">
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Recipe List */}
        <div className="flex-1 overflow-y-auto min-h-0 max-h-[400px] border rounded-lg mt-2" data-testid="add-meal-results">
          {!recipes || recipes.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-sm">
              {search || category ? "No recipes match your search." : "No recipes available."}
            </p>
          ) : (
            <ul className="divide-y">
              {recipes.map((recipe) => {
                const plannedDay = days.find(day => day.date.getDay() === plan?.day_assignments?.[recipe.id])
                return (
                  <li key={recipe.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRecipeId(recipe.id)
                        if (submissionError) clearSubmissionError()
                      }}
                      className={cn(
                        "w-full px-4 py-3 text-left transition-colors hover:bg-accent",
                        selectedRecipeId === recipe.id && "bg-primary/10"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1 break-words">
                          <div className="font-medium">{recipe.name}</div>
                          {plan?.recipe_ids.includes(recipe.id) && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Already planned this week
                              {plannedDay && ` · ${plannedDay.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <span className={cn("capitalize text-xs", getTagClassName(recipe.category, true))}>
                              {recipe.category}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {recipe.servings} servings
                            </span>
                          </div>
                        </div>
                        <div
                          className={cn(
                            "ml-3 w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center",
                            selectedRecipeId === recipe.id
                              ? "border-primary bg-primary"
                              : "border-muted-foreground/30"
                          )}
                        >
                          {selectedRecipeId === recipe.id && (
                            <div className="w-2 h-2 rounded-full bg-white" />
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {submissionError ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {submissionError}
          </p>
        ) : null}

        <DialogFooter className="shrink-0 gap-2 mt-2">
          <Button className="h-11" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="h-11"
            onClick={handleAddToPlan}
            disabled={!selectedRecipeId || addToPlan.isPending || isSubmitting}
          >
            {addToPlan.isPending || isSubmitting ? "Adding..." : "Add to Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
