"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Image from "next/image"
import { Plus, Trash2, FileText, PenTool, AlertTriangle, Check, ArrowLeft, GripVertical, Upload, X } from "lucide-react"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
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
import { useCreateRecipe, useUpdateRecipe, useAllTags, useTagsWithCounts } from "@/hooks/use-recipes"
import { parseRecipeText, type ParsedRecipe } from "@/lib/recipe-parser"
import { TagInput } from "@/components/ui/tag-input"
import { uploadRecipeImage, deleteRecipeImage } from "@/lib/supabase/storage"
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
  const [tags, setTags] = useState<string[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [instructions, setInstructions] = useState("")
  
  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Import state
  const [importText, setImportText] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<'input' | 'preview'>('input')
  const [parsedPreview, setParsedPreview] = useState<ParsedRecipe | null>(null)

  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()

  // Reset form when dialog opens/closes or recipe changes
  useEffect(() => {
    if (open && recipe) {
      setName(recipe.name)
      setCategory(recipe.category)
      setServings(recipe.servings)
      setTags(recipe.tags || [])
      setIngredients(recipe.ingredients || [])
      setInstructions((recipe.instructions || []).join("\n"))
      setImageUrl(recipe.image_url || null)
      setImageFile(null)
      setImagePreview(null)
      setMode("manual")
      setImportText("")
      setParseError(null)
      setImportStep('input')
      setParsedPreview(null)
    } else if (open && !recipe) {
      setName("")
      setCategory(categories[0] || "")
      setServings(4)
      setTags([])
      setIngredients([{ item: "", amount: null, unit: "" }])
      setInstructions("")
      setImageUrl(null)
      setImageFile(null)
      setImagePreview(null)
      setMode("manual")
      setImportText("")
      setParseError(null)
      setImportStep('input')
      setParsedPreview(null)
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

  const handleReorderIngredients = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setIngredients((items) => {
        const oldIndex = items.findIndex((_, i) => i.toString() === active.id)
        const newIndex = items.findIndex((_, i) => i.toString() === over.id)

        const newItems = [...items]
        const [removed] = newItems.splice(oldIndex, 1)
        newItems.splice(newIndex, 0, removed)

        return newItems
      })
    }
  }, [])

  const handleParseImport = () => {
    if (!importText.trim()) {
      setParseError("Please paste some recipe text to import")
      return
    }

    try {
      const parsed = parseRecipeText(importText)
      setParsedPreview(parsed)
      setParseError(null)
      setImportStep('preview')
    } catch (error) {
      setParseError(
        error instanceof Error
          ? error.message
          : "Failed to parse recipe. Please check the format and try again."
      )
    }
  }

  const handleApplyPreview = () => {
    if (!parsedPreview) return

    if (parsedPreview.name) {
      setName(parsedPreview.name)
    }
    if (parsedPreview.servings) {
      setServings(parsedPreview.servings)
    }
    if (parsedPreview.ingredients.length > 0) {
      setIngredients(parsedPreview.ingredients)
    }
    if (parsedPreview.instructions.length > 0) {
      setInstructions(parsedPreview.instructions.join("\n"))
    }

    // Switch to manual mode to allow editing
    setMode("manual")
    setImportStep('input')
    setParsedPreview(null)
  }

  const handleBackToInput = () => {
    setImportStep('input')
    setParsedPreview(null)
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file')
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB')
      return
    }

    setImageFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setImageFile(null)
    setImagePreview(null)
    setImageUrl(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
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

    try {
      let finalImageUrl = imageUrl

      // Upload new image if one was selected
      if (imageFile) {
        setIsUploadingImage(true)
        try {
          const recipeId = isEditing ? recipe.id : name.toLowerCase().replace(/\s+/g, "-")
          finalImageUrl = await uploadRecipeImage(recipeId, imageFile)
        } catch (error) {
          console.error("Failed to upload image:", error)
          alert("Failed to upload image. Recipe will be saved without image.")
          finalImageUrl = imageUrl // Keep existing image if upload fails
        } finally {
          setIsUploadingImage(false)
        }
      }

      // Delete old image if it was removed
      if (isEditing && recipe.image_url && !imageFile && !imageUrl) {
        try {
          await deleteRecipeImage(recipe.image_url)
        } catch (error) {
          console.error("Failed to delete old image:", error)
          // Continue anyway - image deletion failure shouldn't block recipe save
        }
      }

      const recipeData = {
        name: name.trim(),
        category,
        servings,
        tags: tags || [], // Ensure tags is always an array, never null/undefined
        ingredients: validIngredients,
        instructions: instructionLines,
        image_url: finalImageUrl,
      }

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

  const isSubmitting = createRecipe.isPending || updateRecipe.isPending || isUploadingImage

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
      >
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
              {importStep === 'input' ? (
                <>
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
                        <li>Use &quot;Ingredients:&quot; header before the ingredient list</li>
                        <li>Use &quot;Instructions:&quot; or &quot;Directions:&quot; before steps</li>
                        <li>One ingredient per line</li>
                        <li>One instruction step per line</li>
                      </ul>
                    </div>
                  </div>
                  <Button onClick={handleParseImport} className="w-full">
                    Parse & Preview Recipe
                  </Button>
                </>
              ) : (
                /* Preview State */
                <div className="space-y-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleBackToInput}
                    className="mb-2"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Edit
                  </Button>

                  {/* Warnings */}
                  {parsedPreview?.warnings && parsedPreview.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        Parsing Notes
                      </div>
                      <ul className="text-sm text-amber-700 space-y-1">
                        {parsedPreview.warnings.map((warning, i) => (
                          <li key={i}>• {warning}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Preview Card */}
                  <div className="border rounded-lg p-4 bg-muted/30 space-y-4">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Name</div>
                      <div className="font-medium">{parsedPreview?.name || "—"}</div>
                    </div>

                    {parsedPreview?.servings && (
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Servings</div>
                        <div>{parsedPreview.servings}</div>
                      </div>
                    )}

                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        Ingredients ({parsedPreview?.ingredients?.length || 0})
                      </div>
                      {parsedPreview?.ingredients && parsedPreview.ingredients.length > 0 ? (
                        <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
                          {parsedPreview.ingredients.map((ing, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-muted-foreground">
                                {ing.amount ? `${ing.amount} ${ing.unit || ""}`.trim() : "—"}
                              </span>
                              <span>
                                {ing.item}
                                {ing.modifier && (
                                  <span className="text-muted-foreground">, {ing.modifier}</span>
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-sm text-muted-foreground italic">No ingredients found</div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                        Instructions ({parsedPreview?.instructions?.length || 0} steps)
                      </div>
                      {parsedPreview?.instructions && parsedPreview.instructions.length > 0 ? (
                        <ol className="text-sm space-y-1 max-h-32 overflow-y-auto list-decimal list-inside">
                          {parsedPreview.instructions.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      ) : (
                        <div className="text-sm text-muted-foreground italic">No instructions found</div>
                      )}
                    </div>
                  </div>

                  <Button onClick={handleApplyPreview} className="w-full">
                    <Check className="h-4 w-4 mr-2" />
                    Apply & Edit Recipe
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="manual" className="mt-4">
              <RecipeFormContent
                name={name}
                setName={setName}
                category={category}
                setCategory={setCategory}
                servings={servings}
                setServings={setServings}
                tags={tags}
                setTags={setTags}
                allTags={allTags}
                tagCounts={tagCounts}
                ingredients={ingredients}
                instructions={instructions}
                setInstructions={setInstructions}
                categories={categories}
                onAddIngredient={handleAddIngredient}
                onRemoveIngredient={handleRemoveIngredient}
                onIngredientChange={handleIngredientChange}
                isEditing={false}
                onReorderIngredients={handleReorderIngredients}
                imagePreview={imagePreview}
                imageUrl={imageUrl}
                onImageSelect={handleImageSelect}
                onRemoveImage={handleRemoveImage}
                fileInputRef={fileInputRef}
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
            tags={tags}
            setTags={setTags}
            allTags={allTags}
            tagCounts={tagCounts}
            ingredients={ingredients}
            instructions={instructions}
            setInstructions={setInstructions}
            categories={categories}
            onAddIngredient={handleAddIngredient}
            onRemoveIngredient={handleRemoveIngredient}
            onIngredientChange={handleIngredientChange}
            isEditing={true}
            onReorderIngredients={handleReorderIngredients}
            imagePreview={imagePreview}
            imageUrl={imageUrl}
            onImageSelect={handleImageSelect}
            onRemoveImage={handleRemoveImage}
            fileInputRef={fileInputRef}
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
            {isSubmitting ? (isUploadingImage ? "Uploading image..." : "Saving...") : isEditing ? "Save Changes" : "Add Recipe"}
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
  tags: string[]
  setTags: (tags: string[]) => void
  allTags: string[]
  tagCounts?: Array<{ tag: string; count: number }>
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
  isEditing: boolean
  onReorderIngredients: (event: DragEndEvent) => void
}

// Sortable ingredient row component
function SortableIngredientRow({
  ingredient,
  index,
  onRemoveIngredient,
  onIngredientChange,
  ingredients,
  isEditing,
}: {
  ingredient: Ingredient
  index: number
  onRemoveIngredient: (index: number) => void
  onIngredientChange: (
    index: number,
    field: keyof Ingredient,
    value: string | number | null
  ) => void
  ingredients: Ingredient[]
  isEditing: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: index.toString() })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex gap-2 items-center ${isDragging ? "z-50" : ""}`}
    >
      {isEditing && (
        <button
          type="button"
          className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1 flex-shrink-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
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
      <Input
        className="w-32"
        placeholder="Modifier (e.g., rinsed)"
        value={ingredient.modifier || ""}
        onChange={(e) =>
          onIngredientChange(index, "modifier", e.target.value || undefined)
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
  )
}

// Drag overlay for ingredient
function IngredientDragOverlay({ ingredient }: { ingredient: Ingredient }) {
  return (
    <div className="flex gap-2 items-center bg-card border rounded-lg p-2 shadow-lg">
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="flex-1 text-sm">
        {ingredient.amount && ingredient.unit
          ? `${ingredient.amount} ${ingredient.unit} ${ingredient.item}${ingredient.modifier ? `, ${ingredient.modifier}` : ""}`
          : `${ingredient.item || "Ingredient"}${ingredient.modifier ? `, ${ingredient.modifier}` : ""}`}
      </span>
    </div>
  )
}

interface RecipeFormContentPropsWithImage extends RecipeFormContentProps {
  imagePreview?: string | null
  imageUrl?: string | null
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveImage?: () => void
  fileInputRef?: React.RefObject<HTMLInputElement>
}

function RecipeFormContent({
  name,
  setName,
  category,
  setCategory,
  servings,
  setServings,
  tags,
  setTags,
  allTags,
  tagCounts,
  ingredients,
  instructions,
  setInstructions,
  categories,
  onAddIngredient,
  onRemoveIngredient,
  onIngredientChange,
  isEditing,
  onReorderIngredients,
  imagePreview,
  imageUrl,
  onImageSelect,
  onRemoveImage,
  fileInputRef,
}: RecipeFormContentPropsWithImage) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    onReorderIngredients(event)
  }

  const activeIngredient = activeId
    ? ingredients[parseInt(activeId)]
    : null

  const ingredientIds = ingredients.map((_, i) => i.toString())
  return (
    <div className="space-y-6 py-4">
      {/* Recipe Image */}
      <div className="space-y-2">
        <Label>Recipe Image</Label>
        <div className="space-y-3">
          {(imagePreview || imageUrl) && (
            <div className="relative w-full h-48 rounded-lg overflow-hidden border-2 border-border bg-muted">
              <Image
                src={imagePreview || imageUrl || ''}
                alt="Recipe preview"
                fill
                className="object-cover"
                unoptimized={imageUrl ? !imageUrl.includes('supabase.co') : false}
              />
              {onRemoveImage && (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2"
                  onClick={onRemoveImage}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
          {fileInputRef && onImageSelect && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="flex-1"
              >
                <Upload className="h-4 w-4 mr-2" />
                {imagePreview || imageUrl ? 'Change Image' : 'Upload Image'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={onImageSelect}
                className="hidden"
              />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Supported formats: JPG, PNG, WebP. Max size: 5MB
          </p>
        </div>
      </div>

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

      {/* Tags */}
      <div className="space-y-2">
        <Label htmlFor="tags">Tags</Label>
        <TagInput
          value={tags}
          onChange={setTags}
          suggestions={allTags}
          tagCounts={tagCounts}
          placeholder="Add tags..."
        />
      </div>

      {/* Ingredients */}
      <div className="space-y-2">
        <Label>Ingredients</Label>
        {isEditing ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={ingredientIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-2">
                {ingredients.map((ingredient, index) => (
                  <SortableIngredientRow
                    key={index}
                    ingredient={ingredient}
                    index={index}
                    onRemoveIngredient={onRemoveIngredient}
                    onIngredientChange={onIngredientChange}
                    ingredients={ingredients}
                    isEditing={isEditing}
                  />
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
            </SortableContext>
            <DragOverlay>
              {activeIngredient ? (
                <IngredientDragOverlay ingredient={activeIngredient} />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
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
                <Input
                  className="w-32"
                  placeholder="Modifier (e.g., rinsed)"
                  value={ingredient.modifier || ""}
                  onChange={(e) =>
                    onIngredientChange(index, "modifier", e.target.value || undefined)
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
        )}
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
