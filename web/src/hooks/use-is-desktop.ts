"use client"

import { useState, useEffect } from "react"

const DESKTOP_QUERY = "(min-width: 768px)"

/**
 * Returns true when the viewport is ≥768px wide (md breakpoint).
 * Defaults to false on the server (SSR) and corrects on the client after mount.
 * Shares a single matchMedia listener instead of duplicating it across components.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(false)

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY)
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches)
    setIsDesktop(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  return isDesktop
}
