import React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PantryList } from "@/components/pantry/pantry-list"

const addPantryItemsMutateAsync = vi.fn()
const removePantryMutate = vi.fn()
const restorePantryMutate = vi.fn()
const addKeywordsMutateAsync = vi.fn()
const addKeywordsMutate = vi.fn()
const removeKeywordMutate = vi.fn()
const removeKeywordMutateAsync = vi.fn()
const undoToastShow = vi.fn()
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

describe("PantryList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pantryItemsState.data = []
    pantryItemsState.isLoading = false
    pantryItemsState.isFetching = false
    excludedKeywordsState.data = []
    excludedKeywordsState.isLoading = false
    excludedKeywordsState.isFetching = false
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

    fireEvent.click(screen.getByRole("button", { name: /remove garlic/i }))
    fireEvent.click(screen.getByRole("button", { name: /remove excluded keyword pepper/i }))

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

    fireEvent.click(screen.getByRole("button", { name: /remove garlic/i }))

    const pantryMutationOptions = removePantryMutate.mock.calls[0]?.[1]
    act(() => {
      pantryMutationOptions?.onError?.(new Error("remove failed"))
    })

    return waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent('Could not remove "garlic" from pantry. Try again.')
      expect(undoToastShow).not.toHaveBeenCalled()
    })
  })
})
