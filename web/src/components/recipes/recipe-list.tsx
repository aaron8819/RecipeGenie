"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Plus, Search, Heart, Filter, Grid3x3, List, Settings, Loader2, Download, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RecipeCard } from "./recipe-card"
import { RecipeDialog } from "./recipe-dialog"
import { RecipeDetailDialog } from "./recipe-detail-dialog"
import { AddToPlanDialog } from "./add-to-plan-dialog"
import { RecipeSettingsModal } from "./recipe-settings-modal"
import { ShareRecipeDialog } from "./share-recipe-dialog"
import { SharedRecipesInbox } from "./shared-recipes-inbox"
import { EmptyState } from "@/components/ui/empty-state"
import {
  useRecipes,
  useCategories,
  useAllTags,
  useTagsWithCounts,
  useToggleFavorite,
  useDeleteRecipe,
} from "@/hooks/use-recipes"
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { useRecipeHistoryStats, useMarkRecipeAsMade, useUnmarkRecipeAsMade } from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { downloadRecipesAsJson } from "@/lib/recipe-export"
import { getRecipeStatsMap, type RecipeStats } from "@/lib/recipe-history-stats"
import type { Recipe } from "@/types/database"

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
      case "newest": {
        const createdAtA = a.created_at ? new Date(a.created_at).getTime() : 0
        const createdAtB = b.created_at ? new Date(b.created_at).getTime() : 0
        return createdAtB - createdAtA
      }
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
import { cn, getErrorMessage } from "@/lib/utils"

