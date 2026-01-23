"use client"

import { useState, useMemo } from "react"
import { Plus, Search, Heart, Filter, Grid3x3, List, X, Settings, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RecipeCard } from "./recipe-card"
import { RecipeDialog } from "./recipe-dialog"
import { RecipeDetailDialog } from "./recipe-detail-dialog"
import { AddToPlanDialog } from "./add-to-plan-dialog"
import { RecipeSettingsModal } from "./recipe-settings-modal"
import { EmptyState } from "@/components/ui/empty-state"
import {
  useRecipes,
  useCategories,
  useAllTags,
  useTagsWithCounts,
  useToggleFavorite,
  useDeleteRecipe,
} from "@/hooks/use-recipes"
import { useRecipeHistory, useMarkRecipeAsMade, useUnmarkRecipeAsMade } from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import type { Recipe, RecipeHistory } from "@/types/database"

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

type SortOption = "timesMade" | "lastMade" | "name" | "newest"

/**
 * Sort recipes based on the selected sort option
 */
function sortRecipes(
  recipes: Recipe[],
  statsMap: Map<string, RecipeStats>,
  sortBy: SortOption
): Recipe[] {
  return [...recipes].sort((a, b) => {
    const statsA = statsMap.get(a.id)
    const statsB = statsMap.get(b.id)

    // Helper to safely compare names
    const compareNames = (nameA: string | undefined, nameB: string | undefined) => {
      const safeA = nameA || ""
      const safeB = nameB || ""
      return safeA.localeCompare(safeB)
    }

    switch (sortBy) {
      case "timesMade": {
        const timesMadeA = statsA?.timesMade ?? 0
        const timesMadeB = statsB?.timesMade ?? 0
        if (timesMadeA !== timesMadeB) {
          return timesMadeB - timesMadeA
        }
        return compareNames(a.name, b.name)
      }
      case "lastMade": {
        const lastMadeA = statsA?.lastMade
        const lastMadeB = statsB?.lastMade
        if (!lastMadeA && !lastMadeB) return compareNames(a.name, b.name)
        if (!lastMadeA) return 1
        if (!lastMadeB) return -1
        return new Date(lastMadeB).getTime() - new Date(lastMadeA).getTime()
      }
      case "name":
        return compareNames(a.name, b.name)
      case "newest":
        // Assuming recipes have created_at or we use id as proxy
        // If you have created_at in your Recipe type, use that instead
        return (b.id || "").localeCompare(a.id || "")
      default:
        return 0
    }
  })
}
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MultiSelect } from "@/components/ui/multi-select"
import { cn } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

