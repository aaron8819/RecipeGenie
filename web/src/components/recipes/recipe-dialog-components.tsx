import React from "react"
import Image from "next/image"
import {
  ArrowLeft,
  Check,
  ChefHat,
  FileText,
  Link,
  List as ListIcon,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Plus,
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
import type { Ingredient } from "@/types/database"
import type { ParsedRecipe } from "@/lib/recipe-parser"

type RecipeImageFieldProps = {
  variant: "add" | "edit"
  imagePreview?: string | null
  imageUrl?: string | null
  onImageSelect?: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRemoveImage?: () => void
  fileInputRef?: React.RefObject<HTMLInputElement>
}

export function RecipeImageField({
  variant,
  imagePreview,
  imageUrl,
  onImageSelect,
  onRemoveImage,
  fileInputRef,
}: RecipeImageFieldProps) {
  const hasImage = !!(imagePreview || imageUrl)
  const imageSrc = imagePreview || imageUrl || ""
  const unoptimized = imageUrl ? !imageUrl.includes("supabase.co") : false

  if (variant === "edit") {
    return (
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
            className="w-full aspect-video rounded-2xl border-2 border-dashed border-stone-200 bg-muted/50 text-muted-foreground transition-colors hover:bg-muted hover:text-primary dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:bg-zinc-900 flex flex-col items-center justify-center group/up"
          >
            <Upload className="h-12 w-12 text-stone-300 transition-colors group-hover/up:text-primary dark:text-zinc-600 sm:h-14 sm:w-14" />
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
    )
  }

  return (
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
}

type RecipeImportSectionProps = {
  importStep: "input" | "preview"
  importUrl: string
  importText: string
  parseError: string | null
  livePreview: ParsedRecipe | null
  parsedPreview: ParsedRecipe | null
  isImportingFromUrl: boolean
  onImportUrlChange: (value: string) => void
  onImportTextChange: (value: string) => void
  onImportUrl: () => void
  onApplyLivePreview: () => void
  onBackToInput: () => void
  onApplyPreview: () => void
}

export function RecipeImportSection({
  importStep,
  importUrl,
  importText,
  parseError,
  livePreview,
  parsedPreview,
  isImportingFromUrl,
  onImportUrlChange,
  onImportTextChange,
  onImportUrl,
  onApplyLivePreview,
  onBackToInput,
  onApplyPreview,
}: RecipeImportSectionProps) {
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

          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Ingredients ({parsedPreview?.ingredients?.length || 0})
            </div>
            {parsedPreview?.ingredients && parsedPreview.ingredients.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {parsedPreview.ingredients.map((ingredient, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-muted-foreground">
                      {ingredient.amount
                        ? `${ingredient.amount} ${ingredient.unit || ""}`.trim()
                        : "-"}
                    </span>
                    <span>
                      {ingredient.item}
                      {ingredient.modifier ? (
                        <span className="text-muted-foreground">
                          , {ingredient.modifier}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm italic text-muted-foreground">
                No ingredients found
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
              Instructions ({parsedPreview?.instructions?.length || 0} steps)
            </div>
            {parsedPreview?.instructions && parsedPreview.instructions.length > 0 ? (
              <ol className="list-inside list-decimal space-y-1 text-sm">
                {parsedPreview.instructions.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            ) : (
              <div className="text-sm italic text-muted-foreground">
                No instructions found
              </div>
            )}
          </div>
        </div>

        <Button onClick={onApplyPreview} className="w-full">
          <Check className="mr-2 h-4 w-4" />
          Apply & Edit Recipe
        </Button>
      </div>
    )
  }

  const hasBlockingLivePreviewWarnings = !!livePreview?.warnings.some(
    (warning) =>
      warning.includes("No ingredients") || warning.includes("No instructions")
  )

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
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

        <div className="space-y-2">
          <Label htmlFor="import-text">Paste Recipe Text</Label>
          <Textarea
            id="import-text"
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
            className="resize-none font-mono text-sm"
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
                    {livePreview.instructions.length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    step{livePreview.instructions.length !== 1 ? "s" : ""}
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

            {livePreview.ingredients.length > 0 ? (
              <div>
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Ingredients Preview
                </div>
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg bg-background/50 p-3 text-sm">
                  {livePreview.ingredients.slice(0, 8).map((ingredient, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <span className="mt-0.5 min-w-[70px] flex-shrink-0 text-right font-mono text-xs text-muted-foreground">
                        {ingredient.amount !== null
                          ? `${ingredient.amount} ${ingredient.unit}`.trim()
                          : "-"}
                      </span>
                      <span className="flex-1">
                        {ingredient.item}
                        {ingredient.modifier ? (
                          <span className="text-xs text-muted-foreground">
                            , {ingredient.modifier}
                          </span>
                        ) : null}
                      </span>
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
                  {livePreview.instructions.slice(0, 3).map((step, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span className="flex-1 leading-relaxed">
                        {step.length > 100 ? `${step.substring(0, 100)}...` : step}
                      </span>
                    </div>
                  ))}
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
              Apply to Form
            </Button>
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
  tags: string[]
  onTagsChange: (value: string[]) => void
  allTags: string[]
  tagCounts?: Array<{ tag: string; count: number }>
  categories: string[]
}

export function RecipeMetadataSection({
  variant,
  name,
  onNameChange,
  category,
  onCategoryChange,
  servings,
  onServingsChange,
  tags,
  onTagsChange,
  allTags,
  tagCounts,
  categories,
}: RecipeMetadataSectionProps) {
  const addLabelClass =
    "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"
  const nameInputId = variant === "edit" ? "name-edit" : "name-add"

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
            <Label className="block text-sm font-semibold text-primary mb-2">
              Servings
            </Label>
            <Input
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
          <label className={addLabelClass}>Servings</label>
          <Input
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
  instructions: string
  onInstructionsChange: (value: string) => void
}

export function RecipeInstructionsSection({
  variant,
  instructions,
  onInstructionsChange,
}: RecipeInstructionsSectionProps) {
  const addLabelClass =
    "text-[10px] font-bold uppercase tracking-widest text-primary dark:text-accent"
  const instructionsId = variant === "edit" ? "instructions-edit" : "instructions-add"

  if (variant === "edit") {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <Label
          htmlFor={instructionsId}
          className="block text-sm font-semibold text-primary mb-2"
        >
          Instructions
        </Label>
        <Textarea
          id={instructionsId}
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          placeholder="Step by step process..."
          className="flex-1 min-h-[180px] sm:min-h-[200px] w-full rounded-2xl bg-background border-stone-200 dark:border-zinc-800 focus:ring-primary focus:border-primary resize-none leading-relaxed px-5 py-4"
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <label htmlFor={instructionsId} className={`${addLabelClass} block`}>
        Instructions
      </label>
      <Textarea
        id={instructionsId}
        value={instructions}
        onChange={(e) => onInstructionsChange(e.target.value)}
        placeholder={
          "Step 1: Preheat oven to 400Â°F...\nStep 2: Season the chicken generously..."
        }
        className="w-full bg-background border-stone-100 dark:border-zinc-800 rounded-xl px-4 py-4 text-sm min-h-[160px] resize-none focus:ring-2 focus:ring-primary"
      />
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
