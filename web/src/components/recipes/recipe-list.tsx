"use client"

import { useState } from "react"
import { Plus, Search, Heart, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RecipeCard } from "./recipe-card"
import { RecipeDialog } from "./recipe-dialog"
import { RecipeDetailDialog } from "./recipe-detail-dialog"
import { AddToPlanDialog } from "./add-to-plan-dialog"
import {
  useRecipes,
  useCategories,
  useToggleFavorite,
  useDeleteRecipe,
} from "@/hooks/use-recipes"
import { useRecipeHistory } from "@/hooks/use-planner"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export function RecipeList() {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null)
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null)
  const [addToPlanRecipe, setAddToPlanRecipe] = useState<Recipe | null>(null)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  const { data: recipes, isLoading } = useRecipes({
    category,
    search: search || null,
    favoritesOnly,
  })
  const { data: categories } = useCategories()
  const { data: history } = useRecipeHistory()
  const toggleFavorite = useToggleFavorite()
  const deleteRecipe = useDeleteRecipe()

  // Build a map of recipe_id -> last made date
  const lastMadeMap = getLastMadeMap(history)

  const handleDelete = async (recipe: Recipe) => {
    if (confirm(`Are you sure you want to delete "${recipe.name}"?`)) {
      await deleteRecipe.mutateAsync(recipe.id)
    }
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search recipes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

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

        <Button onClick={() => setIsAddDialogOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add Recipe
        </Button>
      </div>

      {/* Recipe Grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
          <span className="text-sm">Loading recipes...</span>
        </div>
      ) : recipes?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">
            {search || category || favoritesOnly
              ? "No recipes match your filters."
              : "No recipes yet. Add your first recipe!"}
          </p>
          {!search && !category && !favoritesOnly && (
            <Button onClick={() => setIsAddDialogOpen(true)} className="mt-4">
              <Plus className="h-4 w-4 mr-2" />
              Add Recipe
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes?.map((recipe, index) => (
            <div
              key={recipe.id}
              style={{ animationDelay: `${index * 50}ms` }}
              className="animate-fade-in"
            >
              <RecipeCard
                recipe={recipe}
                onDelete={handleDelete}
                onToggleFavorite={(r) =>
                  toggleFavorite.mutate({ id: r.id, favorite: r.favorite })
                }
                onAddToPlan={setAddToPlanRecipe}
                onClick={setViewingRecipe}
                lastMade={lastMadeMap.get(recipe.id) || null}
              />
            </div>
          ))}
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
      />

      {/* Add to Plan Dialog */}
      <AddToPlanDialog
        open={!!addToPlanRecipe}
        onOpenChange={(open) => !open && setAddToPlanRecipe(null)}
        recipe={addToPlanRecipe}
      />
    </div>
  )
}
