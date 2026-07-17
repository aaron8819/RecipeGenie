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
import { useCreateRecipe, useUpdateRecipe, useAllTags, useTagsWithCounts, useRecipe } from "@/hooks/use-recipes"
import { useRecipeImageStorage } from "@/hooks/use-recipe-image-storage"
import { useUndoToast } from "@/hooks/use-undo-toast"
import { useDebouncedCallback } from "@/hooks/use-debounce"
import { parseIngredientLine, type ParsedRecipe } from "@/lib/recipe-parser"
import { useImportRecipeFromUrl } from "@/hooks/use-recipe-import"
import type { Recipe, Ingredient, RecipeInstructionGroup } from "@/types/database"
import { createRecipeUuid } from "@/lib/recipe-identity"
import {
  RecipeDialogActions,
  RecipeIngredientsSection,
  RecipeImageField,
  RecipeInstructionsSection,
  RecipeImportSection,
  RecipeMetadataSection,
  RecipeNotesSection,
} from "./recipe-dialog-components"
import {
  applyParsedRecipeToFormValues,
  buildEditingRecipeDialogFormValues,
  buildNewRecipeDialogFormValues,
  buildRecipeSubmissionData,
  hasValidRecipeIngredients,
  isEditingRecipeDialogDirty,
  isNewRecipeDialogDirty,
  normalizeRecipeIngredientsForEditing,
} from "./recipe-dialog.defaults"
import {
  getImportErrorMessage,
  IMPORT_URL_FAILURE_ERROR,
  parseRecipeImportPreview,
  toParsedRecipeImport,
  validateRecipeImportUrl,
} from "./recipe-import.parser"
import {
  analyzeIngredientDuplicates,
  autoFixIngredients,
  countBlockingIngredientIssues,
  countIngredientsWithIssues,
  removeExactDuplicateIngredients,
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
  recipeId?: string
  categories: string[]
  onRecipeCreated?: (recipe: Recipe) => void
}


