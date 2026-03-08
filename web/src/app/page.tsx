import { cookies } from "next/headers"
import { HomePageClient } from "./home-page-client"
import { HOME_TAB_COOKIE, normalizeHomeTab } from "./home-tab-state"

export default async function HomePage() {
  const cookieStore = await cookies()
  const cookieTab = cookieStore.get(HOME_TAB_COOKIE)?.value
  const initialTab = normalizeHomeTab(cookieTab)

  return <HomePageClient initialTab={initialTab} />
}
