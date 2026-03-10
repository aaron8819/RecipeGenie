import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { RecipeDialog } from "../recipe-dialog"
import type { Ingredient, Recipe } from "@/types/database"

globalThis.React = React

const createRecipeMutateAsync = vi.fn<(args: unknown) => Promise<Recipe>>()
const updateRecipeMutateAsync = vi.fn<(args: unknown) => Promise<Recipe>>()
const uploadImageMock = vi.fn<(recipeId: string, file: File) => Promise<string>>()
const deleteImageMock = vi.fn<(imageUrl: string) => Promise<void>>()
const undoToastShow = vi.fn<(args: { message: string; duration?: number }) => void>()
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

class MockFileReader {
  result: string | ArrayBuffer | null = null
  onloadend: null | (() => void) = null

  readAsDataURL(file: Blob) {
    this.result = `data:${file.type || "image/png"};base64,mock-image`
    this.onloadend?.()
  }
}

let currentCreatedRecipe: Recipe
let mockLiveRecipeData: Recipe | undefined

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockSortableIngredientList({
      ingredients,
      onIngredientChange,
    }: {
      ingredients: Ingredient[]
      onIngredientChange: (
        index: number,
        field: keyof Ingredient,
        value: string | number | null
      ) => void
    }) {
      return (
        <div>
          {ingredients.map((ingredient, index) => (
            <input
              key={index}
              aria-label={`Ingredient ${index + 1}`}
              value={ingredient.item}
              onChange={(event) => onIngredientChange(index, "item", event.target.value)}
            />
          ))}
        </div>
      )
    },
}))

vi.mock("@/hooks/use-recipes", () => ({
  useCreateRecipe: () => ({
    mutateAsync: createRecipeMutateAsync,
    isPending: false,
  }),
  useUpdateRecipe: () => ({
    mutateAsync: updateRecipeMutateAsync,
    isPending: false,
  }),
  useAllTags: () => ({
    data: [],
  }),
  useTagsWithCounts: () => ({
    data: [],
  }),
  useRecipe: () => ({
    data: mockLiveRecipeData,
  }),
}))

vi.mock("@/hooks/use-recipe-image-storage", () => ({
  useRecipeImageStorage: () => ({
    uploadImage: uploadImageMock,
    deleteImage: deleteImageMock,
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}))

vi.mock("@/hooks/use-debounce", () => ({
  useDebouncedCallback: (fn: (...args: unknown[]) => void) => fn,
}))

vi.mock("@/hooks/use-recipe-import", () => ({
  useImportRecipeFromUrl: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    children: React.ReactNode
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => <button type="button" data-value={value}>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode; value: string }) => <div>{children}</div>,
}))

vi.mock("../recipe-dialog-components", () => ({
  RecipeDialogActions: ({
    isEditing,
    isSubmitting,
    isUploadingImage,
    canSubmit,
    onCancel,
    onSubmit,
  }: {
    isEditing: boolean
    isSubmitting: boolean
    isUploadingImage: boolean
    canSubmit: boolean
    onCancel: () => void
    onSubmit: () => void
  }) => (
    <div>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" onClick={onSubmit} disabled={!canSubmit}>
        {isSubmitting ? (isUploadingImage ? "Uploading image..." : "Saving...") : isEditing ? "Save Changes" : "Add Recipe"}
      </button>
    </div>
  ),
  RecipeMetadataSection: ({
    name,
    onNameChange,
    category,
    onCategoryChange,
    servings,
    onServingsChange,
  }: {
    name: string
    onNameChange: (value: string) => void
    category: string
    onCategoryChange: (value: string) => void
    servings: number
    onServingsChange: (value: number) => void
  }) => (
    <div>
      <label>
        Name
        <input aria-label="Recipe Name" value={name} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <label>
        Category
        <input aria-label="Recipe Category" value={category} onChange={(event) => onCategoryChange(event.target.value)} />
      </label>
      <label>
        Servings
        <input
          aria-label="Servings"
          type="number"
          value={servings}
          onChange={(event) => onServingsChange(Number(event.target.value))}
        />
      </label>
    </div>
  ),
  RecipeImageField: ({
    imagePreview,
    imageUrl,
    onImageSelect,
    onRemoveImage,
  }: {
    imagePreview?: string | null
    imageUrl?: string | null
    onImageSelect?: (event: React.ChangeEvent<HTMLInputElement>) => void
    onRemoveImage?: () => void
  }) => (
    <div>
      <input
        aria-label="Recipe image input"
        type="file"
        onChange={(event) => onImageSelect?.(event)}
      />
      {imagePreview || imageUrl ? (
        <button type="button" aria-label="Remove image" onClick={onRemoveImage}>
          Remove image
        </button>
      ) : null}
    </div>
  ),
  RecipeInstructionsSection: ({
    instructionGroups,
    onInstructionGroupsChange,
  }: {
    instructionGroups: Array<{ label?: string; steps: string[] }>
    onInstructionGroupsChange: (groups: Array<{ label?: string; steps: string[] }>) => void
  }) => (
    <label>
      Instructions
      <textarea
        aria-label="Instructions"
        value={instructionGroups[0]?.steps[0] ?? ""}
        onChange={(event) =>
          onInstructionGroupsChange([
            {
              ...(instructionGroups[0] ?? {}),
              steps: [event.target.value],
            },
          ])
        }
      />
    </label>
  ),
  RecipeImportSection: () => <div>Import section</div>,
  RecipeNotesSection: ({
    notes,
    onNotesChange,
  }: {
    notes: string
    onNotesChange: (value: string) => void
  }) => (
    <label>
      Notes
      <textarea
        aria-label="Notes"
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
      />
    </label>
  ),
  RecipeIngredientsSection: ({
    children,
    onAddIngredient,
  }: {
    children: React.ReactNode
    onAddIngredient?: () => void
  }) => (
    <div>
      {children}
      {onAddIngredient ? (
        <button type="button" onClick={onAddIngredient}>
          Add ingredient
        </button>
      ) : null}
    </div>
  ),
}))

