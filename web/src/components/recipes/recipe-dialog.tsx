"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { FileText, PenTool, X } from "lucide-react"
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
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs"
import { useCreateRecipe, useUpdateRecipe, useAllTags, useTagsWithCounts } from "@/hooks/use-recipes"
import { useRecipeImageStorage } from "@/hooks/use-recipe-image-storage"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { useDebouncedCallback } from "@/hooks/use-debounce"
import type { ParsedRecipe } from "@/lib/recipe-parser"
import { useImportRecipeFromUrl } from "@/hooks/use-recipe-import"
import type { Recipe, Ingredient } from "@/types/database"
import { sanitizeRecipeNameForStorage } from "@/lib/recipe-id-utils"
import {
  RecipeDialogActions,
  RecipeIngredientsSection,
  RecipeImageField,
  RecipeInstructionsSection,
  RecipeImportSection,
  RecipeMetadataSection,
} from "./recipe-dialog-components"
import {
  applyParsedRecipeToFormValues,
  buildEditingRecipeDialogFormValues,
  buildNewRecipeDialogFormValues,
  buildRecipeSubmissionData,
  hasValidRecipeIngredients,
  isNewRecipeDialogDirty,
} from "./recipe-dialog.defaults"
import {
  getImportErrorMessage,
  IMPORT_URL_FAILURE_ERROR,
  parseRecipeImportPreview,
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
  const { uploadImage, deleteImage } = useRecipeImageStorage()
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
          finalImageUrl = await uploadImage(recipeId, imageFile)
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
          await deleteImage(recipe.image_url)
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
              <RecipeImportSection
                importStep={importStep}
                importUrl={importUrl}
                importText={importText}
                parseError={parseError}
                livePreview={livePreview}
                parsedPreview={parsedPreview}
                isImportingFromUrl={importFromUrl.isPending}
                onImportUrlChange={(value) => {
                  setImportUrl(value)
                  setParseError(null)
                }}
                onImportTextChange={(value) => {
                  setImportText(value)
                  setParseError(null)
                  debouncedParse(value)
                }}
                onImportUrl={handleUrlImport}
                onApplyLivePreview={() => {
                  if (!livePreview) return
                  setParsedPreview(livePreview)
                  setName(livePreview.name)
                  setIngredients(livePreview.ingredients)
                  setInstructions(livePreview.instructions.join("\n"))
                  setServings(livePreview.servings || 4)
                  setMode("manual")
                }}
                onBackToInput={handleBackToInput}
                onApplyPreview={handleApplyPreview}
              />
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
          <RecipeDialogActions
            isEditing={isEditing}
            isSubmitting={isSubmitting}
            isUploadingImage={isUploadingImage}
            canSubmit={!!name.trim() && !!category && hasValidIngredients && !isSubmitting}
            onCancel={() => onOpenChange(false)}
            onSubmit={handleSubmit}
          />
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
  const ingredientIssueCount = countIngredientsWithIssues(ingredients)

  // Edit Recipe: 2-col layout per reference/recipemodal_editmode_redesign
  if (isEditing) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10">
        {/* Left: Image, Name, Category, Servings, Tags */}
        <div className="space-y-6 sm:space-y-8">
          <RecipeImageField
            variant="edit"
            imagePreview={imagePreview}
            imageUrl={imageUrl}
            onImageSelect={onImageSelect}
            onRemoveImage={onRemoveImage}
            fileInputRef={fileInputRef}
          />
          <RecipeMetadataSection
            variant="edit"
            name={name}
            onNameChange={setName}
            category={category}
            onCategoryChange={setCategory}
            servings={servings}
            onServingsChange={setServings}
            tags={tags}
            onTagsChange={setTags}
            allTags={allTags}
            tagCounts={tagCounts}
            categories={categories}
          />
        </div>

        {/* Right: Ingredients, Instructions - recipemodal_editmode_redesign */}
        <div className="space-y-6 sm:space-y-8 flex flex-col min-h-0">
          <RecipeIngredientsSection
            variant="edit"
            ingredientIssueCount={ingredientIssueCount}
            onAutoFix={handleAutoFix}
            onAddIngredient={onAddIngredient}
          >
            <SortableIngredientList
              ingredients={ingredients}
              editModeTwoColLayout
              onReorderIngredients={onReorderIngredients}
              onRemoveIngredient={onRemoveIngredient}
              onIngredientChange={onIngredientChange}
            />
          </RecipeIngredientsSection>

          <RecipeInstructionsSection
            variant="edit"
            instructions={instructions}
            onInstructionsChange={setInstructions}
          />
        </div>
      </div>
    )
  }

  // Add Recipe manual: 2-col layout per reference/addrecipemodal_redesign
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-0">
      {/* Left: lg:col-span-5 - Image, Name, Category, Servings, Tags */}
      <div className="lg:col-span-5 border-r border-stone-100 dark:border-zinc-900 p-4 sm:p-8 flex flex-col gap-6">
        <RecipeImageField
          variant="add"
          imagePreview={imagePreview}
          imageUrl={imageUrl}
          onImageSelect={onImageSelect}
          onRemoveImage={onRemoveImage}
          fileInputRef={fileInputRef}
        />

        <RecipeMetadataSection
          variant="add"
          name={name}
          onNameChange={setName}
          category={category}
          onCategoryChange={setCategory}
          servings={servings}
          onServingsChange={setServings}
          tags={tags}
          onTagsChange={setTags}
          allTags={allTags}
          tagCounts={tagCounts}
          categories={categories}
        />
      </div>

      {/* Right: lg:col-span-7 - Ingredients, Instructions */}
      <div className="lg:col-span-7 p-4 sm:p-8 space-y-8">
        <RecipeIngredientsSection variant="add" onAddIngredient={onAddIngredient}>
          <SortableIngredientList
            ingredients={ingredients}
            addRecipeModalLayout
            isWideViewport={isWideViewport}
            onReorderIngredients={onReorderIngredients}
            onRemoveIngredient={onRemoveIngredient}
            onIngredientChange={onIngredientChange}
          />
        </RecipeIngredientsSection>

        <RecipeInstructionsSection
          variant="add"
          instructions={instructions}
          onInstructionsChange={setInstructions}
        />
      </div>
    </div>
  )
}
