"use client"

import { useState, useEffect } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Shuffle,
  Check,
  Clock,
  ShoppingCart,
  Trash2,
  Heart,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RecipeDetailDialog } from "@/components/recipes/recipe-detail-dialog"
import { RecipeDialog } from "@/components/recipes/recipe-dialog"
import {
  useWeeklyPlan,
  useWeeklyPlanRecipes,
  useUserConfig,
  useGenerateMealPlan,
  useSwapRecipe,
  useMarkRecipeMade,
  useRemoveRecipeFromPlan,
  useRecipeHistory,
  getWeekStartDate,
  navigateWeek,
} from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useCategories, useToggleFavorite } from "@/hooks/use-recipes"
import { getTagClassName } from "@/lib/tag-colors"
import { cn } from "@/lib/utils"
import type { Recipe, RecipeHistory } from "@/types/database"

/**
 * Get the most recent "made" date for each recipe from history
 */
function getLastMadeMap(history: RecipeHistory[] | undefined): Map<string, string> {
  const lastMadeMap = new Map<string, string>()
  if (!history) return lastMadeMap

  // History is already sorted by date_made DESC, so first occurrence is most recent
  for (const entry of history) {
    if (!lastMadeMap.has(entry.recipe_id)) {
      lastMadeMap.set(entry.recipe_id, entry.date_made)
    }
  }
  return lastMadeMap
}

/**
 * Check if a date falls within a week's date range
 * @param dateStr - Date string to check (ISO format)
 * @param weekStartDate - Start date of the week (ISO format)
 * @returns true if date falls within the week (inclusive)
 */
