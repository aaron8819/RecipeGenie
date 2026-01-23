"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Shuffle,
  Check,
  Clock,
  ShoppingCart,
  Trash2,
  Heart,
  Loader2,
  Plus,
  MoreVertical,
  GripVertical,
  CalendarIcon,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RecipeDetailDialog } from "@/components/recipes/recipe-detail-dialog"
import { RecipeDialog } from "@/components/recipes/recipe-dialog"
import { AddRecipeToPlanModal } from "./add-recipe-to-plan-modal"
import { PlanSettingsModal } from "./plan-settings-modal"
import {
  useWeeklyPlan,
  useWeeklyPlanRecipes,
  useUserConfig,
  useUpdateUserConfig,
  useGenerateMealPlan,
  useSwapRecipe,
  useMarkRecipeMade,
  useRemoveRecipeFromPlan,
  useAddRecipeToPlan,
  useRecipeHistory,
  useSaveDayAssignments,
  getWeekStartDate,
  navigateWeek,
} from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { useCategories, useToggleFavorite, useRecipes } from "@/hooks/use-recipes"
import { EmptyState } from "@/components/ui/empty-state"
import { CalendarDays, BookOpen } from "lucide-react"
import { getTagClassName, getTagColor } from "@/lib/tag-colors"
import { cn } from "@/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
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
 * Recipe stats interface
 */
interface RecipeStats {
  lastMade: string | null
  timesMade: number
}

/**
 * Get stats (last made date + times made count) for each recipe from history
 */
function getRecipeStatsMap(history: RecipeHistory[] | undefined): Map<string, RecipeStats> {
  const statsMap = new Map<string, RecipeStats>()
  if (!history) return statsMap

  // History is already sorted by date_made DESC, so first occurrence is most recent
  for (const entry of history) {
    const existing = statsMap.get(entry.recipe_id)
    if (existing) {
      existing.timesMade += 1
    } else {
      statsMap.set(entry.recipe_id, {
        lastMade: entry.date_made,
        timesMade: 1,
      })
    }
  }
  return statsMap
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

const PLANNER_VIEW_KEY = "recipe-genie-planner-view"
const RECIPE_DAY_ASSIGNMENTS_KEY = "recipe-genie-recipe-day-assignments"

/**
 * Hex colors for category pills (for inline styles)
 */
const CATEGORY_HEX_COLORS: Record<string, string> = {
  chicken: "#4d7c0f",     // lime-700
  beef: "#b91c1c",        // red-700
  lamb: "#c2410c",        // orange-700
  turkey: "#a16207",      // yellow-700
  vegetarian: "#1d4ed8",  // blue-700
}

/**
 * Get hex color for a category
 */
function getCategoryHexColor(category: string): string {
  return CATEGORY_HEX_COLORS[category.toLowerCase()] || "#6b7280" // gray-500 fallback
}

/**
 * Compact category pill with inline stepper for meal selection
 */
interface CategoryPillProps {
  category: string
  count: number
  onIncrement: () => void
  onDecrement: () => void
}

function CategoryPill({ category, count, onIncrement, onDecrement }: CategoryPillProps) {
  const isActive = count > 0
  const categoryColor = getCategoryHexColor(category)

  return (
    <div
      className={cn(
        "flex-shrink-0 flex flex-col items-center gap-2 px-4 py-3 rounded-xl border-2 transition-all",
        isActive ? "bg-opacity-10" : "border-sage-200 bg-white"
      )}
      style={{
        borderColor: isActive ? categoryColor : undefined,
        backgroundColor: isActive ? `${categoryColor}10` : undefined,
      }}
    >
      {/* Category label with color dot */}
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full"
          style={{ backgroundColor: categoryColor }}
        />
        <span className="text-sm font-medium capitalize whitespace-nowrap">
          {category}
        </span>
      </div>

      {/* Compact stepper */}
      <div className="flex items-center gap-1">
        <button
          onClick={onDecrement}
          disabled={count === 0}
          className="w-7 h-7 rounded-full border border-sage-300 flex items-center justify-center
                     disabled:opacity-30 hover:bg-sage-100 transition-colors"
          aria-label={`Decrease ${category} count`}
        >
          <span className="text-lg leading-none">−</span>
        </button>
        <span className="w-6 text-center text-lg font-semibold tabular-nums">
          {count}
        </span>
        <button
          onClick={onIncrement}
          disabled={count === 5}
          className="w-7 h-7 rounded-full border border-sage-300 flex items-center justify-center
                     disabled:opacity-30 hover:bg-sage-100 transition-colors"
          aria-label={`Increase ${category} count`}
        >
          <span className="text-lg leading-none">+</span>
        </button>
      </div>
    </div>
  )
}

type PlannerView = "calendar" | "list" | "category"
type RecipeDayAssignments = Record<string, number> // recipe_id -> dayIndex (0-6)
type WeekAssignments = Record<string, RecipeDayAssignments> // week_date -> RecipeDayAssignments

/**
 * Get array of day objects for a week
 */
function getWeekDays(weekStartDate: string, weekStartDay: number = 1): Array<{ date: Date; dayName: string; dayNumber: number }> {
  if (!weekStartDate) return []
  
  const startDate = new Date(weekStartDate)
  const days: Array<{ date: Date; dayName: string; dayNumber: number }> = []
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    const dayIndex = date.getDay()
    days.push({
      date,
      dayName: dayNames[dayIndex],
      dayNumber: date.getDate(),
    })
  }
  
  return days
}