function recipeFixture(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Recipe",
    category: "Dinner",
    servings: 4,
    favorite: false,
    tags: [],
    ingredients: [{ item: "Carrot", amount: 1, unit: "" }],
    instructions: ["Cook"],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

function renderCreateDialog(props?: {
  onOpenChange?: (open: boolean) => void
  onRecipeCreated?: (recipe: Recipe) => void
}) {
  return render(
    <RecipeDialog
      open={true}
      onOpenChange={props?.onOpenChange ?? vi.fn()}
      categories={["Dinner"]}
      onRecipeCreated={props?.onRecipeCreated}
    />
  )
}

function renderEditDialog(recipe: Recipe, onOpenChange?: (open: boolean) => void) {
  return render(
    <RecipeDialog
      open={true}
      onOpenChange={onOpenChange ?? vi.fn()}
      recipe={recipe}
      categories={["Dinner"]}
    />
  )
}

function renderDialog(props: {
  open: boolean
  recipe?: Recipe
  recipeId?: string
  onOpenChange?: (open: boolean) => void
}) {
  return render(
    <RecipeDialog
      open={props.open}
      onOpenChange={props.onOpenChange ?? vi.fn()}
      recipe={props.recipe}
      recipeId={props.recipeId}
      categories={["Dinner"]}
    />
  )
}

async function selectImage(file: File) {
  const input = screen.getByLabelText("Recipe image input")
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Remove image" })).toBeInTheDocument()
  })
}