export function RecipeDialog({
  open,
  onOpenChange,
  recipe,
  recipeId,
  categories,
  onRecipeCreated,
}: RecipeDialogProps) {
  const resolvedRecipeId = recipeId ?? recipe?.id ?? null
  const { data: liveRecipe } = useRecipe(open && !!resolvedRecipeId ? resolvedRecipeId : null)
  const editingRecipe = liveRecipe ?? recipe
  const isEditing = !!resolvedRecipeId
  const createRecipe = useCreateRecipe()
  const updateRecipe = useUpdateRecipe()
  const { uploadImage, deleteImage } = useRecipeImageStorage()
  const undoToast = useUndoToast()

  const [mode, setMode] = useState<"manual" | "import">("manual")
  const [editTab, setEditTab] = useState<
    "details" | "ingredients" | "instructions" | "replace"
  >("details")
  const [isWideViewport, setIsWideViewport] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(min-width: 640px)").matches
  })
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [servings, setServings] = useState(4)
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<number | null>(null)
  const [cookTimeMinutes, setCookTimeMinutes] = useState<number | null>(null)
  const [totalTimeMinutes, setTotalTimeMinutes] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [instructionGroups, setInstructionGroups] = useState<RecipeInstructionGroup[]>([])
  const [notes, setNotes] = useState("")
  
  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const wasOpenRef = useRef(false)
  const hydratedRecipeIdRef = useRef<string | null>(null)
  const pendingCreateUuidRef = useRef<string | null>(null)
  
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

  const applyFormValues = useCallback((formValues: ReturnType<typeof buildNewRecipeDialogFormValues>) => {
    setName(formValues.name)
    setCategory(formValues.category)
    setServings(formValues.servings)
    setPrepTimeMinutes(formValues.prepTimeMinutes)
    setCookTimeMinutes(formValues.cookTimeMinutes)
    setTotalTimeMinutes(formValues.totalTimeMinutes)
    setTags(formValues.tags)
    setIngredients(formValues.ingredients)
    setInstructionGroups(formValues.instructionGroups)
    setNotes(formValues.notes)
    setImageUrl(formValues.imageUrl)
    setImageFile(null)
    setImagePreview(null)
    setMode("manual")
    setEditTab("details")
    setImportText("")
    setImportUrl("")
    setParseError(null)
    setImportStep('input')
    setParsedPreview(null)
    setLivePreview(null)
  }, [])

  // Reset form when the dialog opens or the edited recipe target changes.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      hydratedRecipeIdRef.current = null
      pendingCreateUuidRef.current = null
      return
    }

    const justOpened = !wasOpenRef.current
    wasOpenRef.current = true

    if (isEditing) {
      if (!editingRecipe || !resolvedRecipeId) {
        return
      }

      if (justOpened || hydratedRecipeIdRef.current !== resolvedRecipeId) {
        applyFormValues(buildEditingRecipeDialogFormValues(editingRecipe))
        hydratedRecipeIdRef.current = resolvedRecipeId
      }
      return
    }

    const shouldHydrateNewRecipe =
      justOpened ||
      (
        !isNewRecipeDialogDirty({
          name,
          defaultCategory: categories[0] || "",
          category,
          tags,
          prepTimeMinutes,
          cookTimeMinutes,
          totalTimeMinutes,
          ingredients,
          instructionGroups,
          notes,
          imageReference: imagePreview ?? imageUrl,
        }) &&
        !category &&
        categories.length > 0
      )

    if (shouldHydrateNewRecipe) {
      applyFormValues(buildNewRecipeDialogFormValues(categories))
    }
  }, [
    open,
    editingRecipe,
    isEditing,
    resolvedRecipeId,
    categories,
    applyFormValues,
    name,
    category,
    tags,
    prepTimeMinutes,
    cookTimeMinutes,
    totalTimeMinutes,
    ingredients,
    instructionGroups,
    notes,
    imagePreview,
    imageUrl,
  ])

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

  const handleBulkPasteIngredients = useCallback((startIndex: number, text: string) => {
    const parsedLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseIngredientLine(line))
      .filter((ingredient) => ingredient.item)

    if (parsedLines.length === 0) {
      return
    }

    setIngredients((currentIngredients) => {
      const nextIngredients = [...currentIngredients]

      while (nextIngredients.length < startIndex + parsedLines.length) {
        nextIngredients.push({ item: "", amount: null, unit: "" })
      }

      parsedLines.forEach((ingredient, offset) => {
        nextIngredients[startIndex + offset] = {
          ...nextIngredients[startIndex + offset],
          ...ingredient,
        }
      })

      return normalizeRecipeIngredientsForEditing(nextIngredients)
    })
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

  const applyPreviewToCurrentForm = useCallback((preview: ParsedRecipe) => {
    const formValues = applyParsedRecipeToFormValues(
      {
        name,
        category,
        servings,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        tags,
        ingredients,
        instructionGroups,
        notes,
        imageUrl,
      },
      preview
    )

    setName(formValues.name)
    setServings(formValues.servings)
    setPrepTimeMinutes(formValues.prepTimeMinutes)
    setCookTimeMinutes(formValues.cookTimeMinutes)
    setTotalTimeMinutes(formValues.totalTimeMinutes)
    setIngredients(formValues.ingredients)
    setInstructionGroups(formValues.instructionGroups)
    setNotes(formValues.notes)
  }, [
    name,
    category,
    servings,
    prepTimeMinutes,
    cookTimeMinutes,
    totalTimeMinutes,
    tags,
    ingredients,
    instructionGroups,
    notes,
    imageUrl,
  ])

  const handleApplyPreview = () => {
    if (!parsedPreview) return
    applyPreviewToCurrentForm(parsedPreview)

    // Switch to manual mode to allow editing
    setMode("manual")
    setEditTab("ingredients")
    setImportStep('input')
    setParsedPreview(null)
  }

  const handleApplyReplacementPreview = () => {
    if (!livePreview) return
    applyPreviewToCurrentForm(livePreview)
    setEditTab("ingredients")
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

  const handleRemoveExactDuplicates = useCallback(() => {
    const result = removeExactDuplicateIngredients(ingredients)

    if (result.removedCount === 0) {
      return
    }

    setIngredients(result.ingredients)
    undoToast.show({
      message: `Removed ${result.removedCount} exact duplicate ingredient row(s)`,
      duration: 3000,
    })
  }, [ingredients, undoToast])


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
      const nextRecipeId = editingRecipe?.id ??
        (pendingCreateUuidRef.current ||= createRecipeUuid())

      // Upload new image if one was selected
      if (imageFile) {
        setIsUploadingImage(true)
        try {
          finalImageUrl = await uploadImage(nextRecipeId, imageFile)
        } catch (error) {
          console.error("Failed to upload image:", error)
          undoToast.show({ message: "Failed to upload image. Recipe will be saved without image.", duration: 5000 })
          finalImageUrl = imageUrl // Keep existing image if upload fails
        } finally {
          setIsUploadingImage(false)
        }
      }

      // Delete old image if it was removed
      if (editingRecipe?.image_url && !imageFile && !imageUrl) {
        try {
          await deleteImage(editingRecipe.image_url)
        } catch (error) {
          console.error("Failed to delete old image:", error)
          // Continue anyway - image deletion failure shouldn't block recipe save
        }
      }

      const recipeData = buildRecipeSubmissionData({
        name,
        category,
        servings,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        tags,
        ingredients,
        instructionGroups,
        notes,
        imageUrl: finalImageUrl,
      })

      if (isEditing) {
        await updateRecipe.mutateAsync({
          id: editingRecipe!.id,
          updates: recipeData,
        })
      } else {
        const created = await createRecipe.mutateAsync({
          ...recipeData,
          recipeUuid: nextRecipeId,
        })
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
  const initialEditingFormValues = editingRecipe
    ? buildEditingRecipeDialogFormValues(editingRecipe)
    : null
  const isDirty = isEditing
    ? !!initialEditingFormValues && isEditingRecipeDialogDirty(initialEditingFormValues, {
        name,
        category,
        servings,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        tags,
        ingredients,
        instructionGroups,
        notes,
        imageUrl,
        imageReference: imagePreview ?? imageUrl,
      })
    : isNewRecipeDialogDirty({
        name,
        defaultCategory: categories[0] || "",
        category,
        tags,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        ingredients,
        instructionGroups,
        notes,
        imageReference: imagePreview ?? imageUrl,
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
            ? "max-w-6xl w-full sm:w-[calc(100%-2rem)] p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-t-3xl rounded-b-none sm:rounded-3xl overflow-hidden bg-card h-[100dvh] max-h-[100dvh] sm:h-[90vh] sm:max-h-[90vh] flex flex-col !top-0 !translate-y-0 sm:!top-1/2 sm:!-translate-y-1/2"
            : "max-w-6xl w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] p-0 gap-0 border border-stone-200 dark:border-zinc-800 shadow-2xl rounded-xl overflow-hidden bg-card max-h-[92dvh] flex flex-col"
        }
      >
        <DialogTitle className="sr-only">{dialogTitle}</DialogTitle>
        {isEditing && (
          <div className="sticky top-0 z-20 px-4 sm:px-8 pt-[max(1rem,env(safe-area-inset-top))] pb-4 sm:py-6 flex justify-between items-center border-b border-stone-200 dark:border-zinc-800 flex-shrink-0 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
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
                  setLivePreview(null)
                  debouncedParse(value)
                }}
                onImportUrl={handleUrlImport}
                onApplyLivePreview={() => {
                  if (!livePreview) return
                  setParsedPreview(livePreview)
                  applyPreviewToCurrentForm(livePreview)
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
                prepTimeMinutes={prepTimeMinutes}
                setPrepTimeMinutes={setPrepTimeMinutes}
                cookTimeMinutes={cookTimeMinutes}
                setCookTimeMinutes={setCookTimeMinutes}
                totalTimeMinutes={totalTimeMinutes}
                setTotalTimeMinutes={setTotalTimeMinutes}
                tags={tags}
                setTags={setTags}
                allTags={allTags}
                tagCounts={tagCounts}
                ingredients={ingredients}
                instructionGroups={instructionGroups}
                setInstructionGroups={setInstructionGroups}
                notes={notes}
                setNotes={setNotes}
                categories={categories}
                onAddIngredient={handleAddIngredient}
                onRemoveIngredient={handleRemoveIngredient}
                onIngredientChange={handleIngredientChange}
                isEditing={false}
                onReorderIngredients={handleReorderIngredients}
                onBulkPasteIngredients={handleBulkPasteIngredients}
                handleAutoFix={handleAutoFix}
                onRemoveExactDuplicates={handleRemoveExactDuplicates}
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
          <Tabs
            value={editTab}
            onValueChange={(value) => setEditTab(value as typeof editTab)}
            className="flex flex-1 min-h-0 flex-col"
          >
            <div className="border-b border-stone-200 bg-card px-4 py-3 dark:border-zinc-800 sm:px-8">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:inline-grid sm:w-auto sm:grid-cols-4">
                <TabsTrigger value="details" className="rounded-lg text-xs font-semibold">
                  Details
                </TabsTrigger>
                <TabsTrigger value="ingredients" className="rounded-lg text-xs font-semibold">
                  Ingredients
                </TabsTrigger>
                <TabsTrigger value="instructions" className="rounded-lg text-xs font-semibold">
                  Instructions
                </TabsTrigger>
                <TabsTrigger value="replace" className="rounded-lg text-xs font-semibold">
                  Replace
                </TabsTrigger>
              </TabsList>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 sm:p-6 lg:p-8 scrollbar-recipe-dialog">
              <TabsContent value="details" className="mt-0 data-[state=inactive]:hidden">
                <RecipeFormContent
                  editSection="details"
                  name={name}
                  setName={setName}
                  category={category}
                  setCategory={setCategory}
                  servings={servings}
                  setServings={setServings}
                  prepTimeMinutes={prepTimeMinutes}
                  setPrepTimeMinutes={setPrepTimeMinutes}
                  cookTimeMinutes={cookTimeMinutes}
                  setCookTimeMinutes={setCookTimeMinutes}
                  totalTimeMinutes={totalTimeMinutes}
                  setTotalTimeMinutes={setTotalTimeMinutes}
                  tags={tags}
                  setTags={setTags}
                  allTags={allTags}
                  tagCounts={tagCounts}
                  ingredients={ingredients}
                  instructionGroups={instructionGroups}
                  setInstructionGroups={setInstructionGroups}
                  notes={notes}
                  setNotes={setNotes}
                  categories={categories}
                  onAddIngredient={handleAddIngredient}
                  onRemoveIngredient={handleRemoveIngredient}
                  onIngredientChange={handleIngredientChange}
                  isEditing={true}
                  onReorderIngredients={handleReorderIngredients}
                  onBulkPasteIngredients={handleBulkPasteIngredients}
                  handleAutoFix={handleAutoFix}
                  onRemoveExactDuplicates={handleRemoveExactDuplicates}
                  isWideViewport={isWideViewport}
                  imagePreview={imagePreview}
                  imageUrl={imageUrl}
                  onImageSelect={handleImageSelect}
                  onRemoveImage={handleRemoveImage}
                  fileInputRef={fileInputRef}
                />
              </TabsContent>
              <TabsContent value="ingredients" className="mt-0 data-[state=inactive]:hidden">
                <RecipeFormContent
                  editSection="ingredients"
                  name={name}
                  setName={setName}
                  category={category}
                  setCategory={setCategory}
                  servings={servings}
                  setServings={setServings}
                  prepTimeMinutes={prepTimeMinutes}
                  setPrepTimeMinutes={setPrepTimeMinutes}
                  cookTimeMinutes={cookTimeMinutes}
                  setCookTimeMinutes={setCookTimeMinutes}
                  totalTimeMinutes={totalTimeMinutes}
                  setTotalTimeMinutes={setTotalTimeMinutes}
                  tags={tags}
                  setTags={setTags}
                  allTags={allTags}
                  tagCounts={tagCounts}
                  ingredients={ingredients}
                  instructionGroups={instructionGroups}
                  setInstructionGroups={setInstructionGroups}
                  notes={notes}
                  setNotes={setNotes}
                  categories={categories}
                  onAddIngredient={handleAddIngredient}
                  onRemoveIngredient={handleRemoveIngredient}
                  onIngredientChange={handleIngredientChange}
                  isEditing={true}
                  onReorderIngredients={handleReorderIngredients}
                  onBulkPasteIngredients={handleBulkPasteIngredients}
                  handleAutoFix={handleAutoFix}
                  onRemoveExactDuplicates={handleRemoveExactDuplicates}
                  isWideViewport={isWideViewport}
                  imagePreview={imagePreview}
                  imageUrl={imageUrl}
                  onImageSelect={handleImageSelect}
                  onRemoveImage={handleRemoveImage}
                  fileInputRef={fileInputRef}
                />
              </TabsContent>
              <TabsContent value="instructions" className="mt-0 data-[state=inactive]:hidden">
                <RecipeFormContent
                  editSection="instructions"
                  name={name}
                  setName={setName}
                  category={category}
                  setCategory={setCategory}
                  servings={servings}
                  setServings={setServings}
                  prepTimeMinutes={prepTimeMinutes}
                  setPrepTimeMinutes={setPrepTimeMinutes}
                  cookTimeMinutes={cookTimeMinutes}
                  setCookTimeMinutes={setCookTimeMinutes}
                  totalTimeMinutes={totalTimeMinutes}
                  setTotalTimeMinutes={setTotalTimeMinutes}
                  tags={tags}
                  setTags={setTags}
                  allTags={allTags}
                  tagCounts={tagCounts}
                  ingredients={ingredients}
                  instructionGroups={instructionGroups}
                  setInstructionGroups={setInstructionGroups}
                  notes={notes}
                  setNotes={setNotes}
                  categories={categories}
                  onAddIngredient={handleAddIngredient}
                  onRemoveIngredient={handleRemoveIngredient}
                  onIngredientChange={handleIngredientChange}
                  isEditing={true}
                  onReorderIngredients={handleReorderIngredients}
                  onBulkPasteIngredients={handleBulkPasteIngredients}
                  handleAutoFix={handleAutoFix}
                  onRemoveExactDuplicates={handleRemoveExactDuplicates}
                  isWideViewport={isWideViewport}
                  imagePreview={imagePreview}
                  imageUrl={imageUrl}
                  onImageSelect={handleImageSelect}
                  onRemoveImage={handleRemoveImage}
                  fileInputRef={fileInputRef}
                />
              </TabsContent>
              <TabsContent value="replace" className="mt-0 data-[state=inactive]:hidden">
                <RecipeImportSection
                  variant="replace"
                  showUrlImport={false}
                  currentRecipeName={name}
                  requireInstructions={false}
                  importStep="input"
                  importUrl={importUrl}
                  importText={importText}
                  parseError={parseError}
                  livePreview={livePreview}
                  parsedPreview={null}
                  isImportingFromUrl={false}
                  onImportUrlChange={(value) => {
                    setImportUrl(value)
                    setParseError(null)
                  }}
                  onImportTextChange={(value) => {
                    setImportText(value)
                    setParseError(null)
                    setLivePreview(null)
                    debouncedParse(value)
                  }}
                  onImportUrl={handleUrlImport}
                  onApplyLivePreview={handleApplyReplacementPreview}
                  onBackToInput={handleBackToInput}
                  onApplyPreview={handleApplyPreview}
                />
              </TabsContent>
            </div>
          </Tabs>
        )}

        <DialogFooter
          className={
            isEditing
              ? "sticky bottom-0 z-20 px-4 sm:px-8 py-4 sm:py-6 pb-[max(1rem,env(safe-area-inset-bottom))] bg-muted/85 dark:bg-zinc-900/85 border-t border-stone-200 dark:border-zinc-800 backdrop-blur supports-[backdrop-filter]:bg-muted/70 flex flex-col items-end flex-shrink-0"
              : "px-4 sm:px-8 py-4 sm:py-6 pb-[env(safe-area-inset-bottom)] border-t border-stone-100 dark:border-zinc-900 bg-white/40 dark:bg-black/20 backdrop-blur-md flex flex-col items-end flex-shrink-0"
          }
        >
          <RecipeDialogActions
            isEditing={isEditing}
            isSubmitting={isSubmitting}
            isUploadingImage={isUploadingImage}
            canSubmit={!!name.trim() && !!category && hasValidIngredients && !isSubmitting && (!isEditing || !!editingRecipe)}
            onCancel={() => handleOpenChange(false)}
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
  prepTimeMinutes: number | null
  setPrepTimeMinutes: (value: number | null) => void
  cookTimeMinutes: number | null
  setCookTimeMinutes: (value: number | null) => void
  totalTimeMinutes: number | null
  setTotalTimeMinutes: (value: number | null) => void
  tags: string[]
  setTags: (tags: string[]) => void
  allTags: string[]
  tagCounts?: Array<{ tag: string; count: number }>
  ingredients: Ingredient[]
  instructionGroups: RecipeInstructionGroup[]
  setInstructionGroups: (instructionGroups: RecipeInstructionGroup[]) => void
  notes: string
  setNotes: (notes: string) => void
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
  onBulkPasteIngredients: (index: number, text: string) => void
  handleAutoFix: () => void
  onRemoveExactDuplicates: () => void
  isWideViewport: boolean
  editSection?: "details" | "ingredients" | "instructions"
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
  prepTimeMinutes,
  setPrepTimeMinutes,
  cookTimeMinutes,
  setCookTimeMinutes,
  totalTimeMinutes,
  setTotalTimeMinutes,
  tags,
  setTags,
  allTags,
  tagCounts,
  ingredients,
  instructionGroups,
  setInstructionGroups,
  notes,
  setNotes,
  categories,
  onAddIngredient,
  onRemoveIngredient,
  onIngredientChange,
  isEditing,
  onReorderIngredients,
  onBulkPasteIngredients,
  isWideViewport,
  imagePreview,
  imageUrl,
  onImageSelect,
  onRemoveImage,
  fileInputRef,
  handleAutoFix,
  onRemoveExactDuplicates,
  editSection,
}: RecipeFormContentPropsWithImage) {
  const ingredientIssueCount = countIngredientsWithIssues(ingredients)
  const duplicateAnalysis = analyzeIngredientDuplicates(ingredients)
  const exactDuplicateCount = duplicateAnalysis.exactGroups.reduce(
    (total, group) => total + group.rowIndexes.length - 1,
    0
  )
  const nearDuplicateCount = duplicateAnalysis.nearGroups.reduce(
    (total, group) => total + group.rowIndexes.length - 1,
    0
  )
  const activeEditSection = editSection ?? "details"

  if (isEditing) {
    if (activeEditSection === "details") {
      return (
        <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-6">
            <RecipeImageField
              variant="edit"
              imagePreview={imagePreview}
              imageUrl={imageUrl}
              onImageSelect={onImageSelect}
              onRemoveImage={onRemoveImage}
              fileInputRef={fileInputRef}
            />
          </div>
          <div className="space-y-6">
            <div className="rounded-2xl border border-stone-200 bg-background p-4 dark:border-zinc-800 sm:p-6">
              <RecipeMetadataSection
                variant="edit"
                name={name}
                onNameChange={setName}
                category={category}
                onCategoryChange={setCategory}
                servings={servings}
                onServingsChange={setServings}
                prepTimeMinutes={prepTimeMinutes}
                onPrepTimeMinutesChange={setPrepTimeMinutes}
                cookTimeMinutes={cookTimeMinutes}
                onCookTimeMinutesChange={setCookTimeMinutes}
                totalTimeMinutes={totalTimeMinutes}
                onTotalTimeMinutesChange={setTotalTimeMinutes}
                tags={tags}
                onTagsChange={setTags}
                allTags={allTags}
                tagCounts={tagCounts}
                categories={categories}
              />
            </div>
            <RecipeNotesSection
              variant="edit"
              notes={notes}
              onNotesChange={setNotes}
            />
          </div>
        </div>
      )
    }

    if (activeEditSection === "ingredients") {
      return (
        <div className="mx-auto max-w-5xl">
          <RecipeIngredientsSection
            variant="edit"
            ingredientIssueCount={ingredientIssueCount}
            exactDuplicateCount={exactDuplicateCount}
            nearDuplicateCount={nearDuplicateCount}
            onAutoFix={handleAutoFix}
            onRemoveExactDuplicates={onRemoveExactDuplicates}
            onAddIngredient={onAddIngredient}
          >
            <SortableIngredientList
              ingredients={ingredients}
              editDocumentLayout
              onReorderIngredients={onReorderIngredients}
              onBulkPasteIngredients={onBulkPasteIngredients}
              duplicateWarningsByRow={duplicateAnalysis.rowWarnings}
              onRemoveIngredient={onRemoveIngredient}
              onIngredientChange={onIngredientChange}
            />
          </RecipeIngredientsSection>
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <RecipeInstructionsSection
          variant="edit"
          instructionGroups={instructionGroups}
          onInstructionGroupsChange={setInstructionGroups}
        />
        <RecipeNotesSection
          variant="edit"
          notes={notes}
          onNotesChange={setNotes}
        />
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
          prepTimeMinutes={prepTimeMinutes}
          onPrepTimeMinutesChange={setPrepTimeMinutes}
          cookTimeMinutes={cookTimeMinutes}
          onCookTimeMinutesChange={setCookTimeMinutes}
          totalTimeMinutes={totalTimeMinutes}
          onTotalTimeMinutesChange={setTotalTimeMinutes}
          tags={tags}
          onTagsChange={setTags}
          allTags={allTags}
          tagCounts={tagCounts}
          categories={categories}
        />
      </div>

      {/* Right: lg:col-span-7 - Ingredients, Instructions */}
      <div className="lg:col-span-7 p-4 sm:p-8 space-y-8">
        <RecipeIngredientsSection
          variant="add"
          ingredientIssueCount={ingredientIssueCount}
          exactDuplicateCount={exactDuplicateCount}
          nearDuplicateCount={nearDuplicateCount}
          onAutoFix={handleAutoFix}
          onRemoveExactDuplicates={onRemoveExactDuplicates}
          onAddIngredient={onAddIngredient}
        >
          <SortableIngredientList
            ingredients={ingredients}
            addRecipeModalLayout
            isWideViewport={isWideViewport}
            onReorderIngredients={onReorderIngredients}
            onBulkPasteIngredients={onBulkPasteIngredients}
            duplicateWarningsByRow={duplicateAnalysis.rowWarnings}
            onRemoveIngredient={onRemoveIngredient}
            onIngredientChange={onIngredientChange}
          />
        </RecipeIngredientsSection>

        <RecipeInstructionsSection
          variant="add"
          instructionGroups={instructionGroups}
          onInstructionGroupsChange={setInstructionGroups}
        />
        <RecipeNotesSection
          variant="add"
          notes={notes}
          onNotesChange={setNotes}
        />
      </div>
    </div>
  )
}
