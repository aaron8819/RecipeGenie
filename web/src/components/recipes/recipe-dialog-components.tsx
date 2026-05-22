import React from "react"
import Image from "next/image"
import {
  ArrowLeft,
  Check,
  ChefHat,
  ChevronDown,
  ChevronUp,
  FileText,
  Link,
  List as ListIcon,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Plus,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TagInput } from "@/components/ui/tag-input"
import { Textarea } from "@/components/ui/textarea"
import { clampRecipeServings } from "./recipe-dialog.defaults"
import type { Ingredient, RecipeInstructionGroup } from "@/types/database"
import type { ParsedRecipe } from "@/lib/recipe-parser"
import { getIngredientDisplayUnit } from "@/lib/ingredient-units"
import {
  createEmptyInstructionGroup,
  normalizeInstructionGroupsForEditor,
} from "@/lib/recipe-structure"

type RecipeMobileSectionProps = {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function RecipeMobileSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: RecipeMobileSectionProps) {
  const [open, setOpen] = React.useState(defaultOpen)

  return (
    <section className="rounded-2xl border border-stone-200 bg-background/95 dark:border-zinc-800 dark:bg-zinc-950/70">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <div className="text-sm font-semibold text-primary">{title}</div>
          {summary ? (
            <div className="truncate pt-0.5 text-xs text-muted-foreground">{summary}</div>
          ) : null}
        </div>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="border-t border-stone-200 px-4 py-4 dark:border-zinc-800">{children}</div> : null}
    </section>
  )
}

type RecipeImageFieldProps = {
  variant: "add" | "edit"
  imagePreview?: string | null
  imageUrl?: string | null
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveImage?: () => void
  fileInputRef?: React.RefObject<HTMLInputElement>
  mobileCollapsible?: boolean
}

export function RecipeImageField({
  variant,
  imagePreview,
  imageUrl,
  onImageSelect,
  onRemoveImage,
  fileInputRef,
  mobileCollapsible = false,
}: RecipeImageFieldProps) {
  const hasImage = !!(imagePreview || imageUrl)
  const imageSrc = imagePreview || imageUrl || ""
  const unoptimized = imageUrl ? !imageUrl.includes("supabase.co") : false

  const imageContent = variant === "edit" ? (
    <div className="relative">
      <Label className="mb-2 block text-sm font-semibold text-primary">
        Recipe Image
      </Label>
      {hasImage ? (
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-muted">
          <Image
            src={imageSrc}
            alt="Recipe"
            fill
            className="object-cover"
            unoptimized={unoptimized}
          />
          {onRemoveImage ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute right-2 top-2"
              onClick={onRemoveImage}
              aria-label="Remove image"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : fileInputRef && onImageSelect ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-200 bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-primary dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:bg-zinc-900 aspect-video"
        >
          <Upload className="h-12 w-12 text-stone-300 transition-colors dark:text-zinc-600 sm:h-14 sm:w-14" />
          <span className="mt-2 text-sm font-medium">Upload Image</span>
          <span className="mt-1 text-xs uppercase tracking-wider">
            JPG, PNG, WebP. Max 5MB
          </span>
        </button>
      ) : null}
      {fileInputRef && onImageSelect ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={onImageSelect}
          className="hidden"
        />
      ) : null}
    </div>
  ) : (
    <div className="space-y-3 order-last lg:order-first">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent">
        Recipe Image
      </h3>
      {hasImage ? (
        <div className="relative h-44 w-full overflow-hidden rounded-xl bg-muted">
          <Image
            src={imageSrc}
            alt="Recipe"
            fill
            className="object-cover"
            unoptimized={unoptimized}
          />
          {onRemoveImage ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute right-2 top-2"
              onClick={onRemoveImage}
              aria-label="Remove image"
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : fileInputRef && onImageSelect ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full h-44 rounded-xl border-2 border-dashed border-stone-200 bg-muted/50 transition-all cursor-pointer hover:border-accent dark:border-zinc-800 dark:bg-zinc-900/50 flex flex-col items-center justify-center group/up"
        >
          <div className="mb-2 rounded-full bg-stone-50 p-3 transition-transform group-hover/up:scale-110 dark:bg-zinc-800">
            <Upload className="h-6 w-6 text-stone-400 dark:text-stone-500" />
          </div>
          <p className="text-sm font-semibold text-stone-600 dark:text-stone-300">
            Upload Image
          </p>
          <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
            JPG, PNG, WebP (Max 5MB)
          </p>
        </button>
      ) : null}
      {fileInputRef && onImageSelect ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          onChange={onImageSelect}
          className="hidden"
        />
      ) : null}
    </div>
  )

  if (variant === "edit" && mobileCollapsible) {
    return (
      <RecipeMobileSection
        title="Image"
        summary={hasImage ? "Recipe image added" : "No image"}
      >
        {imageContent}
      </RecipeMobileSection>
    )
  }

  return imageContent
}

