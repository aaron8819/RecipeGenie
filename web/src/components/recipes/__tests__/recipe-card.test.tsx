import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Recipe } from "@/types/database"
import { RecipeCard } from "../recipe-card"
import { canonicalizeRecipeFixture } from "@/test/recipe-fixtures"

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

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children, onCloseAutoFocus }: { children: React.ReactNode; onCloseAutoFocus?: (event: Event) => void }) => <div>{children}<button type="button" onClick={() => onCloseAutoFocus?.(new Event("close", { cancelable: true }))}>Close menu</button></div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: { children: React.ReactNode; onSelect?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={() => onSelect?.()} disabled={disabled}>
      {children}
    </button>
  ),
}))

function makeRecipe(): Recipe {
  return canonicalizeRecipeFixture({
    id: "recipe-1",
    user_id: "user-1",
    name: "Card Recipe",
    category: "Dinner",
    servings: 4,
    favorite: false,
    tags: ["Quick"],
    fixtureIngredients: [{ item: "Onion", amount: 1, unit: "" }],
    fixtureInstructions: ["Cook it"],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  })
}

describe("RecipeCard", () => {
  it("opens recipe detail without exposing cooking controls on the card", () => {
    const onClick = vi.fn()
    render(
      <RecipeCard
        recipe={makeRecipe()}
        isDesktopViewport
        onClick={onClick}
        onAddToPlan={vi.fn()}
        onAddToShoppingList={vi.fn()}
        onShare={vi.fn()}
      />
    )

    fireEvent.click(screen.getByText("Card Recipe"))

    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ id: "recipe-1" }))
    expect(screen.queryByText(/cook mode/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/start cooking/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/mark as made/i)).not.toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Card Recipe/ })
    expect(link).toHaveAttribute("href", "/recipes/recipe-1?from=recipes")
    expect(link.querySelector("button")).toBeNull()
  })

  it("keeps favorite, pending menu actions, and tag filters separate from navigation", () => {
    const open = vi.fn()
    const favorite = vi.fn()
    const tag = vi.fn()
    const shop = vi.fn()
    render(<RecipeCard recipe={makeRecipe()} viewMode="list" onClick={open} onToggleFavorite={favorite} onTagClick={tag} onAddToShoppingList={shop} isAddingToShoppingList />)
    fireEvent.click(screen.getByRole("button", { name: "Add Card Recipe to favorites" }))
    fireEvent.click(screen.getByRole("button", { name: "Filter by Quick" }))
    expect(tag).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }))
    fireEvent.click(screen.getByRole("button", { name: "Add to Shopping List" }))
    expect(favorite).toHaveBeenCalledOnce()
    expect(tag).toHaveBeenCalledWith("Quick")
    expect(shop).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it("recovers a broken photo without dropping the recipe link", () => {
    const recipe = { ...makeRecipe(), image_url: "https://example.com/broken.jpg" }
    const { container } = render(<RecipeCard recipe={recipe} />)
    fireEvent.error(container.querySelector("img")!)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByRole("link", { name: /Card Recipe/ })).toBeInTheDocument()
  })

  it("keeps mobile card utilities in a touch-sized overflow menu", () => {
    render(
      <RecipeCard
        recipe={makeRecipe()}
        isDesktopViewport={false}
        onAddToPlan={vi.fn()}
        onAddToShoppingList={vi.fn()}
        onShare={vi.fn()}
      />
    )

    const actions = screen.getByTitle("Actions")
    expect(actions).toHaveClass("h-11", "w-11")
    expect(screen.getByText("Add to Shopping List")).toBeInTheDocument()
    expect(screen.getByText("Add to Meal Plan")).toBeInTheDocument()
    expect(screen.getByText("Share Recipe")).toBeInTheDocument()
    expect(screen.queryByText(/mark as made/i)).not.toBeInTheDocument()
  })
})
