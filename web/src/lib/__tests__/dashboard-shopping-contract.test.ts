import { describe, expect, it } from 'vitest';
import { canonicalizeRecipeFixture } from '@/test/recipe-fixtures';
import { createEmptyShoppingDocument, projectShoppingDocument, validateShoppingDocumentV3 } from '../shopping-document';
import { initializeShoppingDocument, readInitializedDocument } from '../shopping-initialization';
import { createSelectedShoppingEntry, initialShoppingSelection } from '../shopping-selection';
import { planShoppingCommand, type ShoppingCommandContext } from '../shopping-command-planner';
import { readShoppingCommand, type ShoppingCommand } from '../shopping-command';
import { shoppingRowCoverage } from '../shopping-coverage-runtime';

const recipe = canonicalizeRecipeFixture({ fixtureIngredients: [
  { item: 'milk', amount: 1, unit: 'cup' }, { item: 'carrot', amount: 2, unit: '' },
] });
const row = { ...recipe, recipe_uuid: recipe.id, ingredient_sections: recipe.ingredientSections,
  instruction_sections: recipe.instructionSections, yield_metadata: null };
function context(v4: boolean): ShoppingCommandContext {
  const document = createEmptyShoppingDocument();
  return { status: 'Pending', row: { document: v4 ? initializeShoppingDocument(document, []) : document,
    content_revision: 0 }, dependencyRevision: '0', pantry: [], recipes: [row], inverse: null, inverseRevision: null };
}
const selection = { ...initialShoppingSelection(recipe, undefined, 1.5).selection, ingredientOrdinals: [1] };
const command: ShoppingCommand = { protocol: 1, observedRevision: 0, sourceSelections: [selection],
  mutation: { type: 'upsertRecipes', entries: [createSelectedShoppingEntry(recipe, selection)] } };

describe('integrated Dashboard Shopping contracts', () => {
  it.each([false, true])('admits partial scaled sources, saved recovery and idempotent replacement (V4=%s)', v4 => {
    expect(readShoppingCommand(JSON.parse(JSON.stringify(command)))).toEqual(JSON.parse(JSON.stringify(command)));
    const c = context(v4);
    const added = planShoppingCommand(c, command);
    expect(added.outcome).toBe('Applied');
    const saved = added.document.recipeEntries[recipe.id];
    expect(saved.ingredients).toHaveLength(1);
    expect(saved.selectedServings).toBe(6);
    expect(saved.ingredients[0].quantity?.amount).toBe(3);
    expect(initialShoppingSelection(recipe, saved, 9).selection).toEqual(selection);
    if (v4) {
      expect(readInitializedDocument(added.document, validateShoppingDocumentV3)).not.toBeNull();
      expect(saved.sourceEvidence?.occurrences.map(s => s.ordinal)).toEqual([1]);
      expect(saved.sourceEvidence?.occurrences[0].id).toContain(':0:1');
    }
    c.row = { document: added.document, content_revision: 1 };
    const again = planShoppingCommand(c, { ...command, observedRevision: 1 });
    expect(again.outcome).toBe('Unchanged');
    expect(again.document).toEqual(added.document);
  });
  it.each([false, true])('rejects stale snapshot, forged quantities and foreign sources (V4=%s)', v4 => {
    const c = context(v4);
    const stale = structuredClone(command); stale.sourceSelections![0].contentSnapshot = 'stale';
    expect(planShoppingCommand(c, stale).outcome).not.toBe('Applied');
    const forged = structuredClone(command);
    if (forged.mutation.type === 'upsertRecipes') forged.mutation.entries[0].selectedServings = 99;
    expect(planShoppingCommand(c, forged).outcome).toBe('Conflict');
    const foreign = structuredClone(command); foreign.sourceSelections![0].recipeId = 'foreign';
    expect(planShoppingCommand(c, foreign).outcome).toBe('InvalidInput');
    expect(c.row!.document).toEqual(context(v4).row!.document);
  });
  it('requires current coverage and acknowledgement version; changed demand cannot be checked', () => {
    const c = context(true);
    const added = planShoppingCommand(c, command);
    c.row = { document: added.document, content_revision: 1 };
    const row = projectShoppingDocument(added.document, []).rows[0];
    const check: ShoppingCommand = { protocol: 1, observedRevision: 1,
      mutation: { type: 'setChecked', rowRef: row.rowRef, checked: true } };
    expect(planShoppingCommand(c, check).outcome).toBe('Conflict');
    check.inspectedCoverage = { [row.orderingKey]: { version: 0, basis: shoppingRowCoverage(row) } };
    const checked = planShoppingCommand(c, check);
    expect(checked.outcome).toBe('Applied');
    c.row = { document: checked.document, content_revision: 2 };
    expect(planShoppingCommand(c, check).outcome).toBe('Conflict');
    c.row = { document: added.document, content_revision: 1 };
    const larger = { ...selection, selectedYield: 12 };
    const increased = planShoppingCommand(c, { ...command, observedRevision: 1, sourceSelections: [larger],
      mutation: { type: 'upsertRecipe', entry: createSelectedShoppingEntry(recipe, larger) } });
    c.row = { document: increased.document, content_revision: 2 };
    expect(planShoppingCommand(c, check).outcome).toBe('RequirementChanged');
  });
});
