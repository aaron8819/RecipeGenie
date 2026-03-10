import React from "react"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SharedRecipesInbox } from "../shared-recipes-inbox"

const incomingState = {
  isLoading: false,
  error: null as Error | null,
  data: [] as Array<{
    id: string
    status: string
    created_at: string
    sender_email: string
    message: string | null
    source_recipe_snapshot: { name: string }
  }>,
}

const sentState = {
  isLoading: false,
  error: null as Error | null,
  data: [] as Array<{
    id: string
    status: string
    created_at: string
    recipient_email: string
    message: string | null
    source_recipe_snapshot: { name: string }
  }>,
}

vi.mock("@/hooks/use-recipe-shares", () => ({
  useIncomingRecipeShares: () => incomingState,
  useSentRecipeShares: () => sentState,
  useAcceptRecipeShare: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useDeclineRecipeShare: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
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

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe("SharedRecipesInbox", () => {
  beforeEach(() => {
    incomingState.isLoading = false
    incomingState.error = null
    incomingState.data = []
    sentState.isLoading = false
    sentState.error = null
    sentState.data = []
  })

  it("uses task-specific loading copy for both inbox tabs", () => {
    incomingState.isLoading = true
    sentState.isLoading = true

    render(<SharedRecipesInbox open onOpenChange={vi.fn()} />)

    expect(screen.getByText("Loading recipes shared with you...")).toBeInTheDocument()
    expect(screen.getByText("Loading recipes you have shared...")).toBeInTheDocument()
  })

  it("adds clearer next-step context to empty inbox states", () => {
    render(<SharedRecipesInbox open onOpenChange={vi.fn()} />)

    expect(screen.getByText("No recipes shared with you yet")).toBeInTheDocument()
    expect(
      screen.getByText("When someone shares a recipe with you, it will appear here to review and accept.")
    ).toBeInTheDocument()
    expect(screen.getByText("No shared recipes sent yet")).toBeInTheDocument()
    expect(
      screen.getByText("Open any recipe and use Share when you want to send one to someone else.")
    ).toBeInTheDocument()
  })
})
