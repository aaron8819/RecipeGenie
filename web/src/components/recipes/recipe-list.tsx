"use client"

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Heart, Filter, Grid3x3, List, Settings, Loader2, Download, Inbox, MoreHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { RecipeCard } from "./recipe-card"
import { RecipeDialog } from "./recipe-dialog"
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
import { useRecipeHistoryStats } from "@/hooks/use-planner"
import { useAddToShoppingList } from "@/hooks/use-shopping"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { downloadRecipesAsJson } from "@/lib/recipe-export"
import { formatShoppingAddMessage } from "@/lib/shopping-feedback"
import { getRecipeStatsMap, type RecipeStats } from "@/lib/recipe-history-stats"
import { buildRecipeDetailHref, openRecipeDetail } from "@/lib/recipe-detail-navigation"
import {
  buildRecipeRouteHref,
  type RecipeRouteState,
  type RecipeSortOption,
} from "@/lib/recipe-route-state"
import type { Recipe } from "@/types/database"

type SortOption = RecipeSortOption

const SHOPPING_ITEM_LABEL = {
  singular: "shopping item",
  plural: "shopping items",
}

// Ephemeral keyboard focus only. The URL and Next.js history own browse state
// and scroll restoration; no stored navigation state is introduced.
let recipeToFocusOnReturn: string | null = null

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

