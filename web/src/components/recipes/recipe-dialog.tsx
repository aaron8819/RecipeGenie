"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { FileText, PenTool, Plus, Trash2, X } from "lucide-react"
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
import { useIsDesktop } from "@/hooks/use-is-desktop"
import { parseIngredientLine, type ParsedRecipe } from "@/lib/recipe-parser"
import { useImportRecipeFromUrl } from "@/hooks/use-recipe-import"
import type {
  Recipe,
  Ingredient,
  IngredientSection,
  RecipeInstructionGroup,
} from "@/types/database"
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
  updateRecipeIngredientAlternatives,
  updateRecipeIngredientField,
} from "./recipe-dialog.defaults"
import { ingredientSectionsToEditorIngredients } from "@/lib/recipe-structure"
import {
  addIngredientSection,
  addIngredientToSection,
  addUnsectionedIngredient,
  isIngredientSectionEmpty,
  moveIngredientToSection,
  removeEmptyIngredientSection,
  removeIngredientFromSection,
  renameIngredientSection,
  reorderIngredientsWithinSection,
} from "@/lib/recipe-ingredient-editor"
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
} from "./recipe-dialog.validation"
import {
  canReviewImportedRecipe,
  getInvalidImportReviewSection,
  isImportWorkDirty,
  mapImportWarningToSection,
  shouldConfirmCandidateReplacement,
  type ImportReviewSection,
} from "./recipe-import-review"

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
  const isDesktop = useIsDesktop()
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [servings, setServings] = useState(4)
  const [yieldText, setYieldText] = useState("4 servings")
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<number | null>(null)
  const [cookTimeMinutes, setCookTimeMinutes] = useState<number | null>(null)
  const [totalTimeMinutes, setTotalTimeMinutes] = useState<number | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [ingredientSections, setIngredientSections] = useState<
    IngredientSection[]
  >([])
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
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const submitInFlightRef = useRef(false)
  const confirmationGuardRef = useRef(false)
  const rawSourceRef = useRef("")
  const importUrlRef = useRef("")
  const [isSubmitLocked, setIsSubmitLocked] = useState(false)
  
  // Import state
  const [rawSource, setRawSource] = useState("")
  const [importUrl, setImportUrl] = useState("")
  const [parseError, setParseError] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<'input' | 'preview'>('input')
  const [parsedPreview, setParsedPreview] = useState<ParsedRecipe | null>(null)
  const [parsedCandidate, setParsedCandidate] = useState<ParsedRecipe | null>(null)
  const [parsedCandidateKey, setParsedCandidateKey] = useState<string | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [mobileImportPhase, setMobileImportPhase] = useState<'input' | 'review'>('input')
  const [reviewSection, setReviewSection] = useState<ImportReviewSection>('details')
  const [appliedDraftSnapshot, setAppliedDraftSnapshot] = useState<
    ReturnType<typeof buildNewRecipeDialogFormValues> | null
  >(null)
  const [appliedRawSource, setAppliedRawSource] = useState<string | null>(null)
  const [appliedCandidateKey, setAppliedCandidateKey] = useState<string | null>(null)
  const [showReplacementConfirm, setShowReplacementConfirm] = useState(false)
  const importFromUrl = useImportRecipeFromUrl()

  const { data: allTags = [] } = useAllTags()
  const { data: tagCounts = [] } = useTagsWithCounts()

  const applyFormValues = useCallback((formValues: ReturnType<typeof buildNewRecipeDialogFormValues>) => {
    setName(formValues.name)
    setCategory(formValues.category)
    setServings(formValues.servings)
    setYieldText(formValues.yieldText ?? `${formValues.servings} servings`)
    setPrepTimeMinutes(formValues.prepTimeMinutes)
    setCookTimeMinutes(formValues.cookTimeMinutes)
    setTotalTimeMinutes(formValues.totalTimeMinutes)
    setTags(formValues.tags)
    setIngredientSections(formValues.ingredientSections)
    setInstructionGroups(formValues.instructionGroups)
    setNotes(formValues.notes)
    setImageUrl(formValues.imageUrl)
    setImageFile(null)
    setImagePreview(null)
    setMode("manual")
    setEditTab("details")
    setRawSource("")
    rawSourceRef.current = ""
    setImportUrl("")
    importUrlRef.current = ""
    setParseError(null)
    setImportStep('input')
    setParsedPreview(null)
    setParsedCandidate(null)
    setParsedCandidateKey(null)
    setIsParsing(false)
    setMobileImportPhase('input')
    setReviewSection('details')
    setAppliedDraftSnapshot(null)
    setAppliedRawSource(null)
    setAppliedCandidateKey(null)
    setShowReplacementConfirm(false)
    setIsSubmitLocked(false)
    submitInFlightRef.current = false
    confirmationGuardRef.current = false
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
          yieldText,
          tags,
          prepTimeMinutes,
          cookTimeMinutes,
          totalTimeMinutes,
          ingredientSections,
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
    yieldText,
    tags,
    prepTimeMinutes,
    cookTimeMinutes,
    totalTimeMinutes,
    ingredientSections,
    instructionGroups,
    notes,
    imagePreview,
    imageUrl,
  ])

  const ingredients = ingredientSectionsToEditorIngredients(ingredientSections)

  const updateIngredientSection = useCallback((
    sectionIndex: number,
    updater: (section: IngredientSection) => IngredientSection
  ) => {
    setIngredientSections((current) =>
      current.map((section, index) =>
        index === sectionIndex ? updater(section) : section
      )
    )
  }, [])

  const handleAddIngredient = (sectionIndex: number) => {
    setIngredientSections((current) =>
      addIngredientToSection(current, sectionIndex)
    )
  }

  const handleAddUnsectionedIngredient = () => {
    setIngredientSections(addUnsectionedIngredient)
  }

  const handleAddIngredientSection = () => {
    setIngredientSections(addIngredientSection)
  }

  const handleRemoveIngredient = (sectionIndex: number, index: number) => {
    setIngredientSections((current) =>
      removeIngredientFromSection(current, sectionIndex, index)
    )
  }

  const handleIngredientChange = (
    sectionIndex: number,
    index: number,
    field: keyof Ingredient,
    value: string | number | null
  ) => {
    updateIngredientSection(sectionIndex, (section) => ({
      ...section,
      ingredients: section.ingredients.map((ingredient, itemIndex) =>
        itemIndex === index
          ? updateRecipeIngredientField(ingredient, field, value)
          : ingredient
      ),
    }))
  }

  const handleIngredientAlternativesChange = (
    sectionIndex: number,
    index: number,
    alternatives: string[]
  ) => {
    updateIngredientSection(sectionIndex, (section) => ({
      ...section,
      ingredients: section.ingredients.map((ingredient, itemIndex) =>
        itemIndex === index
          ? updateRecipeIngredientAlternatives(ingredient, alternatives)
          : ingredient
      ),
    }))
  }

  const handleIngredientParsed = useCallback((
    sectionIndex: number,
    index: number,
    parsed: Ingredient
  ) => {
    updateIngredientSection(sectionIndex, (section) => {
      const [normalized] = normalizeRecipeIngredientsForEditing([parsed])
      return {
        ...section,
        ingredients: section.ingredients.map((ingredient, itemIndex) =>
          itemIndex === index && normalized ? normalized : ingredient
        ),
      }
    })
  }, [updateIngredientSection])

  const handleReorderIngredients = useCallback((
    sectionIndex: number,
    event: DragEndEvent
  ) => {
    const { active, over } = event

    if (over && active.id !== over.id) {
      setIngredientSections((current) => {
        const section = current[sectionIndex]
        if (!section) return current
        const oldIndex = section.ingredients.findIndex(
          (_, index) => index.toString() === active.id
        )
        const newIndex = section.ingredients.findIndex(
          (_, index) => index.toString() === over.id
        )
        if (oldIndex < 0 || newIndex < 0) return current

        return reorderIngredientsWithinSection(
          current,
          sectionIndex,
          oldIndex,
          newIndex
        )
      })
    }
  }, [])

  const handleBulkPasteIngredients = useCallback((
    sectionIndex: number,
    startIndex: number,
    text: string
  ) => {
    const parsedLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseIngredientLine(line))
      .filter((ingredient) => ingredient.item)

    if (parsedLines.length === 0) {
      return
    }

    updateIngredientSection(sectionIndex, (section) => {
      const nextIngredients = [...section.ingredients]

      while (nextIngredients.length < startIndex + parsedLines.length) {
        nextIngredients.push({ item: "", amount: null, unit: "" })
      }

      parsedLines.forEach((ingredient, offset) => {
        nextIngredients[startIndex + offset] = {
          ...nextIngredients[startIndex + offset],
          ...ingredient,
        }
      })

      return {
        ...section,
        ingredients: normalizeRecipeIngredientsForEditing(nextIngredients),
      }
    })
  }, [updateIngredientSection])

  const handleIngredientSectionLabelChange = (
    sectionIndex: number,
    label: string
  ) => {
    setIngredientSections((current) =>
      renameIngredientSection(current, sectionIndex, label)
    )
  }

  const handleRemoveIngredientSection = (sectionIndex: number) => {
    const section = ingredientSections[sectionIndex]
    if (section && !isIngredientSectionEmpty(section)) {
      undoToast.show({
        message: "Move or delete this section's ingredients first.",
        duration: 4000,
      })
      return
    }

    setIngredientSections((current) =>
      removeEmptyIngredientSection(current, sectionIndex)
    )
  }

  const handleMoveIngredient = (
    sourceSectionIndex: number,
    ingredientIndex: number,
    targetSectionIndex: number | null
  ) => {
    setIngredientSections((current) =>
      moveIngredientToSection(
        current,
        sourceSectionIndex,
        ingredientIndex,
        targetSectionIndex
      )
    )
  }

  // Debounced live preview parser
  const debouncedParse = useDebouncedCallback(((text: string) => {
    if (text !== rawSourceRef.current) return
    setParsedCandidate(parseRecipeImportPreview(text))
    setParsedCandidateKey(`text:${text}`)
    setIsParsing(false)
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
      if (validateRecipeImportUrl(importUrlRef.current).normalizedUrl !== validation.normalizedUrl) {
        return
      }
      const importedCandidate = toParsedRecipeImport(result)
      if (isDesktop) {
        setParsedPreview(importedCandidate)
        setImportStep('preview')
      } else {
        setParsedCandidate(importedCandidate)
        setParsedCandidateKey(`url:${validation.normalizedUrl}`)
      }
      // Store the extracted image URL for later
      if (result.imageUrl) {
        setImageUrl(result.imageUrl)
      }
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
        yieldText,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        tags,
        ingredientSections,
        instructionGroups,
        notes,
        imageUrl,
      },
      preview,
      { applyCategory: !isEditing, categories }
    )

    setName(formValues.name)
    setCategory(formValues.category)
    setServings(formValues.servings)
    setYieldText(formValues.yieldText ?? `${formValues.servings} servings`)
    setPrepTimeMinutes(formValues.prepTimeMinutes)
    setCookTimeMinutes(formValues.cookTimeMinutes)
    setTotalTimeMinutes(formValues.totalTimeMinutes)
    setIngredientSections(formValues.ingredientSections)
    setInstructionGroups(formValues.instructionGroups)
    setNotes(formValues.notes)
    return formValues
  }, [
    name,
    category,
    servings,
    yieldText,
    prepTimeMinutes,
    cookTimeMinutes,
    totalTimeMinutes,
    tags,
    ingredientSections,
    instructionGroups,
    notes,
    imageUrl,
    isEditing,
    categories,
  ])

  const currentDraft = {
    name,
    category,
    servings,
    yieldText,
    prepTimeMinutes,
    cookTimeMinutes,
    totalTimeMinutes,
    tags,
    ingredientSections,
    instructionGroups,
    notes,
    imageUrl,
  }
  const draftCorrected = !!appliedDraftSnapshot && isEditingRecipeDialogDirty(
    appliedDraftSnapshot,
    { ...currentDraft, imageReference: imagePreview ?? imageUrl }
  )
  const applyCandidateForReview = () => {
    if (!parsedCandidate || !parsedCandidateKey || !canReviewImportedRecipe(parsedCandidate)) return
    const appliedDraft = applyPreviewToCurrentForm(parsedCandidate)
    setAppliedDraftSnapshot(appliedDraft)
    setAppliedRawSource(rawSource)
    setAppliedCandidateKey(parsedCandidateKey)
    if (isDesktop) {
      setMode('manual')
    } else {
      setMobileImportPhase('review')
      setReviewSection('details')
    }
  }

  const handleReviewCandidate = () => {
    if (!parsedCandidate || !parsedCandidateKey || !canReviewImportedRecipe(parsedCandidate)) return

    if (appliedCandidateKey === parsedCandidateKey && appliedDraftSnapshot) {
      if (isDesktop) setMode('manual')
      else setMobileImportPhase('review')
      return
    }

    if (shouldConfirmCandidateReplacement({
      appliedRawSource: appliedCandidateKey,
      nextRawSource: parsedCandidateKey,
      draftCorrected,
    })) {
      confirmationGuardRef.current = true
      setShowReplacementConfirm(true)
      return
    }

    applyCandidateForReview()
  }

  const handleApplyPreview = () => {
    if (!parsedPreview) return
    const appliedDraft = applyPreviewToCurrentForm(parsedPreview)
    setAppliedDraftSnapshot(appliedDraft)
    setAppliedRawSource(rawSource)
    setAppliedCandidateKey(parsedCandidateKey)

    // Switch to manual mode to allow editing
    setMode("manual")
    setEditTab("ingredients")
    setImportStep('input')
    setParsedPreview(null)
  }

  const handleApplyReplacementPreview = () => {
    if (!parsedCandidate) return
    applyPreviewToCurrentForm(parsedCandidate)
    setEditTab("ingredients")
  }

  const handleBackToInput = () => {
    setImportStep('input')
    setParsedPreview(null)
  }

  // Handle auto-fix for validation issues
  const handleAutoFix = useCallback(() => {
    const result = autoFixIngredients(ingredients)
    let offset = 0
    setIngredientSections((current) =>
      current.map((section) => {
        const nextIngredients = result.ingredients.slice(
          offset,
          offset + section.ingredients.length
        )
        offset += section.ingredients.length
        return { ...section, ingredients: nextIngredients }
      })
    )

    if (result.fixedCount > 0) {
      undoToast.show({
        message: `Auto-fixed ${result.fixedCount} ingredient(s)`,
        duration: 3000
      })
    }
  }, [ingredients, undoToast])

  const handleRemoveExactDuplicates = useCallback(() => {
    const duplicateIndexes = new Set(
      analyzeIngredientDuplicates(ingredients).exactGroups.flatMap((group) =>
        group.rowIndexes.slice(1)
      )
    )
    if (duplicateIndexes.size === 0) {
      return
    }

    let globalIndex = 0
    setIngredientSections((current) =>
      current.map((section) => ({
        ...section,
        ingredients: section.ingredients.filter(() => {
          const shouldKeep = !duplicateIndexes.has(globalIndex)
          globalIndex += 1
          return shouldKeep
        }),
      }))
    )
    undoToast.show({
      message: `Removed ${duplicateIndexes.size} exact duplicate ingredient row(s)`,
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
    if (submitInFlightRef.current) return

    // P3: Validate ingredients before submitting (only blocking issues)
    const blockingIssuesCount = countBlockingIngredientIssues(ingredients)

    if (!isDesktop && mobileImportPhase === 'review' && !isEditing) {
      const invalidSection = getInvalidImportReviewSection({
        name,
        category,
        ingredients,
        instructionGroups,
        blockingIngredientIssues: blockingIssuesCount,
      })

      if (invalidSection) {
        setReviewSection(invalidSection)
        undoToast.show({
          message: `Review the ${invalidSection} section before saving.`,
          duration: 5000,
        })
        return
      }
    }

    if (blockingIssuesCount > 0) {
      if (!isDesktop && mobileImportPhase === 'review') {
        setReviewSection('ingredients')
      }
      undoToast.show({
        message: `${blockingIssuesCount} ingredient(s) have critical issues. Please fix them before saving.`,
        duration: 5000
      })
      document.querySelector('[data-has-issues="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    submitInFlightRef.current = true
    setIsSubmitLocked(true)
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
        yieldText,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        tags,
        ingredientSections,
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
    } finally {
      submitInFlightRef.current = false
      setIsSubmitLocked(false)
    }
  }

  const isSubmitting = isSubmitLocked || createRecipe.isPending || updateRecipe.isPending || isUploadingImage

  // Check if there's at least one valid ingredient
  const hasValidIngredients = hasValidRecipeIngredients(ingredientSections)

  const dialogTitle = isEditing ? "Edit Recipe" : "Add Recipe"

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const initialEditingFormValues = editingRecipe
    ? buildEditingRecipeDialogFormValues(editingRecipe)
    : null
  const hasDirtyForm = isEditing
    ? !!initialEditingFormValues && isEditingRecipeDialogDirty(initialEditingFormValues, {
        name,
        category,
        servings,
        yieldText,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        tags,
        ingredientSections,
        instructionGroups,
        notes,
        imageUrl,
        imageReference: imagePreview ?? imageUrl,
      })
    : isNewRecipeDialogDirty({
        name,
        defaultCategory: categories[0] || "",
        category,
        yieldText,
        tags,
        prepTimeMinutes,
        cookTimeMinutes,
        totalTimeMinutes,
        ingredientSections,
        instructionGroups,
        notes,
        imageReference: imagePreview ?? imageUrl,
      })
  const isDirty = hasDirtyForm || (!isEditing && isImportWorkDirty({
    rawSource,
    importUrl,
    hasParsedCandidate: parsedCandidate !== null,
    hasAppliedCandidate: appliedRawSource !== null,
  }))
  const isMobileImportInput = !isDesktop && !isEditing && mode === 'import' &&
    mobileImportPhase === 'input'
  const isMobileImportReview = !isDesktop && !isEditing && mode === 'import' &&
    mobileImportPhase === 'review'
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && confirmationGuardRef.current) {
      return
    }
    if (!nextOpen && isDirty) {
      confirmationGuardRef.current = true
      setShowDiscardConfirm(true)
      return
    }
    onOpenChange(nextOpen)
  }

  const handleKeepEditing = () => {
    setShowDiscardConfirm(false)
    window.setTimeout(() => {
      confirmationGuardRef.current = false
      closeButtonRef.current?.focus()
    }, 0)
  }

  const handleKeepCurrentDraft = () => {
    setShowReplacementConfirm(false)
    window.setTimeout(() => {
      confirmationGuardRef.current = false
    }, 0)
  }

  const handleConfirmationOpenChange = (
    setOpen: (open: boolean) => void,
    nextOpen: boolean
  ) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      window.setTimeout(() => {
        confirmationGuardRef.current = false
      }, 0)
    }
  }

  return (
    <>
    <AlertDialog
      open={showDiscardConfirm}
      onOpenChange={(nextOpen) => handleConfirmationOpenChange(setShowDiscardConfirm, nextOpen)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
          <AlertDialogDescription>
            You have unsaved changes that will be lost. Are you sure you want to discard them?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleKeepEditing}>Keep editing</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            confirmationGuardRef.current = false
            setShowDiscardConfirm(false)
            onOpenChange(false)
          }}>
            Discard
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog
      open={showReplacementConfirm}
      onOpenChange={(nextOpen) => handleConfirmationOpenChange(setShowReplacementConfirm, nextOpen)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace your draft corrections?</AlertDialogTitle>
          <AlertDialogDescription>
            Applying the reparsed source will replace the corrections you made in the current draft.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleKeepCurrentDraft}>
            Keep current draft
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            setShowReplacementConfirm(false)
            applyCandidateForReview()
            window.setTimeout(() => {
              confirmationGuardRef.current = false
            }, 0)
          }}>
            Replace corrections
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        hideCloseButton
        className={
          isEditing || isMobileImportReview
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
                ref={closeButtonRef}
                type="button"
                className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>
          </div>
        )}

        {isMobileImportReview && (
          <div className="sticky top-0 z-20 flex flex-shrink-0 items-center justify-between border-b border-stone-200 bg-card/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur dark:border-zinc-800">
            <div>
              <h1 className="text-lg font-bold text-primary">Review imported recipe</h1>
              <p className="text-xs text-muted-foreground">Edit each section before saving.</p>
            </div>
            <DialogClose asChild>
              <button
                ref={closeButtonRef}
                type="button"
                className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </DialogClose>
          </div>
        )}

        {!isEditing && !isMobileImportReview && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as "manual" | "import")} className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 sm:px-8 pt-4 sm:pt-6 pb-3 sm:pb-4 flex justify-between items-center border-b border-stone-100 dark:border-zinc-900 flex-shrink-0 gap-2">
              <TabsList className="flex w-fit rounded-full p-1 bg-stone-100 dark:bg-zinc-900 gap-0 min-w-0">
                <TabsTrigger
                  value="manual"
                  className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-1.5 rounded-full text-xs font-bold data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary data-[state=inactive]:text-stone-500 dark:data-[state=inactive]:text-stone-400 transition-all"
                >
                  <PenTool className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                  <span>{isDesktop ? "Manual Entry" : "Manual"}</span>
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
                  ref={closeButtonRef}
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
                importText={rawSource}
                parseError={parseError}
                livePreview={parsedCandidate}
                parsedPreview={parsedPreview}
                isImportingFromUrl={importFromUrl.isPending}
                compactMobile={!isDesktop}
                isParsing={isParsing}
                onImportUrlChange={(value) => {
                  importUrlRef.current = value
                  setImportUrl(value)
                  setParseError(null)
                  if (parsedCandidateKey?.startsWith('url:')) {
                    setParsedCandidate(null)
                    setParsedCandidateKey(null)
                  }
                }}
                onImportTextChange={(value) => {
                  rawSourceRef.current = value
                  setRawSource(value)
                  setParseError(null)
                  setParsedCandidate(null)
                  setParsedCandidateKey(null)
                  setIsParsing(!!value.trim())
                  if (value.trim()) {
                    debouncedParse(value)
                  } else {
                    setIsParsing(false)
                  }
                }}
                onImportUrl={handleUrlImport}
                onApplyLivePreview={() => {
                  if (!parsedCandidate) return
                  handleReviewCandidate()
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
                yieldText={yieldText}
                setYieldText={setYieldText}
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
                ingredientSections={ingredientSections}
                instructionGroups={instructionGroups}
                setInstructionGroups={setInstructionGroups}
                notes={notes}
                setNotes={setNotes}
                categories={categories}
                onAddIngredient={handleAddIngredient}
                onAddUnsectionedIngredient={handleAddUnsectionedIngredient}
                onAddIngredientSection={handleAddIngredientSection}
                onIngredientSectionLabelChange={handleIngredientSectionLabelChange}
                onRemoveIngredientSection={handleRemoveIngredientSection}
                onMoveIngredient={handleMoveIngredient}
                onRemoveIngredient={handleRemoveIngredient}
                onIngredientChange={handleIngredientChange}
                onIngredientAlternativesChange={handleIngredientAlternativesChange}
                onIngredientParsed={handleIngredientParsed}
                isEditing={false}
                onReorderIngredients={handleReorderIngredients}
                onBulkPasteIngredients={handleBulkPasteIngredients}
                handleAutoFix={handleAutoFix}
                onRemoveExactDuplicates={handleRemoveExactDuplicates}
                isWideViewport={isDesktop}
                imagePreview={imagePreview}
                imageUrl={imageUrl}
                onImageSelect={handleImageSelect}
                onRemoveImage={handleRemoveImage}
                fileInputRef={fileInputRef}
              />
            </TabsContent>
          </Tabs>
        )}

        {isMobileImportReview && (
          <Tabs
            value={reviewSection}
            onValueChange={(value) => setReviewSection(value as ImportReviewSection)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-shrink-0 border-b border-stone-200 bg-card px-3 py-2 dark:border-zinc-800">
              <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl bg-muted p-1">
                <TabsTrigger value="details" className="rounded-lg text-xs font-semibold">Details</TabsTrigger>
                <TabsTrigger value="ingredients" className="rounded-lg text-xs font-semibold">Ingredients</TabsTrigger>
                <TabsTrigger value="instructions" className="rounded-lg text-xs font-semibold">Instructions</TabsTrigger>
              </TabsList>
              {parsedCandidate?.warnings.length ? (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Import warnings">
                  {parsedCandidate.warnings.map((warning, index) => (
                    <button
                      key={`${warning}-${index}`}
                      type="button"
                      onClick={() => setReviewSection(mapImportWarningToSection(warning))}
                      className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300"
                    >
                      {warning}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scrollbar-recipe-dialog"
              data-testid="import-review-scroller"
            >
              <RecipeFormContent
                editSection={reviewSection}
                name={name}
                setName={setName}
                category={category}
                setCategory={setCategory}
                servings={servings}
                setServings={setServings}
                yieldText={yieldText}
                setYieldText={setYieldText}
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
                ingredientSections={ingredientSections}
                instructionGroups={instructionGroups}
                setInstructionGroups={setInstructionGroups}
                notes={notes}
                setNotes={setNotes}
                categories={categories}
                onAddIngredient={handleAddIngredient}
                onAddUnsectionedIngredient={handleAddUnsectionedIngredient}
                onAddIngredientSection={handleAddIngredientSection}
                onIngredientSectionLabelChange={handleIngredientSectionLabelChange}
                onRemoveIngredientSection={handleRemoveIngredientSection}
                onMoveIngredient={handleMoveIngredient}
                onRemoveIngredient={handleRemoveIngredient}
                onIngredientChange={handleIngredientChange}
                onIngredientAlternativesChange={handleIngredientAlternativesChange}
                onIngredientParsed={handleIngredientParsed}
                isEditing={true}
                onReorderIngredients={handleReorderIngredients}
                onBulkPasteIngredients={handleBulkPasteIngredients}
                handleAutoFix={handleAutoFix}
                onRemoveExactDuplicates={handleRemoveExactDuplicates}
                isWideViewport={false}
                imagePreview={imagePreview}
                imageUrl={imageUrl}
                onImageSelect={handleImageSelect}
                onRemoveImage={handleRemoveImage}
                fileInputRef={fileInputRef}
              />
            </div>
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
                  yieldText={yieldText}
                  setYieldText={setYieldText}
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
                  ingredientSections={ingredientSections}
                  instructionGroups={instructionGroups}
                  setInstructionGroups={setInstructionGroups}
                  notes={notes}
                  setNotes={setNotes}
                  categories={categories}
                  onAddIngredient={handleAddIngredient}
                  onAddUnsectionedIngredient={handleAddUnsectionedIngredient}
                  onAddIngredientSection={handleAddIngredientSection}
                  onIngredientSectionLabelChange={handleIngredientSectionLabelChange}
                  onRemoveIngredientSection={handleRemoveIngredientSection}
                  onMoveIngredient={handleMoveIngredient}
                  onRemoveIngredient={handleRemoveIngredient}
                  onIngredientChange={handleIngredientChange}
                  onIngredientAlternativesChange={handleIngredientAlternativesChange}
                  onIngredientParsed={handleIngredientParsed}
                  isEditing={true}
                  onReorderIngredients={handleReorderIngredients}
                  onBulkPasteIngredients={handleBulkPasteIngredients}
                  handleAutoFix={handleAutoFix}
                  onRemoveExactDuplicates={handleRemoveExactDuplicates}
                  isWideViewport={isDesktop}
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
                  yieldText={yieldText}
                  setYieldText={setYieldText}
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
                  ingredientSections={ingredientSections}
                  instructionGroups={instructionGroups}
                  setInstructionGroups={setInstructionGroups}
                  notes={notes}
                  setNotes={setNotes}
                  categories={categories}
                  onAddIngredient={handleAddIngredient}
                  onAddUnsectionedIngredient={handleAddUnsectionedIngredient}
                  onAddIngredientSection={handleAddIngredientSection}
                  onIngredientSectionLabelChange={handleIngredientSectionLabelChange}
                  onRemoveIngredientSection={handleRemoveIngredientSection}
                  onMoveIngredient={handleMoveIngredient}
                  onRemoveIngredient={handleRemoveIngredient}
                  onIngredientChange={handleIngredientChange}
                  onIngredientAlternativesChange={handleIngredientAlternativesChange}
                  onIngredientParsed={handleIngredientParsed}
                  isEditing={true}
                  onReorderIngredients={handleReorderIngredients}
                  onBulkPasteIngredients={handleBulkPasteIngredients}
                  handleAutoFix={handleAutoFix}
                  onRemoveExactDuplicates={handleRemoveExactDuplicates}
                  isWideViewport={isDesktop}
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
                  yieldText={yieldText}
                  setYieldText={setYieldText}
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
                  ingredientSections={ingredientSections}
                  instructionGroups={instructionGroups}
                  setInstructionGroups={setInstructionGroups}
                  notes={notes}
                  setNotes={setNotes}
                  categories={categories}
                  onAddIngredient={handleAddIngredient}
                  onAddUnsectionedIngredient={handleAddUnsectionedIngredient}
                  onAddIngredientSection={handleAddIngredientSection}
                  onIngredientSectionLabelChange={handleIngredientSectionLabelChange}
                  onRemoveIngredientSection={handleRemoveIngredientSection}
                  onMoveIngredient={handleMoveIngredient}
                  onRemoveIngredient={handleRemoveIngredient}
                  onIngredientChange={handleIngredientChange}
                  onIngredientAlternativesChange={handleIngredientAlternativesChange}
                  onIngredientParsed={handleIngredientParsed}
                  isEditing={true}
                  onReorderIngredients={handleReorderIngredients}
                  onBulkPasteIngredients={handleBulkPasteIngredients}
                  handleAutoFix={handleAutoFix}
                  onRemoveExactDuplicates={handleRemoveExactDuplicates}
                  isWideViewport={isDesktop}
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
                  importText={rawSource}
                  parseError={parseError}
                  livePreview={parsedCandidate}
                  parsedPreview={null}
                  isImportingFromUrl={false}
                  onImportUrlChange={(value) => {
                    importUrlRef.current = value
                    setImportUrl(value)
                    setParseError(null)
                    if (parsedCandidateKey?.startsWith('url:')) {
                      setParsedCandidate(null)
                      setParsedCandidateKey(null)
                    }
                  }}
                  onImportTextChange={(value) => {
                    rawSourceRef.current = value
                    setRawSource(value)
                    setParseError(null)
                    setParsedCandidate(null)
                    setParsedCandidateKey(null)
                    setIsParsing(!!value.trim())
                    if (value.trim()) debouncedParse(value)
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

        {(isEditing || mode === 'manual' || isMobileImportInput || isMobileImportReview) && (
          <DialogFooter
          className={
            isEditing || isMobileImportReview
              ? "sticky bottom-0 z-20 px-4 sm:px-8 py-4 sm:py-6 pb-[max(1rem,env(safe-area-inset-bottom))] bg-muted/85 dark:bg-zinc-900/85 border-t border-stone-200 dark:border-zinc-800 backdrop-blur supports-[backdrop-filter]:bg-muted/70 flex flex-col items-end flex-shrink-0"
              : "px-4 sm:px-8 py-4 sm:py-6 pb-[env(safe-area-inset-bottom)] border-t border-stone-100 dark:border-zinc-900 bg-white/40 dark:bg-black/20 backdrop-blur-md flex flex-col items-end flex-shrink-0"
          }
        >
          {isMobileImportInput ? (
            <Button
              type="button"
              onClick={handleReviewCandidate}
              disabled={!canReviewImportedRecipe(parsedCandidate) || isParsing}
              className="w-full"
              size="lg"
            >
              Review imported recipe
            </Button>
          ) : isMobileImportReview ? (
            <div className="flex w-full gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMobileImportPhase('input')}
                className="flex-1"
              >
                Back to imported text
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!name.trim() || !category || !hasValidIngredients || isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? 'Saving…' : 'Save Recipe'}
              </Button>
            </div>
          ) : (
            <RecipeDialogActions
              isEditing={isEditing}
              isSubmitting={isSubmitting}
              isUploadingImage={isUploadingImage}
              canSubmit={!!name.trim() && !!category && hasValidIngredients && !isSubmitting && (!isEditing || !!editingRecipe)}
              onCancel={() => handleOpenChange(false)}
              onSubmit={handleSubmit}
            />
          )}
          {!isMobileImportInput && !hasValidIngredients && !isSubmitting && (
            <p className="text-xs text-muted-foreground text-right mt-1">
              Add at least one ingredient to save
            </p>
          )}
          </DialogFooter>
        )}
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
  yieldText: string
  setYieldText: (yieldText: string) => void
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
  ingredientSections: IngredientSection[]
  instructionGroups: RecipeInstructionGroup[]
  setInstructionGroups: (instructionGroups: RecipeInstructionGroup[]) => void
  notes: string
  setNotes: (notes: string) => void
  categories: string[]
  onAddIngredient: (sectionIndex: number) => void
  onAddUnsectionedIngredient: () => void
  onAddIngredientSection: () => void
  onIngredientSectionLabelChange: (sectionIndex: number, label: string) => void
  onRemoveIngredientSection: (sectionIndex: number) => void
  onMoveIngredient: (
    sourceSectionIndex: number,
    ingredientIndex: number,
    targetSectionIndex: number | null
  ) => void
  onRemoveIngredient: (sectionIndex: number, index: number) => void
  onIngredientChange: (
    sectionIndex: number,
    index: number,
    field: keyof Ingredient,
    value: string | number | null
  ) => void
  onIngredientAlternativesChange: (
    sectionIndex: number,
    index: number,
    alternatives: string[]
  ) => void
  onIngredientParsed: (
    sectionIndex: number,
    index: number,
    ingredient: Ingredient
  ) => void
  isEditing: boolean
  onReorderIngredients: (sectionIndex: number, event: DragEndEvent) => void
  onBulkPasteIngredients: (
    sectionIndex: number,
    index: number,
    text: string
  ) => void
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
  fileInputRef?: React.RefObject<HTMLInputElement | null>
}

function RecipeFormContent({
  name,
  setName,
  category,
  setCategory,
  servings,
  setServings,
  yieldText,
  setYieldText,
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
  ingredientSections,
  instructionGroups,
  setInstructionGroups,
  notes,
  setNotes,
  categories,
  onAddIngredient,
  onAddUnsectionedIngredient,
  onAddIngredientSection,
  onIngredientSectionLabelChange,
  onRemoveIngredientSection,
  onMoveIngredient,
  onRemoveIngredient,
  onIngredientChange,
  onIngredientAlternativesChange,
  onIngredientParsed,
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
  const ingredients = ingredientSectionsToEditorIngredients(ingredientSections)
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
  const ingredientSectionOptions = ingredientSections.map((section, index) => ({
    value: index,
    label: getIngredientSectionOptionLabel(ingredientSections, index),
  }))
  const hasUnsectionedSection = ingredientSections.some(
    (section) => section.label === null
  )
  const ingredientEditor = (
    <div className="space-y-5" data-testid="ingredient-sections-editor">
      {ingredientSections.map((section, sectionIndex) => {
        const ingredientOffset = ingredientSections
          .slice(0, sectionIndex)
          .reduce((total, current) => total + current.ingredients.length, 0)
        const duplicateWarningsByRow = Object.fromEntries(
          Object.entries(duplicateAnalysis.rowWarnings)
            .map(([globalIndex, warnings]) => [Number(globalIndex), warnings] as const)
            .filter(([globalIndex]) =>
              globalIndex >= ingredientOffset &&
              globalIndex < ingredientOffset + section.ingredients.length
            )
            .map(([globalIndex, warnings]) => [
              globalIndex - ingredientOffset,
              warnings,
            ])
        )

        return (
          <section
            key={`ingredient-section-${sectionIndex}`}
            className="rounded-2xl border border-stone-200 bg-muted/20 p-3 dark:border-zinc-800 sm:p-4"
            aria-label={`Ingredient section ${sectionIndex + 1}`}
          >
            <div className="mb-3 flex items-center gap-2">
              <Input
                aria-label={`Ingredient section ${sectionIndex + 1} label`}
                value={section.label ?? ""}
                onChange={(event) =>
                  onIngredientSectionLabelChange(
                    sectionIndex,
                    event.target.value
                  )
                }
                placeholder="Unsectioned"
                className="min-w-0 flex-1 font-semibold"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemoveIngredientSection(sectionIndex)}
                aria-label={`Delete ingredient section ${sectionIndex + 1}`}
                title="Delete this section when it is empty"
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {section.ingredients.length > 0 ? (
              <SortableIngredientList
                ingredients={section.ingredients}
                editDocumentLayout={isEditing}
                addRecipeModalLayout={!isEditing}
                isWideViewport={isWideViewport}
                onReorderIngredients={(event) =>
                  onReorderIngredients(sectionIndex, event)
                }
                onBulkPasteIngredients={(index, text) =>
                  onBulkPasteIngredients(sectionIndex, index, text)
                }
                duplicateWarningsByRow={duplicateWarningsByRow}
                onRemoveIngredient={(index) =>
                  onRemoveIngredient(sectionIndex, index)
                }
                onIngredientChange={(index, field, value) =>
                  onIngredientChange(sectionIndex, index, field, value)
                }
                onIngredientAlternativesChange={(index, alternatives) =>
                  onIngredientAlternativesChange(
                    sectionIndex,
                    index,
                    alternatives
                  )
                }
                onIngredientParsed={(index, ingredient) =>
                  onIngredientParsed(sectionIndex, index, ingredient)
                }
                currentSectionIndex={sectionIndex}
                sectionOptions={ingredientSectionOptions}
                includeNewUnsectionedOption={!hasUnsectionedSection}
                onMoveIngredient={(index, targetSectionIndex) =>
                  onMoveIngredient(
                    sectionIndex,
                    index,
                    targetSectionIndex
                  )
                }
              />
            ) : (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No ingredients in this section.
              </p>
            )}

            <button
              type="button"
              onClick={() => onAddIngredient(sectionIndex)}
              className="mt-3 inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
            >
              <Plus className="h-3.5 w-3.5" />
              Add ingredient
            </button>
          </section>
        )
      })}
    </div>
  )

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
                yieldText={yieldText}
                onYieldTextChange={setYieldText}
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
            onAddIngredient={onAddUnsectionedIngredient}
            onAddSection={onAddIngredientSection}
          >
            {ingredientEditor}
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
          yieldText={yieldText}
          onYieldTextChange={setYieldText}
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
          onAddIngredient={onAddUnsectionedIngredient}
          onAddSection={onAddIngredientSection}
        >
          {ingredientEditor}
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

function getIngredientSectionOptionLabel(
  sections: IngredientSection[],
  sectionIndex: number
): string {
  const baseLabel = sections[sectionIndex].label?.trim() || "Unsectioned"
  const matchingIndexes = sections
    .map((section, index) => ({
      index,
      label: section.label?.trim() || "Unsectioned",
    }))
    .filter(({ label }) => label === baseLabel)
    .map(({ index }) => index)

  if (matchingIndexes.length === 1) return baseLabel
  return `${baseLabel} (${matchingIndexes.indexOf(sectionIndex) + 1})`
}
