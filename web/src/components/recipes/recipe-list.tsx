"use client"

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Plus, Search, Heart, Filter, Grid3x3, List, Settings, Loader2, Download, Inbox, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { openRecipeDetail } from "@/lib/recipe-detail-navigation"
import type { Recipe } from "@/types/database"

type SortOption = "timesMade" | "lastMade" | "name" | "newest"

const RECIPE_VIEW_STATE_KEY = "recipe-genie:recipes-view-state:v1"

interface RecipeViewState {
  category: string | null
  favoritesOnly: boolean
  scrollTop: number
  search: string
  selectedTags: string[]
  sortBy: SortOption
  viewMode: "grid" | "list"
}

function getDefaultRecipeViewState(): RecipeViewState {
  return {
    category: null,
    favoritesOnly: false,
    scrollTop: 0,
    search: "",
    selectedTags: [],
    sortBy: "lastMade",
    viewMode: "grid",
  }
}

function readRecipeViewState(): RecipeViewState {
  const fallback = getDefaultRecipeViewState()
  if (typeof window === "undefined") return fallback

  try {
    const stored = JSON.parse(
      window.sessionStorage.getItem(RECIPE_VIEW_STATE_KEY) || "null"
    ) as Partial<RecipeViewState> | null
    if (!stored) return fallback

    return {
      category: typeof stored.category === "string" ? stored.category : null,
      favoritesOnly: stored.favoritesOnly === true,
      scrollTop:
        typeof stored.scrollTop === "number" && stored.scrollTop >= 0
          ? stored.scrollTop
          : 0,
      search: typeof stored.search === "string" ? stored.search : "",
      selectedTags: Array.isArray(stored.selectedTags)
        ? stored.selectedTags.filter(
            (tag): tag is string => typeof tag === "string"
          )
        : [],
      sortBy:
        stored.sortBy &&
        ["timesMade", "lastMade", "name", "newest"].includes(stored.sortBy)
          ? stored.sortBy
          : "lastMade",
      viewMode:
        stored.viewMode === "grid" || stored.viewMode === "list"
          ? stored.viewMode
          : fallback.viewMode,
    }
  } catch {
    return fallback
  }
}

function persistRecipeViewState(state: RecipeViewState) {
  try {
    window.sessionStorage.setItem(RECIPE_VIEW_STATE_KEY, JSON.stringify(state))
  } catch {
    // Recipe browsing remains functional when browser storage is unavailable.
  }
}

const SHOPPING_ITEM_LABEL = {
  singular: "shopping item",
  plural: "shopping items",
}

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

interface MobileRecipesHeaderProps {
  search: string
  onSearchChange: (value: string) => void
  category: string | null
  onCategoryChange: (value: string | null) => void
  categories?: string[]
  sortBy: SortOption
  onSortChange: (value: SortOption) => void
  allTags: string[]
  selectedTags: string[]
  onSelectedTagsChange: (value: string[]) => void
  tagCounts: Array<{ tag: string; count: number }>
  favoritesOnly: boolean
  onFavoritesToggle: () => void
  viewMode: "grid" | "list"
  onViewModeChange: (value: "grid" | "list") => void
  onSharedOpen: () => void
  onSettingsOpen: () => void
}

