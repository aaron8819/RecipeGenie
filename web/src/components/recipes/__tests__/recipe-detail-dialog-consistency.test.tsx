import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { describe, expect, it, vi } from "vitest"
import { RecipeDetailDialog } from "../recipe-detail-dialog"
import type { Recipe } from "@/types/database"
import { recipeKeys } from "@/lib/query-keys"

globalThis.React = React

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

vi.mock("@/lib/auth-context", () => ({
  useAuthContext: () => ({ user: { id: "user-1" } }),
}))

vi.mock("@/lib/supabase/client", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: vi.fn(),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock("@/hooks/use-recipes", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/use-recipes")>("@/hooks/use-recipes")
  return {
    ...actual,
    useToggleFavorite: () => ({
      mutate: vi.fn(),
    }),
  }
})

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogAction: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
  AlertDialogCancel: ({
    children,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" disabled={disabled}>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Curry",
    category: "dinner",
    servings: 4,
    prep_time_minutes: null,
    cook_time_minutes: null,
    total_time_minutes: null,
    favorite: false,
    tags: [],
    ingredients: [{ item: "Onion", amount: 1, unit: "" }],
    instructions: ["Cook it"],
    notes: [],
    instruction_groups: null,
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("RecipeDetailDialog cache consistency", () => {
  it("reads the current recipe from query state instead of a stale snapshot", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(recipeKeys.detail("user-1", "recipe-1"), makeRecipe({ favorite: false }))

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe({ favorite: false })}
        />
      </QueryClientProvider>
    )

    expect(screen.getByLabelText("Add to favorites")).toBeInTheDocument()

    queryClient.setQueryData(recipeKeys.detail("user-1", "recipe-1"), makeRecipe({ favorite: true }))

    await waitFor(() => {
      expect(screen.getByLabelText("Remove from favorites")).toBeInTheDocument()
    })
  })

  it("surfaces follow-up actions in the detail header and reuses parent callbacks", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const onAddToPlan = vi.fn()
    const onAddToShoppingList = vi.fn()
    const onMarkAsMade = vi.fn()
    const onShare = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe()}
          onAddToPlan={onAddToPlan}
          onAddToShoppingList={onAddToShoppingList}
          onMarkAsMade={onMarkAsMade}
          onShare={onShare}
        />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Add to Plan" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to Shopping List" }))
    fireEvent.click(screen.getByRole("button", { name: "Mark Made" }))
    fireEvent.click(screen.getByRole("button", { name: "Share" }))

    expect(onAddToPlan).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1" }))
    expect(onAddToShoppingList).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1" }))
    expect(onMarkAsMade).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1" }))
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1" }))
  })

  it("keeps minimal contexts structured without rendering unrelated action groups", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const onEdit = vi.fn()

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe()}
          onEdit={onEdit}
        />
      </QueryClientProvider>
    )

    expect(screen.queryByRole("button", { name: "Start Cooking" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit Recipe" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add to Plan" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Add to Shopping List" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Mark Made" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Edit Recipe" }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1" }))
  })

  it("renders whole/count ingredients without showing the internal unit", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe({
            ingredients: [
              { item: "onion", amount: 1, unit: "count" },
              { item: "rice", amount: 1, unit: "cup" },
            ],
          })}
        />
      </QueryClientProvider>
    )

    expect(screen.getByText("onion")).toBeInTheDocument()
    expect(screen.getAllByText("1").length).toBeGreaterThan(0)
    expect(screen.getByText("1 cup")).toBeInTheDocument()
    expect(screen.queryByText("1 count")).not.toBeInTheDocument()
  })
  it("renders persisted times, notes, and grouped instructions without legacy note duplication", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe({
            prep_time_minutes: 10,
            cook_time_minutes: 15,
            total_time_minutes: 25,
            instructions: ["Sear chicken.", "Finish sauce."],
            instruction_groups: [
              { steps: ["Sear chicken."] },
              { label: "Sauce", steps: ["Finish sauce."] },
            ],
            notes: ["Rest before serving."],
          })}
        />
      </QueryClientProvider>
    )

    expect(screen.getByText("Prep 10 min")).toBeInTheDocument()
    expect(screen.getByText("Cook 15 min")).toBeInTheDocument()
    expect(screen.getByText("Total 25 min")).toBeInTheDocument()
    expect(screen.getByText("Sauce")).toBeInTheDocument()
    expect(screen.getByText("Rest before serving.")).toBeInTheDocument()
    expect(screen.queryByText("Notes:")).not.toBeInTheDocument()
  })

  it("exposes one actionable confirmation and prevents duplicate deletion while pending", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    let resolveDelete: ((deleted: boolean) => void) | undefined
    const onDelete = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveDelete = resolve
    }))

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe()}
          onDelete={onDelete}
        />
      </QueryClientProvider>
    )

    expect(screen.queryByRole("button", { name: /^Delete$/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Delete Recipe" }))

    const confirmButton = screen.getByRole("button", { name: /^Delete$/ })
    expect(confirmButton).toBeEnabled()
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled()
    })
    fireEvent.click(screen.getByRole("button", { name: "Deleting..." }))
    expect(onDelete).toHaveBeenCalledTimes(1)

    resolveDelete?.(true)
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    })
  })

  it("keeps deletion confirmation recoverable when the parent reports failure", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const onDelete = vi.fn().mockResolvedValue(false)

    render(
      <QueryClientProvider client={queryClient}>
        <RecipeDetailDialog
          open={true}
          onOpenChange={() => {}}
          recipeId="recipe-1"
          recipe={makeRecipe()}
          onDelete={onDelete}
        />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete Recipe" }))
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Delete$/ })).toBeEnabled()
  })
})