type RecipeImportSectionProps = {
  importStep: "input" | "preview"
  importUrl: string
  importText: string
  parseError: string | null
  livePreview: ParsedRecipe | null
  parsedPreview: ParsedRecipe | null
  isImportingFromUrl: boolean
  variant?: "create" | "replace"
  showUrlImport?: boolean
  currentRecipeName?: string
  requireInstructions?: boolean
  onImportUrlChange: (value: string) => void
  onImportTextChange: (value: string) => void
  onImportUrl: () => void
  onApplyLivePreview: () => void
  onBackToInput: () => void
  onApplyPreview: () => void
}

function formatIngredientAmount(ingredient: Ingredient): string {
  const displayUnit = getIngredientDisplayUnit(ingredient.unit)

  return ingredient.amount !== null
    ? `${ingredient.amount} ${displayUnit}`.trim()
    : "-"
}

function formatIngredientText(ingredient: Ingredient): string {
  const alternatives =
    ingredient.alternatives && ingredient.alternatives.length > 0
      ? ` or ${ingredient.alternatives.join(" or ")}`
      : ""
  const modifier = ingredient.modifier ? `, ${ingredient.modifier}` : ""

  return `${ingredient.item}${alternatives}${modifier}`
}

function getIngredientGroups(preview: ParsedRecipe): Array<{
  label?: string
  ingredients: Ingredient[]
}> {
  if (preview.ingredientGroups && preview.ingredientGroups.length > 0) {
    return preview.ingredientGroups
  }

  return preview.ingredients.length > 0
    ? [{ ingredients: preview.ingredients }]
    : []
}

function getInstructionGroups(preview: ParsedRecipe): Array<{
  label?: string
  steps: string[]
}> {
  if (preview.instructionGroups && preview.instructionGroups.length > 0) {
    return preview.instructionGroups
  }

  return preview.instructions.length > 0
    ? [{ steps: preview.instructions }]
    : []
}

function countInstructionSteps(
  groups: Array<{ label?: string; steps: string[] }>
): number {
  return groups.reduce((total, group) => total + group.steps.length, 0)
}

