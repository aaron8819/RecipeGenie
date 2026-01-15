"use client"

import { useState } from "react"
import { Plus, Search, Heart, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RecipeCard } from "./recipe-card"
import { RecipeDialog } from "./recipe-dialog"
import { RecipeDetailDialog } from "./recipe-detail-dialog"
import {
  useRecipes,
  useCategories,
  useToggleFavorite,
  useDeleteRecipe,
} from "@/hooks/use-recipes"
import type { Recipe } from "@/types/database"
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
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)

  const { data: recipes, isLoading } = useRecipes({
    category,
    search: search || null,
    favoritesOnly,
  })
  const { data: categories } = useCategories()
  const toggleFavorite = useToggleFavorite()
  const deleteRecipe = useDeleteRecipe()

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
        <div className="text-center py-12 text-muted-foreground">
          Loading recipes...
        </div>
      ) : recipes?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {search || category || favoritesOnly
            ? "No recipes match your filters."
            : "No recipes yet. Add your first recipe!"}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recipes?.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              onEdit={setEditingRecipe}
              onDelete={handleDelete}
              onToggleFavorite={(r) =>
                toggleFavorite.mutate({ id: r.id, favorite: r.favorite })
              }
              onClick={setViewingRecipe}
            />
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
    </div>
  )
}
