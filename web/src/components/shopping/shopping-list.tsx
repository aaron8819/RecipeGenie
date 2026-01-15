"use client"

import { useState } from "react"
import { Plus, Trash2, RefreshCw, Package, Ban, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  useShoppingList,
  useGenerateShoppingList,
  useAddShoppingItem,
  useRemoveShoppingItem,
  useClearShoppingList,
} from "@/hooks/use-shopping"
import { useWeeklyPlan, getWeekStartDate } from "@/hooks/use-planner"
import { useUserConfig } from "@/hooks/use-planner"
import { SHOPPING_CATEGORIES } from "@/lib/shopping-categories"
import type { ShoppingItem } from "@/types/database"

export function ShoppingListView() {
  const [newItem, setNewItem] = useState("")
  const [scale, setScale] = useState(1.0)

  const { data: config } = useUserConfig()
  const weekDate = getWeekStartDate(new Date(), config?.week_start_day || 1)
  const { data: weeklyPlan } = useWeeklyPlan(weekDate)
  const { data: shoppingList, isLoading } = useShoppingList()

  const generateList = useGenerateShoppingList()
  const addItem = useAddShoppingItem()
  const removeItem = useRemoveShoppingItem()
  const clearList = useClearShoppingList()

  const handleGenerateList = async () => {
    if (!weeklyPlan?.recipe_ids?.length) {
      alert("No recipes in current week's meal plan")
      return
    }
    await generateList.mutateAsync({
      recipeIds: weeklyPlan.recipe_ids,
      scale,
    })
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItem.trim()) return

    try {
      await addItem.mutateAsync({ itemName: newItem })
      setNewItem("")
    } catch (error) {
      console.error("Failed to add item:", error)
    }
  }

  const handleClearList = async () => {
    if (confirm("Clear the entire shopping list?")) {
      await clearList.mutateAsync()
    }
  }

  // Group items by category
  const groupedItems = (shoppingList?.items || []).reduce(
    (acc, item) => {
      const category = item.categoryKey || "misc"
      if (!acc[category]) acc[category] = []
      acc[category].push(item)
      return acc
    },
    {} as Record<string, ShoppingItem[]>
  )

  const formatAmount = (item: ShoppingItem) => {
    if (!item.amount) return ""
    const amt = Math.round(item.amount * 100) / 100
    return `${amt}${item.unit ? " " + item.unit : ""}`
  }

  return (
    <div className="space-y-6">
      {/* Generate Controls */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Shopping List</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="space-y-2 flex-1">
              <Label htmlFor="scale">Scale</Label>
              <Input
                id="scale"
                type="number"
                min="0.5"
                max="5"
                step="0.5"
                value={scale}
                onChange={(e) => setScale(parseFloat(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                Multiply all quantities (e.g., 2 = double portions)
              </p>
            </div>
            <Button
              onClick={handleGenerateList}
              disabled={generateList.isPending || !weeklyPlan?.recipe_ids?.length}
              className="w-full sm:w-auto"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${generateList.isPending ? "animate-spin" : ""}`}
              />
              Generate from Meal Plan
            </Button>
          </div>

          {shoppingList?.source_recipes && shoppingList.source_recipes.length > 0 && (
            <p className="text-sm text-muted-foreground mt-4">
              {shoppingList.total_servings} total servings • Scale: {shoppingList.scale}x
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add Manual Item */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleAddItem} className="flex gap-2">
            <Input
              placeholder="Add item to list..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={addItem.isPending}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Shopping List */}
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Loading...</p>
      ) : !shoppingList?.items?.length ? (
        <p className="text-center text-muted-foreground py-8">
          Shopping list is empty. Generate one from your meal plan!
        </p>
      ) : (
        <div className="space-y-4">
          {/* Main shopping items grouped by category */}
          {Object.entries(SHOPPING_CATEGORIES)
            .sort(([, a], [, b]) => a.order - b.order)
            .map(([categoryKey, categoryData]) => {
              const items = groupedItems[categoryKey]
              if (!items || items.length === 0) return null

              return (
                <Card key={categoryKey}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm font-medium">
                      {categoryData.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-2">
                      {items.map((item) => (
                        <li
                          key={item.item}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Check className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {formatAmount(item) && (
                                <span className="text-muted-foreground mr-1">
                                  {formatAmount(item)}
                                </span>
                              )}
                              {item.item}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem.mutate(item.item)}
                            disabled={removeItem.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )
            })}

          {/* Already Have Section */}
          {shoppingList.already_have && shoppingList.already_have.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Already Have ({shoppingList.already_have.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {shoppingList.already_have.map((item) => (
                    <span
                      key={item.item}
                      className="px-2 py-1 bg-secondary rounded text-sm"
                    >
                      {item.item}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Excluded Section */}
          {shoppingList.excluded && shoppingList.excluded.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Ban className="h-4 w-4" />
                  Excluded ({shoppingList.excluded.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  {shoppingList.excluded.map((item) => (
                    <span
                      key={item.item}
                      className="px-2 py-1 bg-destructive/10 text-destructive rounded text-sm"
                    >
                      {item.item}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Clear Button */}
          <Button
            variant="outline"
            onClick={handleClearList}
            disabled={clearList.isPending}
            className="w-full"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Shopping List
          </Button>
        </div>
      )}
    </div>
  )
}
