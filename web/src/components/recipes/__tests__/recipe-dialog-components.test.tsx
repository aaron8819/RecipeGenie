import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ParsedRecipe } from "@/lib/recipe-parser"
import {
  RecipeDialogActions,
  RecipeIngredientsSection,
  RecipeImageField,
  RecipeImportSection,
  RecipeInstructionsSection,
  RecipeMetadataSection,
} from "../recipe-dialog-components"

vi.mock("next/image", () => ({
  default: ({
    fill: _fill,
    unoptimized: _unoptimized,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean
    unoptimized?: boolean
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt || ""} {...props} />
  ),
}))

vi.mock("@/components/ui/tag-input", () => ({
  TagInput: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string[]
    onChange: (tags: string[]) => void
    placeholder?: string
  }) => (
    <div>
      <div>{placeholder}</div>
      <button type="button" onClick={() => onChange([...value, "mock-tag"])}>
        Add mock tag
      </button>
    </div>
  ),
}))

function parsedRecipe(overrides: Partial<ParsedRecipe> = {}): ParsedRecipe {
  return {
    name: "Roast Chicken",
    servings: 4,
    ingredients: [
      { item: "chicken", amount: 1, unit: "" },
      { item: "salt", amount: 1, unit: "tsp" },
    ],
    instructions: ["Prep the chicken", "Roast until done"],
    warnings: [],
    ...overrides,
  }
}

describe("RecipeImageField", () => {
  it("renders upload affordance and forwards add-mode click", () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {})
    const fileInputRef = { current: document.createElement("input") } as React.RefObject<HTMLInputElement>

    render(
      <RecipeImageField
        variant="add"
        onImageSelect={() => {}}
        onRemoveImage={() => {}}
        fileInputRef={fileInputRef}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: /upload image/i }))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/jpg, png, webp/i)).toBeInTheDocument()

    clickSpy.mockRestore()
  })

  it("renders image preview and remove control in edit mode", () => {
    const onRemoveImage = vi.fn()

    render(
      <RecipeImageField
        variant="edit"
        imageUrl="https://example.com/recipe.jpg"
        onRemoveImage={onRemoveImage}
      />
    )

    expect(screen.getByAltText("Recipe")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }))
    expect(onRemoveImage).toHaveBeenCalledTimes(1)
  })
})

describe("RecipeImportSection", () => {
  it("renders input mode and wires URL/text callbacks", () => {
    const onImportUrlChange = vi.fn()
    const onImportTextChange = vi.fn()
    const onImportUrl = vi.fn()

    render(
      <RecipeImportSection
        importStep="input"
        importUrl=""
        importText=""
        parseError="Bad import"
        livePreview={null}
        parsedPreview={null}
        isImportingFromUrl={false}
        onImportUrlChange={onImportUrlChange}
        onImportTextChange={onImportTextChange}
        onImportUrl={onImportUrl}
        onApplyLivePreview={() => {}}
        onBackToInput={() => {}}
        onApplyPreview={() => {}}
      />
    )

    fireEvent.change(screen.getByLabelText("Import from URL"), {
      target: { value: "https://example.com" },
    })
    fireEvent.change(screen.getByLabelText("Paste Recipe Text"), {
      target: { value: "Recipe text" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Import" }))

    expect(onImportUrlChange).toHaveBeenCalledWith("https://example.com")
    expect(onImportTextChange).toHaveBeenCalledWith("Recipe text")
    expect(onImportUrl).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("alert")).toHaveTextContent("Bad import")
  })

  it("disables live-preview apply when blocking warnings exist", () => {
    render(
      <RecipeImportSection
        importStep="input"
        importUrl=""
        importText=""
        parseError={null}
        livePreview={parsedRecipe({
          warnings: ["No ingredients found"],
        })}
        parsedPreview={null}
        isImportingFromUrl={false}
        onImportUrlChange={() => {}}
        onImportTextChange={() => {}}
        onImportUrl={() => {}}
        onApplyLivePreview={() => {}}
        onBackToInput={() => {}}
        onApplyPreview={() => {}}
      />
    )

    expect(screen.getByRole("button", { name: "Apply to Form" })).toBeDisabled()
  })

  it("renders preview mode and forwards back/apply callbacks", () => {
    const onBackToInput = vi.fn()
    const onApplyPreview = vi.fn()

    render(
      <RecipeImportSection
        importStep="preview"
        importUrl=""
        importText=""
        parseError={null}
        livePreview={null}
        parsedPreview={parsedRecipe({ warnings: ["Trim ingredient spacing"] })}
        isImportingFromUrl={false}
        onImportUrlChange={() => {}}
        onImportTextChange={() => {}}
        onImportUrl={() => {}}
        onApplyLivePreview={() => {}}
        onBackToInput={onBackToInput}
        onApplyPreview={onApplyPreview}
      />
    )

    expect(screen.getByText("Roast Chicken")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /back to edit/i }))
    fireEvent.click(screen.getByRole("button", { name: /apply & edit recipe/i }))
    expect(onBackToInput).toHaveBeenCalledTimes(1)
    expect(onApplyPreview).toHaveBeenCalledTimes(1)
  })
})