export function RecipeList({ routeState }: { routeState: RecipeRouteState }) {
  const isDesktop = useIsDesktop()
  const router = useRouter()
  const collectionRef = useRef<HTMLDivElement>(null)
  const collectionMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const collectionMenuActionRef = useRef<(() => void) | null>(null)
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef(recipeToFocusOnReturn)
  const [search, setSearch] = useState(routeState.query)
  const lastSubmittedQueryRef = useRef(routeState.query)
  const pendingRouteStateRef = useRef<RecipeRouteState | null>(null)
  const category = routeState.category
  const selectedTags = routeState.tags
  const favoritesOnly = routeState.favoritesOnly
  const sortBy = routeState.sortBy
  const viewMode = routeState.viewMode ?? (isDesktop ? "grid" : "list")
  const [addToPlanRecipeId, setAddToPlanRecipeId] = useState<string | null>(null)
  const [addingToShoppingListId, setAddingToShoppingListId] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSharedInboxOpen, setIsSharedInboxOpen] = useState(false)
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [shareRecipeId, setShareRecipeId] = useState<string | null>(null)
  const [skeletonDelayed, setSkeletonDelayed] = useState(false)

  const restoreDialogFocus = useCallback(() => {
    const target = dialogReturnFocusRef.current
    dialogReturnFocusRef.current = null
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus({ preventScroll: true })
    })
  }, [])

  useEffect(() => {
    if (pendingRouteStateRef.current &&
        routeState.query !== pendingRouteStateRef.current.query) return
    if (routeState.query === lastSubmittedQueryRef.current) return
    setSearch(routeState.query)
  }, [routeState.query])

  useEffect(() => {
    if (pendingRouteStateRef.current &&
        buildRecipeRouteHref(routeState) === buildRecipeRouteHref(pendingRouteStateRef.current)) {
      pendingRouteStateRef.current = null
    }
  }, [routeState])

  useEffect(() => {
    const clearPendingRoute = () => { pendingRouteStateRef.current = null }
    window.addEventListener("popstate", clearPendingRoute)
    return () => window.removeEventListener("popstate", clearPendingRoute)
  }, [])

  const replaceRouteState = useCallback((patch: Partial<RecipeRouteState>) => {
    // Compose rapid control changes while Next is still resolving the last URL.
    const nextState = { ...(pendingRouteStateRef.current ?? routeState), query: search, ...patch }
    pendingRouteStateRef.current = nextState
    router.replace(
      buildRecipeRouteHref(nextState),
      { scroll: false }
    )
  }, [routeState, router, search])

  useEffect(() => {
    if (search.trim() === routeState.query || search.trim() === lastSubmittedQueryRef.current) return
    const timeout = window.setTimeout(() => {
      lastSubmittedQueryRef.current = search.trim()
      replaceRouteState({ query: search })
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [replaceRouteState, routeState.query, search])

  const setCategory = useCallback(
    (value: string | null) => replaceRouteState({ category: value }),
    [replaceRouteState]
  )
  const setSelectedTags = useCallback(
    (value: string[]) => replaceRouteState({ tags: value }),
    [replaceRouteState]
  )
  const setFavoritesOnly = useCallback(
    (value: boolean) => replaceRouteState({ favoritesOnly: value }),
    [replaceRouteState]
  )
  const setSortBy = useCallback(
    (value: SortOption) => replaceRouteState({ sortBy: value }),
    [replaceRouteState]
  )
  const setViewMode = useCallback(
    (value: "grid" | "list") => replaceRouteState({ viewMode: value }),
    [replaceRouteState]
  )

  const normalizedSearch = routeState.query

  const { data: recipes, isLoading, isFetching, error, refetch } = useRecipes({
    category,
    search: normalizedSearch || null,
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

  useEffect(() => {
    const recipeId = returnFocusRef.current
    if (!recipeId || isLoading) return
    returnFocusRef.current = null
    recipeToFocusOnReturn = null
    const link = collectionRef.current?.querySelector<HTMLAnchorElement>(
      `a[href="${buildRecipeDetailHref(recipeId, "recipes")}"]`
    )
    link?.focus({ preventScroll: true })
  }, [isLoading, sortedRecipes])

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

  const deleteRecipeAndNotify = useCallback(async (recipe: Recipe) => {
    try {
      await deleteRecipe.mutateAsync(recipe.id)
      showToast({
        message: `"${recipe.name}" deleted`,
      })
      return true
    } catch (error) {
      showToast({
        message: getErrorMessage(error, `Failed to delete "${recipe.name}"`),
        duration: 4000,
      })
      return false
    }
  }, [deleteRecipe, showToast])

  const handleDelete = useCallback(async (recipe: Recipe) => {
    if (!confirm(`Are you sure you want to delete "${recipe.name}"?`)) {
      return false
    }
    return deleteRecipeAndNotify(recipe)
  }, [deleteRecipeAndNotify])

  const handleAddToShoppingList = useCallback(async (recipe: Recipe) => {
    setAddingToShoppingListId(recipe.id)
    try {
      const result = await addToShoppingList.mutateAsync({
        recipeIds: [recipe.id],
        scale: 1.0,
      })

      showToast({
        message: formatShoppingAddMessage(result, {
          sourceName: recipe.name,
          itemLabel: SHOPPING_ITEM_LABEL,
          zeroMessage: `All shopping items from "${recipe.name}" are already on the shopping list`,
        }),
      })
    } catch (error) {
      showToast({
        message: getErrorMessage(error, "Failed to add ingredients to shopping list"),
      })
    } finally {
      setAddingToShoppingListId(null)
    }
  }, [addToShoppingList, showToast])

  const handleShareRecipe = useCallback((recipe: Recipe) => {
    dialogReturnFocusRef.current = document.activeElement as HTMLElement
    setShareRecipeId(recipe.id)
    setIsShareDialogOpen(true)
  }, [])

  const handleOpenRecipe = useCallback((recipe: Recipe) => {
    recipeToFocusOnReturn = recipe.id
    openRecipeDetail(router, recipe.id, "recipes")
  }, [router])

  const handleToggleFavorite = useCallback((r: Recipe) => {
    toggleFavorite.mutate({ id: r.id, favorite: !!r.favorite })
  }, [toggleFavorite])

  const handleTagClick = useCallback((tag: string) => {
    if (!selectedTags.includes(tag)) {
      setSelectedTags([...selectedTags, tag])
    }
  }, [selectedTags, setSelectedTags])

  const clearAllFilters = () => {
    lastSubmittedQueryRef.current = ""
    setSearch("")
    replaceRouteState({
      category: null,
      favoritesOnly: false,
      query: "",
      tags: [],
    })
  }

  const isFiltered = !!normalizedSearch || !!category || favoritesOnly || selectedTags.length > 0

  const activeFilters = useMemo(() => {
    const filters: string[] = []

    if (normalizedSearch) {
      filters.push(`Search: "${normalizedSearch}"`)
    }

    if (category) {
      filters.push(`Category: ${category}`)
    }

    if (selectedTags.length === 1) {
      filters.push(`Tag: ${selectedTags[0]}`)
    } else if (selectedTags.length > 1) {
      filters.push(`Tags: ${selectedTags.length} selected`)
    }

    if (favoritesOnly) {
      filters.push("Favorites only")
    }

    return filters
  }, [category, favoritesOnly, normalizedSearch, selectedTags])

  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = (category ? 1 : 0) + selectedTags.length + (favoritesOnly ? 1 : 0)

  return (
    <div ref={collectionRef} className="recipe-collection-page">
      <header className="recipe-collection-heading">
        <div>
          <p className="recipe-collection-eyebrow">Your kitchen, collected</p>
          <h1>Recipes</h1>
          <p>Find something good to cook.</p>
        </div>
        <div className="recipe-collection-heading-actions">
          <Button data-testid="recipes-add-button" onClick={(event) => { dialogReturnFocusRef.current = event.currentTarget; setIsAddDialogOpen(true) }} className="recipe-collection-add min-h-11 gap-2 rounded-lg">
            <Plus className="h-4 w-4" /><span>Add recipe</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button ref={collectionMenuTriggerRef} variant="ghost" size="icon" className="h-11 w-11" aria-label="Collection actions"><MoreHorizontal className="h-5 w-5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => {
              const action = collectionMenuActionRef.current
              collectionMenuActionRef.current = null
              if (action) {
                event.preventDefault()
                collectionMenuTriggerRef.current?.focus()
                dialogReturnFocusRef.current = collectionMenuTriggerRef.current
                action()
              }
            }}>
              <DropdownMenuItem className="min-h-11" onSelect={() => { collectionMenuActionRef.current = () => setIsSharedInboxOpen(true) }}><Inbox className="mr-2 h-4 w-4" />Shared recipes</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => { collectionMenuActionRef.current = () => downloadRecipesAsJson(displayRecipes) }} disabled={!displayRecipes.length}><Download className="mr-2 h-4 w-4" />Export recipes</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => { collectionMenuActionRef.current = () => setIsSettingsOpen(true) }}><Settings className="mr-2 h-4 w-4" />Recipe settings</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="recipe-collection-browse">
        <div className="recipe-collection-search">
          <Search aria-hidden="true" className="h-5 w-5 shrink-0 text-muted-foreground" />
          <Input placeholder="Search recipes…" aria-label="Search recipes by name or category" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Clear search" onClick={() => setSearch("")}><X className="h-4 w-4" /></Button>}
        </div>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button data-testid="recipes-filter-toggle" variant="outline" className="min-h-11 gap-2 justify-start rounded-lg" aria-label={activeFilterCount ? `Filters (${activeFilterCount})` : "Filters"}>
              <Filter className="h-4 w-4" />Filters{activeFilterCount > 0 && ` (${activeFilterCount})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)]" aria-label="Recipe browse filters">
            <div className="space-y-3" data-testid="recipes-filter-panel">
              <Select value={category || "all"} onValueChange={(value) => setCategory(value === "all" ? null : value)}>
                <SelectTrigger aria-label="Filter by category" className="min-h-11"><SelectValue placeholder="All categories" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All categories</SelectItem>{categories?.map((cat) => <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>)}</SelectContent>
              </Select>
              {allTags.length > 0 && <MultiSelect options={allTags} value={selectedTags} onChange={setSelectedTags} placeholder="Filter by tags" tagCounts={tagCounts} className="w-full [&>button]:min-h-11 [&>button]:w-full" />}
              <Button variant="outline" aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(!favoritesOnly)} className="min-h-11 gap-2 w-full justify-start">
                <Heart className={cn("h-4 w-4", favoritesOnly && "fill-current")} />Favorites
              </Button>
              {isFiltered && <Button variant="ghost" className="min-h-11" onClick={clearAllFilters}>Clear all filters</Button>}
            </div>
          </PopoverContent>
        </Popover>
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
          <SelectTrigger aria-label="Sort recipes" className="min-h-11 rounded-lg"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="timesMade">Most Made</SelectItem><SelectItem value="lastMade">Recently Made</SelectItem>
            <SelectItem value="name">Name (A-Z)</SelectItem><SelectItem value="newest">Newest First</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="recipe-collection-subbar">
        <div className="min-w-0 text-sm text-muted-foreground" aria-live="polite">
          {!isLoading && <span>{displayRecipes.length} recipe{displayRecipes.length !== 1 ? "s" : ""}{isFiltered ? " shown" : ""}</span>}
          {isFiltered && <button type="button" className="ml-2 min-h-11 text-primary underline underline-offset-4" onClick={clearAllFilters}>Clear all filters</button>}
        </div>
        <div className="recipe-collection-view" aria-label="Recipe view">
          <Button variant="ghost" size="icon" className="h-11 w-11 rounded-none" aria-label="Grid view" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")}><Grid3x3 className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" className="h-11 w-11 rounded-none" aria-label="List view" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}><List className="h-5 w-5" /></Button>
        </div>
      </div>
      {isFiltered && <div className="recipe-collection-active-filters" aria-label="Active recipe filters">{activeFilters.map((filter) => <span key={filter}>{filter}</span>)}</div>}
      {/* Recipe Grid/List */}
      <div className="pb-8" aria-busy={isFetching}>
      {error && (
        <div role="alert" className="mb-4 rounded-xl border p-6">
          <h2 className="font-semibold">Could not load recipes</h2>
          <p className="mt-2 text-sm text-muted-foreground">{getErrorMessage(error, "Try again in a moment.")}</p>
          <Button variant="outline" className="mt-4 min-h-11" disabled={isFetching} onClick={() => void refetch()}>Try again</Button>
        </div>
      )}
      {error && !displayRecipes.length ? null : isLoadingWithNoData ? (
        <div className={cn(
          viewMode === "grid"
            ? "recipe-collection-grid"
            : "recipe-collection-list"
        )} aria-label="Loading recipes">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className={cn(
                "recipe-collection-skeleton", showSkeleton ? "animate-pulse" : "opacity-0",
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
        <div className="recipe-collection-empty">
          <EmptyState
            icon={Search}
            title={
              isFiltered
                ? "No recipes match the current search and filters"
                : "No recipes yet"
            }
            description={
              isFiltered
                ? "Search only checks recipe names and categories. Try adjusting the filters above or clear them to broaden results."
                : "Start building your recipe collection by adding your first recipe!"
            }
            action={
              !isFiltered
                ? {
                    label: "Add Recipe",
                    onClick: () => { dialogReturnFocusRef.current = document.activeElement as HTMLElement; setIsAddDialogOpen(true) },
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
        <div className="relative w-full">
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
                ? "recipe-collection-grid"
                : "recipe-collection-list"
            )}
          >
            {sortedRecipes.map((recipe) => {
              const stats = statsMap.get(recipe.id)
              return (
                <div
                  key={recipe.id}
                  className="flex min-w-0 [&>article]:w-full"
                >
                  <RecipeCard
                    recipe={recipe}
                    viewMode={viewMode}
                    isDesktopViewport={isDesktop}
                    onDelete={handleDelete}
                    onToggleFavorite={handleToggleFavorite}
                    onAddToPlan={(recipe) => { dialogReturnFocusRef.current = document.activeElement as HTMLElement; setAddToPlanRecipeId(recipe.id) }}
                    onAddToShoppingList={handleAddToShoppingList}
                    onShare={handleShareRecipe}
                    onClick={handleOpenRecipe}
                    onTagClick={handleTagClick}
                    lastMade={stats?.lastMade ?? null}
                    timesMade={stats?.timesMade ?? 0}
                    isAddingToShoppingList={addingToShoppingListId === recipe.id}
                    isSharing={false}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
      </div>

      {/* Add Dialog */}
      <RecipeDialog
        open={isAddDialogOpen}
        onOpenChange={(open) => { setIsAddDialogOpen(open); if (!open) restoreDialogFocus() }}
        categories={categories || []}
        onRecipeCreated={handleOpenRecipe}
      />

      <ShareRecipeDialog
        open={isShareDialogOpen}
        onOpenChange={(open) => {
          setIsShareDialogOpen(open)
          if (!open) { setShareRecipeId(null); restoreDialogFocus() }
        }}
        recipeId={shareRecipeId}
      />

      <SharedRecipesInbox
        open={isSharedInboxOpen}
        onOpenChange={(open) => { setIsSharedInboxOpen(open); if (!open) restoreDialogFocus() }}
      />

      {/* Add to Plan Dialog */}
      <AddToPlanDialog
        open={!!addToPlanRecipeId}
        onOpenChange={(open) => { if (!open) { setAddToPlanRecipeId(null); restoreDialogFocus() } }}
        recipeId={addToPlanRecipeId}
      />

      {/* Recipe Settings Modal */}
      <RecipeSettingsModal
        open={isSettingsOpen}
        onOpenChange={(open) => { setIsSettingsOpen(open); if (!open) restoreDialogFocus() }}
      />
    </div>
  )
}
