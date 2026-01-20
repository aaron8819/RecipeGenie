"use client"

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react"
import { X } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/lib/utils"

interface UndoToastOptions {
  message: string
  duration?: number // default 5000ms
  onUndo: () => void
  onExpire?: () => void
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
  onUndo: () => void
  onExpire?: () => void
  startTime: number
}

export function UndoToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [progress, setProgress] = useState(100)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const animationRef = useRef<number | null>(null)

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

  const dismiss = useCallback(() => {
    clearTimers()
    setIsVisible(false)
    // Wait for exit animation before clearing toast
    setTimeout(() => setToast(null), 200)
  }, [clearTimers])

  const show = useCallback((options: UndoToastOptions) => {
    clearTimers()

    const duration = options.duration ?? 5000
    const startTime = Date.now()

    setToast({
      message: options.message,
      duration,
      onUndo: options.onUndo,
      onExpire: options.onExpire,
      startTime,
    })
    setProgress(100)
    setIsVisible(true)

    // Set up expiration timer
    timerRef.current = setTimeout(() => {
      options.onExpire?.()
      dismiss()
    }, duration)

    // Animate progress bar
    const updateProgress = () => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)

      if (remaining > 0) {
        animationRef.current = requestAnimationFrame(updateProgress)
      }
    }
    animationRef.current = requestAnimationFrame(updateProgress)
  }, [clearTimers, dismiss])

  const handleUndo = useCallback(() => {
    if (toast) {
      clearTimers()
      toast.onUndo()
      setIsVisible(false)
      setTimeout(() => setToast(null), 200)
    }
  }, [toast, clearTimers])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimers()
  }, [clearTimers])

  return (
    <UndoToastContext.Provider value={{ show, dismiss }}>
      {children}

      {/* Toast Container */}
      <div
        className={cn(
          "fixed bottom-24 left-1/2 -translate-x-1/2 z-50 transition-all duration-200",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
        )}
        role="alert"
        aria-live="polite"
      >
        {toast && (
          <div className="bg-foreground text-background rounded-lg shadow-lg overflow-hidden min-w-[280px] max-w-[400px]">
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="flex-1 text-sm">{toast.message}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUndo}
                className="h-8 px-3 text-background hover:text-background hover:bg-background/20 font-medium"
              >
                Undo
              </Button>
              <button
                onClick={dismiss}
                className="text-background/60 hover:text-background transition-colors"
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
