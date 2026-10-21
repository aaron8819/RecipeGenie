import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RecipeDialog } from "../recipe-dialog";
import type { Ingredient, Recipe } from "@/types/database";
import { parseIngredientLine } from "@/lib/recipe-parser";
import { parseIngredientAmountLexeme } from "@/lib/recipe-parser";
import {
  canonicalizeRecipeFixture,
  type RecipeFixtureInput,
} from "@/test/recipe-fixtures";

globalThis.React = React;

const createRecipeMutateAsync = vi.fn<(args: unknown) => Promise<Recipe>>();
const updateRecipeMutateAsync = vi.fn<(args: unknown) => Promise<Recipe>>();
const uploadImageMock =
  vi.fn<(recipeId: string, file: File) => Promise<string>>();
const importUrlMock =
  vi.fn<() => Promise<import("@/lib/recipe-url-parser").ExtractedRecipe>>();
const deleteImageMock = vi.fn<(imageUrl: string) => Promise<void>>();
const undoToastShow =
  vi.fn<(args: { message: string; duration?: number }) => void>();
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

class MockFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: null | (() => void) = null;

  readAsDataURL(file: Blob) {
    this.result = `data:${file.type || "image/png"};base64,mock-image`;
    this.onloadend?.();
  }
}

let currentCreatedRecipe: Recipe;
let mockLiveRecipeData: Recipe | undefined;

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockSortableIngredientList({
      ingredients,
      onIngredientChange,
      onIngredientParsed,
    }: {
      ingredients: Ingredient[];
      onIngredientChange: (
        index: number,
        field: keyof Ingredient,
        value: string | number | null,
      ) => void;
      onIngredientParsed: (index: number, ingredient: Ingredient) => void;
    }) {
      return (
        <div>
          {ingredients.map((ingredient, index) => (
            <React.Fragment key={index}>
              <input
                aria-label={`Ingredient ${index + 1}`}
                value={ingredient.item}
                onChange={(event) =>
                  onIngredientChange(index, "item", event.target.value)
                }
                onBlur={(event) =>
                  onIngredientParsed(
                    index,
                    parseIngredientLine(event.target.value),
                  )
                }
              />
              <input
                aria-label={`Amount ${index + 1}`}
                defaultValue={ingredient.amount ?? ""}
                onBlur={(event) =>
                  onIngredientChange(
                    index,
                    "amount",
                    parseIngredientAmountLexeme(event.currentTarget.value),
                  )
                }
              />
              <input
                aria-label={`Unit ${index + 1}`}
                value={ingredient.unit}
                onChange={(event) =>
                  onIngredientChange(index, "unit", event.target.value)
                }
              />
            </React.Fragment>
          ))}
        </div>
      );
    },
}));

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
}));

vi.mock("@/hooks/use-recipe-image-storage", () => ({
  useRecipeImageStorage: () => ({
    uploadImage: uploadImageMock,
    deleteImage: deleteImageMock,
  }),
}));

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}));

vi.mock("@/hooks/use-debounce", () => ({
  useDebouncedCallback: (fn: (...args: unknown[]) => void) => fn,
}));