export function RecipeList() {
  const isDesktop = useIsDesktop()

  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid"

    // Check localStorage for saved preference
    const saved = localStorage.getItem("recipeViewMode")
    if (saved === "grid" || saved === "list") {
      return saved
    }

    // Fallback to responsive default
    return window.innerWidth < 768 ? "list" : "grid"
  })
  const [sortBy, setSortBy] = useState<SortOption>("lastMade")
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [addToPlanRecipe, setAddToPlanRecipe] = useState<Recipe | null>(null)
  const [addingToShoppingListId, setAddingToShoppingListId] = useState<string | null>(null)
  const [markingAsMadeId, setMarkingAsMadeId] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSharedInboxOpen, setIsSharedInboxOpen] = useState(false)
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [shareRecipe, setShareRecipe] = useState<Recipe | null>(null)
  const [skeletonDelayed, setSkeletonDelayed] = useState(false)

  // Persist view mode preference to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    localStorage.setItem("recipeViewMode", viewMode)
  }, [viewMode])

  const { data: recipes, isLoading, isFetching } = useRecipes({
    category,
    search: search || null,
    favoritesOnly,
    tags: selectedTags.length > 0 ? selectedTags : undefined,
  })
  const { data: categories } = useCategories()
  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()
  const { data: historyStats } = useRecipeHistoryStats()
  const toggleFavorite = useToggleFavorite()
  const deleteRecipe = useDeleteRecipe()
  const addToShoppingList = useAddToShoppingList()
  const markAsMade = useMarkRecipeAsMade()
  const unmarkAsMade = useUnmarkRecipeAsMade()
  const { show: showToast } = useUndoToast()

  // Build a map of recipe_id -> stats (last made + times made)
  const statsMap = useMemo(() => getRecipeStatsMap(historyStats), [historyStats])
  
  // Show cached data immediately even while fetching (stale-while-revalidate)
  const displayRecipes = useMemo(() => recipes || [], [recipes])
  
  // Sort recipes based on selected sort option
  const sortedRecipes = useMemo(() => {
    if (!displayRecipes.length) return []
    return sortRecipes(displayRecipes, statsMap, sortBy)
  }, [displayRecipes, statsMap, sortBy])
  
  // Only show skeleton on initial load with no cached data, and only after a short delay to avoid flash on fast/cached loads
  const isLoadingWithNoData = isLoading && !displayRecipes.length
  useEffect(() => {
    if (isLoadingWithNoData) {
      const t = setTimeout(() => setSkeletonDelayed(true), 150)
      return () => clearTimeout(t)
    }
    setSkeletonDelayed(false)
    return undefined
  }, [isLoadingWithNoData])
  const showSkeleton = isLoadingWithNoData && skeletonDelayed

  const handleDelete = useCallback(async (recipe: Recipe) => {
    if (confirm(`Are you sure you want to delete "${recipe.name}"?`)) {
      await deleteRecipe.mutateAsync(recipe.id)
    }
  }, [deleteRecipe])

  const handleAddToShoppingList = useCallback(async (recipe: Recipe) => {
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
        message: getErrorMessage(error, "Failed to add ingredients to shopping list"),
      })
    } finally {
      setAddingToShoppingListId(null)
    }
  }, [addToShoppingList, showToast])

  const handleMarkAsMade = useCallback(async (recipe: Recipe) => {
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
        message: getErrorMessage(error, "Failed to mark recipe as made"),
      })
    } finally {
      setMarkingAsMadeId(null)
    }
  }, [markAsMade, unmarkAsMade, showToast])

  const handleShareRecipe = useCallback((recipe: Recipe) => {
    setShareRecipe(recipe)
    setIsShareDialogOpen(true)
  }, [])

  const handleToggleFavorite = useCallback((r: Recipe) => {
    toggleFavorite.mutate({ id: r.id, favorite: !!r.favorite })
  }, [toggleFavorite])

  const handleTagClick = useCallback((tag: string) => {
    if (!selectedTags.includes(tag)) {
      setSelectedTags([...selectedTags, tag])
    }
  }, [selectedTags])

  const clearAllFilters = () => {
    setCategory(null)
    setSelectedTags([])
    setFavoritesOnly(false)
    setSearch("")
  }

  const isFiltered = !!search || !!category || favoritesOnly || selectedTags.length > 0

  const pillOutline =
    "flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-full font-medium transition-all text-xs md:text-sm hover:bg-slate-100 dark:hover:bg-slate-600 hover:border-slate-300 dark:hover:border-slate-500 hover:text-slate-800 dark:hover:text-slate-100"

  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      {/* Search — full width, generous spacing below */}
      <div className="relative mb-6 md:mb-8 p-1">
        <Search className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 h-4 w-4 md:h-5 md:w-5 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <Input
          placeholder="Search recipes by name or cuisine..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-auto py-3.5 md:py-5 pl-10 md:pl-12 pr-4 md:pr-5 text-sm md:text-base bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm focus:ring-2 focus:ring-primary focus:border-primary rounded-2xl placeholder:text-slate-400 outline-none transition-all"
        />
      </div>

      {/* Single row spanning full width: filters left, Settings + Add Recipe right */}
      <div className="flex flex-col md:flex-row md:flex-nowrap md:items-center md:justify-between gap-4 md:gap-6 mb-8 md:mb-10 w-full min-w-0">
        {/* Left: All categories, Filter by tags, Favorites, Recently Made, divider, view toggle */}
        <div className="flex flex-nowrap items-center gap-3 md:gap-4 min-w-0 overflow-x-auto md:overflow-visible pb-1 md:pb-0 scrollbar-thin">
          <Select value={category || "all"} onValueChange={(v) => setCategory(v === "all" ? null : v)}>
            <SelectTrigger
              className={cn(
                "flex items-center gap-2 px-4 md:px-4 py-2 md:py-2.5 rounded-full font-medium text-xs md:text-sm h-auto w-auto min-w-0 shrink-0 transition-all",
                !category
                  ? "bg-primary text-primary-foreground border-0 shadow-md shadow-primary/20 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 hover:brightness-105"
                  : "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 hover:border-slate-300 dark:hover:border-slate-500 hover:text-slate-800 dark:hover:text-slate-100"
              )}
            >
              <Filter className="h-4 w-4 shrink-0" />
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

          {allTags.length > 0 && (
            <div className="shrink-0">
              <MultiSelect
                options={allTags}
                value={selectedTags}
                onChange={setSelectedTags}
                placeholder="Filter by tags"
                className="w-[130px] md:w-[140px] [&>button]:rounded-full [&>button]:px-3 md:[&>button]:px-4 [&>button]:py-2 md:[&>button]:py-2.5 [&>button]:text-xs md:[&>button]:text-sm [&>button]:border-slate-200 [&>button]:dark:border-slate-700 [&>button]:text-slate-600 [&>button]:dark:text-slate-300 [&>button]:whitespace-nowrap [&>button]:transition-all [&>button]:hover:bg-slate-100 [&>button]:dark:hover:bg-slate-600 [&>button]:hover:border-slate-300 [&>button]:dark:hover:border-slate-500 [&>button]:hover:text-slate-800 [&>button]:dark:hover:text-slate-100"
                tagCounts={tagCounts}
              />
            </div>
          )}

          <Button
            variant="ghost"
            onClick={() => setFavoritesOnly(!favoritesOnly)}
            className={cn(
              "flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 rounded-full font-medium transition-all text-xs md:text-sm shrink-0 border border-slate-200 dark:border-slate-700",
              favoritesOnly
                ? "text-red-600 dark:text-red-400 bg-white dark:bg-slate-800 hover:bg-red-50 dark:hover:bg-red-950/30 hover:border-red-200 dark:hover:border-red-800 hover:text-red-700 dark:hover:text-red-300"
                : pillOutline
            )}
          >
            <Heart className={cn("h-4 w-4 shrink-0", favoritesOnly && "fill-current")} />
            Favorites
          </Button>

          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className={cn(pillOutline, "min-w-0 w-auto shrink-0 h-auto")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="timesMade">Most Made</SelectItem>
              <SelectItem value="lastMade">Recently Made</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
            </SelectContent>
          </Select>

          <div className="h-6 w-px bg-slate-200 dark:bg-slate-600 shrink-0 mx-1" aria-hidden />

          <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === "grid"
                  ? "bg-white dark:bg-slate-700 shadow-sm text-primary border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 hover:ring-2 hover:ring-primary/20"
                  : "opacity-60 text-slate-600 dark:text-slate-400 hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-800 dark:hover:text-slate-200"
              )}
              aria-label="Grid view"
            >
              <Grid3x3 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === "list"
                  ? "bg-white dark:bg-slate-700 shadow-sm text-primary border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 hover:ring-2 hover:ring-primary/20"
                  : "opacity-60 text-slate-600 dark:text-slate-400 hover:opacity-100 hover:bg-slate-200 dark:hover:bg-slate-600 hover:text-slate-800 dark:hover:text-slate-200"
              )}
              aria-label="List view"
            >
              <List className="h-5 w-5" />
            </button>
          </div>

          {!isDesktop && (
            <>
              <div
                className="h-6 w-px bg-slate-200 dark:bg-slate-600 shrink-0 mx-1"
                aria-hidden
              />

              <Button
                variant="outline"
                onClick={() => setIsSharedInboxOpen(true)}
                className={cn(pillOutline, "shrink-0")}
              >
                <Inbox className="h-4 w-4 shrink-0" />
                Shared
              </Button>

              <Button
                variant="outline"
                onClick={() => setIsSettingsOpen(true)}
                className={cn(pillOutline, "shrink-0")}
              >
                <Settings className="h-4 w-4 shrink-0" />
                Settings
              </Button>
            </>
          )}
        </div>

        {/* Right: Settings, Add Recipe */}
        {isDesktop && (
        <div className="flex flex-nowrap items-center gap-3 md:gap-4 shrink-0">
          <Button
            variant="outline"
            onClick={() => setIsSharedInboxOpen(true)}
            className={cn(pillOutline, "shrink-0")}
          >
            <Inbox className="h-4 w-4 shrink-0" />
            Shared
          </Button>

          <Button
            variant="outline"
            onClick={() => {
              if (displayRecipes.length > 0) {
                downloadRecipesAsJson(displayRecipes)
              }
            }}
            disabled={displayRecipes.length === 0}
            className={cn(pillOutline, "shrink-0")}
            title={isFiltered ? "Export filtered recipes as JSON" : "Export all recipes as JSON"}
          >
            <Download className="h-4 w-4 shrink-0" />
            Export
          </Button>

          <Button
            variant="outline"
            onClick={() => setIsSettingsOpen(true)}
            className={cn(pillOutline, "shrink-0")}
          >
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </Button>

          <Button
            onClick={() => setIsAddDialogOpen(true)}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-bold shadow-md shadow-primary/20 transition-all shrink-0 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 hover:brightness-105 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Add Recipe
          </Button>
        </div>
        )}
      </div>

      {/* Recipe Grid/List */}
      <div>
      {showSkeleton ? (
        <div className={cn(
          viewMode === "grid"
            ? "grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
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
        <div className="animate-fade-in">
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
        </div>
      ) : (
        <div className="animate-fade-in relative w-full overflow-hidden">
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
                ? "grid gap-8 sm:grid-cols-2 lg:grid-cols-3 w-full"
                : "space-y-4 w-full"
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
                    isDesktopViewport={isDesktop}
                    onDelete={handleDelete}
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlan={setAddToPlanRecipe}
                    onAddToShoppingList={handleAddToShoppingList}
                    onMarkAsMade={handleMarkAsMade}
                    onShare={handleShareRecipe}
                    onClick={setViewingRecipe}
                    onTagClick={handleTagClick}
                    lastMade={stats?.lastMade ?? null}
                    timesMade={stats?.timesMade ?? 0}
                    isAddingToShoppingList={addingToShoppingListId === recipe.id}
                    isMarkingAsMade={markingAsMadeId === recipe.id}
                    isSharing={false}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
      </div>

      {/* FAB Add Recipe — mobile only */}
      {!isDesktop && (
        <button
          type="button"
          onClick={() => setIsAddDialogOpen(true)}
          className="fixed bottom-24 right-6 w-14 h-14 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-xl shadow-primary/40 hover:opacity-90 transition-opacity z-30"
          aria-label="Add Recipe"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      {/* Add Dialog */}
      <RecipeDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        categories={categories || []}
        onRecipeCreated={(recipe) => setViewingRecipe(recipe)}
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
        onShare={handleShareRecipe}
        lastMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.lastMade ?? null : null}
        timesMade={viewingRecipe ? statsMap.get(viewingRecipe.id)?.timesMade ?? 0 : 0}
      />

      <ShareRecipeDialog
        open={isShareDialogOpen}
        onOpenChange={(open) => {
          setIsShareDialogOpen(open)
          if (!open) setShareRecipe(null)
        }}
        recipe={shareRecipe}
      />

      <SharedRecipesInbox
        open={isSharedInboxOpen}
        onOpenChange={setIsSharedInboxOpen}
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