export function RecipeList() {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [sortBy, setSortBy] = useState<SortOption>("timesMade")
  const [showFilters, setShowFilters] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [addToPlanRecipe, setAddToPlanRecipe] = useState<Recipe | null>(null)
  const [addingToShoppingListId, setAddingToShoppingListId] = useState<string | null>(null)
  const [markingAsMadeId, setMarkingAsMadeId] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const { data: recipes, isLoading, isFetching } = useRecipes({
    category,
    search: search || null,
    favoritesOnly,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  })
  const { data: categories } = useCategories()
  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()
  const { data: history } = useRecipeHistory()
  const toggleFavorite = useToggleFavorite()
  const deleteRecipe = useDeleteRecipe()
  const addToShoppingList = useAddToShoppingList()
  const markAsMade = useMarkRecipeAsMade()
  const unmarkAsMade = useUnmarkRecipeAsMade()
  const { show: showToast } = useUndoToast()

  // Build a map of recipe_id -> stats (last made + times made)
  const statsMap = useMemo(() => getRecipeStatsMap(history), [history])
  
  // Show cached data immediately even while fetching (stale-while-revalidate)
  const displayRecipes = recipes || []
  
  // Sort recipes based on selected sort option
  const sortedRecipes = useMemo(() => {
    if (!displayRecipes.length) return []
    return sortRecipes(displayRecipes, statsMap, sortBy)
  }, [displayRecipes, statsMap, sortBy])
  
  // Only show skeleton on initial load with no cached data
  const showSkeleton = isLoading && !displayRecipes.length

  // Count active filters
  const activeFilterCount = useMemo(() => {
    return (category ? 1 : 0) + selectedTags.length + (favoritesOnly ? 1 : 0)
  }, [category, selectedTags.length, favoritesOnly])

  const handleDelete = async (recipe: Recipe) => {
    if (confirm(`Are you sure you want to delete "${recipe.name}"?`)) {
      await deleteRecipe.mutateAsync(recipe.id)
    }
  }

  const handleAddToShoppingList = async (recipe: Recipe) => {
    setAddingToShoppingListId(recipe.id)
    try {
      const result = await addToShoppingList.mutateAsync({
        recipeIds: [recipe.id],
        scale: 1.0,
      })
      
      const itemCount = result.added + result.merged
      showToast({
        message: `Added ${itemCount} ingredient${itemCount !== 1 ? "s" : ""} from "${recipe.name}" to shopping list`,
      })
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "Failed to add ingredients to shopping list",
      })
    } finally {
      setAddingToShoppingListId(null)
    }
  }

  const handleMarkAsMade = async (recipe: Recipe) => {
    setMarkingAsMadeId(recipe.id)
    try {
      await markAsMade.mutateAsync(recipe.id)
      
      // Show undo toast after mutation succeeds
      showToast({
        message: `"${recipe.name}" marked as made`,
        onUndo: () => {
          // Remove the most recent history entry for this recipe
          unmarkAsMade.mutate(recipe.id)
        },
        onExpire: () => {
          // Mutation already executed, nothing to do
        },
      })
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "Failed to mark recipe as made",
      })
    } finally {
      setMarkingAsMadeId(null)
    }
  }

  const clearAllFilters = () => {
    setCategory(null)
    setSelectedTags([])
    setFavoritesOnly(false)
    setSearch("")
  }


  return (
    <div className="space-y-4 w-full min-w-0 overflow-x-hidden">
      {/* Sticky Search Bar Only */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b pb-3 mb-4 w-full">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-base sm:text-sm"
          />
        </div>
        
        {/* Active Filter Chips - inside sticky bar but below search */}
        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {category && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
                <span className="capitalize">{category}</span>
                <button
                  onClick={() => setCategory(null)}
                  className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {selectedTags.map((tag) => {
              const tagColors = getTagClassName(tag, false)
              return (
                <div
                  key={tag}
                  className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium", tagColors)}
                >
                  {tag}
                  <button
                    onClick={() => setSelectedTags((prev) => prev.filter((t) => t !== tag))}
                    className="hover:opacity-70 rounded-full p-0.5 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
            {favoritesOnly && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium">
                Favorites
                <button
                  onClick={() => setFavoritesOnly(false)}
                  className="hover:bg-primary/20 rounded-full p-0.5 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters and Add Recipe - NOT sticky */}
      <div className="flex flex-col sm:flex-row gap-3 items-start">
        {/* Mobile: Filter Toggle */}
        <Button
          variant="outline"
          onClick={() => setShowFilters(!showFilters)}
          className="sm:hidden w-full"
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-2 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {/* Desktop Filters / Mobile Collapsible */}
        <div className={cn("transition-all duration-200 w-full", showFilters ? "block" : "hidden sm:block")}>
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Category Filter */}
          <Select
            value={category || "all"}
            onValueChange={(v) => setCategory(v === "all" ? null : v)}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="All categories" />
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

          {/* Tags Filter */}
          {allTags.length > 0 && (
            <MultiSelect
              options={allTags}
              value={selectedTags}
              onChange={setSelectedTags}
              placeholder="Filter by tags..."
              className="w-full sm:w-[180px]"
              tagCounts={tagCounts}
            />
          )}

          {/* Favorites Toggle */}
          <Button
            variant={favoritesOnly ? "default" : "outline"}
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className="w-full sm:w-auto"
          >
            <Heart
              className={cn(
                "h-4 w-4 mr-2",
                favoritesOnly && "fill-current"
              )}
            />
            Favorites
          </Button>

          {/* Sort */}
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="timesMade">Most Made</SelectItem>
              <SelectItem value="lastMade">Recently Made</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
            </SelectContent>
          </Select>

          {/* View Toggle */}
          <div className="flex gap-1 border rounded-lg p-1 bg-background">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grid")}
              className="flex-1"
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="flex-1"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
        </div>

        {/* Add Recipe and Settings Buttons - NOT sticky */}
        <div className="flex gap-2 w-full sm:w-auto sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => setIsSettingsOpen(true)}
            className="w-full sm:w-auto"
          >
            <Settings className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Settings</span>
          </Button>
          <Button onClick={() => setIsAddDialogOpen(true)} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Add Recipe
          </Button>
        </div>
      </div>

      {/* Recipe Grid/List */}
      {showSkeleton ? (
        <div className={cn(
          viewMode === "grid"
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "space-y-3"
        )}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className={cn(
                "border rounded-lg p-4 animate-pulse",
                viewMode === "list" && "flex items-center gap-4"
              )}
            >
              <div className="space-y-3">
                <div className="h-5 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-full" />
                <div className="h-4 bg-muted rounded w-2/3" />
                {viewMode === "grid" && (
                  <div className="flex gap-2 mt-3">
                    <div className="h-8 bg-muted rounded flex-1" />
                    <div className="h-8 w-8 bg-muted rounded" />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : displayRecipes.length === 0 ? (
        <EmptyState
          icon={Search}
          title={
            search || category || selectedTags.length > 0 || favoritesOnly
              ? "No recipes match your filters"
              : "No recipes yet"
          }
          description={
            search || category || selectedTags.length > 0 || favoritesOnly
              ? "Try adjusting your search or filters to find what you're looking for."
              : "Start building your recipe collection by adding your first recipe!"
          }
          action={
            !search && !category && selectedTags.length === 0 && !favoritesOnly
              ? {
                  label: "Add Recipe",
                  onClick: () => setIsAddDialogOpen(true),
                }
              : {
                  label: "Clear Filters",
                  onClick: clearAllFilters,
                  variant: "outline",
                }
          }
        />
      ) : (
        <div className="relative w-full overflow-hidden">
          {/* Subtle loading indicator for background refetch */}
          {isFetching && !isLoading && (
            <div className="absolute top-0 right-0 z-10 p-2">
              <div className="bg-background/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div
            className={cn(
              viewMode === "grid"
                ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 w-full"
                : "space-y-3 w-full"
            )}
          >
            {sortedRecipes.map((recipe, index) => {
              const stats = statsMap.get(recipe.id)
              return (
                <div
                  key={recipe.id}
                  style={{ animationDelay: `${index * 50}ms` }}
                  className="animate-fade-in w-full min-w-0"
                >
                  <RecipeCard
                    recipe={recipe}
                    viewMode={viewMode}
                    onDelete={handleDelete}
                    onToggleFavorite={(r) =>
                      toggleFavorite.mutate({ id: r.id, favorite: r.favorite })
                    }
                    onAddToPlan={setAddToPlanRecipe}
                    onAddToShoppingList={handleAddToShoppingList}
                    onMarkAsMade={handleMarkAsMade}
                    onClick={setViewingRecipe}
                    onTagClick={(tag) => {
                      if (!selectedTags.includes(tag)) {
                        setSelectedTags([...selectedTags, tag])
                      }
                    }}
                    lastMade={stats?.lastMade ?? null}
                    timesMade={stats?.timesMade ?? 0}
                    isAddingToShoppingList={addingToShoppingListId === recipe.id}
                    isMarkingAsMade={markingAsMadeId === recipe.id}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add Dialog */}
      <RecipeDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        categories={categories || []}
      />

      {/* Edit Dialog */}
      <RecipeDialog
        open={!!editingRecipe}
        onOpenChange={(open) => !open && setEditingRecipe(null)}
        recipe={editingRecipe || undefined}
        categories={categories || []}
      />

      {/* View Dialog */}
      <RecipeDetailDialog
        open={!!viewingRecipe}
        onOpenChange={(open) => !open && setViewingRecipe(null)}
        recipe={viewingRecipe}
        onEdit={(r) => {
          setViewingRecipe(null)
          setEditingRecipe(r)
        }}
        onDelete={handleDelete}
        lastMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.lastMade ?? null : null}
        timesMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.timesMade ?? 0 : 0}
      />

      {/* Add to Plan Dialog */}
      <AddToPlanDialog
        open={!!addToPlanRecipe}
        onOpenChange={(open) => !open && setAddToPlanRecipe(null)}
        recipe={addToPlanRecipe}
      />

      {/* Recipe Settings Modal */}
      <RecipeSettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  )
}
