import React from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ShareRecipeDialog } from "../share-recipe-dialog"
import type { Recipe } from "@/types/database"
import {
  canonicalizeRecipeFixture,
  type RecipeFixtureInput,
} from "@/test/recipe-fixtures"

globalThis.React = React

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const createShareMutateAsync = vi.fn()

function recipeFixture(overrides: RecipeFixtureInput = {}): Recipe {
  return canonicalizeRecipeFixture({
    id: "recipe-1",
    user_id: "user-1",
    name: "Pasta",
    category: "Dinner",
    servings: 4,
    ingredients: [],
    instructions: [],
    tags: [],
    image_url: null,
    favorite: false,
    created_at: null,
    updated_at: null,
    ...overrides,
  })
}

vi.mock("@/hooks/use-recipes", () => ({
  useRecipe: () => ({
    data: recipeFixture(),
  }),
}))

vi.mock("@/hooks/use-recipe-shares", () => ({
  useCreateRecipeShare: () => ({
    mutateAsync: createShareMutateAsync,
    isPending: false,
  }),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}))

describe("ShareRecipeDialog", () => {
  beforeEach(() => {
    createShareMutateAsync.mockReset()
  })

  it("keeps the dialog open with a durable error when sharing fails", async () => {
    const onOpenChange = vi.fn()
    createShareMutateAsync.mockRejectedValueOnce(new Error("Unable to reach the server"))

    render(
      <ShareRecipeDialog
        open
        onOpenChange={onOpenChange}
        recipeId="recipe-1"
      />
    )

    fireEvent.change(screen.getByLabelText("Recipient email"), {
      target: { value: "friend@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Share" }))

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Unable to reach the server")
    })

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole("button", { name: "Share" })).toBeEnabled()
  })

  it("suppresses duplicate submits while the share request is in flight", async () => {
    const pendingShare = deferred<{ deduplicated: boolean }>()
    createShareMutateAsync.mockReturnValueOnce(pendingShare.promise)

    render(
      <ShareRecipeDialog
        open
        onOpenChange={vi.fn()}
        recipeId="recipe-1"
      />
    )

    fireEvent.change(screen.getByLabelText("Recipient email"), {
      target: { value: "friend@example.com" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    fireEvent.click(screen.getByRole("button", { name: "Share" }))

    expect(createShareMutateAsync).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingShare.resolve({ deduplicated: false })
      await pendingShare.promise
    })

    expect(screen.getByText("Recipe shared successfully.")).toBeInTheDocument()
  })
})
