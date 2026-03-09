import React from "react"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useAsyncSubmit } from "../use-async-submit"

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

function Harness({
  action,
  onError,
  onSettled,
  onSuccess,
}: {
  action: () => Promise<void>
  onError?: (error: unknown) => void
  onSettled?: () => void
  onSuccess?: () => void
}) {
  const { error, isSubmitting, run } = useAsyncSubmit({
    getErrorMessage: (submitError) =>
      submitError instanceof Error ? submitError.message : "Submit failed",
  })

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void run(action, { onError, onSettled, onSuccess })
        }}
      >
        Submit
      </button>
      <div data-testid="pending">{isSubmitting ? "yes" : "no"}</div>
      <div data-testid="error">{error ?? ""}</div>
    </div>
  )
}

describe("useAsyncSubmit", () => {
  it("suppresses duplicate submits until the current request settles", async () => {
    const pending = deferred<void>()
    const action = vi.fn(() => pending.promise)

    render(<Harness action={action} />)

    await act(async () => {
      screen.getByRole("button", { name: "Submit" }).click()
      screen.getByRole("button", { name: "Submit" }).click()
      await Promise.resolve()
    })

    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("pending")).toHaveTextContent("yes")

    await act(async () => {
      pending.resolve()
      await pending.promise
    })

    expect(screen.getByTestId("pending")).toHaveTextContent("no")
  })

  it("stores the mapped error and runs settled callbacks after a failure", async () => {
    const onError = vi.fn()
    const onSettled = vi.fn()
    const action = vi.fn(async () => {
      throw new Error("Network down")
    })

    render(<Harness action={action} onError={onError} onSettled={onSettled} />)

    await act(async () => {
      screen.getByRole("button", { name: "Submit" }).click()
      await Promise.resolve()
    })

    expect(screen.getByTestId("error")).toHaveTextContent("Network down")
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId("pending")).toHaveTextContent("no")
  })
})
