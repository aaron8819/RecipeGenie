import type { Metadata, Viewport } from "next"
import { Outfit, Playfair_Display } from "next/font/google"
import { headers } from "next/headers"
import "./globals.css"
import { Providers } from "@/components/providers"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-outfit",
})
const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-playfair",
})

export const metadata: Metadata = {
  title: "Recipe Genie",
  description: "Meal planning and recipe management made easy",
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  themeColor: '#3d5a2e',
}

// PERF TRADEOFF: force-dynamic prevents edge/CDN caching of the page shell.
// It is required because layout calls headers() to read the per-request x-nonce
// set by middleware. Next.js 15 uses that value to stamp inline scripts with a
// matching nonce, which is the mechanism that makes our nonce-based CSP effective.
// Without it, headers() would not receive a per-request nonce and every page would
// share the same nonce — defeating its entire security purpose.
// DO NOT remove without replacing nonce-based CSP with a hash-based policy first.
export const dynamic = "force-dynamic"

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Call headers() to trigger Next.js 15+ automatic nonce detection.
  // Next.js reads the 'x-nonce' header from middleware and applies it to inline scripts.
  await headers()

  // Read the cookie session for fast bootstrap, then verify the user server-side.
  // Supabase warns against trusting session.user from getSession() in server code.
  const supabase = await createClient()
  const { data: { session: initialSession } } = await supabase.auth.getSession()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const verifiedInitialSession =
    initialSession && user
      ? {
          ...initialSession,
          user,
        }
      : null

  return (
    <html lang="en" className={cn(outfit.variable, playfair.variable)}>
      <body className={cn(outfit.className, "min-h-0 flex flex-col overflow-hidden")}>
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          <Providers initialSession={verifiedInitialSession}>{children}</Providers>
        </div>
      </body>
    </html>
  )
}