describe("RecipeDialogActions", () => {
  it("renders save state and wires cancel/submit", () => {
    const onCancel = vi.fn()
    const onSubmit = vi.fn()

    render(
      <RecipeDialogActions
        isEditing={true}
        isSubmitting={false}
        isUploadingImage={false}
        canSubmit={true}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})

describe("RecipeMetadataSection", () => {
  it("renders add variant fields and wires name/servings callbacks", () => {
    const onNameChange = vi.fn()
    const onServingsChange = vi.fn()

    render(
      <RecipeMetadataSection
        variant="add"
        name=""
        onNameChange={onNameChange}
        category="dinner"
        onCategoryChange={() => {}}
        servings={4}
        onServingsChange={onServingsChange}
        tags={[]}
        onTagsChange={() => {}}
        allTags={[]}
        categories={["breakfast", "dinner"]}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("e.g. Grandma's Roast Chicken"), {
      target: { value: "Pasta" },
    })
    fireEvent.change(screen.getByRole("spinbutton"), {
      target: { value: "101" },
    })

    expect(onNameChange).toHaveBeenCalledWith("Pasta")
    expect(onServingsChange).toHaveBeenCalledWith(100)
    expect(screen.getByText("Recipe Name")).toBeInTheDocument()
  })
})

describe("RecipeIngredientsSection", () => {
  it("renders edit validation summary and wires auto-fix/add callbacks", () => {
    const onAutoFix = vi.fn()
    const onAddIngredient = vi.fn()

    render(
      <RecipeIngredientsSection
        variant="edit"
        ingredientIssueCount={2}
        onAutoFix={onAutoFix}
        onAddIngredient={onAddIngredient}
      >
        <div>ingredient-list</div>
      </RecipeIngredientsSection>
    )

    expect(screen.getByText("Ingredient Validation Issues")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Attempt Auto-Fix" }))
    fireEvent.click(screen.getByRole("button", { name: "ADD INGREDIENT" }))

    expect(onAutoFix).toHaveBeenCalledTimes(1)
    expect(onAddIngredient).toHaveBeenCalledTimes(1)
  })

  it("renders add-mode paste guidance and validation summary", () => {
    const onAutoFix = vi.fn()

    render(
      <RecipeIngredientsSection
        variant="add"
        ingredientIssueCount={1}
        onAutoFix={onAutoFix}
        onAddIngredient={() => {}}
      >
        <div>ingredient-list</div>
      </RecipeIngredientsSection>
    )

    expect(screen.getByText(/paste full lines like/i)).toBeInTheDocument()
    expect(screen.getByText(/may not save cleanly downstream/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Attempt Auto-Fix" }))
    expect(onAutoFix).toHaveBeenCalledTimes(1)
  })
})

describe("RecipeInstructionsSection", () => {
  it("renders add variant textarea and forwards change callback", () => {
    const onInstructionsChange = vi.fn()

    render(
      <RecipeInstructionsSection
        variant="add"
        instructions=""
        onInstructionsChange={onInstructionsChange}
      />
    )

    fireEvent.change(screen.getByLabelText("Instructions"), {
      target: { value: "Step 1" },
    })

    expect(onInstructionsChange).toHaveBeenCalledWith("Step 1")
  })
})
