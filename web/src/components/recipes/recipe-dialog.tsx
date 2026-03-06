"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import { Plus, FileText, PenTool, AlertTriangle, Check, ArrowLeft, Upload, X, Link, Loader2, List as ListIcon, ChefHat, AlertCircle, Wand2 } from "lucide-react"
import type { DragEndEvent } from "@dnd-kit/core"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
import { useUndoToast } from "@/hooks/use-undo-toast"
import { useDebouncedCallback } from "@/hooks/use-debounce"
import type { ParsedRecipe } from "@/lib/recipe-parser"
import { TagInput } from "@/components/ui/tag-input"
import { uploadRecipeImage, deleteRecipeImage } from "@/lib/supabase/storage"
import { cn, toFraction } from "@/lib/utils"
import { useImportRecipeFromUrl } from "@/hooks/use-recipe-import"
import type { Recipe, Ingredient } from "@/types/database"
import { sanitizeRecipeNameForStorage } from "@/lib/recipe-id-utils"
import {
  applyParsedRecipeToFormValues,
  buildEditingRecipeDialogFormValues,
  buildNewRecipeDialogFormValues,
  buildRecipeSubmissionData,
  clampRecipeServings,
  hasValidRecipeIngredients,
  isNewRecipeDialogDirty,
} from "./recipe-dialog.defaults"
import {
  getImportErrorMessage,
  IMPORT_URL_FAILURE_ERROR,
  parseRecipeImportPreview,
  parseRecipeImportText,
  toParsedRecipeImport,
  validateRecipeImportUrl,
} from "./recipe-import.parser"
import {
  autoFixIngredients,
  countBlockingIngredientIssues,
  countIngredientsWithIssues,
} from "./recipe-dialog.validation"

// Lazy-loaded so @dnd-kit (~60–90 KB gzipped) is excluded from the initial bundle
const SortableIngredientList = dynamic(
  () => import("./recipe-sortable-ingredients").then((m) => m.SortableIngredientList),
  { ssr: false }
)

interface RecipeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe?: Recipe
  categories: string[]
  onRecipeCreated?: (recipe: Recipe) => void
}


