import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postcss, {
  type AtRule,
  type Declaration,
  type Root,
  type Rule,
} from "postcss"
import { describe, expect, it } from "vitest"
import tailwindConfig from "../../../tailwind.config"

const canonicalTokens = {
  canvas: "250 248 245",
  shell: "255 248 246",
  "surface-raised": "248 246 240",
  "surface-highest": "255 255 255",
  "border-warm": "230 224 216",
  "brand-primary": "47 75 52",
  "emphasis-dark": "25 52 31",
  cta: "224 106 83",
  "semantic-secondary": "163 61 42",
  "text-primary": "36 25 21",
  "text-variant": "66 72 66",
  "text-muted": "139 128 123",
  error: "186 26 26",
  focus: "47 75 52",
  "accent-peach": "251 231 209",
  "accent-mint": "220 244 233",
  "accent-lavender": "232 225 245",
  "accent-rose": "252 228 228",
} as const

const shadcnAliases = {
  background: "40 33% 98%",
  foreground: "20 25% 15%",
  card: "40 25% 98%",
  "card-foreground": "20 25% 15%",
  popover: "40 25% 98%",
  "popover-foreground": "20 25% 15%",
  primary: "102 26% 28%",
  "primary-foreground": "40 40% 98%",
  secondary: "95 18% 57%",
  "secondary-foreground": "40 40% 98%",
  muted: "35 15% 95%",
  "muted-foreground": "20 10% 50%",
  accent: "10 72% 65%",
  "accent-foreground": "40 40% 98%",
  destructive: "0 84.2% 60.2%",
  "destructive-foreground": "210 40% 98%",
  border: "30 20% 88%",
  input: "30 20% 88%",
  ring: "102 26% 28%",
} as const

const globalsCss = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8"
)

const isBaseLayer = (node: AtRule) =>
  node.name === "layer" && node.params.trim() === "base"

const isRootRule = (node: Rule) => node.selector.trim() === ":root"

const findGlobalRootContracts = (stylesheet: Root) =>
  stylesheet.nodes.flatMap((node) => {
    if (node.type !== "atrule" || !isBaseLayer(node)) {
      return []
    }

    return (node.nodes ?? []).filter(
      (child): child is Rule => child.type === "rule" && isRootRule(child)
    )
  })

const findDeclarations = (stylesheet: Root, property: string) => {
  const declarations: Declaration[] = []

  stylesheet.walkDecls(property, (declaration) => {
    declarations.push(declaration)
  })

  return declarations
}

const findDirectDeclarations = (rule: Rule, property: string) =>
  (rule.nodes ?? []).filter(
    (node): node is Declaration =>
      node.type === "decl" && node.prop === property
  )

const getCanonicalContractViolations = (source: string) => {
  const stylesheet = postcss.parse(source)
  const rootContracts = findGlobalRootContracts(stylesheet)
  const violations: string[] = []

  if (rootContracts.length !== 1) {
    violations.push(
      `expected one global @layer base > :root contract, found ${rootContracts.length}`
    )
  }

  for (const [role, value] of Object.entries(canonicalTokens)) {
    const property = `--rg-desktop-${role}`
    const allDeclarations = findDeclarations(stylesheet, property)
    const directDeclarations = rootContracts.flatMap((rootContract) =>
      findDirectDeclarations(rootContract, property)
    )

    if (allDeclarations.length !== 1) {
      violations.push(
        `${property} must appear once globally; found ${allDeclarations.length}`
      )
    }

    if (directDeclarations.length !== 1) {
      violations.push(
        `${property} must be declared directly in the root contract once; ` +
          `found ${directDeclarations.length}`
      )
    } else if (directDeclarations[0].value.trim() !== value) {
      violations.push(
        `${property} must equal ${value}; found ${directDeclarations[0].value}`
      )
    }
  }

  return violations
}

const canonicalDeclarations = Object.entries(canonicalTokens).map(
  ([role, value]) => `--rg-desktop-${role}: ${value};`
)
const canvasDeclaration = canonicalDeclarations[0]
const declarationsWithoutCanvas = canonicalDeclarations.slice(1).join(" ")
const buildFixture = (rootContent: string, extraContent = "") =>
  `@layer base { :root { ${rootContent} } } ${extraContent}`

const stylesheet = postcss.parse(globalsCss)
const rootContracts = findGlobalRootContracts(stylesheet)
const cssVariables: Declaration[] = []
stylesheet.walkDecls((declaration) => {
  if (declaration.prop.startsWith("--")) {
    cssVariables.push(declaration)
  }
})
const colors = tailwindConfig.theme?.extend?.colors as Record<string, unknown>

describe("desktop redesign token contract", () => {
  it("defines each exact canonical value once in the global root contract", () => {
    expect(getCanonicalContractViolations(globalsCss)).toEqual([])

    for (const value of Object.values(canonicalTokens)) {
      expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/)
    }
  })

  it("handles multiple declarations on one line without weakening exactness", () => {
    const sameLineFixture = buildFixture(canonicalDeclarations.join(" "))
    const duplicateFixture = buildFixture(
      `${canonicalDeclarations.join(" ")} ${canvasDeclaration}`
    )

    expect(getCanonicalContractViolations(sameLineFixture)).toEqual([])
    expect(getCanonicalContractViolations(duplicateFixture)).toContain(
      "--rg-desktop-canvas must appear once globally; found 2"
    )
  })

  it.each([
    [
      "a comment",
      buildFixture(
        `/* ${canvasDeclaration} */ ${declarationsWithoutCanvas}`
      ),
    ],
    [
      ".dark",
      buildFixture(
        declarationsWithoutCanvas,
        `.dark { ${canvasDeclaration} }`
      ),
    ],
    [
      "another selector",
      buildFixture(
        declarationsWithoutCanvas,
        `.token-owner { ${canvasDeclaration} }`
      ),
    ],
    [
      "a nested selector",
      buildFixture(
        `${declarationsWithoutCanvas} .dark { ${canvasDeclaration} }`
      ),
    ],
    [
      "a nested at-rule",
      buildFixture(
        `${declarationsWithoutCanvas} ` +
          `@media (min-width: 1px) { :root { ${canvasDeclaration} } }`
      ),
    ],
    [
      "another root contract",
      buildFixture(
        declarationsWithoutCanvas,
        `@layer base { :root { ${canvasDeclaration} } }`
      ),
    ],
  ])("rejects a canonical declaration moved to %s", (_label, fixture) => {
    expect(getCanonicalContractViolations(fixture)).not.toEqual([])
  })

  it("maps each semantic role through opacity-aware RGB syntax", () => {
    for (const role of Object.keys(canonicalTokens)) {
      expect(colors[role]).toBe(
        `rgb(var(--rg-desktop-${role}) / <alpha-value>)`
      )
    }
  })

  it("preserves the shadcn compatibility aliases", () => {
    for (const [alias, value] of Object.entries(shadcnAliases)) {
      const variable = `--${alias}`
      const matches = cssVariables.filter(
        (declaration) => declaration.prop === variable
      )

      expect(matches).toHaveLength(1)
      expect(matches[0]?.value).toBe(value)
    }

    expect(colors).toMatchObject({
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
    })

    expect(colors["card-cream"]).toBe(
      "rgb(var(--rg-desktop-surface-raised) / <alpha-value>)"
    )
    expect(
      rootContracts.flatMap((rootContract) =>
        findDirectDeclarations(
          rootContract,
          "--rg-desktop-surface-raised"
        )
      )[0]?.value.trim()
    ).toBe("248 246 240")
  })
})
