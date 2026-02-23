import type { Metadata } from "next"
import { Outfit, Playfair_Display } from "next/font/google"
import { headers } from "next/headers"
import "./globals.css"
import { Providers } from "@/components/providers"
import { cn } from "@/lib/utils"

const outfit = Outfit({
  subsets: ["latin"],
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
}

// Nonce-based CSP requires dynamic rendering so scripts get the per-request nonce
export const dynamic = "force-dynamic"

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Call headers() to trigger Next.js 15+ automatic nonce detection
  // Next.js reads the 'x-nonce' header from middleware and applies it to inline scripts
  await headers()

  return (
    <html lang="en" className={cn(outfit.variable, playfair.variable)}>
      <body className={cn(outfit.className, "min-h-0 flex flex-col overflow-hidden")}>
        <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  )
}
