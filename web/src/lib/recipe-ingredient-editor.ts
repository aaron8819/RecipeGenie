import type {
  CanonicalIngredient,
  IngredientSection,
} from "@/types/database"

export const EMPTY_EDITOR_INGREDIENT: CanonicalIngredient = {
  item: "",
  amount: null,
  unit: "",
}

export function addIngredientSection(
  sections: IngredientSection[],
  label = ""
): IngredientSection[] {
  return [...sections, { label, ingredients: [] }]
}

export function renameIngredientSection(
  sections: IngredientSection[],
  sectionIndex: number,
  label: string
): IngredientSection[] {
  return updateSection(sections, sectionIndex, (section) => ({
    ...section,
    label,
  }))
}

export function addIngredientToSection(
  sections: IngredientSection[],
  sectionIndex: number,
  ingredient: CanonicalIngredient = EMPTY_EDITOR_INGREDIENT
): IngredientSection[] {
  return updateSection(sections, sectionIndex, (section) => ({
    ...section,
    ingredients: [...section.ingredients, { ...ingredient }],
  }))
}

export function addUnsectionedIngredient(
  sections: IngredientSection[]
): IngredientSection[] {
  const sectionIndex = sections.findIndex((section) => section.label === null)
  if (sectionIndex >= 0) {
    return addIngredientToSection(sections, sectionIndex)
  }

  return [
    ...sections,
    { label: null, ingredients: [{ ...EMPTY_EDITOR_INGREDIENT }] },
  ]
}

export function removeIngredientFromSection(
  sections: IngredientSection[],
  sectionIndex: number,
  ingredientIndex: number
): IngredientSection[] {
  return updateSection(sections, sectionIndex, (section) => ({
    ...section,
    ingredients: section.ingredients.filter(
      (_, index) => index !== ingredientIndex
    ),
  }))
}

export function isIngredientSectionEmpty(
  section: IngredientSection
): boolean {
  return !section.ingredients.some((ingredient) =>
    Boolean(
      ingredient.item.trim() ||
        ingredient.unit.trim() ||
        ingredient.modifier?.trim() ||
        ingredient.amount !== null ||
        ingredient.alternatives?.some((alternative) => alternative.trim())
    )
  )
}

export function removeEmptyIngredientSection(
  sections: IngredientSection[],
  sectionIndex: number
): IngredientSection[] {
  const section = sections[sectionIndex]
  if (!section || !isIngredientSectionEmpty(section)) return sections
  return sections.filter((_, index) => index !== sectionIndex)
}

export function moveIngredientToSection(
  sections: IngredientSection[],
  sourceSectionIndex: number,
  ingredientIndex: number,
  requestedTargetIndex: number | null
): IngredientSection[] {
  const sourceSection = sections[sourceSectionIndex]
  const ingredient = sourceSection?.ingredients[ingredientIndex]
  if (!ingredient) return sections

  const nextSections = sections.map((section) => ({
    ...section,
    ingredients: [...section.ingredients],
  }))
  let targetSectionIndex = requestedTargetIndex

  if (targetSectionIndex === null) {
    targetSectionIndex = nextSections.findIndex(
      (section, index) => section.label === null && index !== sourceSectionIndex
    )
    if (targetSectionIndex < 0) {
      nextSections.push({ label: null, ingredients: [] })
      targetSectionIndex = nextSections.length - 1
    }
  }

  if (
    targetSectionIndex === sourceSectionIndex ||
    !nextSections[targetSectionIndex]
  ) {
    return sections
  }

  nextSections[sourceSectionIndex].ingredients.splice(ingredientIndex, 1)
  nextSections[targetSectionIndex].ingredients.push(ingredient)
  return nextSections
}

export function reorderIngredientsWithinSection(
  sections: IngredientSection[],
  sectionIndex: number,
  fromIndex: number,
  toIndex: number
): IngredientSection[] {
  if (fromIndex === toIndex) return sections

  return updateSection(sections, sectionIndex, (section) => {
    if (!section.ingredients[fromIndex] || !section.ingredients[toIndex]) {
      return section
    }

    const ingredients = [...section.ingredients]
    const [moved] = ingredients.splice(fromIndex, 1)
    ingredients.splice(toIndex, 0, moved)
    return { ...section, ingredients }
  })
}

function updateSection(
  sections: IngredientSection[],
  sectionIndex: number,
  updater: (section: IngredientSection) => IngredientSection
): IngredientSection[] {
  if (!sections[sectionIndex]) return sections
  return sections.map((section, index) =>
    index === sectionIndex ? updater(section) : section
  )
}