function isDateInWeekRange(dateStr: string, weekStartDate: string): boolean {
  if (!dateStr || !weekStartDate) return false
  
  const date = new Date(dateStr)
  const weekStart = new Date(weekStartDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  weekEnd.setHours(23, 59, 59, 999) // End of day
  
  // Set time to start of day for comparison
  date.setHours(0, 0, 0, 0)
  weekStart.setHours(0, 0, 0, 0)
  
  return date >= weekStart && date <= weekEnd
}

const MEALS_SECTION_COLLAPSED_KEY = "recipe-genie-meals-section-collapsed"

export function MealPlanner() {
  const [currentWeekDate, setCurrentWeekDate] = useState<string>("")
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [markingRecipeId, setMarkingRecipeId] = useState<string | null>(null)
  const [addingToCartRecipeId, setAddingToCartRecipeId] = useState<string | null>(null)
  const [swappingRecipeId, setSwappingRecipeId] = useState<string | null>(null)
  const [mealsSectionCollapsed, setMealsSectionCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(MEALS_SECTION_COLLAPSED_KEY) === "true"
  })

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem(MEALS_SECTION_COLLAPSED_KEY, String(mealsSectionCollapsed))
  }, [mealsSectionCollapsed])

  const { data: config } = useUserConfig()
  const { data: weeklyPlan, isLoading: planLoading } = useWeeklyPlan(currentWeekDate)
  const { data: recipes } = useWeeklyPlanRecipes(weeklyPlan?.recipe_ids || [])
  const { data: history } = useRecipeHistory()
  const { data: allCategories } = useCategories()

  const generatePlan = useGenerateMealPlan()
  const swapRecipe = useSwapRecipe()
  const markMade = useMarkRecipeMade()
  const removeFromPlan = useRemoveRecipeFromPlan()
  const addToShoppingList = useAddToShoppingList()
  const toggleFavorite = useToggleFavorite()

  // Build a map of recipe_id -> last made date
  const lastMadeMap = getLastMadeMap(history)

  // Initialize current week on mount
  useEffect(() => {
    const weekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
    setCurrentWeekDate(weekStart)
  }, [config?.week_start_day])

  // Initialize selection from config
  useEffect(() => {
    if (config?.default_selection) {
      setSelection(config.default_selection as Record<string, number>)
    }
  }, [config?.default_selection])

  const handlePrevWeek = () => {
    setCurrentWeekDate((prev) => navigateWeek(prev, "prev"))
  }

  const handleNextWeek = () => {
    setCurrentWeekDate((prev) => navigateWeek(prev, "next"))
  }

  const handleGeneratePlan = async () => {
    if (!currentWeekDate) return
    await generatePlan.mutateAsync({ weekDate: currentWeekDate, selection })
  }

  const handleGenerateShoppingList = async () => {
    if (!weeklyPlan?.recipe_ids || weeklyPlan.recipe_ids.length === 0) return
    await addToShoppingList.mutateAsync({ recipeIds: weeklyPlan.recipe_ids })
  }

  const handleSwapRecipe = async (recipe: Recipe) => {
    if (!currentWeekDate) return
    setSwappingRecipeId(recipe.id)
    try {
      await swapRecipe.mutateAsync({
        weekDate: currentWeekDate,
        oldRecipeId: recipe.id,
        category: recipe.category,
        excludeIds: weeklyPlan?.recipe_ids || [],
      })
    } finally {
      // Clear swap state after animation completes
      setTimeout(() => setSwappingRecipeId(null), 600)
    }
  }

  const handleMarkMade = async (recipeId: string, isMadeForWeek: boolean) => {
    if (!currentWeekDate) return
    setMarkingRecipeId(recipeId)
    try {
      await markMade.mutateAsync({ recipeId, weekDate: currentWeekDate, isMadeForWeek })
    } finally {
      setMarkingRecipeId(null)
    }
  }

  const handleRemoveFromPlan = async (recipeId: string) => {
    if (!currentWeekDate) return
    await removeFromPlan.mutateAsync({ weekDate: currentWeekDate, recipeId })
  }

  const handleAddRecipeToCart = async (recipeId: string) => {
    setAddingToCartRecipeId(recipeId)
    try {
      await addToShoppingList.mutateAsync({ recipeIds: [recipeId] })
    } finally {
      setAddingToCartRecipeId(null)
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

  const categories = allCategories || config?.categories || []
  const totalMeals = Object.values(selection).reduce((sum, n) => sum + n, 0)

  // Check if displayed week is the current week
  const currentWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
  const isCurrentWeek = currentWeekDate === currentWeekStart

  return (
    <div className="space-y-6">
      {/* Week Navigation */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" size="lg" onClick={handlePrevWeek} className="px-3 sm:px-4">
          <ChevronLeft className="h-5 w-5 sm:mr-1" />
          <span className="hidden sm:inline">Prev</span>
        </Button>

        <div className="text-center">
          <h2 className="text-lg font-semibold">
            Week of {formatWeekLabel(currentWeekDate)}
          </h2>
          {isCurrentWeek && (
            <span className="text-xs font-medium text-sage-600 bg-sage-100 px-2 py-0.5 rounded-full">
              Current Week
            </span>
          )}
        </div>

        <Button variant="outline" size="lg" onClick={handleNextWeek} className="px-3 sm:px-4">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-5 w-5 sm:ml-1" />
        </Button>
      </div>

      {/* Category Selection */}
      <Card>
        <CardHeader
          className="pb-2 cursor-pointer select-none hover:bg-accent/50 transition-colors rounded-t-lg"
          onClick={() => setMealsSectionCollapsed((prev) => !prev)}
        >
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">How many meals this week?</CardTitle>
            <div className="flex items-center gap-2">
              {mealsSectionCollapsed && totalMeals > 0 && (
                <span className="text-sm text-muted-foreground">
                  {totalMeals} meals selected
                </span>
              )}
              <ChevronDown
                className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
                  mealsSectionCollapsed ? "-rotate-90" : ""
                }`}
              />
            </div>
          </div>
        </CardHeader>
        {!mealsSectionCollapsed && <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {categories.map((category: string) => {
              const count = selection[category] || 0
              return (
                <div
                  key={category}
                  className="flex flex-col items-center p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <span className="capitalize text-sm font-medium text-muted-foreground mb-2">
                    {category}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() =>
                        setSelection((prev) => ({
                          ...prev,
                          [category]: Math.max(0, (prev[category] || 0) - 1),
                        }))
                      }
                      disabled={count === 0}
                    >
                      <span className="text-lg font-medium">−</span>
                    </Button>
                    <span className="w-6 text-center text-lg font-semibold tabular-nums">
                      {count}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() =>
                        setSelection((prev) => ({
                          ...prev,
                          [category]: Math.min(5, (prev[category] || 0) + 1),
                        }))
                      }
                      disabled={count === 5}
                    >
                      <span className="text-lg font-medium">+</span>
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <span className="text-sm text-muted-foreground">
              Total: <span className="font-semibold text-foreground">{totalMeals} meals</span>
            </span>
            <Button
              onClick={handleGeneratePlan}
              disabled={generatePlan.isPending || totalMeals === 0}
              size="lg"
            >
              <RefreshCw
                className={`h-5 w-5 mr-2 ${generatePlan.isPending ? "animate-spin" : ""}`}
              />
              Generate Meal Plan
            </Button>
          </div>
        </CardContent>}
      </Card>

      {/* Meal Plan Display */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            This Week&apos;s Meals ({recipes?.length || 0} recipes)
          </h3>
          {recipes && recipes.length > 0 && (
            <Button
              onClick={handleGenerateShoppingList}
              disabled={addToShoppingList.isPending}
              variant="outline"
              size="default"
            >
              <ShoppingCart
                className={`h-4 w-4 mr-2 ${addToShoppingList.isPending ? "animate-pulse" : ""}`}
              />
              Add to Shopping List
            </Button>
          )}
        </div>

        {planLoading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : !recipes || recipes.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No meal plan for this week. Generate one above!
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recipes.map((recipe, index) => {
              const lastMade = lastMadeMap.get(recipe.id)
              const isManuallyMarked = weeklyPlan?.made_recipe_ids?.includes(recipe.id) || false
              const isMadeInWeek = lastMade ? isDateInWeekRange(lastMade, currentWeekDate) : false
              const isMadeForWeek = isManuallyMarked || isMadeInWeek
              const isMarkingThis = markingRecipeId === recipe.id
              const isAddingToCart = addingToCartRecipeId === recipe.id
              const isSwapping = swappingRecipeId === recipe.id

              return (
                <Card
                  key={`${recipe.id}-${index}`}
                  className={cn(
                    "cursor-pointer hover:shadow-md transition-shadow max-w-xs",
                    isSwapping ? "animate-flip" : "animate-fade-in"
                  )}
                  style={isSwapping ? undefined : { animationDelay: `${index * 50}ms` }}
                  onClick={() => setViewingRecipe(recipe)}
                >
                  <CardContent className="pt-4">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1 pr-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-foreground">{recipe.name}</h4>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 flex-shrink-0 transition-transform hover:scale-110"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleFavorite.mutate({ id: recipe.id, favorite: recipe.favorite })
                            }}
                          >
                            <Heart
                              className={`h-5 w-5 transition-colors ${
                                recipe.favorite
                                  ? "fill-terracotta-500 text-terracotta-500"
                                  : "text-muted-foreground hover:text-terracotta-400"
                              }`}
                            />
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className={cn("capitalize", getTagClassName(recipe.category, true))}>
                            {recipe.category}
                          </span>
                          {recipe.tags && recipe.tags.length > 0 && (
                            <>
                              {recipe.tags.map((tag) => (
                                <span key={tag} className={getTagClassName(tag, false)}>
                                  {tag}
                                </span>
                              ))}
                            </>
                          )}
                          <span className="text-xs text-muted-foreground">{recipe.servings} servings</span>
                        </div>
                      </div>
                    </div>

                    {lastMade && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                        <Clock className="h-3 w-3" />
                        <span>Last made: {new Date(lastMade).toLocaleDateString()}</span>
                      </div>
                    )}

                    <div className="flex gap-2 mt-4">
                      <Button
                        variant="outline"
                        size="default"
                        className="h-10 px-3"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSwapRecipe(recipe)
                        }}
                        disabled={swapRecipe.isPending}
                      >
                        <Shuffle className="h-4 w-4 mr-1.5" />
                        Swap
                      </Button>
                      <Button
                        variant={isMadeForWeek ? "default" : "outline"}
                        size="default"
                        className={
                          isMadeForWeek
                            ? "h-10 px-3 bg-sage-600 hover:bg-sage-700 text-white"
                            : "h-10 px-3 text-sage-700 border-sage-300 hover:bg-sage-50"
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMarkMade(recipe.id, isMadeForWeek)
                        }}
                        disabled={isMarkingThis}
                      >
                        <Check className="h-4 w-4 mr-1.5" />
                        {isMarkingThis ? "..." : isMadeForWeek ? "Made" : "Made It"}
                      </Button>
                      <Button
                        variant="outline"
                        size="default"
                        className="h-10 w-10 p-0 text-sage-700 border-sage-300 hover:bg-sage-50"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleAddRecipeToCart(recipe.id)
                        }}
                        disabled={isAddingToCart}
                        title="Add to shopping list"
                      >
                        <ShoppingCart className={`h-4 w-4 ${isAddingToCart ? "animate-pulse" : ""}`} />
                      </Button>
                      <Button
                        variant="outline"
                        size="default"
                        className="h-10 w-10 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveFromPlan(recipe.id)
                        }}
                        disabled={removeFromPlan.isPending}
                        title="Remove from plan"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Recipe Detail Dialog */}
      <RecipeDetailDialog
        open={!!viewingRecipe}
        onOpenChange={(open) => !open && setViewingRecipe(null)}
        recipe={viewingRecipe}
        onEdit={(r) => {
          setViewingRecipe(null)
          setEditingRecipe(r)
        }}
      />

      {/* Edit Recipe Dialog */}
      <RecipeDialog
        open={!!editingRecipe}
        onOpenChange={(open) => !open && setEditingRecipe(null)}
        recipe={editingRecipe || undefined}
        categories={allCategories || []}
      />
    </div>
  )
}