export function RecipeImportSection({
  importStep,
  importUrl,
  importText,
  parseError,
  livePreview,
  parsedPreview,
  isImportingFromUrl,
  variant = "create",
  showUrlImport = true,
  currentRecipeName,
  requireInstructions = true,
  onImportUrlChange,
  onImportTextChange,
  onImportUrl,
  onApplyLivePreview,
  onBackToInput,
  onApplyPreview,
}: RecipeImportSectionProps) {
  const previewRecipe = importStep === "preview" ? parsedPreview : livePreview
  const ingredientGroups = previewRecipe ? getIngredientGroups(previewRecipe) : []
  const instructionGroups = previewRecipe ? getInstructionGroups(previewRecipe) : []
  const instructionStepCount = countInstructionSteps(instructionGroups)
  const notes = previewRecipe?.notes || []
  const isReplacement = variant === "replace"
  const liveIngredientCount = livePreview?.ingredients.length ?? 0
  const liveInstructionCount = livePreview ? instructionStepCount : 0
  const liveWarnings = livePreview?.warnings ?? []
  const hasBlockingLivePreviewWarnings = !!livePreview && (
    liveIngredientCount === 0 ||
    liveWarnings.some((warning) => warning.includes("No ingredients")) ||
    (requireInstructions && (
      liveInstructionCount === 0 ||
      liveWarnings.some((warning) => warning.includes("No instructions"))
    ))
  )
  const applyLivePreviewLabel = isReplacement
    ? "Apply to Current Recipe"
    : "Apply to Form"

  if (importStep === "preview") {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBackToInput} className="mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Edit
        </Button>

        {parsedPreview?.warnings && parsedPreview.warnings.length > 0 ? (
          <div
            className="rounded-lg border border-amber-200 bg-amber-50 p-3"
            role="alert"
            aria-live="polite"
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Parsing Notes
            </div>
            <ul className="space-y-1 text-sm text-amber-700">
              {parsedPreview.warnings.map((warning, index) => (
                <li key={index}>- {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Name
            </div>
            <div className="font-medium">{parsedPreview?.name || "-"}</div>
          </div>

          {parsedPreview?.servings ? (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                Servings
              </div>
              <div>{parsedPreview.servings}</div>
            </div>
          ) : null}

          {parsedPreview?.metadata ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {parsedPreview.metadata.prepTime ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                    Prep Time
                  </div>
                  <div>{parsedPreview.metadata.prepTime}</div>
                </div>
              ) : null}
              {parsedPreview.metadata.cookTime ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                    Cook Time
                  </div>
                  <div>{parsedPreview.metadata.cookTime}</div>
                </div>
              ) : null}
              {parsedPreview.metadata.totalTime ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                    Total Time
                  </div>
                  <div>{parsedPreview.metadata.totalTime}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Ingredients ({parsedPreview?.ingredients?.length || 0})
            </div>
            {ingredientGroups.length > 0 ? (
              <div className="space-y-3 text-sm">
                {ingredientGroups.map((group, groupIndex) => (
                  <div key={`${group.label || "main"}-${groupIndex}`} className="space-y-1">
                    {group.label ? (
                      <div className="font-semibold text-primary">{group.label}</div>
                    ) : null}
                    <ul className="space-y-1">
                      {group.ingredients.map((ingredient, index) => (
                        <li key={`${groupIndex}-${index}`} className="flex gap-2">
                          <span className="text-muted-foreground">
                            {formatIngredientAmount(ingredient)}
                          </span>
                          <span>{formatIngredientText(ingredient)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm italic text-muted-foreground">
                No ingredients found
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Instructions ({instructionStepCount} steps)
            </div>
            {instructionGroups.length > 0 ? (
              <div className="space-y-3 text-sm">
                {instructionGroups.map((group, groupIndex) => (
                  <div key={`${group.label || "main"}-${groupIndex}`} className="space-y-1">
                    {group.label ? (
                      <div className="font-semibold text-primary">{group.label}</div>
                    ) : null}
                    <ol className="list-inside list-decimal space-y-1">
                      {group.steps.map((step, index) => (
                        <li key={`${groupIndex}-${index}`}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm italic text-muted-foreground">
                No instructions found
              </div>
            )}
          </div>

          {notes.length > 0 ? (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                Notes ({notes.length})
              </div>
              <ul className="space-y-1 text-sm">
                {notes.map((note, index) => (
                  <li key={index}>- {note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <Button onClick={onApplyPreview} className="w-full">
          <Check className="mr-2 h-4 w-4" />
          {isReplacement ? "Apply to Current Recipe" : "Apply & Edit Recipe"}
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        {isReplacement ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Replace current recipe draft
            </div>
            <p>
              Pasted text will replace parsed fields for
              {currentRecipeName ? ` "${currentRecipeName}"` : " this recipe"}.
              Existing tags, category, notes, and image stay unless the pasted
              recipe includes supported replacement data.
            </p>
          </div>
        ) : null}

        {showUrlImport ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="import-url">Import from URL</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="import-url"
                    value={importUrl}
                    onChange={(e) => onImportUrlChange(e.target.value)}
                    placeholder="https://www.example.com/recipe..."
                    className="pl-9 font-mono text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        onImportUrl()
                      }
                    }}
                  />
                </div>
                <Button
                  onClick={onImportUrl}
                  disabled={isImportingFromUrl}
                  className="shrink-0"
                >
                  {isImportingFromUrl ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    "Import"
                  )}
                </Button>
              </div>
            </div>

            <div className="relative flex items-center gap-4 py-1">
              <div className="flex-1 border-t border-stone-200 dark:border-zinc-800" />
              <span className="text-xs font-medium text-muted-foreground">
                or paste text
              </span>
              <div className="flex-1 border-t border-stone-200 dark:border-zinc-800" />
            </div>
          </>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={isReplacement ? "replace-text" : "import-text"}>
            {isReplacement ? "Paste Updated Recipe Text" : "Paste Recipe Text"}
          </Label>
          <Textarea
            id={isReplacement ? "replace-text" : "import-text"}
            value={importText}
            onChange={(e) => onImportTextChange(e.target.value)}
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
1. Preheat oven to 375 F
2. Mix flour and baking soda in a bowl
3. Cream butter and sugar until fluffy
4. Add eggs and mix well
5. Gradually add flour mixture
6. Stir in chocolate chips
7. Drop rounded tablespoons onto baking sheet
8. Bake for 9-11 minutes`}
            rows={20}
            className="min-h-[520px] resize-y font-mono text-sm"
          />
          {parseError ? (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-live="assertive"
            >
              {parseError}
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        <Label className="text-sm font-semibold">Live Preview</Label>

        {livePreview ? (
          <div className="h-full space-y-6 rounded-xl border border-border bg-muted/30 p-6">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recipe Name
              </div>
              <div className="font-serif text-2xl font-medium text-primary">
                {livePreview.name}
              </div>
              {livePreview.servings ? (
                <div className="mt-1 text-sm text-muted-foreground">
                  Serves {livePreview.servings}
                </div>
              ) : null}
              {livePreview.metadata ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {livePreview.metadata.prepTime ? (
                    <span className="rounded-full bg-background/70 px-2.5 py-1">
                      Prep {livePreview.metadata.prepTime}
                    </span>
                  ) : null}
                  {livePreview.metadata.cookTime ? (
                    <span className="rounded-full bg-background/70 px-2.5 py-1">
                      Cook {livePreview.metadata.cookTime}
                    </span>
                  ) : null}
                  {livePreview.metadata.totalTime ? (
                    <span className="rounded-full bg-background/70 px-2.5 py-1">
                      Total {livePreview.metadata.totalTime}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <ChefHat className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-lg font-bold">
                    {livePreview.ingredients.length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ingredient{livePreview.ingredients.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                  <ListIcon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <div className="text-lg font-bold">
                    {instructionStepCount}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    step{instructionStepCount !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
            </div>

            {livePreview.warnings.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  Parsing Notes
                </div>
                <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
                  {livePreview.warnings.slice(0, 4).map((warning, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="mt-0.5 text-amber-500">*</span>
                      <span>{warning}</span>
                    </li>
                  ))}
                  {livePreview.warnings.length > 4 ? (
                    <li className="text-xs italic text-amber-600">
                      +{livePreview.warnings.length - 4} more warning
                      {livePreview.warnings.length - 4 !== 1 ? "s" : ""}
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {isReplacement && livePreview && liveInstructionCount === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                No instructions were parsed. You can still apply the ingredient
                replacement, but the current instructions will be preserved.
              </div>
            ) : null}

            {livePreview.ingredients.length > 0 ? (
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ingredients Preview
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-background/50 p-3 text-sm">
                  {ingredientGroups.slice(0, 3).map((group, groupIndex) => (
                    <div key={`${group.label || "main"}-${groupIndex}`} className="space-y-2">
                      {group.label ? (
                        <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                          {group.label}
                        </div>
                      ) : null}
                      {group.ingredients.slice(0, 4).map((ingredient, index) => (
                        <div key={`${groupIndex}-${index}`} className="flex items-start gap-3">
                          <span className="mt-0.5 min-w-[70px] flex-shrink-0 text-right font-mono text-xs text-muted-foreground">
                            {formatIngredientAmount(ingredient)}
                          </span>
                          <span className="flex-1">{formatIngredientText(ingredient)}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {livePreview.instructions.length > 0 ? (
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Instructions Preview
                </div>
                <div className="max-h-32 space-y-2 overflow-y-auto rounded-lg bg-background/50 p-3 text-sm">
                  {instructionGroups.slice(0, 2).map((group, groupIndex) => (
                    <div key={`${group.label || "main"}-${groupIndex}`} className="space-y-2">
                      {group.label ? (
                        <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                          {group.label}
                        </div>
                      ) : null}
                      {group.steps.slice(0, 2).map((step, index) => (
                        <div key={`${groupIndex}-${index}`} className="flex items-start gap-2">
                          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                            {index + 1}
                          </span>
                          <span className="flex-1 leading-relaxed">
                            {step.length > 100 ? `${step.substring(0, 100)}...` : step}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {livePreview.notes && livePreview.notes.length > 0 ? (
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Notes Preview
                </div>
                <div className="rounded-lg bg-background/50 p-3 text-sm">
                  <ul className="space-y-1">
                    {livePreview.notes.slice(0, 3).map((note, index) => (
                      <li key={index}>- {note}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}

            <Button
              type="button"
              onClick={onApplyLivePreview}
              className="w-full"
              size="lg"
              disabled={!livePreview || hasBlockingLivePreviewWarnings}
            >
              <Check className="mr-2 h-4 w-4" />
              {applyLivePreviewLabel}
            </Button>
            {isReplacement ? (
              <p className="text-center text-xs text-muted-foreground">
                Review the draft, then use Save Changes to overwrite this recipe.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full min-h-[500px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/20 bg-muted/10 p-12 text-center">
            <FileText className="mb-4 h-16 w-16 text-muted-foreground/30" />
            <p className="mb-1 text-sm font-medium text-muted-foreground">
              Paste recipe text to see live preview
            </p>
            <p className="max-w-[280px] text-xs text-muted-foreground/70">
              Your recipe will be parsed in real-time as you type
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

type RecipeMetadataSectionProps = {
  variant: "add" | "edit"
  name: string
  onNameChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
  servings: number
  onServingsChange: (value: number) => void
  prepTimeMinutes: number | null
  onPrepTimeMinutesChange: (value: number | null) => void
  cookTimeMinutes: number | null
  onCookTimeMinutesChange: (value: number | null) => void
  totalTimeMinutes: number | null
  onTotalTimeMinutesChange: (value: number | null) => void
  tags: string[]
  onTagsChange: (value: string[]) => void
  allTags: string[]
  tagCounts?: Array<{ tag: string; count: number }>
  categories: string[]
  showTags?: boolean
}

export function RecipeMetadataSection({
  variant,
  name,
  onNameChange,
  category,
  onCategoryChange,
  servings,
  onServingsChange,
  prepTimeMinutes,
  onPrepTimeMinutesChange,
  cookTimeMinutes,
  onCookTimeMinutesChange,
  totalTimeMinutes,
  onTotalTimeMinutesChange,
  tags,
  onTagsChange,
  allTags,
  tagCounts,
  categories,
  showTags = true,
}: RecipeMetadataSectionProps) {
  const addLabelClass =
    "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"
  const nameInputId = variant === "edit" ? "name-edit" : "name-add"
  const servingsInputId = variant === "edit" ? "servings-edit" : "servings-add"
  const renderTimeInput = (
    id: string,
    label: string,
    value: number | null,
    onChange: (value: number | null) => void,
    inputClassName: string
  ) => (
    <div>
      <Label htmlFor={id} className="block text-sm font-semibold text-primary mb-2">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={value ?? ""}
        onChange={(e) => {
          const nextValue = e.target.value.trim()
          if (!nextValue) {
            onChange(null)
            return
          }

          const parsedValue = Number.parseInt(nextValue, 10)
          onChange(Number.isNaN(parsedValue) || parsedValue < 0 ? null : parsedValue)
        }}
        placeholder="Optional"
        className={inputClassName}
      />
    </div>
  )

  if (variant === "edit") {
    return (
      <div className="space-y-4">
        <div>
          <Label
            htmlFor={nameInputId}
            className="block text-sm font-semibold text-primary mb-2"
          >
            Recipe Name
          </Label>
          <Input
            id={nameInputId}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Enter recipe name"
            className="w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary focus:border-primary py-3"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="block text-sm font-semibold text-primary mb-2">
              Category
            </Label>
            <Select value={category} onValueChange={onCategoryChange}>
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
            <Label htmlFor={servingsInputId} className="block text-sm font-semibold text-primary mb-2">
              Servings
            </Label>
            <Input
              id={servingsInputId}
              type="number"
              min={1}
              max={100}
              value={servings}
              onChange={(e) => {
                const val = parseInt(e.target.value)
                if (isNaN(val)) onServingsChange(1)
                else onServingsChange(clampRecipeServings(val))
              }}
              className="w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary py-3"
            />
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-muted/30 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Time
          </div>
          <div className="grid grid-cols-3 gap-2">
            {renderTimeInput(
              "prep-time-edit",
              "Prep",
              prepTimeMinutes,
              onPrepTimeMinutesChange,
              "w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary px-3 py-2.5 text-sm"
            )}
            {renderTimeInput(
              "cook-time-edit",
              "Cook",
              cookTimeMinutes,
              onCookTimeMinutesChange,
              "w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary px-3 py-2.5 text-sm"
            )}
            {renderTimeInput(
              "total-time-edit",
              "Total",
              totalTimeMinutes,
              onTotalTimeMinutesChange,
              "w-full bg-background border-stone-200 dark:border-zinc-800 rounded-xl focus:ring-primary px-3 py-2.5 text-sm"
            )}
          </div>
        </div>
        {showTags ? (
          <div>
            <Label className="block text-sm font-semibold text-primary mb-2">
              Tags
            </Label>
            <TagInput
              value={tags}
              onChange={onTagsChange}
              suggestions={allTags}
              tagCounts={tagCounts}
              placeholder="Add another tag..."
              showAddIconInInput
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className={addLabelClass}>Recipe Name</label>
        <Input
          id={nameInputId}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Grandma's Roast Chicken"
          className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-primary"
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className={addLabelClass}>Category</label>
          <Select value={category} onValueChange={onCategoryChange}>
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
          <label htmlFor={servingsInputId} className={addLabelClass}>Servings</label>
          <Input
            id={servingsInputId}
            type="number"
            min={1}
            max={100}
            value={servings}
            onChange={(e) => {
              const val = parseInt(e.target.value)
              if (isNaN(val)) onServingsChange(1)
              else onServingsChange(clampRecipeServings(val))
            }}
            className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label htmlFor="prep-time-add" className={addLabelClass}>Prep (min)</label>
          <Input
            id="prep-time-add"
            type="number"
            min={0}
            value={prepTimeMinutes ?? ""}
            onChange={(e) => {
              const nextValue = e.target.value.trim()
              if (!nextValue) {
                onPrepTimeMinutesChange(null)
                return
              }

              const parsedValue = Number.parseInt(nextValue, 10)
              onPrepTimeMinutesChange(Number.isNaN(parsedValue) || parsedValue < 0 ? null : parsedValue)
            }}
            placeholder="Optional"
            className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="cook-time-add" className={addLabelClass}>Cook (min)</label>
          <Input
            id="cook-time-add"
            type="number"
            min={0}
            value={cookTimeMinutes ?? ""}
            onChange={(e) => {
              const nextValue = e.target.value.trim()
              if (!nextValue) {
                onCookTimeMinutesChange(null)
                return
              }

              const parsedValue = Number.parseInt(nextValue, 10)
              onCookTimeMinutesChange(Number.isNaN(parsedValue) || parsedValue < 0 ? null : parsedValue)
            }}
            placeholder="Optional"
            className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="total-time-add" className={addLabelClass}>Total (min)</label>
          <Input
            id="total-time-add"
            type="number"
            min={0}
            value={totalTimeMinutes ?? ""}
            onChange={(e) => {
              const nextValue = e.target.value.trim()
              if (!nextValue) {
                onTotalTimeMinutesChange(null)
                return
              }

              const parsedValue = Number.parseInt(nextValue, 10)
              onTotalTimeMinutesChange(Number.isNaN(parsedValue) || parsedValue < 0 ? null : parsedValue)
            }}
            placeholder="Optional"
            className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className={addLabelClass}>Tags</label>
        <TagInput
          value={tags}
          onChange={onTagsChange}
          suggestions={allTags}
          tagCounts={tagCounts}
          placeholder="Add tag..."
          showAddIconInInput
        />
      </div>
    </div>
  )
}

type RecipeTagsSectionProps = {
  variant: "add" | "edit"
  tags: string[]
  onTagsChange: (value: string[]) => void
  allTags: string[]
  tagCounts?: Array<{ tag: string; count: number }>
  mobileCollapsible?: boolean
}

export function RecipeTagsSection({
  variant,
  tags,
  onTagsChange,
  allTags,
  tagCounts,
  mobileCollapsible = false,
}: RecipeTagsSectionProps) {
  const summary = tags.length === 0 ? "No tags" : `${tags.length} tag${tags.length === 1 ? "" : "s"}: ${tags.slice(0, 2).join(", ")}${tags.length > 2 ? "..." : ""}`
  const content = (
    <div>
      <Label className="mb-2 block text-sm font-semibold text-primary">
        Tags
      </Label>
      <TagInput
        value={tags}
        onChange={onTagsChange}
        suggestions={allTags}
        tagCounts={tagCounts}
        placeholder={variant === "edit" ? "Add another tag..." : "Add tag..."}
        showAddIconInInput
      />
    </div>
  )

  if (variant === "edit" && mobileCollapsible) {
    return (
      <RecipeMobileSection title="Tags" summary={summary}>
        {content}
      </RecipeMobileSection>
    )
  }

  return content
}

type RecipeNotesSectionProps = {
  variant: "add" | "edit"
  notes: string
  onNotesChange: (value: string) => void
  mobileCollapsible?: boolean
}

export function RecipeNotesSection({
  variant,
  notes,
  onNotesChange,
  mobileCollapsible = false,
}: RecipeNotesSectionProps) {
  const addLabelClass =
    "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"
  const notesId = variant === "edit" ? "notes-edit" : "notes-add"

  if (variant === "edit") {
    const content = (
      <div className="flex flex-col">
        <Label
          htmlFor={notesId}
          className="block text-sm font-semibold text-primary mb-2"
        >
          Notes
        </Label>
        <Textarea
          id={notesId}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="One note per line..."
          className="min-h-[140px] w-full rounded-2xl bg-background border-stone-200 dark:border-zinc-800 focus:ring-primary focus:border-primary resize-none leading-relaxed px-5 py-4"
        />
      </div>
    )

    if (mobileCollapsible) {
      const noteCount = notes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length
      return (
        <RecipeMobileSection
          title="Notes"
          summary={noteCount > 0 ? `${noteCount} note${noteCount === 1 ? "" : "s"} added` : "No notes"}
        >
          {content}
        </RecipeMobileSection>
      )
    }

    return (
      content
    )
  }

  return (
    <div className="space-y-4">
      <label htmlFor={notesId} className={`${addLabelClass} block`}>
        Notes
      </label>
      <Textarea
        id={notesId}
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="One note per line..."
        className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-4 text-sm min-h-[140px] resize-none focus:ring-2 focus:ring-primary"
      />
    </div>
  )
}

type RecipeIngredientsSectionProps = {
  variant: "add" | "edit"
  ingredientIssueCount?: number
  exactDuplicateCount?: number
  nearDuplicateCount?: number
  onAutoFix?: () => void
  onRemoveExactDuplicates?: () => void
  onAddIngredient: () => void
  children: React.ReactNode
}

export function RecipeIngredientsSection({
  variant,
  ingredientIssueCount = 0,
  exactDuplicateCount = 0,
  nearDuplicateCount = 0,
  onAutoFix,
  onRemoveExactDuplicates,
  onAddIngredient,
  children,
}: RecipeIngredientsSectionProps) {
  const addLabelClass =
    "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"

  if (variant === "edit") {
    return (
      <div>
        <Label className="text-sm font-semibold text-primary mb-4 block">
          Ingredients
        </Label>

        {ingredientIssueCount > 0 ? (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-amber-900 dark:text-amber-200 text-sm mb-1">
                  Ingredient Validation Issues
                </div>
                <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
                  {ingredientIssueCount} ingredient(s) need attention. Check
                  highlighted fields.
                </p>
                {onAutoFix ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onAutoFix}
                    className="text-xs h-7"
                  >
                    <Wand2 className="h-3 w-3 mr-1.5" />
                    Attempt Auto-Fix
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {exactDuplicateCount > 0 || nearDuplicateCount > 0 ? (
          <div className="mb-4 rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-stone-600 dark:text-stone-300" />
              <div className="flex-1">
                <div className="mb-1 text-sm font-semibold text-foreground">
                  Possible duplicate ingredients
                </div>
                <p className="text-xs text-muted-foreground">
                  {exactDuplicateCount > 0
                    ? `${exactDuplicateCount} exact duplicate row(s)`
                    : "No exact duplicate rows"}
                  {nearDuplicateCount > 0
                    ? ` and ${nearDuplicateCount} possible near-duplicate row(s)`
                    : ""}
                  . Review highlighted rows before saving.
                </p>
                {exactDuplicateCount > 0 && onRemoveExactDuplicates ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRemoveExactDuplicates}
                    className="mt-2 h-7 text-xs"
                  >
                    Remove Exact Duplicates
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {children}
        <button
          type="button"
          onClick={onAddIngredient}
          className="mt-3 text-xs font-bold text-primary flex items-center hover:opacity-80 transition-opacity"
        >
          <Plus className="h-4 w-4 mr-1" />
          ADD INGREDIENT
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className={addLabelClass}>Ingredients</h3>
        <p className="text-xs text-muted-foreground">
          Enter one ingredient per row. You can paste full lines like `1 cup flour`
          or paste multiple lines into an ingredient field to fill several rows.
        </p>
      </div>
      {ingredientIssueCount > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="flex-1">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {ingredientIssueCount} ingredient(s) need attention. Highlighted rows
                may not save cleanly downstream.
              </p>
              {onAutoFix ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAutoFix}
                  className="mt-2 h-7 text-xs"
                >
                  <Wand2 className="mr-1.5 h-3 w-3" />
                  Attempt Auto-Fix
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {exactDuplicateCount > 0 || nearDuplicateCount > 0 ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-stone-600 dark:text-stone-300" />
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">
                {exactDuplicateCount > 0
                  ? `${exactDuplicateCount} exact duplicate row(s)`
                  : "No exact duplicate rows"}
                {nearDuplicateCount > 0
                  ? ` and ${nearDuplicateCount} possible near-duplicate row(s)`
                  : ""}
                . Highlighted rows may describe the same ingredient twice.
              </p>
              {exactDuplicateCount > 0 && onRemoveExactDuplicates ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRemoveExactDuplicates}
                  className="mt-2 h-7 text-xs"
                >
                  Remove Exact Duplicates
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {children}
      <button
        type="button"
        onClick={onAddIngredient}
        className="mt-3 text-[10px] font-bold uppercase text-accent hover:text-primary transition-colors flex items-center gap-1 min-h-[44px] px-4 border border-dashed border-accent rounded-lg w-full justify-center"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Row
      </button>
    </div>
  )
}

type RecipeInstructionsSectionProps = {
  variant: "add" | "edit"
  instructionGroups: RecipeInstructionGroup[]
  onInstructionGroupsChange: (groups: RecipeInstructionGroup[]) => void
}

export function RecipeInstructionsSection({
  variant,
  instructionGroups,
  onInstructionGroupsChange,
}: RecipeInstructionsSectionProps) {
  const addLabelClass =
    "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"
  const groups = normalizeInstructionGroupsForEditor(instructionGroups)

  const updateGroups = (nextGroups: RecipeInstructionGroup[]) => {
    onInstructionGroupsChange(nextGroups)
  }

  const updateGroup = (
    groupIndex: number,
    updater: (group: RecipeInstructionGroup) => RecipeInstructionGroup
  ) => {
    updateGroups(
      groups.map((group, index) => (index === groupIndex ? updater(group) : group))
    )
  }

  const moveGroup = (groupIndex: number, direction: -1 | 1) => {
    const nextIndex = groupIndex + direction
    if (nextIndex < 0 || nextIndex >= groups.length) {
      return
    }

    const nextGroups = [...groups]
    const [group] = nextGroups.splice(groupIndex, 1)
    nextGroups.splice(nextIndex, 0, group)
    updateGroups(nextGroups)
  }

  const removeGroup = (groupIndex: number) => {
    const nextGroups = groups.filter((_, index) => index !== groupIndex)
    updateGroups(nextGroups.length > 0 ? nextGroups : [createEmptyInstructionGroup()])
  }

  const addGroup = () => {
    updateGroups([...groups, createEmptyInstructionGroup()])
  }

  const addStep = (groupIndex: number) => {
    updateGroup(groupIndex, (group) => ({
      ...group,
      steps: [...group.steps, ""],
    }))
  }

  const removeStep = (groupIndex: number, stepIndex: number) => {
    updateGroup(groupIndex, (group) => {
      const nextSteps = group.steps.filter((_, index) => index !== stepIndex)
      return {
        ...group,
        steps: nextSteps.length > 0 ? nextSteps : [""],
      }
    })
  }

  const moveStep = (groupIndex: number, stepIndex: number, direction: -1 | 1) => {
    updateGroup(groupIndex, (group) => {
      const nextIndex = stepIndex + direction
      if (nextIndex < 0 || nextIndex >= group.steps.length) {
        return group
      }

      const nextSteps = [...group.steps]
      const [step] = nextSteps.splice(stepIndex, 1)
      nextSteps.splice(nextIndex, 0, step)
      return {
        ...group,
        steps: nextSteps,
      }
    })
  }

  return (
    <div className={variant === "edit" ? "flex-1 flex flex-col min-h-0" : "space-y-4"}>
      {variant === "edit" ? (
        <Label className="block text-sm font-semibold text-primary mb-2">
          Instructions
        </Label>
      ) : (
        <label className={`${addLabelClass} block`}>
          Instructions
        </label>
      )}
      <p className={variant === "edit" ? "mb-4 text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>
        Keep notes separate. Leave the main method unlabeled, or add labels for subsections like sauces or toppings.
      </p>
      <div className="space-y-4">
        {groups.map((group, groupIndex) => (
          <div
            key={`instruction-group-${groupIndex}`}
            className={
              variant === "edit"
                ? "rounded-2xl border border-stone-200 bg-background p-4 dark:border-zinc-800"
                : "rounded-xl border border-stone-100 bg-background p-4 dark:border-zinc-800"
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Input
                aria-label={`Instruction group ${groupIndex + 1} label`}
                value={group.label ?? ""}
                onChange={(event) =>
                  updateGroup(groupIndex, (currentGroup) => ({
                    ...currentGroup,
                    label: event.target.value,
                  }))
                }
                placeholder={groupIndex === 0 ? "Optional section label" : "Optional group label"}
                className="min-w-[13rem] flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => moveGroup(groupIndex, -1)}
                disabled={groupIndex === 0}
                aria-label={`Move instruction group ${groupIndex + 1} up`}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => moveGroup(groupIndex, 1)}
                disabled={groupIndex === groups.length - 1}
                aria-label={`Move instruction group ${groupIndex + 1} down`}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeGroup(groupIndex)}
                aria-label={`Remove instruction group ${groupIndex + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3">
              {group.steps.map((step, stepIndex) => (
                <div
                  key={`instruction-group-${groupIndex}-step-${stepIndex}`}
                  className="flex items-start gap-2"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                    {stepIndex + 1}
                  </span>
                  <Textarea
                    aria-label={`Instruction group ${groupIndex + 1} step ${stepIndex + 1}`}
                    value={step}
                    onChange={(event) =>
                      updateGroup(groupIndex, (currentGroup) => ({
                        ...currentGroup,
                        steps: currentGroup.steps.map((currentStep, currentStepIndex) =>
                          currentStepIndex === stepIndex ? event.target.value : currentStep
                        ),
                      }))
                    }
                    placeholder={stepIndex === 0 ? "Describe the step..." : "Describe this step..."}
                    className="min-h-[88px] flex-1 resize-none"
                  />
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => moveStep(groupIndex, stepIndex, -1)}
                      disabled={stepIndex === 0}
                      aria-label={`Move step ${stepIndex + 1} up in group ${groupIndex + 1}`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => moveStep(groupIndex, stepIndex, 1)}
                      disabled={stepIndex === group.steps.length - 1}
                      aria-label={`Move step ${stepIndex + 1} down in group ${groupIndex + 1}`}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => removeStep(groupIndex, stepIndex)}
                      aria-label={`Remove step ${stepIndex + 1} from group ${groupIndex + 1}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addStep(groupIndex)}
              className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary transition-opacity hover:opacity-80"
            >
              <Plus className="h-3.5 w-3.5" />
              Add step
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addGroup}
        className={
          variant === "edit"
            ? "mt-4 inline-flex items-center gap-1 text-xs font-bold text-primary transition-opacity hover:opacity-80"
            : "inline-flex min-h-[44px] w-full items-center justify-center gap-1 rounded-lg border border-dashed border-accent px-4 text-[10px] font-bold uppercase text-accent transition-colors hover:text-primary"
        }
      >
        <Plus className="h-3.5 w-3.5" />
        Add group
      </button>
    </div>
  )
}

type RecipeDialogActionsProps = {
  isEditing: boolean
  isSubmitting: boolean
  isUploadingImage: boolean
  canSubmit: boolean
  onCancel: () => void
  onSubmit: () => void
}

export function RecipeDialogActions({
  isEditing,
  isSubmitting,
  isUploadingImage,
  canSubmit,
  onCancel,
  onSubmit,
}: RecipeDialogActionsProps) {
  return (
    <div className="flex gap-3">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={!canSubmit}>
        {isSubmitting
          ? isUploadingImage
            ? "Uploading image..."
            : "Saving..."
          : isEditing
            ? "Save Changes"
            : "Add Recipe"}
      </Button>
    </div>
  )
}
