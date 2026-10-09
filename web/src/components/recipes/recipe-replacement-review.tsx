import { recipeIngredientText } from '@/lib/recipe-plain-text'
import type { RecipeDialogFormValues } from './recipe-dialog.defaults'

function ingredientReviewRows(values: RecipeDialogFormValues) {
  return values.ingredientSections.flatMap(section => section.ingredients.map(ingredient => ({
    item: ingredient.item,
    text: [section.label, recipeIngredientText(ingredient, values.servings, values.servings)].filter(Boolean).join(': '),
  })))
}

export function replacementReviewSections(values: RecipeDialogFormValues) {
  return [
    { label: 'Title', text: values.name },
    { label: 'Servings', text: values.yieldText || `${values.servings} servings` },
    { label: 'Times', text: [values.prepTimeMinutes, values.cookTimeMinutes, values.totalTimeMinutes]
      .map((time, index) => `${['Prep', 'Cook', 'Total'][index]}: ${time == null ? 'Not set' : `${time} min`}`).join('\n') },
    { label: 'Ingredients', text: values.ingredientSections.map(section =>
      [section.label, ...section.ingredients.map(ingredient => recipeIngredientText(ingredient, values.servings, values.servings))]
        .filter(Boolean).join('\n')).join('\n\n') },
    { label: 'Instructions', text: values.instructionGroups.map(group =>
      [group.label, ...group.steps.map((step, index) => `${index + 1}. ${step}`)].filter(Boolean).join('\n')).join('\n\n') },
    { label: 'Notes', text: values.notes || 'None' },
    { label: 'Category', text: values.category },
    { label: 'Tags', text: values.tags.join(', ') || 'None' },
    { label: 'Image', text: values.imageUrl || 'None' },
  ]
}

export function RecipeReplacementReview({ current, updated, unparsed, warnings }: {
  current: RecipeDialogFormValues
  updated: RecipeDialogFormValues
  unparsed: string[]
  warnings: string[]
}) {
  const before = replacementReviewSections(current)
  const after = replacementReviewSections(updated)
  const changed = after.filter((section, index) => section.text !== before[index].text)
  const unchanged = after.filter((section, index) => section.text === before[index].text)
  const oldIngredients = ingredientReviewRows(current)
  const newIngredients = ingredientReviewRows(updated)
  // Compare ordered occurrences. Repeated ingredients and section labels remain distinct.
  const ingredientChanges = Array.from({ length: Math.max(oldIngredients.length, newIngredients.length) }, (_, index) => ({
    before: oldIngredients[index], after: newIngredients[index],
  })).filter(row => row.before?.text !== row.after?.text)
  const retainedIngredients = newIngredients.length - ingredientChanges.filter(row => row.after).length
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-4 text-base sm:py-6" data-testid="replacement-review">
      <h2 className="font-display text-4xl font-semibold">{updated.name}</h2>
      <p>{updated.yieldText}</p>
      <p className="text-muted-foreground">Updates this recipe. Its link, favorite and cooking history stay the same.</p>
      {unparsed.length > 0 && <div role="alert" className="rounded-xl border border-destructive p-4">
        <h3 className="font-semibold">Some text could not be included</h3>
        <p>Return to the text and move this content into a supported section, such as Notes. Saving is blocked until it can all be included.</p>
        <ul className="mt-3 list-inside list-disc whitespace-pre-wrap">{unparsed.map((text, index) => <li key={index}>{text}</li>)}</ul>
      </div>}
      {warnings.length > 0 && <details open className="rounded-xl border p-4">
        <summary className="min-h-11 cursor-pointer font-semibold">Parsing notes ({warnings.length})</summary>
        <ul className="list-inside list-disc">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </details>}
      <h3 className="text-xl font-semibold">{ingredientChanges.length} ingredient change{ingredientChanges.length === 1 ? '' : 's'}</h3>
      {ingredientChanges.map((row, index) => <section key={index} className="space-y-3 rounded-xl border p-4">
        <h4 className="text-lg font-semibold">{row.after?.item || row.before?.item}</h4>
        <div><p className="text-xs uppercase text-muted-foreground">Current</p><p className="whitespace-pre-wrap break-words">{row.before?.text || 'Not included'}</p></div>
        <div className="rounded-lg bg-primary/10 p-3"><p className="text-xs uppercase text-primary">Updated</p><p className="whitespace-pre-wrap break-words">{row.after?.text || 'Removed'}</p></div>
      </section>)}
      <p className="text-muted-foreground">{retainedIngredients} ingredient{retainedIngredients === 1 ? '' : 's'} unchanged.</p>
      {changed.some(section => section.label !== 'Ingredients') && <h3 className="text-xl font-semibold">Other changes</h3>}
      {after.map((section, index) => section.label !== 'Ingredients' && section.text !== before[index].text &&
        <section key={section.label} className="space-y-3 rounded-xl border p-4">
          <h4 className="text-lg font-semibold">{section.label}</h4>
          <div><p className="text-xs uppercase text-muted-foreground">Current</p><p className="whitespace-pre-wrap break-words">{before[index].text}</p></div>
          <div className="rounded-lg bg-primary/10 p-3"><p className="text-xs uppercase text-primary">Updated</p><p className="whitespace-pre-wrap break-words">{section.text}</p></div>
        </section>)}
      <p className="text-muted-foreground">Unchanged: {unchanged.map(section => section.label.toLowerCase()).join(', ') || 'None'}.</p>
      <details className="rounded-xl border p-4">
        <summary className="min-h-11 cursor-pointer text-lg font-semibold text-primary">Full recipe</summary>
        {after.map(section => <section className="mt-4" key={section.label}>
          <h4 className="font-semibold">{section.label}</h4><p className="whitespace-pre-wrap break-words">{section.text}</p>
        </section>)}
      </details>
    </div>
  )
}