/**
 * Day column component (Desktop)
 */
function DayColumn({
  day,
  dayIndex,
  dayRecipes,
  isRecipeMade,
  markingRecipeId,
  addingToCartRecipeId,
  swappingRecipeId,
  onViewRecipe,
  onSwapRecipe,
  onMarkMade,
  onAddToCart,
  onRemoveRecipe,
  onMoveToDay,
  getTagClassName,
  weekDays,
  currentDayIndex,
  isToday,
}: {
  day: { date: Date; dayName: string; dayNumber: number }
  dayIndex: number
  dayRecipes: Recipe[]
  isRecipeMade: (recipe: Recipe) => boolean
  markingRecipeId: string | null
  addingToCartRecipeId: string | null
  swappingRecipeId: string | null
  onViewRecipe: (recipe: Recipe) => void
  onSwapRecipe: (recipe: Recipe) => void
  onMarkMade: (recipeId: string, isMade: boolean) => void
  onAddToCart: (recipeId: string) => void
  onRemoveRecipe: (recipe: Recipe) => void
  onMoveToDay: (recipeId: string, dayIndex: number) => void
  getTagClassName: (tag: string, isCategory: boolean) => string
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
  isToday?: boolean
}) {
  return (
    <div
      data-day-index={dayIndex}
      className="min-h-[300px] p-4 border-r border-b border-gray-200 last:border-r-0 bg-gradient-to-b from-white to-gray-50/50 overflow-y-auto max-h-[600px] scrollbar-thin"
    >
      <div className="space-y-3">
        {dayRecipes.length > 0 ? (
          dayRecipes.map((recipe) => {
            const isMade = isRecipeMade(recipe)
            const isMarkingThis = markingRecipeId === recipe.id
            const isAddingToCart = addingToCartRecipeId === recipe.id
            const isSwapping = swappingRecipeId === recipe.id
            return (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                isMade={isMade}
                isMarkingThis={isMarkingThis}
                isAddingToCart={isAddingToCart}
                isSwapping={isSwapping}
                onView={() => onViewRecipe(recipe)}
                onSwap={() => onSwapRecipe(recipe)}
                onMarkMade={() => onMarkMade(recipe.id, isMade)}
                onAddToCart={() => onAddToCart(recipe.id)}
                onRemove={() => onRemoveRecipe(recipe)}
                onMoveToDay={(dayIdx) => onMoveToDay(recipe.id, dayIdx)}
                getTagClassName={getTagClassName}
                weekDays={weekDays}
                currentDayIndex={currentDayIndex?.[recipe.id] !== undefined ? currentDayIndex : undefined}
              />
            )
          })
        ) : (
          <div className="empty-state rounded-lg p-8 text-center border-2 border-dashed border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p className="text-sm text-gray-400 font-medium">No meals planned</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Day column component (Mobile)
 */
function MobileDayColumn({
  day,
  dayIndex,
  dayRecipes,
  isRecipeMade,
  markingRecipeId,
  addingToCartRecipeId,
  swappingRecipeId,
  onViewRecipe,
  onSwapRecipe,
  onMarkMade,
  onAddToCart,
  onRemoveRecipe,
  onMoveToDay,
  getTagClassName,
  weekDays,
  currentDayIndex,
}: {
  day: { date: Date; dayName: string; dayNumber: number }
  dayIndex: number
  dayRecipes: Recipe[]
  isRecipeMade: (recipe: Recipe) => boolean
  markingRecipeId: string | null
  addingToCartRecipeId: string | null
  swappingRecipeId: string | null
  onViewRecipe: (recipe: Recipe) => void
  onSwapRecipe: (recipe: Recipe) => void
  onMarkMade: (recipeId: string, isMade: boolean) => void
  onAddToCart: (recipeId: string) => void
  onRemoveRecipe: (recipe: Recipe) => void
  onMoveToDay: (recipeId: string, dayIndex: number) => void
  getTagClassName: (tag: string, isCategory: boolean) => string
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
}) {
  const hasMadeRecipes = dayRecipes.some(r => isRecipeMade(r))

  return (
    <div
      data-day-index={dayIndex}
      className={cn(
        "border-l-4 pl-4 rounded-lg p-3",
        hasMadeRecipes ? "border-sage-500" : "border-gray-300"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold">
            {day.dayName}, {day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
          <div className="text-xs text-gray-500">
            {dayRecipes.length} meal{dayRecipes.length !== 1 ? "s" : ""} planned
          </div>
        </div>
        {hasMadeRecipes && (
          <div className="flex items-center gap-1">
            <Check className="w-4 h-4 text-sage-600" />
            <span className="text-xs font-medium text-sage-600">Made</span>
          </div>
        )}
      </div>
      <div className="space-y-2">
        {dayRecipes.length > 0 ? (
          dayRecipes.map((recipe) => {
            const isMade = isRecipeMade(recipe)
            const isMarkingThis = markingRecipeId === recipe.id
            const isAddingToCart = addingToCartRecipeId === recipe.id
            const isSwapping = swappingRecipeId === recipe.id
            return (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                isMade={isMade}
                isMarkingThis={isMarkingThis}
                isAddingToCart={isAddingToCart}
                isSwapping={isSwapping}
                onView={() => onViewRecipe(recipe)}
                onSwap={() => onSwapRecipe(recipe)}
                onMarkMade={() => onMarkMade(recipe.id, isMade)}
                onAddToCart={() => onAddToCart(recipe.id)}
                onRemove={() => onRemoveRecipe(recipe)}
                onMoveToDay={(dayIdx) => onMoveToDay(recipe.id, dayIdx)}
                getTagClassName={getTagClassName}
                weekDays={weekDays}
                currentDayIndex={currentDayIndex}
              />
            )
          })
        ) : (
          <div className="rounded-lg p-6 text-center border-2 border-dashed border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100/50">
            <svg className="w-10 h-10 mx-auto text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <p className="text-sm text-gray-400 font-medium">No meals planned</p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Recipe card component for calendar view
 */
function RecipeCard({
  recipe,
  isMade,
  isMarkingThis,
  isAddingToCart,
  isSwapping,
  onView,
  onSwap,
  onMarkMade,
  onAddToCart,
  onRemove,
  onMoveToDay,
  getTagClassName,
  weekDays,
  currentDayIndex,
}: {
  recipe: Recipe
  isMade: boolean
  isMarkingThis: boolean
  isAddingToCart: boolean
  isSwapping: boolean
  onView: () => void
  onSwap: () => void
  onMarkMade: () => void
  onAddToCart: () => void
  onRemove: () => void
  onMoveToDay: (dayIndex: number) => void
  getTagClassName: (tag: string, isCategory: boolean) => string
  weekDays: Array<{ date: Date; dayName: string; dayNumber: number }>
  currentDayIndex: Record<string, number> | undefined
}) {
  const currentDayValue = currentDayIndex?.[recipe.id] !== undefined ? String(currentDayIndex[recipe.id]) : undefined
  const assignedDayIdx = currentDayIndex?.[recipe.id]
  const assignedDayName = assignedDayIdx !== undefined && weekDays[assignedDayIdx]
    ? weekDays[assignedDayIdx].dayName
    : null

  return (
    <div
      className={cn(
        "bg-white rounded-xl p-3 border-2 border-gray-100 shadow-sm hover:border-sage-300 hover:shadow-md transition-all duration-200",
        isMade && "relative"
      )}
      style={isMade ? {
        background: "linear-gradient(to bottom, rgba(34, 197, 94, 0.03), rgba(34, 197, 94, 0.01))"
      } : undefined}
    >
      <div className="flex items-start justify-between mb-2">
        <div
          className="font-semibold text-sm text-gray-800 pr-2 leading-tight cursor-pointer flex-1 hover:text-sage-700 transition-colors"
          onClick={onView}
        >
          {recipe.name}
        </div>
        {(() => {
          const tagColors = getTagColor(recipe.category, true)
          return (
            <div
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm",
                tagColors.bg,
                tagColors.text,
                "text-xs font-bold"
              )}
              title={recipe.category}
            >
              {recipe.category.charAt(0).toUpperCase()}
            </div>
          )
        })()}
      </div>

      {/* Desktop: show all buttons */}
      <div className="hidden lg:grid grid-cols-4 gap-1.5 mb-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 p-0 border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all hover:scale-105"
          onClick={(e) => {
            e.stopPropagation()
            onSwap()
          }}
          disabled={isSwapping}
          title="Swap"
        >
          {isSwapping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-600" />
          ) : (
            <Shuffle className="h-3.5 w-3.5 text-gray-600" />
          )}
        </Button>
        <Button
          variant={isMade ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-7 p-0 transition-all hover:scale-105",
            isMade
              ? "bg-green-600 hover:bg-green-700 text-white border-green-700 shadow-sm"
              : "text-sage-700 border-sage-200 hover:border-green-300 hover:bg-green-50"
          )}
          onClick={(e) => {
            e.stopPropagation()
            onMarkMade()
          }}
          disabled={isMarkingThis}
          title={isMade ? "Unmark as made" : "Mark as made"}
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 p-0 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all hover:scale-105"
          onClick={(e) => {
            e.stopPropagation()
            onAddToCart()
          }}
          disabled={isAddingToCart}
          title="Add to cart"
        >
          {isAddingToCart ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-600" />
          ) : (
            <ShoppingCart className="h-3.5 w-3.5 text-gray-600" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 p-0 border-gray-200 hover:border-red-300 hover:bg-red-50 text-gray-600 hover:text-red-600 transition-all hover:scale-105"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Mobile: show primary actions + overflow menu */}
      <div className="flex lg:hidden gap-1.5 mt-2 w-full">
        <Button
          variant={isMade ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-7 flex-1 p-0 transition-all",
            isMade
              ? "bg-green-600 hover:bg-green-700 text-white"
              : "text-sage-700 border-sage-200 hover:bg-green-50"
          )}
          onClick={(e) => {
            e.stopPropagation()
            onMarkMade()
          }}
          disabled={isMarkingThis}
          title={isMade ? "Unmark as made" : "Mark as made"}
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 p-0"
          onClick={(e) => {
            e.stopPropagation()
            onSwap()
          }}
          disabled={isSwapping}
          title="Swap"
        >
          {isSwapping ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Shuffle className="h-3 w-3" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 flex-1 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onAddToCart()
              }}
              disabled={isAddingToCart}
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Add to cart
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                onRemove()
              }}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Day assignment dropdown - improved visibility */}
      <div className="mt-2">
        <Select
          value={currentDayValue}
          onValueChange={(value) => {
            const dayIndex = parseInt(value, 10)
            if (!isNaN(dayIndex)) {
              onMoveToDay(dayIndex)
            }
          }}
        >
          <SelectTrigger className="h-7 text-[10px] w-full border-sage-200 bg-sage-50 hover:bg-sage-100 text-sage-700 font-medium transition-colors">
            <CalendarIcon className="h-3 w-3 mr-1 text-sage-600" />
            <SelectValue placeholder={assignedDayName ? assignedDayName : "Assign day"} />
          </SelectTrigger>
          <SelectContent>
            {weekDays.map((day, idx) => (
              <SelectItem key={idx} value={String(idx)}>
                {day.dayName}, {day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

/**
 * Get day name abbreviation
 */
function getDayName(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short" })
}

export function MealPlanner() {
  const [currentWeekDate, setCurrentWeekDate] = useState<string>("")
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [markingRecipeId, setMarkingRecipeId] = useState<string | null>(null)
  const [addingToCartRecipeId, setAddingToCartRecipeId] = useState<string | null>(null)
  const [swappingRecipeId, setSwappingRecipeId] = useState<string | null>(null)
  const [pendingRemovalRecipeId, setPendingRemovalRecipeId] = useState<string | null>(null)
  const [isAddRecipeModalOpen, setIsAddRecipeModalOpen] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false)
  const [view, setView] = useState<PlannerView>(() => {
    if (typeof window === "undefined") return "calendar"
    return (localStorage.getItem(PLANNER_VIEW_KEY) as PlannerView) || "calendar"
  })

  // Hook to save day assignments to database
  const saveDayAssignments = useSaveDayAssignments()

  const { data: config } = useUserConfig()
  const updateConfig = useUpdateUserConfig()
  const { data: weeklyPlan, isLoading: planLoading } = useWeeklyPlan(currentWeekDate)

  // Get day assignments from the weekly plan (database) with localStorage fallback
  const recipeDayAssignments = useMemo(() => {
    // First try to get from database (weekly plan)
    if (weeklyPlan?.day_assignments) {
      return weeklyPlan.day_assignments
    }
    // Fallback to localStorage for backward compatibility and guest mode
    if (typeof window !== "undefined" && currentWeekDate) {
      try {
        const stored = localStorage.getItem(RECIPE_DAY_ASSIGNMENTS_KEY)
        if (stored) {
          const allAssignments: WeekAssignments = JSON.parse(stored)
          return allAssignments[currentWeekDate] || {}
        }
      } catch {
        // Ignore parse errors
      }
    }
    return {}
  }, [weeklyPlan?.day_assignments, currentWeekDate])

  // Persist view state to localStorage
  useEffect(() => {
    localStorage.setItem(PLANNER_VIEW_KEY, view)
  }, [view])
  const { data: recipes } = useWeeklyPlanRecipes(weeklyPlan?.recipe_ids || [])
  const { data: history } = useRecipeHistory()
  const { data: allCategories } = useCategories()
  const { data: allRecipes } = useRecipes({})
  const hasAnyRecipes = (allRecipes?.length ?? 0) > 0

  const generatePlan = useGenerateMealPlan()
  const swapRecipe = useSwapRecipe()
  const markMade = useMarkRecipeMade()
  const removeFromPlan = useRemoveRecipeFromPlan()
  const addRecipeToPlan = useAddRecipeToPlan()
  const addToShoppingList = useAddToShoppingList()
  const toggleFavorite = useToggleFavorite()
  const undoToast = useUndoToast()

  // Build a map of recipe_id -> last made date
  const lastMadeMap = getLastMadeMap(history)
  
  // Build a map of recipe_id -> stats (last made + times made)
  const statsMap = useMemo(() => getRecipeStatsMap(history), [history])

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

  const handleGeneratePlan = () => {
    if (!currentWeekDate) return
    // Show confirmation if there are existing recipes
    if (weeklyPlan?.recipe_ids && weeklyPlan.recipe_ids.length > 0) {
      setShowRegenerateConfirm(true)
    } else {
      executeGeneratePlan()
    }
  }

  const executeGeneratePlan = async () => {
    if (!currentWeekDate) return
    setShowRegenerateConfirm(false)
    await generatePlan.mutateAsync({ weekDate: currentWeekDate, selection })
  }

  const handleGenerateShoppingList = async () => {
    if (!weeklyPlan?.recipe_ids || weeklyPlan.recipe_ids.length === 0) return
    try {
      const result = await addToShoppingList.mutateAsync({ recipeIds: weeklyPlan.recipe_ids })
      
      // Show success message based on what happened
      let message = ""
      if (result.added > 0 && result.merged > 0) {
        message = `${result.added} item${result.added !== 1 ? "s" : ""} added, ${result.merged} item${result.merged !== 1 ? "s" : ""} merged to shopping list`
      } else if (result.added > 0) {
        message = `${result.added} item${result.added !== 1 ? "s" : ""} added to shopping list`
      } else if (result.merged > 0) {
        message = `${result.merged} item${result.merged !== 1 ? "s" : ""} merged to shopping list`
      } else {
        message = "All items already in shopping list"
      }
      
      undoToast.show({
        message,
        duration: 4000,
      })
    } catch (error) {
      // Error handling is done by the mutation itself
      console.error("Failed to add to shopping list:", error)
    }
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
      setSwappingRecipeId(null)
    }
  }

  const handleMarkMade = useCallback(async (recipeId: string, isMadeForWeek: boolean) => {
    if (!currentWeekDate) return

    // Get recipe name for the toast message
    const recipe = recipes?.find(r => r.id === recipeId)
    const recipeName = recipe?.name || "Recipe"

    setMarkingRecipeId(recipeId)
    try {
      // Execute the mutation immediately
      await markMade.mutateAsync({ recipeId, weekDate: currentWeekDate, isMadeForWeek })

      // Show undo toast after mutation succeeds
      undoToast.show({
        message: isMadeForWeek
          ? `"${recipeName}" unmarked as made`
          : `"${recipeName}" marked as made`,
        onUndo: () => {
          // Toggle back the made status
          markMade.mutate({
            recipeId,
            weekDate: currentWeekDate,
            isMadeForWeek: !isMadeForWeek, // Toggle back
          })
        },
        onExpire: () => {
          // Mutation already executed, nothing to do
        },
      })
    } finally {
      setMarkingRecipeId(null)
    }
  }, [currentWeekDate, recipes, markMade, undoToast])

  const handleRemoveFromPlan = useCallback((recipe: Recipe) => {
    if (!currentWeekDate) return
    setPendingRemovalRecipeId(recipe.id)
    undoToast.show({
      message: `"${recipe.name}" removed from plan`,
      onUndo: () => {
        setPendingRemovalRecipeId(null)
      },
      onExpire: () => {
        removeFromPlan.mutate({ weekDate: currentWeekDate, recipeId: recipe.id })
        setPendingRemovalRecipeId(null)
      },
    })
  }, [currentWeekDate, undoToast, removeFromPlan])

  const handleAddRecipeToCart = async (recipeId: string) => {
    setAddingToCartRecipeId(recipeId)
    try {
      await addToShoppingList.mutateAsync({ recipeIds: [recipeId] })
    } finally {
      setAddingToCartRecipeId(null)
    }
  }

  // Move recipe to a different day
  const handleMoveToDay = useCallback((recipeId: string, dayIndex: number) => {
    if (!currentWeekDate || dayIndex < 0 || dayIndex >= 7) return
    
    // Update local state immediately for optimistic UI update
    const updatedAssignments = {
      ...recipeDayAssignments,
      [recipeId]: dayIndex,
    }
    
    // Save to database (or localStorage for guest mode)
    saveDayAssignments.mutate({
      weekDate: currentWeekDate,
      dayAssignments: updatedAssignments,
    })
    
    // Also update localStorage as fallback
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem(RECIPE_DAY_ASSIGNMENTS_KEY)
        const allAssignments: WeekAssignments = stored ? JSON.parse(stored) : {}
        allAssignments[currentWeekDate] = updatedAssignments
        localStorage.setItem(RECIPE_DAY_ASSIGNMENTS_KEY, JSON.stringify(allAssignments))
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [currentWeekDate, recipeDayAssignments, saveDayAssignments])

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

  // Filter out pending removal recipes
  const displayedRecipes = recipes?.filter(r => r.id !== pendingRemovalRecipeId)

  // Get recipes assigned to each day
  const getRecipesByDay = useCallback((dayIndex: number): Recipe[] => {
    if (!displayedRecipes) return []
    
    // Get recipes explicitly assigned to this day
    const assignedRecipes = displayedRecipes.filter(
      recipe => recipeDayAssignments[recipe.id] === dayIndex
    )
    
    // Get recipes that aren't assigned to any day
    const unassignedRecipes = displayedRecipes.filter(
      recipe => recipeDayAssignments[recipe.id] === undefined
    )
    
    // Distribute unassigned recipes evenly across days (original behavior)
    // We need to maintain the original order, so we filter by the index in the full displayedRecipes array
    const unassignedForThisDay = displayedRecipes.filter((recipe, idx) => {
      // Only include if it's unassigned AND would fall on this day in the original distribution
      return recipeDayAssignments[recipe.id] === undefined && (idx % 7 === dayIndex)
    })
    
    // Combine assigned recipes with unassigned recipes for this day
    return [...assignedRecipes, ...unassignedForThisDay]
  }, [displayedRecipes, recipeDayAssignments])

  // Check if displayed week is the current week
  const currentWeekStart = getWeekStartDate(new Date(), config?.week_start_day || 1)
  const isCurrentWeek = currentWeekDate === currentWeekStart

  // Calculate progress (made recipes / total recipes)
  const progress = useMemo(() => {
    if (!displayedRecipes || displayedRecipes.length === 0) return { made: 0, total: 0, percentage: 0 }
    
    const madeCount = displayedRecipes.filter(recipe => {
      const isManuallyMarked = weeklyPlan?.made_recipe_ids?.includes(recipe.id) || false
      const lastMade = lastMadeMap.get(recipe.id)
      const isMadeInWeek = lastMade ? isDateInWeekRange(lastMade, currentWeekDate) : false
      return isManuallyMarked || isMadeInWeek
    }).length
    
    return {
      made: madeCount,
      total: displayedRecipes.length,
      percentage: displayedRecipes.length > 0 ? Math.round((madeCount / displayedRecipes.length) * 100) : 0,
    }
  }, [displayedRecipes, weeklyPlan?.made_recipe_ids, lastMadeMap, currentWeekDate])

  // Get week days for calendar view
  const weekDays = useMemo(() => {
    return getWeekDays(currentWeekDate, config?.week_start_day || 1)
  }, [currentWeekDate, config?.week_start_day])

  // Group recipes by category for category view
  const recipesByCategory = useMemo(() => {
    if (!displayedRecipes) return new Map<string, Recipe[]>()
    
    const grouped = new Map<string, Recipe[]>()
    displayedRecipes.forEach(recipe => {
      const category = recipe.category
      if (!grouped.has(category)) {
        grouped.set(category, [])
      }
      grouped.get(category)!.push(recipe)
    })
    
    return grouped
  }, [displayedRecipes])

  // Helper to check if recipe is made
  const isRecipeMade = useCallback((recipe: Recipe): boolean => {
    const isManuallyMarked = weeklyPlan?.made_recipe_ids?.includes(recipe.id) || false
    const lastMade = lastMadeMap.get(recipe.id)
    const isMadeInWeek = lastMade ? isDateInWeekRange(lastMade, currentWeekDate) : false
    return isManuallyMarked || isMadeInWeek
  }, [weeklyPlan?.made_recipe_ids, lastMadeMap, currentWeekDate])

  return (
    <div className="space-y-6 pb-20 sm:pb-6">
      {/* Week Navigation with Progress */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <Button variant="outline" size="lg" onClick={handlePrevWeek} className="px-3 sm:px-4">
              <ChevronLeft className="h-5 w-5 sm:mr-1" />
              <span className="hidden sm:inline">Prev</span>
            </Button>

            <div className="text-center flex-1">
              <h2 className="text-lg sm:text-xl font-semibold mb-1">
                Week of {formatWeekLabel(currentWeekDate)}
              </h2>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {isCurrentWeek && (
                  <span className="text-xs font-medium text-sage-600 bg-sage-100 px-2 py-0.5 rounded-full">
                    Current Week
                  </span>
                )}
              </div>
            </div>

            <Button variant="outline" size="lg" onClick={handleNextWeek} className="px-3 sm:px-4">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-5 w-5 sm:ml-1" />
            </Button>

            {/* Date picker for direct week navigation */}
            <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="lg" className="px-3" title="Jump to date">
                  <CalendarIcon className="h-5 w-5" />
                  <span className="hidden sm:inline ml-1">Jump</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  selected={currentWeekDate ? new Date(currentWeekDate) : undefined}
                  onSelect={(date) => {
                    if (date) {
                      const weekStart = getWeekStartDate(date, config?.week_start_day || 1)
                      setCurrentWeekDate(weekStart)
                      setIsDatePickerOpen(false)
                    }
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Progress Indicator */}
          {displayedRecipes && displayedRecipes.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Week Progress</span>
                <span className="text-sm font-semibold text-sage-600">
                  {progress.made} of {progress.total} meals made
                </span>
              </div>
              <div className="h-1.5 bg-sage-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-sage-600 to-sage-500 transition-all duration-300"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category Selection - Minimal Horizontal Pills */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">How many meals this week?</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setIsSettingsModalOpen(true)}
              title="Plan Settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {/* Scrollable pill container */}
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
            {categories.map((category: string) => (
              <CategoryPill
                key={category}
                category={category}
                count={selection[category] || 0}
                onIncrement={() => {
                  setSelection((prev) => ({
                    ...prev,
                    [category]: Math.min(5, (prev[category] || 0) + 1),
                  }))
                }}
                onDecrement={() => {
                  setSelection((prev) => ({
                    ...prev,
                    [category]: Math.max(0, (prev[category] || 0) - 1),
                  }))
                }}
              />
            ))}
          </div>

          {/* Minimal footer */}
          <div className="flex items-center justify-between pt-4 border-t mt-4">
            <div className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{totalMeals}</span> meals selected
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddRecipeModalOpen(true)}
                disabled={!hasAnyRecipes}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
              <Button
                size="sm"
                onClick={handleGeneratePlan}
                disabled={generatePlan.isPending || totalMeals === 0}
                className="bg-sage-600 hover:bg-sage-700"
              >
                {generatePlan.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Generate"
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meal Plan Display with View Tabs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4 flex-1">
            <h3 className="font-semibold">
              This Week&apos;s Meals ({displayedRecipes?.length || 0} recipes)
            </h3>
            {displayedRecipes && displayedRecipes.length > 0 && (
              <Tabs value={view} onValueChange={(v) => setView(v as PlannerView)} className="hidden sm:block">
                <TabsList>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                  <TabsTrigger value="list">List</TabsTrigger>
                  <TabsTrigger value="category">Category</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
          {displayedRecipes && displayedRecipes.length > 0 && (
            <Button
              onClick={handleGenerateShoppingList}
              disabled={addToShoppingList.isPending}
              variant="outline"
              size="default"
              className="flex-shrink-0"
            >
              {addToShoppingList.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">Add to Shopping List</span>
                  <span className="sm:hidden">Add to List</span>
                </>
              )}
            </Button>
          )}
        </div>

        {/* Mobile View Toggle */}
        {displayedRecipes && displayedRecipes.length > 0 && (
          <div className="sm:hidden">
            <Tabs value={view} onValueChange={(v) => setView(v as PlannerView)}>
              <TabsList className="w-full">
                <TabsTrigger value="calendar" className="flex-1">Calendar</TabsTrigger>
                <TabsTrigger value="list" className="flex-1">List</TabsTrigger>
                <TabsTrigger value="category" className="flex-1">Category</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        {planLoading ? (
          <p className="text-muted-foreground text-center py-8">Loading...</p>
        ) : !displayedRecipes || displayedRecipes.length === 0 ? (
          !hasAnyRecipes ? (
            <EmptyState
              icon={BookOpen}
              title="Add recipes first"
              description="You need recipes before you can plan your meals. Start by adding some recipes to your collection."
            />
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Plan your week"
              description="Select how many meals you want for each category, then generate a meal plan."
            />
          )
        ) : (
          <>
            {/* Calendar View */}
            {view === "calendar" && (
              <div className="space-y-4">
                {/* Desktop Calendar Grid */}
                <div className="hidden lg:block">
                  <Card className="overflow-hidden border-gray-200 shadow-xl">
                    <CardContent className="p-0">
                      {/* Enhanced Day Headers */}
                      <div className="grid grid-cols-7 border-b-2 border-gray-200">
                        {weekDays.map((day, dayIndex) => {
                          const today = new Date()
                          const isToday = day.date.toDateString() === today.toDateString()
                          return (
                            <div
                              key={day.date.toISOString()}
                              className={cn(
                                "p-4 text-center border-r border-gray-200 last:border-r-0 bg-gradient-to-br from-sage-50 to-emerald-50 relative",
                                isToday && "bg-gradient-to-br from-green-50 to-emerald-100"
                              )}
                            >
                              <div className="text-xs font-semibold text-sage-700 uppercase tracking-wide mb-1">
                                {day.dayName}
                              </div>
                              <div className="text-lg font-bold text-gray-800">{day.dayNumber}</div>
                              {isToday && (
                                <>
                                  <span className="absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full"></span>
                                  <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full"></div>
                                </>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div className="grid grid-cols-7">
                        {weekDays.map((day, dayIndex) => {
                          const dayRecipes = getRecipesByDay(dayIndex)
                          const today = new Date()
                          const isToday = day.date.toDateString() === today.toDateString()
                          return (
                            <DayColumn
                              key={day.date.toISOString()}
                              day={day}
                              dayIndex={dayIndex}
                              dayRecipes={dayRecipes}
                              isRecipeMade={isRecipeMade}
                              markingRecipeId={markingRecipeId}
                              addingToCartRecipeId={addingToCartRecipeId}
                              swappingRecipeId={swappingRecipeId}
                              onViewRecipe={setViewingRecipe}
                              onSwapRecipe={handleSwapRecipe}
                              onMarkMade={handleMarkMade}
                              onAddToCart={handleAddRecipeToCart}
                              onRemoveRecipe={handleRemoveFromPlan}
                              onMoveToDay={handleMoveToDay}
                              getTagClassName={getTagClassName}
                              weekDays={weekDays}
                              currentDayIndex={recipeDayAssignments}
                              isToday={isToday}
                            />
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Mobile Calendar Stack */}
                <div className="lg:hidden space-y-4">
                  {weekDays.map((day, dayIndex) => {
                    const dayRecipes = getRecipesByDay(dayIndex)
                    return (
                      <MobileDayColumn
                        key={day.date.toISOString()}
                        day={day}
                        dayIndex={dayIndex}
                        dayRecipes={dayRecipes}
                        isRecipeMade={isRecipeMade}
                        markingRecipeId={markingRecipeId}
                        addingToCartRecipeId={addingToCartRecipeId}
                        swappingRecipeId={swappingRecipeId}
                        onViewRecipe={setViewingRecipe}
                        onSwapRecipe={handleSwapRecipe}
                        onMarkMade={handleMarkMade}
                        onAddToCart={handleAddRecipeToCart}
                        onRemoveRecipe={handleRemoveFromPlan}
                        onMoveToDay={handleMoveToDay}
                        getTagClassName={getTagClassName}
                        weekDays={weekDays}
                        currentDayIndex={recipeDayAssignments}
                      />
                    )
                  })}
                </div>
              </div>
            )}

            {/* List View */}
            {view === "list" && (
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    {displayedRecipes.map((recipe, index) => {
                      const isMade = isRecipeMade(recipe)
                      const lastMade = lastMadeMap.get(recipe.id)
                      
                      return (
                        <div
                          key={recipe.id}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border border-sage-200 hover:shadow-md transition-shadow cursor-pointer",
                            isMade && "opacity-70 relative"
                          )}
                          onClick={() => setViewingRecipe(recipe)}
                        >
                          {isMade && (
                            <div className="absolute inset-0 bg-gradient-to-br from-sage-600/5 to-transparent pointer-events-none rounded-lg" />
                          )}
                          <div className="flex-shrink-0">
                            {isMade ? (
                              <div className="w-10 h-10 rounded-full bg-sage-100 flex items-center justify-center">
                                <Check className="w-5 h-5 text-sage-600" />
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                                <span className="text-xs font-semibold text-gray-600">
                                  {recipe.category.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-semibold text-sm">{recipe.name}</h4>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("text-xs px-2 py-0.5 rounded", getTagClassName(recipe.category, true))}>
                                {recipe.category}
                              </span>
                              <span className="text-xs text-gray-500">{recipe.servings} servings</span>
                              {lastMade && (
                                <>
                                  <span className="text-xs text-gray-400">•</span>
                                  <span className="text-xs text-gray-500">
                                    Last made: {new Date(lastMade).toLocaleDateString()}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex-shrink-0 flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 text-xs hidden sm:flex"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSwapRecipe(recipe)
                              }}
                              disabled={swappingRecipeId === recipe.id || swapRecipe.isPending}
                            >
                              <Shuffle className="h-3 w-3 mr-1" />
                              Swap
                            </Button>
                            <Button
                              variant={isMade ? "default" : "outline"}
                              size="sm"
                              className={cn(
                                "h-8 px-2 text-xs",
                                isMade
                                  ? "bg-sage-600 hover:bg-sage-700 text-white"
                                  : "text-sage-700 border-sage-300"
                              )}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleMarkMade(recipe.id, isMade)
                              }}
                              disabled={markingRecipeId === recipe.id}
                            >
                              <Check className="h-3 w-3 mr-1" />
                              {isMade ? "Made" : "Made It"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAddRecipeToCart(recipe.id)
                              }}
                              disabled={addingToCartRecipeId === recipe.id}
                              title="Add to cart"
                            >
                              {addingToCartRecipeId === recipe.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ShoppingCart className="h-3 w-3" />
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRemoveFromPlan(recipe)
                              }}
                              title="Remove"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Category View */}
            {view === "category" && (
              <div className="space-y-4">
                {Array.from(recipesByCategory.entries())
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([category, categoryRecipes]) => {
                    const madeCount = categoryRecipes.filter(r => isRecipeMade(r)).length
                    const categoryColor = getTagClassName(category, true)
                    
                    return (
                      <Card key={category}>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold capitalize">{category}</span>
                              <span className={cn("text-xs px-2 py-0.5 rounded-full", categoryColor)}>
                                {categoryRecipes.length} recipe{categoryRecipes.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            {madeCount > 0 && (
                              <span className="text-xs text-sage-600 font-medium">
                                {madeCount} made
                              </span>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {categoryRecipes.map((recipe, idx) => {
                              const isMade = isRecipeMade(recipe)
                              return (
                                <div
                                  key={recipe.id}
                                  className={cn(
                                    "bg-white rounded-lg p-3 border border-sage-200 hover:shadow-md transition-shadow cursor-pointer",
                                    isMade && "opacity-70 relative"
                                  )}
                                  onClick={() => setViewingRecipe(recipe)}
                                >
                                  {isMade && (
                                    <div className="absolute inset-0 bg-gradient-to-br from-sage-600/10 to-transparent pointer-events-none rounded-lg" />
                                  )}
                                  <div className="flex items-center gap-2 mb-2">
                                    <h4 className="font-semibold text-sm pr-2">{recipe.name}</h4>
                                    {(() => {
                                      const tagColors = getTagColor(recipe.category, true)
                                      return (
                                        <div
                                          className={cn(
                                            "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                                            tagColors.bg,
                                            tagColors.text,
                                            "text-xs font-semibold"
                                          )}
                                          title={recipe.category}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {recipe.category.charAt(0).toUpperCase()}
                                        </div>
                                      )
                                    })()}
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap mb-2">
                                    <span className="text-xs text-gray-500">{recipe.servings} servings</span>
                                    {lastMadeMap.get(recipe.id) && (
                                      <>
                                        <span className="text-xs text-gray-400">•</span>
                                        <span className="text-xs text-gray-500">
                                          {new Date(lastMadeMap.get(recipe.id)!).toLocaleDateString("en-US", {
                                            month: "short",
                                            day: "numeric",
                                          })}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                  <div className="flex gap-1.5 mt-3">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleSwapRecipe(recipe)
                                      }}
                                      disabled={swappingRecipeId === recipe.id || swapRecipe.isPending}
                                      title="Swap"
                                    >
                                      {swappingRecipeId === recipe.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Shuffle className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                    <Button
                                      variant={isMade ? "default" : "outline"}
                                      size="sm"
                                      className={cn(
                                        "h-8 w-8 p-0",
                                        isMade
                                          ? "bg-sage-600 hover:bg-sage-700 text-white"
                                          : "text-sage-700 border-sage-300"
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleMarkMade(recipe.id, isMade)
                                      }}
                                      disabled={markingRecipeId === recipe.id}
                                      title={isMade ? "Unmark as made" : "Mark as made"}
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleAddRecipeToCart(recipe.id)
                                      }}
                                      disabled={addingToCartRecipeId === recipe.id}
                                      title="Add to cart"
                                    >
                                      {addingToCartRecipeId === recipe.id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <ShoppingCart className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleRemoveFromPlan(recipe)
                                      }}
                                      title="Remove"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
              </div>
            )}
          </>
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
        lastMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.lastMade ?? null : null}
        timesMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.timesMade ?? 0 : 0}
      />

      {/* Edit Recipe Dialog */}
      <RecipeDialog
        open={!!editingRecipe}
        onOpenChange={(open) => !open && setEditingRecipe(null)}
        recipe={editingRecipe || undefined}
        categories={allCategories || []}
      />

      {/* Add Recipe to Plan Modal */}
      <AddRecipeToPlanModal
        open={isAddRecipeModalOpen}
        onOpenChange={setIsAddRecipeModalOpen}
        weekDate={currentWeekDate}
      />

      {/* Regeneration Confirmation Dialog */}
      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace existing plan?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace {weeklyPlan?.recipe_ids?.length || 0} existing{" "}
              {weeklyPlan?.recipe_ids?.length === 1 ? "recipe" : "recipes"} in your meal plan.
              Recipes marked as made will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeGeneratePlan}
              className="bg-sage-600 hover:bg-sage-700"
            >
              Generate New Plan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Plan Settings Modal */}
      <PlanSettingsModal
        open={isSettingsModalOpen}
        onOpenChange={setIsSettingsModalOpen}
        config={config ?? null}
        currentSelection={selection}
        categories={categories}
        onUpdateConfig={async (updates) => {
          await updateConfig.mutateAsync(updates)
        }}
        onLoadDefault={() => {
          if (config?.default_selection) {
            setSelection(config.default_selection as Record<string, number>)
          }
        }}
        isUpdating={updateConfig.isPending}
      />
    </div>
  )
}
