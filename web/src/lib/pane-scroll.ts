"use client"

const ACTIVE_HOME_TAB_PANEL_SELECTOR = '[data-home-tab-panel][aria-hidden="false"]'

function isScrollableOverflow(value: string) {
  return value === "auto" || value === "scroll" || value === "overlay"
}

function findNearestScrollContainer(target: HTMLElement): HTMLElement | null {
  const activePanel = target.closest<HTMLElement>(ACTIVE_HOME_TAB_PANEL_SELECTOR)
  if (activePanel) {
    return activePanel
  }

  let current = target.parentElement
  while (current) {
    const { overflowY } = window.getComputedStyle(current)
    if (isScrollableOverflow(overflowY)) {
      return current
    }
    current = current.parentElement
  }

  return null
}

export function scrollNodeIntoPane(
  target: HTMLElement,
  options: {
    offset?: number
    behavior?: ScrollBehavior
  } = {}
) {
  if (!target.isConnected) return

  const { offset = 0, behavior = "auto" } = options
  const container = findNearestScrollContainer(target)

  if (!container) {
    target.scrollIntoView({ behavior, block: "start" })
    return
  }

  const containerRect = container.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
  const nextTop = Math.min(
    maxScrollTop,
    Math.max(0, container.scrollTop + (targetRect.top - containerRect.top) - offset)
  )

  container.scrollTo({ top: nextTop, behavior })
}