export function RecipeDialog({
  open,
  onOpenChange,
  recipe,
  categories,
  onRecipeCreated,
}: RecipeDialogProps) {
  const isEditing = !!recipe
  const createRecipe = useCreateRecipe()
  const updateRecipe = useUpdateRecipe()
  const undoToast = useUndoToast()

  const [mode, setMode] = useState<"manual" | "import">("manual")
  const [isWideViewport, setIsWideViewport] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(min-width: 640px)").matches
  })
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
  const [importUrl, setImportUrl] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<'input' | 'preview'>('input')
  const [parsedPreview, setParsedPreview] = useState<ParsedRecipe | null>(null)
  const [livePreview, setLivePreview] = useState<ParsedRecipe | null>(null)
  const importFromUrl = useImportRecipeFromUrl()

  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)")
    const onChange = (event: MediaQueryListEvent) => setIsWideViewport(event.matches)
    setIsWideViewport(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  // Reset form when dialog opens/closes or recipe changes
  useEffect(() => {
    if (open && recipe) {
      const formValues = buildEditingRecipeDialogFormValues(recipe)
      setName(formValues.name)
      setCategory(formValues.category)
      setServings(formValues.servings)
      setTags(formValues.tags)
      setIngredients(formValues.ingredients)
      setInstructions(formValues.instructions)
      setImageUrl(formValues.imageUrl)
      setImageFile(null)
      setImagePreview(null)
      setMode("manual")
      setImportText("")
      setImportUrl("")
      setParseError(null)
      setImportStep('input')
      setParsedPreview(null)
    } else if (open && !recipe) {
      const formValues = buildNewRecipeDialogFormValues(categories)
      setName(formValues.name)
      setCategory(formValues.category)
      setServings(formValues.servings)
      setTags(formValues.tags)
      setIngredients(formValues.ingredients)
      setInstructions(formValues.instructions)
      setImageUrl(formValues.imageUrl)
      setImageFile(null)
      setImagePreview(null)
      setMode("manual")
      setImportText("")
      setImportUrl("")
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

  // Debounced live preview parser
  const debouncedParse = useDebouncedCallback(((text: string) => {
    setLivePreview(parseRecipeImportPreview(text))
  }) as (...args: unknown[]) => void, 300);

  const handleParseImport = () => {
    const result = parseRecipeImportText(importText)

    if (!result.parsedRecipe) {
      setParseError(result.error)
      return
    }

    setParsedPreview(result.parsedRecipe)
    setParseError(null)
    setImportStep('preview')
  }

  const handleUrlImport = async () => {
    const validation = validateRecipeImportUrl(importUrl)

    if (!validation.normalizedUrl) {
      setParseError(validation.error)
      return
    }

    setParseError(null)
    try {
      const result = await importFromUrl.mutateAsync(validation.normalizedUrl)
      setParsedPreview(toParsedRecipeImport(result))
      // Store the extracted image URL for later
      if (result.imageUrl) {
        setImageUrl(result.imageUrl)
      }
      setImportStep('preview')
    } catch (err) {
      setParseError(getImportErrorMessage(err, IMPORT_URL_FAILURE_ERROR))
    }
  }

  const handleApplyPreview = () => {
    if (!parsedPreview) return

    const formValues = applyParsedRecipeToFormValues(
      {
        name,
        category,
        servings,
        tags,
        ingredients,
        instructions,
        imageUrl,
      },
      parsedPreview
    )

    setName(formValues.name)
    setServings(formValues.servings)
    setIngredients(formValues.ingredients)
    setInstructions(formValues.instructions)

    // Switch to manual mode to allow editing
    setMode("manual")
    setImportStep('input')
    setParsedPreview(null)
  }

  const handleBackToInput = () => {
    setImportStep('input')
    setParsedPreview(null)
  }

  // Handle auto-fix for validation issues
  const handleAutoFix = useCallback(() => {
    const result = autoFixIngredients(ingredients)

    setIngredients(result.ingredients)

    if (result.fixedCount > 0) {
      undoToast.show({
        message: `Auto-fixed ${result.fixedCount} ingredient(s)`,
        duration: 3000
      })
    }
  }, [ingredients, setIngredients, undoToast])


  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      undoToast.show({ message: 'Please select an image file', duration: 4000 })
      return
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      undoToast.show({ message: 'Image size must be less than 5MB', duration: 4000 })
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
    // P3: Validate ingredients before submitting (only blocking issues)
    const blockingIssuesCount = countBlockingIngredientIssues(ingredients)

    if (blockingIssuesCount > 0) {
      undoToast.show({
        message: `${blockingIssuesCount} ingredient(s) have critical issues. Please fix them before saving.`,
        duration: 5000
      })
      document.querySelector('[data-has-issues="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    try {
      let finalImageUrl = imageUrl

      // Upload new image if one was selected
      if (imageFile) {
        setIsUploadingImage(true)
        try {
          const recipeId = isEditing ? recipe.id : sanitizeRecipeNameForStorage(name)
          finalImageUrl = await uploadRecipeImage(recipeId, imageFile)
        } catch (error) {
          console.error("Failed to upload image:", error)
          undoToast.show({ message: "Failed to upload image. Recipe will be saved without image.", duration: 5000 })
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

      const recipeData = buildRecipeSubmissionData({
        name,
        category,
        servings,
        tags,
        ingredients,
        instructions,
        imageUrl: finalImageUrl,
      })

      if (isEditing) {
        await updateRecipe.mutateAsync({
          id: recipe.id,
          updates: recipeData,
        })
      } else {
        const created = await createRecipe.mutateAsync(recipeData)
        onRecipeCreated?.(created as Recipe)
      }
      onOpenChange(false)
    } catch (error) {
      console.error("Failed to save recipe:", error)
      undoToast.show({ message: 'Failed to save recipe. Please try again.', duration: 6000 })
    }
  }

  const isSubmitting = createRecipe.isPending || updateRecipe.isPending || isUploadingImage

  // Check if there's at least one valid ingredient
  const hasValidIngredients = hasValidRecipeIngredients(ingredients)

  const dialogTitle = isEditing ? "Edit Recipe" : "Add Recipe"

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const isDirty = !isEditing && isNewRecipeDialogDirty({
    name,
    ingredients,
    instructions,
  })
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isDirty) {
      setShowDiscardConfirm(true)
      return
    }
    onOpenChange(nextOpen)
  }

  return (
    <>
    <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes that will be lost. Are you sure you want to discard them?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => { setShowDiscardConfirm(false); onOpenChange(false) }}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className={
          isEditing
            ? "max-w-6xl w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-2xl sm:rounded-3xl overflow-hidden bg-card h-[90vh] max-h-[90vh] flex flex-col"
            : "max-w-6xl w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-xl overflow-hidden bg-card max-h-[92dvh] flex flex-col"
        }
      >
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        {isEditing && (
          <div className="px-6 sm:px-8 py-4 sm:py-6 flex justify-between items-center border-b border-stone-200 dark:border-zinc-800 flex-shrink-0">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-primary">Edit Recipe</h1>
              <p className="text-sm text-muted-foreground">Update your culinary masterpiece details.</p>
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>
          </div>
        )}

        {!isEditing && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "import")} className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 sm:px-8 pt-4 sm:pt-6 pb-3 sm:pb-4 flex justify-between items-center border-b border-stone-100 dark:border-zinc-900 flex-shrink-0 gap-2">
              <TabsList className="flex w-fit rounded-full p-1 bg-stone-100 dark:bg-zinc-900 gap-0 min-w-0">
                <TabsTrigger
                  value="manual"
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 rounded-full text-xs font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=inactive]:text-stone-500 dark:data-[state=inactive]:text-stone-400 transition-all"
                >
                  <PenTool className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                  <span>{isWideViewport ? "Manual Entry" : "Manual"}</span>
                </TabsTrigger>
                <TabsTrigger
                  value="import"
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 rounded-full text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=inactive]:text-stone-500 dark:data-[state=inactive]:text-stone-400 transition-all"
                >
                  <FileText className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                  Import
                </TabsTrigger>
              </TabsList>
              <DialogClose asChild>
                <button
                  type="button"
                  className="p-2 hover:bg-stone-100 dark:hover:bg-zinc-800 rounded-full transition-colors text-stone-400 shrink-0"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </DialogClose>
            </div>
            <TabsContent value="import" className="space-y-4 mt-0 flex-1 overflow-y-auto pb-6 sm:pb-8 px-4 sm:px-8 scrollbar-recipe-dialog data-[state=inactive]:hidden">
              {importStep === 'input' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* LEFT COLUMN: Input */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="import-url">Import from URL</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            id="import-url"
                            value={importUrl}
                            onChange={(e) => {
                              setImportUrl(e.target.value)
                              setParseError(null)
                            }}
                            placeholder="https://www.example.com/recipe..."
                            className="pl-9 font-mono text-sm"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                handleUrlImport()
                              }
                            }}
                          />
                        </div>
                        <Button
                          onClick={handleUrlImport}
                          disabled={importFromUrl.isPending}
                          className="shrink-0"
                        >
                          {importFromUrl.isPending ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Importing...
                            </>
                          ) : (
                            'Import'
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="relative flex items-center gap-4 py-1">
                      <div className="flex-1 border-t border-stone-200 dark:border-zinc-800" />
                      <span className="text-xs text-muted-foreground font-medium">or paste text</span>
                      <div className="flex-1 border-t border-stone-200 dark:border-zinc-800" />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="import-text">Paste Recipe Text</Label>
                      <Textarea
                        id="import-text"
                        value={importText}
                        onChange={(e) => {
                          setImportText(e.target.value)
                          setParseError(null)
                          debouncedParse(e.target.value)
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
                        rows={20}
                        className="font-mono text-sm resize-none"
                      />
                      {parseError && (
                        <p className="text-sm text-destructive" role="alert" aria-live="assertive">{parseError}</p>
                      )}
                    </div>
                  </div>

                  {/* RIGHT COLUMN: Live Preview */}
                  <div className="space-y-4">
                    <Label className="text-sm font-semibold">Live Preview</Label>

                    {livePreview ? (
                      <div className="bg-muted/30 border border-border rounded-xl p-6 space-y-6 h-full">
                        {/* Recipe Name */}
                        <div>
                          <div className="text-xs uppercase text-muted-foreground mb-1 font-semibold tracking-wide">
                            Recipe Name
                          </div>
                          <div className="font-serif text-2xl text-primary font-medium">
                            {livePreview.name}
                          </div>
                          {livePreview.servings && (
                            <div className="text-sm text-muted-foreground mt-1">
                              Serves {livePreview.servings}
                            </div>
                          )}
                        </div>

                        {/* Quick Stats */}
                        <div className="flex gap-6 text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <ChefHat className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <div className="font-bold text-lg">
                                {livePreview.ingredients.length}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                ingredient{livePreview.ingredients.length !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                              <ListIcon className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <div className="font-bold text-lg">
                                {livePreview.instructions.length}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                step{livePreview.instructions.length !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Warnings */}
                        {livePreview.warnings.length > 0 && (
                          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-xs font-bold uppercase tracking-wide mb-2">
                              <AlertTriangle className="h-4 w-4" />
                              Parsing Notes
                            </div>
                            <ul className="text-sm text-amber-700 dark:text-amber-400 space-y-1">
                              {livePreview.warnings.slice(0, 4).map((warning, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="text-amber-500 mt-0.5">•</span>
                                  <span>{warning}</span>
                                </li>
                              ))}
                              {livePreview.warnings.length > 4 && (
                                <li className="text-xs italic text-amber-600">
                                  +{livePreview.warnings.length - 4} more warning{livePreview.warnings.length - 4 !== 1 ? 's' : ''}
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        {/* Ingredient Preview */}
                        {livePreview.ingredients.length > 0 && (
                          <div>
                            <div className="text-xs uppercase text-muted-foreground mb-3 font-semibold tracking-wide">
                              Ingredients Preview
                            </div>
                            <div className="space-y-2 text-sm bg-background/50 rounded-lg p-3 max-h-48 overflow-y-auto">
                              {livePreview.ingredients.slice(0, 8).map((ing, i) => (
                                <div key={i} className="flex gap-3 items-start">
                                  <span className="text-muted-foreground font-mono text-xs min-w-[70px] text-right flex-shrink-0 mt-0.5">
                                    {ing.amount !== null ? `${ing.amount} ${ing.unit}`.trim() : '—'}
                                  </span>
                                  <span className="flex-1">
                                    {ing.item}
                                    {ing.modifier && (
                                      <span className="text-muted-foreground text-xs">, {ing.modifier}</span>
                                    )}
                                  </span>
                                </div>
                              ))}
                              {livePreview.ingredients.length > 8 && (
                                <div className="text-xs text-muted-foreground italic text-center pt-2 border-t">
                                  +{livePreview.ingredients.length - 8} more ingredient{livePreview.ingredients.length - 8 !== 1 ? 's' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Instructions Preview */}
                        {livePreview.instructions.length > 0 && (
                          <div>
                            <div className="text-xs uppercase text-muted-foreground mb-3 font-semibold tracking-wide">
                              Instructions Preview
                            </div>
                            <div className="space-y-2 text-sm bg-background/50 rounded-lg p-3 max-h-32 overflow-y-auto">
                              {livePreview.instructions.slice(0, 3).map((step, i) => (
                                <div key={i} className="flex gap-2 items-start">
                                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
                                    {i + 1}
                                  </span>
                                  <span className="flex-1 leading-relaxed">
                                    {step.length > 100 ? `${step.substring(0, 100)}...` : step}
                                  </span>
                                </div>
                              ))}
                              {livePreview.instructions.length > 3 && (
                                <div className="text-xs text-muted-foreground italic text-center pt-2 border-t">
                                  +{livePreview.instructions.length - 3} more step{livePreview.instructions.length - 3 !== 1 ? 's' : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Apply Button */}
                        <Button
                          type="button"
                          onClick={() => {
                            if (livePreview) {
                              setParsedPreview(livePreview);
                              setName(livePreview.name);
                              setIngredients(livePreview.ingredients);
                              setInstructions(livePreview.instructions.join('\n'));
                              setServings(livePreview.servings || 4);
                              setMode('manual');
                            }
                          }}
                          className="w-full"
                          size="lg"
                          disabled={
                            !livePreview ||
                            livePreview.warnings.some(w =>
                              w.includes("No ingredients") || w.includes("No instructions")
                            )
                          }
                        >
                          <Check className="h-4 w-4 mr-2" />
                          Apply to Form
                        </Button>
                      </div>
                    ) : (
                      <div className="bg-muted/10 border-2 border-dashed border-muted-foreground/20 rounded-xl p-12 flex flex-col items-center justify-center text-center h-full min-h-[500px]">
                        <FileText className="h-16 w-16 text-muted-foreground/30 mb-4" />
                        <p className="text-sm text-muted-foreground font-medium mb-1">
                          Paste recipe text to see live preview
                        </p>
                        <p className="text-xs text-muted-foreground/70 max-w-[280px]">
                          Your recipe will be parsed in real-time as you type
                        </p>
                      </div>
                    )}
                  </div>
                </div>
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
                    <div
                      className="bg-amber-50 border border-amber-200 rounded-lg p-3"
                      role="alert"
                      aria-live="polite"
                    >
                      <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-2">
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
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
                        <ul className="text-sm space-y-1">
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
                        <ol className="text-sm space-y-1 list-decimal list-inside">
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

            <TabsContent value="manual" className="mt-0 flex-1 overflow-y-auto min-h-0 scrollbar-recipe-dialog data-[state=inactive]:hidden">
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
                handleAutoFix={handleAutoFix}
                isWideViewport={isWideViewport}
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
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 scrollbar-recipe-dialog">
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
            handleAutoFix={handleAutoFix}
            isWideViewport={isWideViewport}
            imagePreview={imagePreview}
            imageUrl={imageUrl}
            onImageSelect={handleImageSelect}
            onRemoveImage={handleRemoveImage}
            fileInputRef={fileInputRef}
          />
        </div>
        )}

        <DialogFooter
          className={
            isEditing
              ? "px-4 sm:px-8 py-4 sm:py-6 pb-[env(safe-area-inset-bottom)] bg-muted/50 dark:bg-zinc-900/50 border-t border-stone-200 dark:border-zinc-800 flex flex-col items-end flex-shrink-0"
              : "px-4 sm:px-8 py-4 sm:py-6 pb-[env(safe-area-inset-bottom)] border-t border-stone-100 dark:border-zinc-900 bg-white/40 dark:bg-black/20 backdrop-blur-md flex flex-col items-end flex-shrink-0"
          }
        >
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || !category || !hasValidIngredients || isSubmitting}
            >
              {isSubmitting ? (isUploadingImage ? "Uploading image..." : "Saving...") : isEditing ? "Save Changes" : "Add Recipe"}
            </Button>
          </div>
          {!hasValidIngredients && !isSubmitting && (
            <p className="text-xs text-muted-foreground text-right mt-1">
              Add at least one ingredient to save
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
  handleAutoFix: () => void
  isWideViewport: boolean
}

// SortableIngredientRow and IngredientDragOverlay have been moved to
// recipe-sortable-ingredients.tsx (lazy-loaded via next/dynamic above).

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
  isWideViewport,
  imagePreview,
  imageUrl,
  onImageSelect,
  onRemoveImage,
  fileInputRef,
  handleAutoFix,
}: RecipeFormContentPropsWithImage) {
  const hasImage = !!(imagePreview || imageUrl)

  // Edit Recipe: 2-col layout per reference/recipemodal_editmode_redesign
  if (isEditing) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
        {/* Left: Image, Name, Category, Servings, Tags */}
        <div className="space-y-6 sm:space-y-8">
          <div className="relative">
            <Label className="block text-sm font-semibold text-primary mb-2">Recipe Image</Label>
            {hasImage ? (
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-muted">
                <Image
                  src={imagePreview || imageUrl || ""}
                  alt="Recipe"
                  fill
                  className="object-cover"
                  unoptimized={imageUrl ? !imageUrl.includes("supabase.co") : false}
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
            ) : fileInputRef && onImageSelect ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-video rounded-2xl border-2 border-dashed border-stone-200 dark:border-zinc-700 flex flex-col items-center justify-center bg-muted/50 dark:bg-zinc-900/50 hover:bg-muted dark:hover:bg-zinc-900 transition-colors text-muted-foreground hover:text-primary group/up"
              >
                <Upload className="h-12 w-12 sm:h-14 sm:w-14 text-stone-300 dark:text-zinc-600 group-hover/up:text-primary transition-colors" />
                <span className="mt-2 text-sm font-medium">Upload Image</span>
                <span className="text-xs uppercase tracking-wider mt-1">JPG, PNG, WebP. Max 5MB</span>
              </button>
            ) : null}
            {fileInputRef && onImageSelect && (
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={onImageSelect}
                className="hidden"
              />
            )}
          </div>

          <div className="space-y-4">
            <div>
              <Label htmlFor="name-edit" className="block text-sm font-semibold text-primary mb-2">Recipe Name</Label>
              <Input
                id="name-edit"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter recipe name"
                className="w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary focus:border-primary py-3"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="block text-sm font-semibold text-primary mb-2">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary py-3">
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
              <div>
                <Label className="block text-sm font-semibold text-primary mb-2">Servings</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={servings}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    if (isNaN(val)) setServings(1)
                    else setServings(clampRecipeServings(val))
                  }}
                  className="w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary py-3"
                />
              </div>
            </div>
          </div>

          <div>
            <Label className="block text-sm font-semibold text-primary mb-2">Tags</Label>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={allTags}
              tagCounts={tagCounts}
              placeholder="Add another tag..."
              showAddIconInInput
            />
          </div>
        </div>

        {/* Right: Ingredients, Instructions — recipemodal_editmode_redesign */}
        <div className="space-y-6 sm:space-y-8 flex flex-col min-h-0">
          <div>
            <Label className="text-sm font-semibold text-primary mb-4 block">Ingredients</Label>

            {/* Validation Summary */}
            {countIngredientsWithIssues(ingredients) > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm mb-1">
                      Ingredient Validation Issues
                    </div>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                      {countIngredientsWithIssues(ingredients)} ingredient(s) need attention. Check highlighted fields.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleAutoFix}
                      className="text-xs h-7"
                    >
                      <Wand2 className="h-3 w-3 mr-1.5" />
                      Attempt Auto-Fix
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <SortableIngredientList
              ingredients={ingredients}
              editModeTwoColLayout
              onReorderIngredients={onReorderIngredients}
              onRemoveIngredient={onRemoveIngredient}
              onIngredientChange={onIngredientChange}
            />
            <button
              type="button"
              onClick={onAddIngredient}
              className="mt-3 text-xs font-bold text-primary flex items-center hover:opacity-80 transition-opacity"
            >
              <Plus className="h-4 w-4 mr-1" />
              ADD INGREDIENT
            </button>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <Label htmlFor="instructions-edit" className="block text-sm font-semibold text-primary mb-2">Instructions</Label>
            <Textarea
              id="instructions-edit"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Step by step process..."
              className="flex-1 min-h-[180px] sm:min-h-[200px] w-full rounded-2xl bg-background border-stone-200 dark:border-zinc-800 focus:ring-primary focus:border-primary resize-none leading-relaxed px-5 py-4"
            />
          </div>
        </div>
      </div>
    )
  }

  // Add Recipe manual: 2-col layout per reference/addrecipemodal_redesign
  const addLabelClass = "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
      {/* Left: lg:col-span-5 — Image, Name, Category, Servings, Tags */}
      <div className="lg:col-span-5 border-r border-stone-100 dark:border-zinc-900 p-4 sm:p-8 flex flex-col gap-6">
        <div className="space-y-3 order-last lg:order-first">
          <h3 className={addLabelClass}>Recipe Image</h3>
          {hasImage ? (
            <div className="relative h-44 w-full overflow-hidden rounded-xl bg-muted">
              <Image
                src={imagePreview || imageUrl || ""}
                alt="Recipe"
                fill
                className="object-cover"
                unoptimized={imageUrl ? !imageUrl.includes("supabase.co") : false}
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
          ) : fileInputRef && onImageSelect ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-44 rounded-xl border-2 border-dashed border-stone-200 dark:border-zinc-800 flex flex-col items-center justify-center bg-muted/50 dark:bg-zinc-900/50 hover:border-accent transition-all cursor-pointer group/up"
            >
              <div className="p-3 rounded-full bg-stone-50 dark:bg-zinc-800 mb-2 group-hover/up:scale-110 transition-transform">
                <Upload className="h-6 w-6 text-stone-400 dark:text-stone-500" />
              </div>
              <p className="text-sm font-semibold text-stone-600 dark:text-stone-300">Upload Image</p>
              <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">JPG, PNG, WebP (Max 5MB)</p>
            </button>
          ) : null}
          {fileInputRef && onImageSelect && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={onImageSelect}
              className="hidden"
            />
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className={addLabelClass}>Recipe Name</label>
            <Input
              id="name-add"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Grandma's Roast Chicken"
              className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className={addLabelClass}>Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm">
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
              <label className={addLabelClass}>Servings</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={servings}
                onChange={(e) => {
                  const val = parseInt(e.target.value)
                  if (isNaN(val)) setServings(1)
                  else setServings(clampRecipeServings(val))
                }}
                className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className={addLabelClass}>Tags</label>
            <TagInput
              value={tags}
              onChange={setTags}
              suggestions={allTags}
              tagCounts={tagCounts}
              placeholder="Add tag..."
              showAddIconInInput
            />
          </div>
        </div>
      </div>

      {/* Right: lg:col-span-7 — Ingredients, Instructions */}
      <div className="lg:col-span-7 p-4 sm:p-8 space-y-8">
        <div className="space-y-4">
          <h3 className={addLabelClass}>Ingredients</h3>
          <SortableIngredientList
            ingredients={ingredients}
            addRecipeModalLayout
            isWideViewport={isWideViewport}
            onReorderIngredients={onReorderIngredients}
            onRemoveIngredient={onRemoveIngredient}
            onIngredientChange={onIngredientChange}
          />
          <button
            type="button"
            onClick={onAddIngredient}
            className="mt-3 text-[10px] font-bold uppercase text-accent hover:text-primary transition-colors flex items-center gap-1 min-h-[44px] px-4 border border-dashed border-accent rounded-lg w-full justify-center"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Row
          </button>
        </div>

        <div className="space-y-4">
          <label htmlFor="instructions-add" className={`${addLabelClass} block`}>Instructions</label>
          <Textarea
            id="instructions-add"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={"Step 1: Preheat oven to 400°F...\nStep 2: Season the chicken generously..."}
            className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-4 text-sm min-h-[160px] resize-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}
