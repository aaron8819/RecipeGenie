import type { Metadata, Viewport } from "next"
import { Outfit, Playfair_Display } from "next/font/google"
import { headers } from "next/headers"
import "./globals.css"
import { Providers } from "@/components/providers"
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
  manifest: "/manifest.json",
  icons: {
    icon: [
      {
        url: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
    ],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico",
  },
  appleWebApp: {
    capable: true,
    title: "Recipe Genie",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  themeColor: "#2F4B34",
}

// PERF TRADEOFF: force-dynamic prevents edge/CDN caching of the page shell.
// It is required because layout calls headers() to read the per-request x-nonce
// set by the proxy. Next.js uses that value to stamp inline scripts with a
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
  // Call headers() to trigger automatic nonce detection.
  // Next.js reads the 'x-nonce' header from the proxy and applies it to inline scripts.
  await headers()

  return (
    <html lang="en" className={cn(outfit.variable, playfair.variable)}>
      <body className={cn(outfit.className, "min-h-screen overflow-x-hidden")}>
        <div className="min-h-screen min-w-0">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  )
}
