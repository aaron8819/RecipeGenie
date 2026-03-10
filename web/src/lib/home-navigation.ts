"use client"

import { HOME_TAB_COOKIE, HOME_TAB_STORAGE_KEY, type HomeTab } from "@/app/home-tab-state"

export const HOME_TAB_NAVIGATE_EVENT = "recipe-genie:navigate-home-tab"

export function persistHomeTab(tab: HomeTab) {
  localStorage.setItem(HOME_TAB_STORAGE_KEY, tab)
  document.cookie = `${HOME_TAB_COOKIE}=${encodeURIComponent(tab)}; Path=/; Max-Age=31536000; SameSite=Lax`
}

export function navigateToHomeTab(tab: HomeTab) {
  persistHomeTab(tab)
  window.dispatchEvent(
    new CustomEvent<{ tab: HomeTab }>(HOME_TAB_NAVIGATE_EVENT, {
      detail: { tab },
    })
  )
}
