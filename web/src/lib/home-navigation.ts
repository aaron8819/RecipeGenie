"use client"

import {
  HOME_TAB_COOKIE,
  HOME_TAB_RECONCILIATION_COOKIE,
  HOME_TAB_STORAGE_KEY,
  isValidHomeTab,
  type HomeTab,
} from "@/app/home-tab-state"

export const HOME_TAB_NAVIGATE_EVENT = "recipe-genie:navigate-home-tab"

export function readPersistedHomeTab(): HomeTab | null {
  try {
    const tab = localStorage.getItem(HOME_TAB_STORAGE_KEY)
    return tab && isValidHomeTab(tab) ? tab : null
  } catch {
    return null
  }
}

export function persistHomeTab(tab: HomeTab) {
  try {
    document.cookie = `${HOME_TAB_COOKIE}=${encodeURIComponent(tab)}; Path=/; Max-Age=31536000; SameSite=Lax`
  } catch {
    // Local storage remains available when cookie persistence is disabled.
  }

  let localStorageUpdated = false
  try {
    localStorage.setItem(HOME_TAB_STORAGE_KEY, tab)
    localStorageUpdated = true
  } catch {
    // The server-readable cookie remains the authoritative fallback.
  }

  try {
    document.cookie = localStorageUpdated
      ? `${HOME_TAB_RECONCILIATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${HOME_TAB_RECONCILIATION_COOKIE}=${encodeURIComponent(tab)}; Path=/; SameSite=Lax`
  } catch {
    // Navigation still works when cookies are unavailable.
  }
}

export function navigateToHomeTab(tab: HomeTab) {
  persistHomeTab(tab)
  window.dispatchEvent(
    new CustomEvent<{ tab: HomeTab }>(HOME_TAB_NAVIGATE_EVENT, {
      detail: { tab },
    })
  )
}