vi.mock("@/hooks/use-recipe-import", () => ({
  useImportRecipeFromUrl: () => ({
    mutateAsync: importUrlMock,
    isPending: false,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: React.ReactNode;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogClose: ({
    children,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{children}</>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/tabs", async () => {
  const ReactModule = await import("react");
  const TabChange = ReactModule.createContext<(value: string) => void>(
    () => {},
  );
  return {
    Tabs: ({
      children,
      onValueChange,
    }: {
      children: React.ReactNode;
      onValueChange?: (value: string) => void;
    }) => (
      <TabChange.Provider value={onValueChange ?? (() => {})}>
        {children}
      </TabChange.Provider>
    ),
    TabsList: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    TabsTrigger: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: string;
    }) => {
      const change = ReactModule.useContext(TabChange);
      return (
        <button type="button" role="tab" onClick={() => change(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  };
});

vi.mock("../recipe-dialog-components", async () => ({
  ...(await vi.importActual<typeof import("../recipe-dialog-components")>(
    "../recipe-dialog-components",
  )),
  RecipeDialogActions: ({
    isEditing,
    isSubmitting,
    isUploadingImage,
    canSubmit,
    submitLabel,
    onCancel,
    onSubmit,
  }: {
    isEditing: boolean;
    isSubmitting: boolean;
    isUploadingImage: boolean;
    canSubmit: boolean;
    submitLabel?: string;
    onCancel: () => void;
    onSubmit: () => void;
  }) => (
    <div>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" onClick={onSubmit} disabled={!canSubmit}>
        {isSubmitting
          ? isUploadingImage
            ? "Uploading image..."
            : "Saving..."
          : isEditing
            ? "Save Changes"
            : (submitLabel ?? "Add Recipe")}
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
    name: string;
    onNameChange: (value: string) => void;
    category: string;
    onCategoryChange: (value: string) => void;
    servings: number;
    onServingsChange: (value: number) => void;
  }) => (
    <div>
      <label>
        Name
        <input
          aria-label="Recipe Name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </label>
      <label>
        Category
        <input
          aria-label="Recipe Category"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        />
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
    imagePreview?: string | null;
    imageUrl?: string | null;
    onImageSelect?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveImage?: () => void;
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
    instructionGroups: Array<{ label?: string; steps: string[] }>;
    onInstructionGroupsChange: (
      groups: Array<{ label?: string; steps: string[] }>,
    ) => void;
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
  RecipeNotesSection: ({
    notes,
    onNotesChange,
  }: {
    notes: string;
    onNotesChange: (value: string) => void;
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
    children: React.ReactNode;
    onAddIngredient?: () => void;
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
}));

function recipeFixture(overrides: RecipeFixtureInput = {}): Recipe {
  return canonicalizeRecipeFixture({
    id: "recipe-1",
    user_id: "user-1",
    name: "Recipe",
    category: "Dinner",
    servings: 4,
    favorite: false,
    tags: [],
    fixtureIngredients: [{ item: "Carrot", amount: 1, unit: "" }],
    fixtureInstructions: ["Cook"],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  });
}

function renderCreateDialog(props?: {
  onOpenChange?: (open: boolean) => void;
  onRecipeCreated?: (recipe: Recipe) => void;
}) {
  const result = render(
    <RecipeDialog
      open={true}
      onOpenChange={props?.onOpenChange ?? vi.fn()}
      categories={["Dinner"]}
      onRecipeCreated={props?.onRecipeCreated}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Manual" }));
  return result;
}

function renderEditDialog(
  recipe: Recipe,
  onOpenChange?: (open: boolean) => void,
) {
  return render(
    <RecipeDialog
      open={true}
      onOpenChange={onOpenChange ?? vi.fn()}
      recipe={recipe}
      categories={["Dinner"]}
    />,
  );
}

function renderDialog(props: {
  open: boolean;
  recipe?: Recipe;
  recipeId?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  return render(
    <RecipeDialog
      open={props.open}
      onOpenChange={props.onOpenChange ?? vi.fn()}
      recipe={props.recipe}
      recipeId={props.recipeId}
      categories={["Dinner"]}
    />,
  );
}

async function selectImage(file: File) {
  const input = screen.getByLabelText("Recipe image input");
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Remove image" }),
    ).toBeInTheDocument();
  });
}

describe("RecipeDialog image orchestration", () => {
  beforeEach(() => {
    createRecipeMutateAsync.mockReset();
    updateRecipeMutateAsync.mockReset();
    uploadImageMock.mockReset();
    deleteImageMock.mockReset();
    undoToastShow.mockReset();
    mockLiveRecipeData = undefined;

    currentCreatedRecipe = recipeFixture({
      id: "created-recipe",
      name: "Fancy Soup",
    });
    createRecipeMutateAsync.mockResolvedValue(currentCreatedRecipe);
    updateRecipeMutateAsync.mockImplementation(async (args) =>
      recipeFixture(args as Partial<Recipe>),
    );
    uploadImageMock.mockResolvedValue("https://cdn.example.com/fancy-soup.jpg");
    deleteImageMock.mockResolvedValue(undefined);

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
    });

    Object.defineProperty(globalThis, "FileReader", {
      writable: true,
      value: MockFileReader,
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it.each([false, true])("applies explicit category/tags through review and save (editing=%s)", async (editing) => {
    const recipe = recipeFixture({ category: "Dinner", tags: ["old"] })
    render(<RecipeDialog open={true} onOpenChange={vi.fn()}
      recipe={editing ? recipe : undefined} categories={["Dinner", "Chicken"]} />)
    if (editing) fireEvent.click(screen.getByRole("tab", { name: "Replace text" }))
    fireEvent.change(screen.getByLabelText("Recipe text"), { target: {
      value: "# Thai Basil Fried Rice\nServings: 4\nCategory: Chicken\nTags: Asian\n\n## Ingredients\n1 cup rice\n\n## Instructions\n1. Cook.",
    } })
    fireEvent.click(screen.getByRole("button", { name: editing ? "Review changes" : "Review recipe" }))
    if (editing) {
      expect(screen.getByTestId("replacement-review")).toHaveTextContent("Asian")
      expect(screen.getByTestId("replacement-review")).toHaveTextContent("Chicken")
      expect(screen.queryByText("Some text could not be included")).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: /Save changes/i }))
      await waitFor(() => expect(updateRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ updates: expect.objectContaining({ category: "Chicken", tags: ["Asian"] }) })
      ))
    } else {
      expect(screen.getByText("Asian")).toBeInTheDocument()
      fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }))
      await waitFor(() => expect(createRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ category: "Chicken", tags: ["Asian"] })
      ))
    }
  })
  it("uploads a selected image through the storage hook before creating a new recipe", async () => {
    const onOpenChange = vi.fn();
    const onRecipeCreated = vi.fn();
    const file = new File(["image-bytes"], "soup.png", { type: "image/png" });

    renderCreateDialog({ onOpenChange, onRecipeCreated });

    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Fancy Soup" },
    });
    fireEvent.change(screen.getByLabelText("Ingredient 1"), {
      target: { value: "Carrot" },
    });
    await selectImage(file);

    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));

    let uploadedRecipeUuid = "";
    await waitFor(() => {
      uploadedRecipeUuid = uploadImageMock.mock.calls[0]?.[0] || "";
      expect(uploadedRecipeUuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(uploadImageMock).toHaveBeenCalledWith(uploadedRecipeUuid, file);
    });

    expect(uploadImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      createRecipeMutateAsync.mock.invocationCallOrder[0],
    );

    expect(createRecipeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Fancy Soup",
        category: "Dinner",
        servings: 4,
        instruction_sections: [],
        image_url: "https://cdn.example.com/fancy-soup.jpg",
        recipeUuid: uploadedRecipeUuid,
      }),
    );
    expect(onRecipeCreated).toHaveBeenCalledWith(currentCreatedRecipe);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("submits the complete parsed ingredient after single-line manual entry", async () => {
    renderCreateDialog();

    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Tomato Soup" },
    });
    const ingredient = screen.getByLabelText("Ingredient 1");
    fireEvent.change(ingredient, {
      target: { value: "about 0.50–1 (14 oz) cans tomatoes" },
    });
    fireEvent.blur(ingredient, {
      target: { value: "about 0.50–1 (14 oz) cans tomatoes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));

    await waitFor(() => {
      expect(createRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          ingredient_sections: [
            {
              label: null,
              ingredients: [
                expect.objectContaining({
                  item: "tomatoes",
                  amount: "0.5–1",
                  unit: "(14 oz) cans",
                  originalText: "about 0.50–1 (14 oz) cans tomatoes",
                  quantityV1: expect.objectContaining({
                    kind: "range",
                    authored: "about 0.50–1",
                    qualifier: "about",
                    startLexeme: "0.50",
                    endLexeme: "1",
                  }),
                  packageV1: expect.objectContaining({
                    type: "can",
                    authoredType: "cans",
                  }),
                }),
              ],
            },
          ],
        }),
      );
    });
  });

  it("preserves authored amount text through hydrate, save, reopen, edit, and resave", async () => {
    const ingredient = parseIngredientLine("0.50 cup sugar");
    const recipe = recipeFixture({
      id: "authored-amount",
      fixtureIngredients: [ingredient],
    });
    const first = renderEditDialog(recipe);

    expect(screen.getByLabelText("Amount 1")).toHaveValue("0.50");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecipeMutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          updates: expect.objectContaining({
            ingredient_sections: [
              {
                label: null,
                ingredients: [
                  expect.objectContaining({
                    amount: 0.5,
                    quantityV1: expect.objectContaining({
                      authored: "0.50",
                      lexeme: "0.50",
                      value: { numerator: "1", denominator: "2" },
                    }),
                  }),
                ],
              },
            ],
          }),
        }),
      );
    });

    const persisted = (
      updateRecipeMutateAsync.mock.calls.at(-1)?.[0] as {
        updates: { ingredient_sections?: Recipe["ingredientSections"] };
      }
    ).updates;
    first.unmount();
    renderEditDialog(
      recipeFixture({
        id: "authored-amount",
        ingredientSections: persisted.ingredient_sections,
      }),
    );

    const reopenedAmount = screen.getByLabelText("Amount 1");
    expect(reopenedAmount).toHaveValue("0.50");
    fireEvent.change(reopenedAmount, { target: { value: "1/2" } });
    fireEvent.blur(reopenedAmount, { target: { value: "1/2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecipeMutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          updates: expect.objectContaining({
            ingredient_sections: [
              {
                label: null,
                ingredients: [
                  expect.objectContaining({
                    amount: 0.5,
                    originalText: undefined,
                    quantityV1: expect.objectContaining({
                      authored: "1/2",
                      lexeme: "1/2",
                      value: { numerator: "1", denominator: "2" },
                    }),
                  }),
                ],
              },
            ],
          }),
        }),
      );
    });
  });

  it("rebuilds sized-package metadata from the actual unit edit callback", async () => {
    const recipe = recipeFixture({
      id: "sized-package",
      fixtureIngredients: [parseIngredientLine("1 (14 oz) can tomatoes")],
    });
    renderEditDialog(recipe);

    fireEvent.change(screen.getByLabelText("Unit 1"), {
      target: { value: "(28 oz) cans" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecipeMutateAsync).toHaveBeenLastCalledWith(
        expect.objectContaining({
          updates: expect.objectContaining({
            ingredient_sections: [
              {
                label: null,
                ingredients: [
                  expect.objectContaining({
                    item: "tomatoes",
                    amount: 1,
                    unit: "(28 oz) cans",
                    originalText: undefined,
                    quantityV1: expect.objectContaining({
                      kind: "exact",
                      authored: "1",
                    }),
                    packageV1: expect.objectContaining({
                      count: expect.objectContaining({ authored: "1" }),
                      size: {
                        value: { numerator: "28", denominator: "1" },
                        lexeme: "28",
                        unit: "oz",
                        authoredUnit: "oz",
                      },
                      type: "can",
                      authoredType: "cans",
                    }),
                  }),
                ],
              },
            ],
          }),
        }),
      );
    });
  });

  it("preserves the create submit flow and shows the existing toast when image upload fails", async () => {
    const onOpenChange = vi.fn();
    const file = new File(["image-bytes"], "soup.png", { type: "image/png" });
    uploadImageMock.mockRejectedValueOnce(new Error("upload failed"));

    renderCreateDialog({ onOpenChange });

    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Fancy Soup" },
    });
    fireEvent.change(screen.getByLabelText("Ingredient 1"), {
      target: { value: "Carrot" },
    });
    await selectImage(file);

    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));

    await waitFor(() => {
      expect(createRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Fancy Soup",
          category: "Dinner",
          servings: 4,
          instruction_sections: [],
          image_url: null,
        }),
      );
    });

    expect(undoToastShow).toHaveBeenCalledWith({
      message: "Failed to upload image. Recipe will be saved without image.",
      duration: 5000,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("deletes a removed image through the storage hook before updating an edited recipe", async () => {
    const onOpenChange = vi.fn();
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Edit Soup",
      image_url: "https://cdn.example.com/existing.jpg",
    });

    renderEditDialog(recipe, onOpenChange);

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(deleteImageMock).toHaveBeenCalledWith(
        "https://cdn.example.com/existing.jpg",
      );
    });

    expect(deleteImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateRecipeMutateAsync.mock.invocationCallOrder[0],
    );

    expect(updateRecipeMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "edit-recipe",
        updates: expect.objectContaining({
          name: "Edit Soup",
          category: "Dinner",
          servings: 4,
          instruction_sections: expect.arrayContaining([
            expect.objectContaining({ steps: ["Cook"] }),
          ]),
          image_url: null,
        }),
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the existing save flow when image deletion fails during edit submit", async () => {
    const onOpenChange = vi.fn();
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Edit Soup",
      image_url: "https://cdn.example.com/existing.jpg",
    });
    deleteImageMock.mockRejectedValueOnce(new Error("delete failed"));

    renderEditDialog(recipe, onOpenChange);

    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "edit-recipe",
          updates: expect.objectContaining({
            name: "Edit Soup",
            category: "Dinner",
            servings: 4,
            instruction_sections: expect.arrayContaining([
              expect.objectContaining({ steps: ["Cook"] }),
            ]),
            image_url: null,
          }),
        }),
      );
    });

    expect(deleteImageMock).toHaveBeenCalledWith(
      "https://cdn.example.com/existing.jpg",
    );
    expect(undoToastShow).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("prompts before discarding unsaved edit changes and keeps the dialog open until confirmed", async () => {
    const onOpenChange = vi.fn();
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Edit Soup",
    });

    renderEditDialog(recipe, onOpenChange);

    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Edited Soup" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it("does not reset edit form state when the same recipe refetches while open", async () => {
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Original Soup",
    });

    const view = renderEditDialog(recipe);

    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Edited Soup" },
    });
    expect(screen.getByLabelText("Recipe Name")).toHaveValue("Edited Soup");

    mockLiveRecipeData = recipeFixture({
      id: "edit-recipe",
      name: "Server Soup",
      updated_at: "2026-03-02T00:00:00.000Z",
    });

    view.rerender(
      <RecipeDialog
        open={true}
        onOpenChange={vi.fn()}
        recipe={recipe}
        categories={["Dinner"]}
      />,
    );

    expect(screen.getByLabelText("Recipe Name")).toHaveValue("Edited Soup");
  });

  it("hydrates edit form values when the dialog opens", async () => {
    const recipe = recipeFixture({
      id: "edit-recipe",
      name: "Hydrated Soup",
      category: "Dinner",
      servings: 6,
    });

    const view = renderDialog({
      open: false,
      recipe,
    });

    expect(screen.queryByLabelText("Recipe Name")).not.toBeInTheDocument();

    view.rerender(
      <RecipeDialog
        open={true}
        onOpenChange={vi.fn()}
        recipe={recipe}
        categories={["Dinner"]}
      />,
    );

    expect(screen.getByLabelText("Recipe Name")).toHaveValue("Hydrated Soup");
    expect(screen.getByLabelText("Recipe Category")).toHaveValue("Dinner");
    expect(screen.getByLabelText("Servings")).toHaveValue(6);
  });
});

