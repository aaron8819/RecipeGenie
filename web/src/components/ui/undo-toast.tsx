"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import { X } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

interface UndoToastOptions {
  message: string
  duration?: number // default 5000ms
  onUndo?: () => void // Optional - if not provided, shows informational toast without undo button
  onExpire?: () => void
  onDismiss?: () => void
  queueBehavior?: "replace" | "enqueue"
  dedupeKey?: string
}

interface UndoToastContextValue {
  show: (options: UndoToastOptions) => void
  dismiss: () => void
}

const UndoToastContext = createContext<UndoToastContextValue | null>(null)

export function useUndoToast() {
  const context = useContext(UndoToastContext)
  if (!context) {
    throw new Error("useUndoToast must be used within an UndoToastProvider")
  }
  return context
}

interface ToastState {
  message: string
  duration: number
  onUndo?: () => void
  onExpire?: () => void
  onDismiss?: () => void
  queueBehavior: "replace" | "enqueue"
  dedupeKey: string
  startTime: number
}

function resolveDedupeKey(options: UndoToastOptions) {
  return options.dedupeKey ?? `${options.onUndo ? "undo" : "info"}:${options.message}`
}

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [progress, setProgress] = useState(100)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const animationRef = useRef<number | null>(null)
  const toastRef = useRef<ToastState | null>(null)
  const queueRef = useRef<UndoToastOptions[]>([])

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [])

  const showNextToast = useCallback(() => {
    const nextOptions = queueRef.current.shift()
    if (!nextOptions) {
      setToast(null)
      toastRef.current = null
      return
    }

    const duration = nextOptions.duration ?? 5000
    const startTime = Date.now()
    const nextToast: ToastState = {
      message: nextOptions.message,
      duration,
      onUndo: nextOptions.onUndo,
      onExpire: nextOptions.onExpire,
      onDismiss: nextOptions.onDismiss,
      queueBehavior: nextOptions.queueBehavior ?? "replace",
      dedupeKey: resolveDedupeKey(nextOptions),
      startTime,
    }

    toastRef.current = nextToast
    setToast(nextToast)
    setProgress(100)
    setIsVisible(true)

    timerRef.current = setTimeout(() => {
      nextToast.onExpire?.()
      clearTimers()
      setIsVisible(false)
      setTimeout(() => {
        showNextToast()
      }, 200)
    }, duration)

    const updateProgress = () => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)

      if (remaining > 0) {
        animationRef.current = requestAnimationFrame(updateProgress)
      }
    }
    animationRef.current = requestAnimationFrame(updateProgress)
  }, [clearTimers])

  const dismiss = useCallback(() => {
    clearTimers()
    toastRef.current?.onDismiss?.()
    setIsVisible(false)
    setTimeout(() => {
      showNextToast()
    }, 200)
  }, [clearTimers, showNextToast])

  const show = useCallback((options: UndoToastOptions) => {
    const nextBehavior = options.queueBehavior ?? "replace"
    const activeToast = toastRef.current
    const dedupeKey = resolveDedupeKey(options)
    const shouldDedupe =
      !options.onUndo &&
      nextBehavior !== "enqueue" &&
      (
        activeToast?.dedupeKey === dedupeKey ||
        queueRef.current.some((queuedToast) => resolveDedupeKey(queuedToast) === dedupeKey)
      )

    if (shouldDedupe) {
      return
    }

    if (activeToast && (activeToast.queueBehavior === "enqueue" || nextBehavior === "enqueue")) {
      queueRef.current.push(options)
      return
    }

    if (activeToast) {
      clearTimers()
      setIsVisible(false)
      queueRef.current = [options]
      setTimeout(() => {
        showNextToast()
      }, 200)
      return
    }

    queueRef.current.push(options)
    showNextToast()
  }, [clearTimers, showNextToast])

  const handleUndo = useCallback(() => {
    if (toast && toast.onUndo) {
      clearTimers()
      toast.onUndo()
      setIsVisible(false)
      setTimeout(() => {
        showNextToast()
      }, 200)
    }
  }, [toast, clearTimers, showNextToast])

  // Flush any pending deferred action and cancel timers on unmount.
  // This catches cases like tab navigation where the provider unmounts
  // while a deferred-delete toast is still active.
  useEffect(() => {
    return () => {
      toastRef.current?.onExpire?.()
      clearTimers()
    }
  }, [clearTimers])

  return (
    <UndoToastContext.Provider value={{ show, dismiss }}>
      {children}

      {/* Toast Container */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 px-3 transition-all duration-200 sm:left-1/2 sm:right-auto sm:w-auto sm:-translate-x-1/2 sm:px-0",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
        role="alert"
        aria-live="polite"
        aria-atomic="true"
      >
        {toast && (
          <div className="w-full overflow-hidden rounded-lg bg-foreground text-background shadow-lg sm:min-w-[280px] sm:max-w-[400px]">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm">{toast.message}</span>
              {toast.onUndo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleUndo}
                  className="h-8 shrink-0 px-3 font-medium text-background hover:bg-background/20 hover:text-background"
                >
                  Undo
                </Button>
              )}
              <button
                onClick={dismiss}
                className="shrink-0 text-background/60 transition-colors hover:text-background"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Progress bar */}
            <div className="h-1 bg-background/20">
              <div
                className="h-full bg-primary transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </UndoToastContext.Provider>
  )
}
