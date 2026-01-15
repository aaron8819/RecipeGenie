"use client"

import { useState, useEffect } from "react"
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Shuffle,
  Check,
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
import {
  useWeeklyPlan,
  useWeeklyPlanRecipes,
  useUserConfig,
  useGenerateMealPlan,
  useSwapRecipe,
  useMarkRecipeMade,
  getWeekStartDate,
  navigateWeek,
} from "@/hooks/use-planner"
import type { Recipe } from "@/types/database"

export function MealPlanner() {
  const [currentWeekDate, setCurrentWeekDate] = useState<string>("")
  const [selection, setSelection] = useState<Record<string, number>>({})

  const { data: config } = useUserConfig()
  const { data: weeklyPlan, isLoading: planLoading } = useWeeklyPlan(currentWeekDate)
  const { data: recipes } = useWeeklyPlanRecipes(weeklyPlan?.recipe_ids || [])

  const generatePlan = useGenerateMealPlan()
  const swapRecipe = useSwapRecipe()
  const markMade = useMarkRecipeMade()

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
    await markMade.mutateAsync(recipeId)
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
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={handlePrevWeek}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Prev Week
        </Button>

        <h2 className="text-lg font-semibold">
          Week of {formatWeekLabel(currentWeekDate)}
        </h2>

        <Button variant="outline" onClick={handleNextWeek}>
          Next Week
          <ChevronRight className="h-4 w-4 ml-1" />
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

          <Button
            onClick={handleGeneratePlan}
            disabled={generatePlan.isPending}
            className="mt-4 w-full"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${generatePlan.isPending ? "animate-spin" : ""}`}
            />
            Generate Meal Plan
          </Button>
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
            {recipes.map((recipe) => (
              <Card key={recipe.id}>
                <CardContent className="pt-4">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-medium">{recipe.name}</h4>
                      <p className="text-sm text-muted-foreground capitalize">
                        {recipe.category} • {recipe.servings} servings
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSwapRecipe(recipe)}
                      disabled={swapRecipe.isPending}
                    >
                      <Shuffle className="h-4 w-4 mr-1" />
                      Swap
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleMarkMade(recipe.id)}
                      disabled={markMade.isPending}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Made It
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
