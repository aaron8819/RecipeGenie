import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PantryList } from "@/components/pantry/pantry-list"

globalThis.React = React

if (typeof window !== "undefined") {
  const testWindow = globalThis as typeof globalThis & {
    PointerEvent?: typeof MouseEvent
    ResizeObserver?: new () => {
      observe: () => void
      unobserve: () => void
      disconnect: () => void
    }
  }

  testWindow.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  testWindow.ResizeObserver ??= class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  HTMLElement.prototype.scrollIntoView ??= () => {}
}

function openActions(ingredient: string) {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: `Actions for ${ingredient}` }),
    { button: 0, ctrlKey: false }
  )
}

const addPantryItemsMutateAsync = vi.fn()
const removePantryMutate = vi.fn()
const restorePantryMutate = vi.fn()
const addKeywordsMutateAsync = vi.fn()
const addKeywordsMutate = vi.fn()
const removeKeywordMutate = vi.fn()
const removeKeywordMutateAsync = vi.fn()
const undoToastShow = vi.fn()
const updateIngredientExclusionMutate = vi.fn()
const pantryItemsState = {
  data: [] as Array<{ id: string; item: string; user_id?: string; created_at?: string }>,
  isLoading: false,
  isFetching: false,
}
const excludedKeywordsState = {
  data: [] as string[],
  isLoading: false,
  isFetching: false,
}
const userConfigState = {
  data: {
    exclude_salt_variants: false,
    exclude_black_pepper_variants: true,
  },
  isLoading: false,
  isError: false,
}
const ingredientExclusionMutationState = {
  isPending: false,
}

vi.mock("@/hooks/use-pantry", () => ({
  usePantryItems: () => pantryItemsState,
  useAddPantryItems: () => ({
    mutateAsync: addPantryItemsMutateAsync,
    isPending: false,
  }),
  useRemovePantryItem: () => ({
    mutate: removePantryMutate,
  }),
  useRestorePantryItem: () => ({
    mutate: restorePantryMutate,
  }),
}))

