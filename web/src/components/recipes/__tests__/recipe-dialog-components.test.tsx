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
  RecipeNotesSection,
  RecipeTagsSection,
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

  it("supports mobile collapsible edit rendering", () => {
    render(
      <RecipeImageField
        variant="edit"
        imageUrl="https://example.com/recipe.jpg"
        mobileCollapsible
      />
    )

    expect(screen.queryByAltText("Recipe")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /image/i }))
    expect(screen.getByAltText("Recipe")).toBeInTheDocument()
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
        prepTimeMinutes={null}
        onPrepTimeMinutesChange={() => {}}
        cookTimeMinutes={null}
        onCookTimeMinutesChange={() => {}}
        totalTimeMinutes={null}
        onTotalTimeMinutesChange={() => {}}
        tags={[]}
        onTagsChange={() => {}}
        allTags={[]}
        categories={["breakfast", "dinner"]}
      />
    )

    fireEvent.change(screen.getByPlaceholderText("e.g. Grandma's Roast Chicken"), {
      target: { value: "Pasta" },
    })
    fireEvent.change(screen.getByLabelText("Servings"), {
      target: { value: "101" },
    })

    expect(onNameChange).toHaveBeenCalledWith("Pasta")
    expect(onServingsChange).toHaveBeenCalledWith(100)
    expect(screen.getByText("Recipe Name")).toBeInTheDocument()
  })
})

describe("Secondary mobile sections", () => {
  it("collapses notes content behind a mobile section trigger", () => {
    render(
      <RecipeNotesSection
        variant="edit"
        notes="Use fresh herbs"
        onNotesChange={() => {}}
        mobileCollapsible
      />
    )

    expect(screen.queryByLabelText("Notes")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /notes/i }))
    expect(screen.getByLabelText("Notes")).toBeInTheDocument()
  })

  it("shows a compact tag summary before expanding the editor", () => {
    render(
      <RecipeTagsSection
        variant="edit"
        tags={["easy", "quick", "weeknight"]}
        onTagsChange={() => {}}
        allTags={["easy", "quick", "weeknight"]}
        mobileCollapsible
      />
    )

    expect(screen.getByText(/3 tags:/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /tags/i }))
    expect(screen.getByText(/add another tag/i)).toBeInTheDocument()
  })
})

describe("RecipeIngredientsSection", () => {
  it("renders edit validation summary and wires auto-fix/add callbacks", () => {
    const onAutoFix = vi.fn()
    const onRemoveExactDuplicates = vi.fn()
    const onAddIngredient = vi.fn()

    render(
      <RecipeIngredientsSection
        variant="edit"
        ingredientIssueCount={2}
        onAutoFix={onAutoFix}
        exactDuplicateCount={1}
        nearDuplicateCount={1}
        onRemoveExactDuplicates={onRemoveExactDuplicates}
        onAddIngredient={onAddIngredient}
      >
        <div>ingredient-list</div>
      </RecipeIngredientsSection>
    )

    expect(screen.getByText("Ingredient Validation Issues")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Attempt Auto-Fix" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove Exact Duplicates" }))
    fireEvent.click(screen.getByRole("button", { name: "ADD INGREDIENT" }))

    expect(onAutoFix).toHaveBeenCalledTimes(1)
    expect(onRemoveExactDuplicates).toHaveBeenCalledTimes(1)
    expect(onAddIngredient).toHaveBeenCalledTimes(1)
  })

  it("renders add-mode paste guidance and validation summary", () => {
    const onAutoFix = vi.fn()
    const onRemoveExactDuplicates = vi.fn()

    render(
      <RecipeIngredientsSection
        variant="add"
        ingredientIssueCount={1}
        exactDuplicateCount={2}
        nearDuplicateCount={1}
        onAutoFix={onAutoFix}
        onRemoveExactDuplicates={onRemoveExactDuplicates}
        onAddIngredient={() => {}}
      >
        <div>ingredient-list</div>
      </RecipeIngredientsSection>
    )

    expect(screen.getByText(/paste full lines like/i)).toBeInTheDocument()
    expect(screen.getByText(/may not save cleanly downstream/i)).toBeInTheDocument()
    expect(screen.getByText(/possible near-duplicate row/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Attempt Auto-Fix" }))
    fireEvent.click(screen.getByRole("button", { name: "Remove Exact Duplicates" }))
    expect(onAutoFix).toHaveBeenCalledTimes(1)
    expect(onRemoveExactDuplicates).toHaveBeenCalledTimes(1)
  })
})

describe("RecipeInstructionsSection", () => {
  it("renders grouped steps and forwards step edits", () => {
    const onInstructionGroupsChange = vi.fn()

    render(
      <RecipeInstructionsSection
        variant="add"
        instructionGroups={[{ steps: [""] }]}
        onInstructionGroupsChange={onInstructionGroupsChange}
      />
    )

    fireEvent.change(screen.getByLabelText("Instruction group 1 step 1"), {
      target: { value: "Step 1" },
    })

    expect(onInstructionGroupsChange).toHaveBeenCalledWith([{ label: "", steps: ["Step 1"] }])
  })

  it("supports adding and renaming groups", () => {
    const onInstructionGroupsChange = vi.fn()

    render(
      <RecipeInstructionsSection
        variant="edit"
        instructionGroups={[{ steps: ["Mix batter"] }]}
        onInstructionGroupsChange={onInstructionGroupsChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Add group" }))
    expect(onInstructionGroupsChange).toHaveBeenCalledWith([
      { label: "", steps: ["Mix batter"] },
      { steps: [""] },
    ])

    fireEvent.change(screen.getByLabelText("Instruction group 1 label"), {
      target: { value: "Cake" },
    })
    expect(onInstructionGroupsChange).toHaveBeenLastCalledWith([
      { label: "Cake", steps: ["Mix batter"] },
    ])
  })

  it("keeps one empty group when the last group is removed", () => {
    const onInstructionGroupsChange = vi.fn()

    render(
      <RecipeInstructionsSection
        variant="edit"
        instructionGroups={[{ label: "Sauce", steps: ["Whisk"] }]}
        onInstructionGroupsChange={onInstructionGroupsChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Remove instruction group 1" }))

    expect(onInstructionGroupsChange).toHaveBeenCalledWith([{ steps: [""] }])
  })
})
