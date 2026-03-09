import React from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UndoToastProvider, useUndoToast } from "../undo-toast"

function ToastHarness() {
  const { show } = useUndoToast()

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          show({
            message: "Saved changes",
            duration: 3000,
          })
        }}
      >
        Show info toast
      </button>
      <button
        type="button"
        onClick={() => {
          show({
            message: "Item removed",
            duration: 3000,
            queueBehavior: "enqueue",
            onUndo: () => undefined,
          })
        }}
      >
        Show undo toast
      </button>
    </div>
  )
}

describe("UndoToastProvider", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("dedupes repeated informational toasts instead of extending them", () => {
    vi.useFakeTimers()

    render(
      <UndoToastProvider>
        <ToastHarness />
      </UndoToastProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Show info toast" }))

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    fireEvent.click(screen.getByRole("button", { name: "Show info toast" }))

    act(() => {
      vi.advanceTimersByTime(2200)
    })

    expect(screen.queryByText("Saved changes")).not.toBeInTheDocument()
  })

  it("keeps queued undo toasts even when the message repeats", () => {
    vi.useFakeTimers()

    render(
      <UndoToastProvider>
        <ToastHarness />
      </UndoToastProvider>
    )

    fireEvent.click(screen.getByRole("button", { name: "Show undo toast" }))

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    fireEvent.click(screen.getByRole("button", { name: "Show undo toast" }))

    act(() => {
      vi.advanceTimersByTime(2200)
    })

    expect(screen.getByText("Item removed")).toBeInTheDocument()
  })
})
