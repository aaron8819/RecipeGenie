"use client"

import { useState, useMemo } from "react"
import { Search, Plus } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useRecipes, useCategories } from "@/hooks/use-recipes"
import { useAddRecipeToPlan } from "@/hooks/use-planner"
import type { Recipe } from "@/types/database"
import { cn } from "@/lib/utils"
import { getTagClassName } from "@/lib/tag-colors"

interface AddRecipeToPlanModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  weekDate: string
}

export function AddRecipeToPlanModal({
  open,
  onOpenChange,
  weekDate,
}: AddRecipeToPlanModalProps) {
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null)

  const { data: recipes } = useRecipes({
    search: search || null,
    category,
  })
  const { data: categories } = useCategories()
  const addToPlan = useAddRecipeToPlan()

  // Reset state when modal opens
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearch("")
      setCategory(null)
      setSelectedRecipeId(null)
    }
    onOpenChange(open)
  }

  const handleAddToPlan = async () => {
    if (!selectedRecipeId || !weekDate) return

    try {
      await addToPlan.mutateAsync({
        weekDate,
        recipeId: selectedRecipeId,
      })
      handleOpenChange(false)
    } catch (error) {
      console.error("Failed to add recipe to plan:", error)
    }
  }

  const selectedRecipe = useMemo(() => {
    return recipes?.find(r => r.id === selectedRecipeId)
  }, [recipes, selectedRecipeId])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add Recipe to Plan
          </DialogTitle>
          <DialogDescription>
            Search and select a recipe to add to this week&apos;s meal plan.
          </DialogDescription>
        </DialogHeader>

        {/* Search and Filter */}
        <div className="flex gap-2 mt-2">
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
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Category" />
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
        </div>

        {/* Recipe List */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px] border rounded-lg mt-2">
          {!recipes || recipes.length === 0 ? (
            <p className="text-muted-foreground text-center py-8 text-sm">
              {search || category ? "No recipes match your search." : "No recipes available."}
            </p>
          ) : (
            <ul className="divide-y">
              {recipes.map((recipe) => (
                <li key={recipe.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRecipeId(recipe.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors hover:bg-accent",
                      selectedRecipeId === recipe.id && "bg-primary/10"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{recipe.name}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={cn("capitalize text-xs", getTagClassName(recipe.category, true))}>
                            {recipe.category}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {recipe.servings} servings
                          </span>
                        </div>
                      </div>
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                          selectedRecipeId === recipe.id
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/30"
                        )}
                      >
                        {selectedRecipeId === recipe.id && (
                          <div className="w-2 h-2 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAddToPlan}
            disabled={!selectedRecipeId || addToPlan.isPending}
          >
            {addToPlan.isPending ? "Adding..." : "Add to Plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
