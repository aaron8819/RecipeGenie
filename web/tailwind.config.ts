import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  safelist: [
    // Category tag colors
    "bg-red-100", "text-red-700",
    "bg-yellow-100", "text-yellow-800",
    "bg-orange-100", "text-orange-700",
    "bg-blue-100", "text-blue-700",
    // Custom tag colors
    "bg-purple-100", "text-purple-700",
    "bg-pink-100", "text-pink-700",
    "bg-indigo-100", "text-indigo-700",
    "bg-teal-100", "text-teal-700",
    "bg-cyan-100", "text-cyan-700",
    "bg-emerald-100", "text-emerald-700",
    "bg-amber-100", "text-amber-700",
    "bg-violet-100", "text-violet-700",
    "bg-rose-100", "text-rose-700",
    "bg-sky-100", "text-sky-700",
    "bg-lime-100", "text-lime-700",
    "bg-fuchsia-100", "text-fuchsia-700",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Extended Terracotta palette
        terracotta: {
          50: "hsl(20, 60%, 97%)",
          100: "hsl(20, 55%, 93%)",
          200: "hsl(18, 55%, 85%)",
          300: "hsl(17, 55%, 70%)",
          400: "hsl(16, 60%, 55%)",
          500: "hsl(16, 65%, 45%)",
          600: "hsl(14, 70%, 38%)",
          700: "hsl(12, 75%, 30%)",
          800: "hsl(10, 75%, 22%)",
          900: "hsl(8, 70%, 15%)",
        },
        // Extended Sage palette
        sage: {
          50: "hsl(100, 25%, 97%)",
          100: "hsl(100, 25%, 93%)",
          200: "hsl(100, 25%, 85%)",
          300: "hsl(100, 25%, 70%)",
          400: "hsl(100, 25%, 55%)",
          500: "hsl(100, 30%, 45%)",
          600: "hsl(100, 35%, 38%)",
          700: "hsl(100, 40%, 30%)",
          800: "hsl(100, 40%, 22%)",
          900: "hsl(100, 35%, 15%)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "flip": {
          "0%": { transform: "rotateY(0)" },
          "50%": { transform: "rotateY(90deg)" },
          "100%": { transform: "rotateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "scale-in": "scale-in 0.15s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        "flip": "flip 0.6s ease-in-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