function MobileRecipesHeader({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  categories,
  sortBy,
  onSortChange,
  allTags,
  selectedTags,
  onSelectedTagsChange,
  tagCounts,
  favoritesOnly,
  onFavoritesToggle,
  viewMode,
  onViewModeChange,
  onSharedOpen,
  onSettingsOpen,
}: MobileRecipesHeaderProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
  const activeFilterCount = (category ? 1 : 0) + selectedTags.length + (favoritesOnly ? 1 : 0)

  const mobileFilterTriggerClassName =
    "min-h-11 w-full justify-between rounded-xl border border-slate-200/70 bg-white/92 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-all hover:border-slate-300/80 hover:bg-white hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-800/92 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-50"

  const utilityButtonClassName =
    "h-11 rounded-xl border border-slate-200/80 bg-white/72 px-2.5 text-xs font-medium text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:border-slate-300/80 hover:bg-white hover:text-slate-900 dark:border-slate-700/80 dark:bg-slate-800/65 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-50"

  return (
    <div className="md:hidden mb-5 space-y-3.5">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
        <Input
          placeholder="Search by recipe name or category..."
          aria-label="Search recipes by name or category"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full h-auto rounded-2xl border border-slate-200 bg-white py-3.5 pl-10 pr-4 text-base shadow-sm transition-all placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary dark:border-slate-700 dark:bg-slate-800"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button
          data-testid="recipes-filter-toggle"
          type="button"
          variant="ghost"
          aria-expanded={filtersOpen}
          aria-controls="mobile-recipe-filters"
          onClick={() => setFiltersOpen((open) => !open)}
          className={cn(
            mobileFilterTriggerClassName,
            activeFilterCount > 0 &&
              "border-primary/25 bg-primary/10 text-primary hover:border-primary/35 hover:bg-primary/15 dark:border-primary/35 dark:bg-primary/15"
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Filter className="h-4 w-4 shrink-0" />
            <span>Filters</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", filtersOpen && "rotate-180")} />
        </Button>

        <Select value={sortBy} onValueChange={(value) => onSortChange(value as SortOption)}>
          <SelectTrigger className={mobileFilterTriggerClassName} aria-label="Sort recipes">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="timesMade">Most Made</SelectItem>
            <SelectItem value="lastMade">Recently Made</SelectItem>
            <SelectItem value="name">Name (A-Z)</SelectItem>
            <SelectItem value="newest">Newest First</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtersOpen && (
        <section
          id="mobile-recipe-filters"
          data-testid="recipes-filter-panel"
          className="rounded-2xl border border-slate-200/75 bg-slate-50/78 p-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-slate-700/80 dark:bg-slate-900/35"
          aria-label="Recipe browse filters"
        >
          <div className="space-y-2.5">
            <Select value={category || "all"} onValueChange={(value) => onCategoryChange(value === "all" ? null : value)}>
              <SelectTrigger
                className={cn(
                  mobileFilterTriggerClassName,
                  category &&
                    "border-primary/20 bg-primary/10 text-primary hover:border-primary/30 hover:bg-primary/15 dark:border-primary/30 dark:bg-primary/15"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Filter className="h-4 w-4 shrink-0" />
                  <SelectValue placeholder="All categories" />
                </div>
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
              <MultiSelect
                options={allTags}
                value={selectedTags}
                onChange={onSelectedTagsChange}
                placeholder="Filter by tags"
                className="w-full [&>button]:min-h-11 [&>button]:w-full [&>button]:justify-between [&>button]:rounded-xl [&>button]:border-slate-200/70 [&>button]:bg-white/92 [&>button]:px-4 [&>button]:py-2.5 [&>button]:text-sm [&>button]:font-medium [&>button]:text-slate-700 [&>button]:shadow-[0_1px_2px_rgba(15,23,42,0.05)] [&>button]:transition-all [&>button]:hover:border-slate-300/80 [&>button]:hover:bg-white [&>button]:hover:text-slate-900 dark:[&>button]:border-slate-700/70 dark:[&>button]:bg-slate-800/92 dark:[&>button]:text-slate-200 dark:[&>button]:hover:border-slate-600 dark:[&>button]:hover:bg-slate-800 dark:[&>button]:hover:text-slate-50"
                tagCounts={tagCounts}
              />
            )}

            <Button
              type="button"
              variant="ghost"
              onClick={onFavoritesToggle}
              className={cn(
                "h-11 w-fit justify-start rounded-full border px-4 text-sm font-medium shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all",
                favoritesOnly
                  ? "border-red-200/80 bg-red-50/80 text-red-700 hover:border-red-300 hover:bg-red-50 dark:border-red-900/80 dark:bg-red-950/20 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/35"
                  : "border-slate-200/65 bg-white/70 text-slate-600 hover:border-slate-300/75 hover:bg-white hover:text-slate-800 dark:border-slate-700/70 dark:bg-slate-800/65 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              )}
            >
              <Heart className={cn("h-4 w-4 shrink-0", favoritesOnly && "fill-current")} />
              Favorites
            </Button>
          </div>
        </section>
      )}

      <section
        className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200/60 bg-white/45 px-2 py-2 dark:border-slate-700/70 dark:bg-slate-900/15"
        aria-label="Recipe mobile utilities"
      >
        <div className="flex rounded-xl bg-slate-100/80 p-1 dark:bg-slate-800/75">
          <button
            type="button"
            onClick={() => onViewModeChange("grid")}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg transition-all",
              viewMode === "grid"
                ? "border border-slate-200/80 bg-white text-primary shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-slate-600 dark:bg-slate-700"
                : "text-slate-500 opacity-70 hover:bg-slate-200/80 hover:text-slate-800 hover:opacity-100 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            )}
            aria-label="Grid view"
          >
            <Grid3x3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange("list")}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-lg transition-all",
              viewMode === "list"
                ? "border border-slate-200/80 bg-white text-primary shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-slate-600 dark:bg-slate-700"
                : "text-slate-500 opacity-70 hover:bg-slate-200/80 hover:text-slate-800 hover:opacity-100 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            )}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onSharedOpen} className={cn(utilityButtonClassName, "shrink-0")}>
            <Inbox className="h-4 w-4 shrink-0" />
            Shared
          </Button>

          <Button type="button" variant="ghost" onClick={onSettingsOpen} className={cn(utilityButtonClassName, "shrink-0")}>
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </Button>
        </div>
      </section>
    </div>
  )
}

export function RecipeList() {
  const isDesktop = useIsDesktop()
  const router = useRouter()
  const [initialViewState] = useState(readRecipeViewState)
  const restoredScrollRef = useRef(false)
  const scrollTopRef = useRef(initialViewState.scrollTop)

  const [search, setSearch] = useState(initialViewState.search)
  const [category, setCategory] = useState<string | null>(
    initialViewState.category
  )
  const [selectedTags, setSelectedTags] = useState<string[]>(
    initialViewState.selectedTags
  )
  const [favoritesOnly, setFavoritesOnly] = useState(
    initialViewState.favoritesOnly
  )
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    if (typeof window === "undefined") return "grid"

    try {
      const saved = localStorage.getItem("recipeViewMode")
      if (saved === "grid" || saved === "list") {
        return saved
      }
    } catch {
      return initialViewState.viewMode
    }

    return initialViewState.viewMode === "list" || window.innerWidth < 768
      ? "list"
      : "grid"
  })
  const [sortBy, setSortBy] = useState<SortOption>(initialViewState.sortBy)
  const [addToPlanRecipeId, setAddToPlanRecipeId] = useState<string | null>(null)
  const [addingToShoppingListId, setAddingToShoppingListId] = useState<string | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSharedInboxOpen, setIsSharedInboxOpen] = useState(false)
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false)
  const [shareRecipeId, setShareRecipeId] = useState<string | null>(null)
  const [skeletonDelayed, setSkeletonDelayed] = useState(false)

  // Persist view mode preference to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      localStorage.setItem("recipeViewMode", viewMode)
    } catch {
      // The session-scoped view state still works when local storage is disabled.
    }
  }, [viewMode])

  useEffect(() => {
    persistRecipeViewState({
      category,
      favoritesOnly,
      scrollTop: scrollTopRef.current,
      search,
      selectedTags,
      sortBy,
      viewMode,
    })
  }, [category, favoritesOnly, search, selectedTags, sortBy, viewMode])

  const normalizedSearch = search.trim()

  const { data: recipes, isLoading, isFetching } = useRecipes({
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

  useEffect(() => {
    if (restoredScrollRef.current || isLoadingWithNoData) return

    const panel = document.querySelector<HTMLElement>(
      '[data-home-tab-panel="recipes"]'
    )
    if (!panel) return

    const frame = requestAnimationFrame(() => {
      panel.scrollTop = scrollTopRef.current
      restoredScrollRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [displayRecipes.length, isLoadingWithNoData])

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
    setShareRecipeId(recipe.id)
    setIsShareDialogOpen(true)
  }, [])

  const handleOpenRecipe = useCallback((recipe: Recipe) => {
    const panel = document.querySelector<HTMLElement>(
      '[data-home-tab-panel="recipes"]'
    )
    scrollTopRef.current = panel?.scrollTop ?? 0
    persistRecipeViewState({
      category,
      favoritesOnly,
      scrollTop: scrollTopRef.current,
      search,
      selectedTags,
      sortBy,
      viewMode,
    })
    openRecipeDetail(router, recipe.id, "recipes")
  }, [
    category,
    favoritesOnly,
    router,
    search,
    selectedTags,
    sortBy,
    viewMode,
  ])

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

  const pillOutline =
    "flex items-center gap-2 px-3 md:px-4 py-2 md:py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-full font-medium transition-all text-xs md:text-sm hover:bg-slate-100 dark:hover:bg-slate-600 hover:border-slate-300 dark:hover:border-slate-500 hover:text-slate-800 dark:hover:text-slate-100"

  return (
    <div className="w-full min-w-0 overflow-x-hidden">
      {!isDesktop && (
        <MobileRecipesHeader
          search={search}
          onSearchChange={setSearch}
          category={category}
          onCategoryChange={setCategory}
          categories={categories}
          sortBy={sortBy}
          onSortChange={setSortBy}
          allTags={allTags}
          selectedTags={selectedTags}
          onSelectedTagsChange={setSelectedTags}
          tagCounts={tagCounts}
          favoritesOnly={favoritesOnly}
          onFavoritesToggle={() => setFavoritesOnly(!favoritesOnly)}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          onSharedOpen={() => setIsSharedInboxOpen(true)}
          onSettingsOpen={() => setIsSettingsOpen(true)}
        />
      )}
      {/* Search — full width, generous spacing below */}
      {isDesktop && (
        <div className="hidden md:block">
          <div className="relative mb-6 md:mb-8 p-1">
            <Search className="absolute left-4 md:left-5 top-1/2 -translate-y-1/2 h-4 w-4 md:h-5 md:w-5 text-slate-400 dark:text-slate-500 pointer-events-none" />
            <Input
              placeholder="Search by recipe name or category..."
              aria-label="Search recipes by name or category"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-auto py-3.5 md:py-5 pl-10 md:pl-12 pr-4 md:pr-5 text-sm md:text-base bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm focus:ring-2 focus:ring-primary focus:border-primary rounded-2xl placeholder:text-slate-400 outline-none transition-all"
            />
          </div>
          <p className="px-1 -mt-3 mb-6 text-xs md:text-sm text-slate-500 dark:text-slate-400">
            Search matches recipe names and categories.
          </p>
        </div>
      )}

      {/* Desktop toolbar */}
      {isDesktop && (
        <div className="hidden md:flex md:flex-row md:flex-nowrap md:items-center md:justify-between gap-6 mb-8 md:mb-10 w-full min-w-0">
          <div className="flex flex-nowrap items-center gap-4 min-w-0 overflow-visible pb-0">
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
          </div>

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
              data-testid="recipes-add-button"
              onClick={() => setIsAddDialogOpen(true)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-full font-bold shadow-md shadow-primary/20 transition-all shrink-0 hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/25 hover:brightness-105 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Add Recipe
            </Button>
          </div>
        </div>
      )}

      {isFiltered && (
        <div className="mb-5 md:mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {displayRecipes.length} recipe{displayRecipes.length !== 1 ? "s" : ""} shown
            </span>
            {activeFilters.map((filter) => (
              <span
                key={filter}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                {filter}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Search checks names and categories. Category, tag, and favorites filters narrow further.</span>
            <button
              type="button"
              onClick={clearAllFilters}
              className="font-medium text-primary underline underline-offset-4"
            >
              Clear all filters
            </button>
          </div>
        </div>
      )}

      {/* Recipe Grid/List */}
      <div className="pb-20 md:pb-0">
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
                    onAddToPlan={(recipe) => setAddToPlanRecipeId(recipe.id)}
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

      {/* FAB Add Recipe — mobile only */}
      {!isDesktop && (
        <button
          data-testid="recipes-add-fab"
          type="button"
          onClick={() => setIsAddDialogOpen(true)}
          className="fixed bottom-[calc(var(--bottom-nav-safe-height)+0.75rem)] right-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/40 transition-opacity hover:opacity-90 z-30"
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
        onRecipeCreated={handleOpenRecipe}
      />

      <ShareRecipeDialog
        open={isShareDialogOpen}
        onOpenChange={(open) => {
          setIsShareDialogOpen(open)
          if (!open) setShareRecipeId(null)
        }}
        recipeId={shareRecipeId}
      />

      <SharedRecipesInbox
        open={isSharedInboxOpen}
        onOpenChange={setIsSharedInboxOpen}
      />

      {/* Add to Plan Dialog */}
      <AddToPlanDialog
        open={!!addToPlanRecipeId}
        onOpenChange={(open) => !open && setAddToPlanRecipeId(null)}
        recipeId={addToPlanRecipeId}
      />

      {/* Recipe Settings Modal */}
      <RecipeSettingsModal
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
      />
    </div>
  )
}