describe("recipe creation review", () => {
  beforeEach(() => {
    createRecipeMutateAsync.mockClear();
    importUrlMock.mockReset();
  });
  const text =
    "Rice\nServings: 4\nIngredients:\n1/2 cup rice\nInstructions:\nCook.\nNotes:\nKeep chilled.";

  it("preserves unresolved pasted text in Notes before allowing creation", async () => {
    render(
      <RecipeDialog open onOpenChange={vi.fn()} categories={["Dinner"]} />,
    );
    fireEvent.change(screen.getByLabelText("Recipe text"), {
      target: { value: text + "\n## Nutrition\nProtein 10g" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    expect(screen.getByRole("button", { name: "Save Recipe" })).toBeDisabled();
    expect(screen.getByText("Protein 10g")).toBeInTheDocument();
    expect(createRecipeMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep in Notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() =>
      expect(createRecipeMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: ["Keep chilled.", "## Nutrition", "Protein 10g"],
        }),
      ),
    );
  });

  it("retains corrections when returning to unchanged pasted text", () => {
    render(
      <RecipeDialog open onOpenChange={vi.fn()} categories={["Dinner"]} />,
    );
    fireEvent.change(screen.getByLabelText("Recipe text"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Corrected rice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    expect(
      screen.getByRole("heading", { name: "Corrected rice" }),
    ).toBeInTheDocument();
  });
  it("does not review a URL result from an empty paste screen", async () => {
    importUrlMock.mockResolvedValue({
      name: "URL Rice",
      ingredientSections: [
        { label: null, ingredients: [parseIngredientLine("1 cup rice")] },
      ],
      instructionSections: [{ label: null, steps: ["Cook."] }],
      warnings: [],
    });
    render(
      <RecipeDialog open onOpenChange={vi.fn()} categories={["Dinner"]} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "From URL" }));
    fireEvent.change(screen.getByLabelText("Import from URL"), {
      target: { value: "https://example.com/rice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review recipe" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Paste text" }));
    expect(
      screen.getByRole("button", { name: "Review recipe" }),
    ).toBeDisabled();
  });

  it("ignores a pending URL response after switching to pasted text", async () => {
    let resolveImport:
      | ((result: import("@/lib/recipe-url-parser").ExtractedRecipe) => void)
      | undefined;
    importUrlMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    render(
      <RecipeDialog open onOpenChange={vi.fn()} categories={["Dinner"]} />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "From URL" }));
    fireEvent.change(screen.getByLabelText("Import from URL"), {
      target: { value: "https://example.com/rice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("tab", { name: "Paste text" }));
    fireEvent.change(screen.getByLabelText("Recipe text"), {
      target: { value: text },
    });
    resolveImport?.({
      name: "Stale URL Rice",
      ingredientSections: [],
      instructionSections: [],
      warnings: [],
    });
    await waitFor(() =>
      expect(screen.queryByText("Stale URL Rice")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    expect(screen.getByRole("heading", { name: "Rice" })).toBeInTheDocument();
  });
  it("keeps an invalid manual draft recoverable during preview", () => {
    renderCreateDialog();
    fireEvent.change(screen.getByLabelText("Recipe Name"), {
      target: { value: "Invalid rice" },
    });
    fireEvent.change(screen.getByLabelText("Ingredient 1"), {
      target: { value: "x".repeat(513) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review recipe" }));
    expect(
      screen.getByText(
        "Some recipe details cannot be saved yet. Edit the ingredients and review again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Recipe" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit ingredients" }));
    fireEvent.change(screen.getByLabelText("Ingredient 1"), {
      target: { value: "rice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to preview" }));
    expect(screen.getByRole("button", { name: "Save Recipe" })).toBeEnabled();
  });
});