vi.mock("@/hooks/use-pantry-excluded-keywords", () => ({
  usePantryExcludedKeywords: () => ({
    data: excludedKeywordsState.data,
    isLoading: excludedKeywordsState.isLoading,
    isFetching: excludedKeywordsState.isFetching,
    addKeywords: {
      mutateAsync: addKeywordsMutateAsync,
      mutate: addKeywordsMutate,
      isPending: false,
    },
    removeKeyword: {
      mutate: removeKeywordMutate,
      mutateAsync: removeKeywordMutateAsync,
    },
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}))

vi.mock("@/hooks/use-shopping", () => ({
  useShoppingConfig: () => userConfigState,
  useUpdateIngredientExclusionSetting: () => ({
    mutate: updateIngredientExclusionMutate,
    isPending: ingredientExclusionMutationState.isPending,
  }),
}))

describe("PantryList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pantryItemsState.data = []
    pantryItemsState.isLoading = false
    pantryItemsState.isFetching = false
    excludedKeywordsState.data = []
    excludedKeywordsState.isLoading = false
    excludedKeywordsState.isFetching = false
    userConfigState.data.exclude_salt_variants = false
    userConfigState.data.exclude_black_pepper_variants = true
    userConfigState.isLoading = false
    userConfigState.isError = false
    ingredientExclusionMutationState.isPending = false
    removeKeywordMutateAsync.mockResolvedValue(undefined)
  })

  it("preserves unresolved pantry failures in the input and surfaces grouped item feedback", async () => {
    addPantryItemsMutateAsync.mockResolvedValueOnce({
      outcomes: [
        { input: "garlic", normalizedItem: "garlic", status: "success" },
        { input: "pepper", normalizedItem: "pepper", status: "duplicate" },
        { input: "salt", normalizedItem: "salt", status: "failure", error: "insert failed" },
      ],
      unresolvedInput: "salt",
    })

    render(<PantryList />)

    const input = screen.getByPlaceholderText(/add pantry item/i)
    fireEvent.change(input, { target: { value: "garlic, salt" } })
    fireEvent.submit(input.closest("form")!)

    await waitFor(() => {
      expect(addPantryItemsMutateAsync).toHaveBeenCalledWith("garlic, salt")
    })

    expect(screen.getByDisplayValue("salt")).toBeInTheDocument()
    expect(screen.getByText(/Pantry items: Added: garlic\. Already existed: pepper\. Needs retry: salt\./i)).toBeInTheDocument()
  })

  it("shows a Pantry header with current counts", () => {
    pantryItemsState.data = [
      { id: "pantry-1", item: "garlic" },
      { id: "pantry-2", item: "oil" },
    ]
    excludedKeywordsState.data = ["pepper"]

    render(<PantryList />)

    expect(screen.getByRole("heading", { name: "Pantry" })).toBeInTheDocument()
    expect(screen.getByText("2 pantry items")).toBeInTheDocument()
    expect(screen.getByText("1 excluded keyword")).toBeInTheDocument()
  })

  it("shows persistent helper text and upgraded empty states", () => {
    render(<PantryList />)

    expect(screen.getByText(/duplicates are skipped and anything that fails stays in the field for retry/i)).toBeInTheDocument()
    expect(screen.getByText(/use exact keywords for ingredients that should stay out of shopping/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add pantry items/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /add excluded keywords/i })).toBeInTheDocument()
  })

  it('renders accessible family settings above excluded ingredients', () => {
    render(<PantryList />)

    const salt = screen.getByRole("checkbox", { name: "Salt variants" })
    const pepper = screen.getByRole("checkbox", { name: "Black pepper variants" })
    expect(salt).not.toBeChecked()
    expect(pepper).toBeChecked()
    expect(salt).toHaveAccessibleDescription(
      'Salt variants include salt, kosher salt, sea salt, Maldon salt, and table salt.'
    )
    expect(pepper).toHaveAccessibleDescription(
      "Black pepper variants include black pepper, ground black pepper, freshly ground black pepper, and cracked black pepper."
    )
    expect(screen.getByRole("heading", { name: "Always exclude" })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Excluded ingredients' }))
      .toBeInTheDocument()
    expect(screen.getByText(/clear\/reset the shopping list, then regenerate/i)).toBeInTheDocument()
    expect(screen.getByText(/never uses substring matching/i)).toBeInTheDocument()
  })

  it("groups Pantry items, restores collapse state after search, and keeps unmatched items in Other", () => {
    pantryItemsState.data = [
      { id: "1", item: "tomato" },
      { id: "2", item: "apple" },
      { id: "3", item: "flour" },
      { id: "4", item: "sugar" },
      { id: "5", item: "mystery ingredient" },
      { id: "6", item: "milk" },
      { id: "7", item: "butter" },
      { id: "8", item: "bread" },
      { id: "9", item: "bagels" },
      { id: "10", item: "chicken" },
      { id: "11", item: "salmon" },
    ]

    render(<PantryList />)

    const produce = screen.getByRole("button", { name: /Fresh Produce 2/i })
    expect(produce).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("button", { name: /Pantry Staples 2/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Other 1/i })).toBeInTheDocument()

    fireEvent.click(produce)
    expect(produce).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("tomato")).not.toBeVisible()

    const search = screen.getByRole("searchbox", { name: "Search pantry items" })
    fireEvent.change(search, {
      target: { value: "tomato" },
    })
    expect(produce).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("tomato")).toBeVisible()
    expect(screen.queryByRole("button", { name: /Pantry Staples/i })).not.toBeInTheDocument()

    fireEvent.change(search, {
      target: { value: "not in this pantry" },
    })
    expect(screen.getByText(/No pantry items match/)).toBeInTheDocument()
    expect(screen.queryByText("No pantry items yet")).not.toBeInTheDocument()

    fireEvent.change(search, {
      target: { value: "" },
    })
    expect(
      screen.getByRole("button", { name: /Fresh Produce 2/i })
    ).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("tomato")).not.toBeVisible()
    expect(screen.getByRole("button", { name: /Pantry Staples 2/i })).toBeInTheDocument()
  })

  it("uses pressed-state semantics for the mobile Pantry workspace", () => {
    render(<PantryList />)

    const pantry = screen.getByRole("button", { name: "Pantry 0" })
    const excluded = screen.getByRole("button", { name: "Excluded 0" })
    expect(pantry).toHaveAttribute("aria-pressed", "true")
    expect(excluded).toHaveAttribute("aria-pressed", "false")

    fireEvent.click(excluded)
    expect(pantry).toHaveAttribute("aria-pressed", "false")
    expect(excluded).toHaveAttribute("aria-pressed", "true")
  })

  it("saves one family setting and shows a failure toast", () => {
    render(<PantryList />)

    fireEvent.click(screen.getByRole("checkbox", { name: "Salt variants" }))

    expect(updateIngredientExclusionMutate).toHaveBeenCalledWith(
      { setting: "exclude_salt_variants", enabled: true },
      expect.objectContaining({ onError: expect.any(Function) })
    )
    const options = updateIngredientExclusionMutate.mock.calls[0][1]
    act(() => options.onError())
    expect(undoToastShow).toHaveBeenCalledWith({
      message: "Could not save the shopping exclusion setting. Try again.",
      duration: 4000,
    })
  })

  it("disables family settings while their serialized write is pending", () => {
    ingredientExclusionMutationState.isPending = true

    render(<PantryList />)

    expect(screen.getByRole("checkbox", { name: "Salt variants" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Black pepper variants" })).toBeDisabled()
  })

  it("shows family-setting loading and error states", () => {
    userConfigState.isLoading = true
    const { rerender } = render(<PantryList />)
    expect(screen.getByText("Loading exclusion settings...")).toBeInTheDocument()

    userConfigState.isLoading = false
    userConfigState.isError = true
    rerender(<PantryList />)
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load exclusion settings. Try refreshing the page."
    )
  })

  it("uses specific loading copy for pantry items and excluded keywords", () => {
    pantryItemsState.isLoading = true
    excludedKeywordsState.isLoading = true

    render(<PantryList />)

    expect(screen.getByText("Loading pantry items...")).toBeInTheDocument()
    expect(screen.getByText("Loading excluded keywords...")).toBeInTheDocument()
  })

  it("queues undo toasts for pantry and keyword removals", async () => {
    pantryItemsState.data = [{ id: "pantry-1", item: "garlic" }]
    excludedKeywordsState.data = ["pepper"]

    render(<PantryList />)

    openActions("garlic")
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }))
    openActions("pepper")
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }))

    expect(undoToastShow).not.toHaveBeenCalled()

    const pantryMutationOptions = removePantryMutate.mock.calls[0]?.[1]
    act(() => {
      pantryMutationOptions?.onSuccess?.()
    })
    await waitFor(() => {
      expect(removeKeywordMutateAsync).toHaveBeenCalledWith("pepper")
    })

    expect(undoToastShow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "\"garlic\" removed from pantry",
        queueBehavior: "enqueue",
      })
    )
    expect(undoToastShow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "\"pepper\" removed from excluded keywords",
        queueBehavior: "enqueue",
      })
    )
  })

  it("keeps pantry removal failures visible inline for retry", () => {
    pantryItemsState.data = [{ id: "pantry-1", item: "garlic" }]

    render(<PantryList />)

    openActions("garlic")
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }))

    const pantryMutationOptions = removePantryMutate.mock.calls[0]?.[1]
    act(() => {
      pantryMutationOptions?.onError?.(new Error("remove failed"))
    })

    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent('Could not remove "garlic" from pantry. Try again.')
      expect(undoToastShow).not.toHaveBeenCalled()
    })
  })

  it("keeps only the selected row pending while removal is in flight", () => {
    pantryItemsState.data = [
      { id: "pantry-1", item: "garlic" },
      { id: "pantry-2", item: "tomato" },
    ]

    render(<PantryList />)

    openActions("garlic")
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }))

    expect(screen.getByRole("button", { name: "Actions for garlic" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Actions for tomato" })).toBeEnabled()
  })
})
