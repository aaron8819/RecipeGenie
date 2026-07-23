import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { Recipe } from "@/types/database"
import { RecipeCard } from "../recipe-card"

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
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

function makeRecipe(): Recipe {
  return {
    id: "recipe-1",
    user_id: "user-1",
    name: "Card Recipe",
    category: "Dinner",
    servings: 4,
    favorite: false,
    tags: ["Quick"],
    ingredients: [{ item: "Onion", amount: 1, unit: "" }],
    instructions: ["Cook it"],
    image_url: null,
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
  }
}

describe("RecipeCard", () => {
  it("opens recipe detail without exposing cooking controls on the card", () => {
    const onClick = vi.fn()
    const { container } = render(
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
    expect(container.querySelector(".grid-cols-3")).toBeInTheDocument()
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