describe("RecipeDialog image orchestration", () => {
  beforeEach(() => {
    createRecipeMutateAsync.mockReset()
    updateRecipeMutateAsync.mockReset()
    uploadImageMock.mockReset()
    deleteImageMock.mockReset()
    undoToastShow.mockReset()
    mockLiveRecipeData = undefined

    currentCreatedRecipe = recipeFixture({ id: "created-recipe", name: "Fancy Soup" })
    createRecipeMutateAsync.mockResolvedValue(currentCreatedRecipe)
    updateRecipeMutateAsync.mockImplementation(async (args) => recipeFixture(args as Partial<Recipe>))
    uploadImageMock.mockResolvedValue("https://cdn.example.com/fancy-soup.jpg")
    deleteImageMock.mockResolvedValue(undefined)

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: "(min-width: 640px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })

    Object.defineProperty(globalThis, "FileReader", {
      writable: true,
      value: MockFileReader,
    })
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it("uploads a selected image through the storage hook before creating a new recipe", async () => {
    const onOpenChange = vi.fn()
    const onRecipeCreated = vi.fn()
    const file = new File(["image-bytes"], "soup.png", { type: "image/png" })

    renderCreateDialog({ onOpenChange, onRecipeCreated })

    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Fancy Soup" } })
    fireEvent.change(screen.getByLabelText("Ingredient 1"), { target: { value: "Carrot" } })
    await selectImage(file)

    fireEvent.click(screen.getByRole("button", { name: "Add Recipe" }))

    await waitFor(() => {
      expect(uploadImageMock).toHaveBeenCalledWith("fancy-soup", file)
    })

    expect(uploadImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      createRecipeMutateAsync.mock.invocationCallOrder[0]
    )

    expect(createRecipeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Fancy Soup",
        category: "Dinner",
        servings: 4,
        instructions: [],
        instruction_groups: [],
        image_url: "https://cdn.example.com/fancy-soup.jpg",
      })
    )
    expect(onRecipeCreated).toHaveBeenCalledWith(currentCreatedRecipe)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("preserves the create submit flow and shows the existing toast when image upload fails", async () => {
    const onOpenChange = vi.fn()
    const file = new File(["image-bytes"], "soup.png", { type: "image/png" })
    uploadImageMock.mockRejectedValueOnce(new Error("upload failed"))

    renderCreateDialog({ onOpenChange })

    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Fancy Soup" } })
    fireEvent.change(screen.getByLabelText("Ingredient 1"), { target: { value: "Carrot" } })
    await selectImage(file)

    fireEvent.click(screen.getByRole("button", { name: "Add Recipe" }))

    await waitFor(() => {
      expect(createRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Fancy Soup",
          category: "Dinner",
          servings: 4,
          instructions: [],
          instruction_groups: [],
          image_url: null,
        })
      )
    })

    expect(undoToastShow).toHaveBeenCalledWith({
      message: "Failed to upload image. Recipe will be saved without image.",
      duration: 5000,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("deletes a removed image through the storage hook before updating an edited recipe", async () => {
    const onOpenChange = vi.fn()
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Edit Soup",
      image_url: "https://cdn.example.com/existing.jpg",
    })

    renderEditDialog(recipe, onOpenChange)

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }))
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() => {
      expect(deleteImageMock).toHaveBeenCalledWith("https://cdn.example.com/existing.jpg")
    })

    expect(deleteImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateRecipeMutateAsync.mock.invocationCallOrder[0]
    )

    expect(updateRecipeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "edit-recipe",
        updates: expect.objectContaining({
          name: "Edit Soup",
          category: "Dinner",
          servings: 4,
          instructions: ["Cook"],
          instruction_groups: expect.arrayContaining([
            expect.objectContaining({ steps: ["Cook"] }),
          ]),
          image_url: null,
        }),
      })
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("keeps the existing save flow when image deletion fails during edit submit", async () => {
    const onOpenChange = vi.fn()
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Edit Soup",
      image_url: "https://cdn.example.com/existing.jpg",
    })
    deleteImageMock.mockRejectedValueOnce(new Error("delete failed"))

    renderEditDialog(recipe, onOpenChange)

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }))
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }))

    await waitFor(() => {
      expect(updateRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "edit-recipe",
          updates: expect.objectContaining({
            name: "Edit Soup",
            category: "Dinner",
            servings: 4,
            instructions: ["Cook"],
            instruction_groups: expect.arrayContaining([
              expect.objectContaining({ steps: ["Cook"] }),
            ]),
            image_url: null,
          }),
        })
      )
    })

    expect(deleteImageMock).toHaveBeenCalledWith("https://cdn.example.com/existing.jpg")
    expect(undoToastShow).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("prompts before discarding unsaved edit changes and keeps the dialog open until confirmed", async () => {
    const onOpenChange = vi.fn()
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Edit Soup",
    })

    renderEditDialog(recipe, onOpenChange)

    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Edited Soup" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole("button", { name: "Discard" }))

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it("does not reset edit form state when the same recipe refetches while open", async () => {
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Original Soup",
    })

    const view = renderEditDialog(recipe)

    fireEvent.change(screen.getByLabelText("Recipe Name"), { target: { value: "Edited Soup" } })
    expect(screen.getByLabelText("Recipe Name")).toHaveValue("Edited Soup")

    mockLiveRecipeData = recipeFixture({
      id: "edit-recipe",
      name: "Server Soup",
      updated_at: "2026-03-02T00:00:00.000Z",
    })

    view.rerender(
      <RecipeDialog
        open={true}
        onOpenChange={vi.fn()}
        recipe={recipe}
        categories={["Dinner"]}
      />
    )

    expect(screen.getByLabelText("Recipe Name")).toHaveValue("Edited Soup")
  })

  it("hydrates edit form values when the dialog opens", async () => {
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Hydrated Soup",
      category: "Dinner",
      servings: 6,
    })

    const view = renderDialog({
      open: false,
      recipe,
    })

    expect(screen.queryByLabelText("Recipe Name")).not.toBeInTheDocument()

    view.rerender(
      <RecipeDialog
        open={true}
        onOpenChange={vi.fn()}
        recipe={recipe}
        categories={["Dinner"]}
      />
    )

    expect(screen.getByLabelText("Recipe Name")).toHaveValue("Hydrated Soup")
    expect(screen.getByLabelText("Recipe Category")).toHaveValue("Dinner")
    expect(screen.getByLabelText("Servings")).toHaveValue(6)
  })
})
