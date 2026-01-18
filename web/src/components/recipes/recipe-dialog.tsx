"use client"

import { useState, useEffect } from "react"
import { Plus, Trash2, FileText, PenTool } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import { useCreateRecipe, useUpdateRecipe } from "@/hooks/use-recipes"
import { parseRecipeText } from "@/lib/recipe-parser"
import type { Recipe, Ingredient } from "@/types/database"

interface RecipeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe?: Recipe
  categories: string[]
}

export function RecipeDialog({
  open,
  onOpenChange,
  recipe,
  categories,
}: RecipeDialogProps) {
  const isEditing = !!recipe
  const createRecipe = useCreateRecipe()
  const updateRecipe = useUpdateRecipe()

  const [mode, setMode] = useState<"manual" | "import">("manual")
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [servings, setServings] = useState(4)
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [instructions, setInstructions] = useState("")
  
  // Import state
  const [importText, setImportText] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)

  // Reset form when dialog opens/closes or recipe changes
  useEffect(() => {
    if (open && recipe) {
      setName(recipe.name)
      setCategory(recipe.category)
      setServings(recipe.servings)
      setIngredients(recipe.ingredients || [])
      setInstructions((recipe.instructions || []).join("\n"))
      setMode("manual")
      setImportText("")
      setParseError(null)
    } else if (open && !recipe) {
      setName("")
      setCategory(categories[0] || "")
      setServings(4)
      setIngredients([{ item: "", amount: null, unit: "" }])
      setInstructions("")
      setMode("manual")
      setImportText("")
      setParseError(null)
    }
  }, [open, recipe, categories])

  const handleAddIngredient = () => {
    setIngredients([...ingredients, { item: "", amount: null, unit: "" }])
  }

  const handleRemoveIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  const handleIngredientChange = (
    index: number,
    field: keyof Ingredient,
    value: string | number | null
  ) => {
    const newIngredients = [...ingredients]
    newIngredients[index] = { ...newIngredients[index], [field]: value }
    setIngredients(newIngredients)
  }

  const handleParseImport = () => {
    if (!importText.trim()) {
      setParseError("Please paste some recipe text to import")
      return
    }

    try {
      const parsed = parseRecipeText(importText)
      
      if (parsed.name) {
        setName(parsed.name)
      }
      if (parsed.servings) {
        setServings(parsed.servings)
      }
      if (parsed.ingredients.length > 0) {
        setIngredients(parsed.ingredients)
      }
      if (parsed.instructions.length > 0) {
        setInstructions(parsed.instructions.join("\n"))
      }
      
      setParseError(null)
      // Switch to manual mode to show the parsed results
      setMode("manual")
    } catch (error) {
      setParseError(
        error instanceof Error
          ? error.message
          : "Failed to parse recipe. Please check the format and try again."
      )
    }
  }

  const handleSubmit = async () => {
    // Filter out empty ingredients
    const validIngredients = ingredients.filter((i) => i.item.trim())

    // Parse instructions into array
    const instructionLines = instructions
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line)

    const recipeData = {
      name: name.trim(),
      category,
      servings,
      ingredients: validIngredients,
      instructions: instructionLines,
    }

    try {
      if (isEditing) {
        await updateRecipe.mutateAsync({
          id: recipe.id,
          updates: recipeData,
        })
      } else {
        await createRecipe.mutateAsync(recipeData)
      }
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to save recipe:", error)
    }
  }

  const isSubmitting = createRecipe.isPending || updateRecipe.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Recipe" : "Add Recipe"}</DialogTitle>
        </DialogHeader>

        {!isEditing && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "import")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">
                <PenTool className="h-4 w-4 mr-2" />
                Manual Entry
              </TabsTrigger>
              <TabsTrigger value="import">
                <FileText className="h-4 w-4 mr-2" />
                Import from Text
              </TabsTrigger>
            </TabsList>

            <TabsContent value="import" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="import-text">Paste Recipe Text</Label>
                <Textarea
                  id="import-text"
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value)
                    setParseError(null)
                  }}
                  placeholder={`Example:
Chocolate Chip Cookies
Makes 24 cookies

Ingredients:
2 cups all-purpose flour
1 tsp baking soda
1 cup butter, softened
3/4 cup granulated sugar
2 large eggs
2 cups chocolate chips

Instructions:
1. Preheat oven to 375°F
2. Mix flour and baking soda in a bowl
3. Cream butter and sugar until fluffy
4. Add eggs and mix well
5. Gradually add flour mixture
6. Stir in chocolate chips
7. Drop rounded tablespoons onto baking sheet
8. Bake for 9-11 minutes`}
                  rows={12}
                  className="font-mono text-sm"
                />
                {parseError && (
                  <p className="text-sm text-destructive">{parseError}</p>
                )}
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Tips for best results:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-2">
                    <li>Include a recipe name at the top</li>
                    <li>Use "Ingredients:" header before the ingredient list</li>
                    <li>Use "Instructions:" or "Directions:" before steps</li>
                    <li>One ingredient per line</li>
                    <li>One instruction step per line</li>
                  </ul>
                </div>
              </div>
              <Button onClick={handleParseImport} className="w-full">
                Parse & Import Recipe
              </Button>
            </TabsContent>

            <TabsContent value="manual" className="mt-4">
              <RecipeFormContent
                name={name}
                setName={setName}
                category={category}
                setCategory={setCategory}
                servings={servings}
                setServings={setServings}
                ingredients={ingredients}
                instructions={instructions}
                setInstructions={setInstructions}
                categories={categories}
                onAddIngredient={handleAddIngredient}
                onRemoveIngredient={handleRemoveIngredient}
                onIngredientChange={handleIngredientChange}
              />
            </TabsContent>
          </Tabs>
        )}

        {isEditing && (
          <RecipeFormContent
            name={name}
            setName={setName}
            category={category}
            setCategory={setCategory}
            servings={servings}
            setServings={setServings}
            ingredients={ingredients}
            instructions={instructions}
            setInstructions={setInstructions}
            categories={categories}
            onAddIngredient={handleAddIngredient}
            onRemoveIngredient={handleRemoveIngredient}
            onIngredientChange={handleIngredientChange}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !category || isSubmitting}
          >
            {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Add Recipe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Extracted form content component for reuse
interface RecipeFormContentProps {
  name: string
  setName: (name: string) => void
  category: string
  setCategory: (category: string) => void
  servings: number
  setServings: (servings: number) => void
  ingredients: Ingredient[]
  instructions: string
  setInstructions: (instructions: string) => void
  categories: string[]
  onAddIngredient: () => void
  onRemoveIngredient: (index: number) => void
  onIngredientChange: (
    index: number,
    field: keyof Ingredient,
    value: string | number | null
  ) => void
}

function RecipeFormContent({
  name,
  setName,
  category,
  setCategory,
  servings,
  setServings,
  ingredients,
  instructions,
  setInstructions,
  categories,
  onAddIngredient,
  onRemoveIngredient,
  onIngredientChange,
}: RecipeFormContentProps) {
  return (
    <div className="space-y-6 py-4">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">Recipe Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Enter recipe name"
        />
      </div>

      {/* Category & Servings */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat} className="capitalize">
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="servings">Servings</Label>
          <Input
            id="servings"
            type="number"
            min={1}
            value={servings}
            onChange={(e) => setServings(parseInt(e.target.value) || 4)}
          />
        </div>
      </div>

      {/* Ingredients */}
      <div className="space-y-2">
        <Label>Ingredients</Label>
        <div className="space-y-2">
          {ingredients.map((ingredient, index) => (
            <div key={index} className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="Ingredient"
                value={ingredient.item}
                onChange={(e) =>
                  onIngredientChange(index, "item", e.target.value)
                }
              />
              <Input
                className="w-20"
                type="number"
                step="0.25"
                placeholder="Amt"
                value={ingredient.amount ?? ""}
                onChange={(e) =>
                  onIngredientChange(
                    index,
                    "amount",
                    e.target.value ? parseFloat(e.target.value) : null
                  )
                }
              />
              <Input
                className="w-24"
                placeholder="Unit"
                value={ingredient.unit}
                onChange={(e) =>
                  onIngredientChange(index, "unit", e.target.value)
                }
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onRemoveIngredient(index)}
                disabled={ingredients.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={onAddIngredient}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Ingredient
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-2">
        <Label htmlFor="instructions">Instructions (one step per line)</Label>
        <Textarea
          id="instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Enter each instruction step on a new line"
          rows={6}
        />
      </div>
    </div>
  )
}
