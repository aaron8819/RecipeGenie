import React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SaveTemplateDialog } from "../save-template-dialog"

const saveTemplateMutateAsync = vi.fn()
const undoToastShow = vi.fn()

vi.mock("@/hooks/use-plan-templates", () => ({
  useSavePlanTemplate: () => ({
    mutateAsync: saveTemplateMutateAsync,
    isPending: false,
  }),
}))

vi.mock("@/hooks/use-undo-toast", () => ({
  useUndoToast: () => ({
    show: undoToastShow,
  }),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor,
  }: {
    children: React.ReactNode
    htmlFor?: string
  }) => <label htmlFor={htmlFor}>{children}</label>,
}))

describe("SaveTemplateDialog", () => {
  beforeEach(() => {
    saveTemplateMutateAsync.mockReset()
    undoToastShow.mockReset()
  })

  it("confirms exactly what was saved", async () => {
    saveTemplateMutateAsync.mockResolvedValueOnce(undefined)

    render(
      <SaveTemplateDialog
        open={true}
        onOpenChange={vi.fn()}
        recipeIds={["recipe-1", "recipe-2"]}
        dayAssignments={{ "recipe-1": 1 }}
        categorySelection={{ Dinner: 2 }}
      />
    )

    fireEvent.change(screen.getByLabelText("Template Name"), {
      target: { value: "Weeknight Rotation" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save template/i }))

    await waitFor(() => {
      expect(undoToastShow).toHaveBeenCalledWith({
        message: 'Template "Weeknight Rotation" saved with 2 planned recipes',
        duration: 4000,
      })
    })
  })
})
