import type { Metadata } from "next"
import { Outfit, Playfair_Display } from "next/font/google"
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={cn(outfit.variable, playfair.variable)}>
      <body className={outfit.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
