"use client"

import { useState, useEffect } from "react"
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Shuffle,
  Check,
  Clock,
  ShoppingCart,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { RecipeDetailDialog } from "@/components/recipes/recipe-detail-dialog"
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

export function MealPlanner() {
  const [currentWeekDate, setCurrentWeekDate] = useState<string>("")
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [markingRecipeId, setMarkingRecipeId] = useState<string | null>(null)
  const [addingToCartRecipeId, setAddingToCartRecipeId] = useState<string | null>(null)

  const { data: config } = useUserConfig()
  const { data: weeklyPlan, isLoading: planLoading } = useWeeklyPlan(currentWeekDate)
  const { data: recipes } = useWeeklyPlanRecipes(weeklyPlan?.recipe_ids || [])
  const { data: history } = useRecipeHistory()

  const generatePlan = useGenerateMealPlan()
  const swapRecipe = useSwapRecipe()
  const markMade = useMarkRecipeMade()
  const removeFromPlan = useRemoveRecipeFromPlan()
  const addToShoppingList = useAddToShoppingList()

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
    await swapRecipe.mutateAsync({
      weekDate: currentWeekDate,
      oldRecipeId: recipe.id,
      category: recipe.category,
      excludeIds: weeklyPlan?.recipe_ids || [],
    })
  }

  const handleMarkMade = async (recipeId: string) => {
    setMarkingRecipeId(recipeId)
    try {
      await markMade.mutateAsync(recipeId)
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

  const categories = config?.categories || []

  return (
    <div className="space-y-6">
      {/* Week Navigation */}
      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" size="lg" onClick={handlePrevWeek} className="px-3 sm:px-4">
          <ChevronLeft className="h-5 w-5 sm:mr-1" />
          <span className="hidden sm:inline">Prev</span>
        </Button>

        <h2 className="text-lg font-semibold text-center">
          Week of {formatWeekLabel(currentWeekDate)}
        </h2>

        <Button variant="outline" size="lg" onClick={handleNextWeek} className="px-3 sm:px-4">
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-5 w-5 sm:ml-1" />
        </Button>
      </div>

      {/* Category Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipe Selection</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
            {categories.map((category: string) => (
              <div key={category} className="space-y-1">
                <Label htmlFor={`select-${category}`} className="capitalize text-sm">
                  {category}
                </Label>
                <Select
                  value={String(selection[category] || 0)}
                  onValueChange={(v) =>
                    setSelection((prev) => ({ ...prev, [category]: parseInt(v) }))
                  }
                >
                  <SelectTrigger id={`select-${category}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div className="flex gap-3 mt-4">
            <Button
              onClick={handleGeneratePlan}
              disabled={generatePlan.isPending}
              className="flex-1 h-12"
              size="lg"
            >
              <RefreshCw
                className={`h-5 w-5 mr-2 ${generatePlan.isPending ? "animate-spin" : ""}`}
              />
              Generate Meal Plan
            </Button>
            <Button
              onClick={handleGenerateShoppingList}
              disabled={addToShoppingList.isPending || !recipes || recipes.length === 0}
              variant="outline"
              className="flex-1 h-12"
              size="lg"
            >
              <ShoppingCart
                className={`h-5 w-5 mr-2 ${addToShoppingList.isPending ? "animate-pulse" : ""}`}
              />
              Generate Shopping List
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Meal Plan Display */}
      <div className="space-y-4">
        <h3 className="font-semibold">
          This Week&apos;s Meals ({recipes?.length || 0} recipes)
        </h3>

        {planLoading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : !recipes || recipes.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No meal plan for this week. Generate one above!
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((recipe, index) => {
              const lastMade = lastMadeMap.get(recipe.id)
              const isMarkingThis = markingRecipeId === recipe.id

              const isAddingToCart = addingToCartRecipeId === recipe.id

              return (
                <Card
                  key={recipe.id}
                  className="animate-fade-in cursor-pointer hover:shadow-md transition-shadow"
                  style={{ animationDelay: `${index * 50}ms` }}
                  onClick={() => setViewingRecipe(recipe)}
                >
                  <CardContent className="pt-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="font-semibold text-foreground">{recipe.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="capitalize px-2 py-0.5 bg-sage-100 text-sage-700 rounded-full text-xs font-medium">
                            {recipe.category}
                          </span>
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
                        className="flex-1 h-10"
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
                        variant={lastMade ? "default" : "outline"}
                        size="default"
                        className={
                          lastMade
                            ? "flex-1 h-10 bg-sage-600 hover:bg-sage-700 text-white"
                            : "flex-1 h-10 text-sage-700 border-sage-300 hover:bg-sage-50"
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMarkMade(recipe.id)
                        }}
                        disabled={isMarkingThis}
                      >
                        <Check className="h-4 w-4 mr-1.5" />
                        {isMarkingThis ? "Saving..." : lastMade ? "Made Again" : "Made It"}
                      </Button>
                      <Button
                        variant="outline"
                        size="default"
                        className="h-10 px-3 text-sage-700 border-sage-300 hover:bg-sage-50"
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
                        className="h-10 px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
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
      />
    </div>
  )
}
