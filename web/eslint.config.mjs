import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"

const nextConfig = nextVitals.map((config) => {
  if (config.name !== "next" || !config.rules) return config

  // React Compiler is intentionally out of scope for this upgrade. Keep the
  // pre-upgrade hook contract instead of enabling its compiler lint suite.
  const rules = Object.fromEntries(
    Object.entries(config.rules).filter(
      ([name]) =>
        !name.startsWith("react-hooks/") ||
        name === "react-hooks/rules-of-hooks" ||
        name === "react-hooks/exhaustive-deps",
    ),
  )

  return { ...config, rules }
})

const pureModuleFiles = [
  "src/components/**/*.selectors.ts",
  "src/components/**/*.helpers.ts",
  "src/components/**/*.helpers.tsx",
  "src/components/**/*.utils.ts",
  "src/components/**/*.utils.tsx",
  "src/components/**/*.parser.ts",
  "src/components/**/*.validation.ts",
  "src/components/**/*.defaults.ts",
]

const componentTestFiles = [
  "src/components/**/__tests__/**",
  "src/components/**/tests/**",
]

const eslintConfig = defineConfig([
  ...nextConfig,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react/no-unescaped-entities": "off",
      "prefer-const": "off",
    },
  },
  {
    files: pureModuleFiles,
    ignores: componentTestFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/client",
              message:
                "Pure selector/helper modules must stay Supabase-free. Move client access into a hook.",
            },
            {
              name: "@/lib/supabase/server",
              message: "Pure selector/helper modules must stay Supabase-free.",
            },
            {
              name: "@/lib/supabase/admin",
              message: "Pure selector/helper modules must stay Supabase-free.",
            },
            {
              name: "@/lib/supabase/storage",
              importNames: ["uploadRecipeImage", "deleteRecipeImage"],
              message:
                "Pure selector/helper modules may only use pure helpers such as getRecipeImageUrl().",
            },
          ],
          patterns: [
            {
              group: ["@/hooks", "@/hooks/*", "@/hooks/**"],
              message: "Pure selector/helper modules must not import hooks.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.tsx"],
    ignores: componentTestFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/client",
              message:
                "Components must not access the Supabase client directly. Move DB access into a hook.",
            },
            {
              name: "@/lib/supabase/server",
              message: "Components must not access Supabase directly.",
            },
            {
              name: "@/lib/supabase/admin",
              message: "Components must not access Supabase admin helpers directly.",
            },
            {
              name: "@/lib/supabase/storage",
              importNames: ["uploadRecipeImage", "deleteRecipeImage"],
              message:
                "Components must use useRecipeImageStorage() for Supabase-backed image mutations. getRecipeImageUrl() remains allowed because it is pure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts", "**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
])

export default eslintConfig
