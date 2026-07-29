import { cookies } from "next/headers"
import { HomePageClient } from "./home-page-client"
import {
  HOME_TAB_COOKIE,
  HOME_TAB_RECONCILIATION_COOKIE,
  isValidHomeTab,
  normalizeHomeTab,
} from "./home-tab-state"

export default async function HomePage() {
  const cookieStore = await cookies()
  const cookieTab = cookieStore.get(HOME_TAB_COOKIE)?.value
  const initialTab = normalizeHomeTab(cookieTab)
  const reconciliationTab = cookieStore.get(
    HOME_TAB_RECONCILIATION_COOKIE
  )?.value
  const initialTabIsAuthoritative =
    !!reconciliationTab &&
    isValidHomeTab(reconciliationTab) &&
    reconciliationTab === initialTab

  return (
    <HomePageClient
      initialTab={initialTab}
      initialTabIsAuthoritative={initialTabIsAuthoritative}
    />
  )
}
