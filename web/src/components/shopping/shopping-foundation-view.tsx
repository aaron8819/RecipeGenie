'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePantryItems } from '@/hooks/use-pantry';
import { useRecipes } from '@/hooks/use-recipes';
import { useShoppingDocumentState, useShoppingFoundationCommand } from '@/hooks/shopping/use-shopping-document';
import { createShoppingRecipeEntry, type ShoppingDocumentStateV3, type ShoppingManualItemV1 } from '@/lib/shopping-document';
import { formatShoppingQuantityPart } from '@/lib/shopping-quantity-display';
import { parseQuantityV1, parseRationalLexeme, divideRationals, getScalingBasis, getAuthoredYieldText } from '@/lib/recipe-quantity';
import { sumShoppingRequirements } from '@/lib/shopping-extra-quantities';
import { initializedCategory, pinnedPurchaseDefault } from '@/lib/shopping-initialization';
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics';
import { SHOPPING_CATEGORIES } from '@/lib/shopping-categories';
import { shoppingRecipeSelections } from '@/lib/shopping-sources';
import { useUndoToast } from '@/hooks/use-undo-toast';
import type { Recipe, ShoppingQuantity } from '@/types/database';

const amountText = (quantity: ShoppingQuantity | null) => quantity?.exactQuantityV1?.authored ?? (quantity?.amount == null ? '' : String(quantity.amount));
function draftQuantity(text: string, unit: string, original: ShoppingQuantity | null = null): ShoppingQuantity | null {
  if (text === amountText(original) && unit === (original?.unit ?? '')) return original;
  if (!text.trim()) return unit.trim() ? { amount: null, unit: unit.trim() } : null;
  const quantity = parseQuantityV1(text);
  const number = quantity.kind === 'exact' ? quantity.value : quantity.kind === 'range' ? quantity.start : null;
  return { amount: number ? Number(number.numerator) / Number(number.denominator) : null,
    unit: unit.trim(), exactQuantityV1: quantity,
    ...(original?.exactPackageV1 ? { exactPackageV1: { ...original.exactPackageV1, count: quantity } } : {}),
  };
}
const amountLabel = (quantity: ShoppingQuantity | null) => formatShoppingQuantityPart(quantity ?? { amount: null, unit: '' });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not save. Your input is preserved.';

export function ShoppingInitializationNotice() {
  const query = useShoppingDocumentState();
  const command = useShoppingFoundationCommand();
  const [error, setError] = useState('');
  if (!query.data || query.data.document.schemaVersion === 4 || query.error) return null;
  return <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Shopping update">
    <h2 className="font-semibold">Keep recipe amounts and extras together</h2>
    <p className="my-2 text-sm">Update this list to remember purchase positions and combine new extras. Existing manual amounts stay separate until you choose their meaning. Saved checks remain previous-check evidence.</p>
    <Button disabled={command.isPending} onClick={async () => {
      try { await command.mutateAsync({ mutation: { type: 'initialize' }, observedRevision: query.data!.contentRevision }); setError(''); }
      catch (error) { setError(errorText(error)); }
    }}>Update this shopping list</Button>
    {error && <p role="alert">{error}</p>}
  </section>;
}

function ManualNeedEditor({ item, state }: { item: ShoppingManualItemV1; state: ShoppingDocumentStateV3 }) {
  const command = useShoppingFoundationCommand();
  const toast = useUndoToast();
  const [name, setName] = useState(item.displayName);
  const [amount, setAmount] = useState(amountText(item.quantity));
  const [unit, setUnit] = useState(item.quantity?.unit ?? '');
  const [choice, setChoice] = useState<'extra' | 'total' | 'reminder'>('extra');
  const [extra, setExtra] = useState('');
  const [category, setCategory] = useState('');
  const [anchor, setAnchor] = useState('');
  const [error, setError] = useState('');
  const identity = item.identity!;
  const [observed, setObserved] = useState({ item, revision: state.contentRevision });
  const legacy = identity.meaning === 'legacyIndependent';
  const unsavedEdit = name !== item.displayName || amount !== amountText(item.quantity) || unit !== (item.quantity?.unit ?? '');
  const purchaseKey = resolveShoppingIngredientSemantics({ item: name, unit }).purchaseKey;
  const currentCategory = initializedCategory(state.document, purchaseKey);
  const existing = !!state.document.placementEvidence?.defaults[purchaseKey];
  const destination = category || (existing ? currentCategory : '') || (identity.legacy?.categoryEvidence.length === 1 &&
    Object.hasOwn(SHOPPING_CATEGORIES, identity.legacy.categoryEvidence[0]) ? identity.legacy.categoryEvidence[0] : '');
  const categories = [...Object.entries(SHOPPING_CATEGORIES).map(([key, value]) => ({ key, name: value.name })),
    ...state.document.preferences.customCategories.map(value => ({ key: `custom_${value.id}`, name: value.name }))];
  const nextQuantity = choice === 'extra' ? item.quantity : choice === 'reminder' ? null : draftQuantity(extra, unit);
  const recipeParts = Object.values(state.document.recipeEntries).flatMap(entry => entry.ingredients)
    .filter(ingredient => ingredient.purchaseKey === purchaseKey).map(ingredient => ingredient.quantity);
  const otherExtras = state.document.manualItems.filter(other => other.id !== item.id && !other.identity?.removed &&
    other.identity?.meaning !== 'legacyIndependent' && other.identity?.purchaseKey === purchaseKey).map(other => other.quantity);
  const total = sumShoppingRequirements([...recipeParts, ...otherExtras, nextQuantity]).map(amountLabel).join(' + ');
  const submit = async (mutation: Parameters<typeof command.mutateAsync>[0]['mutation']) => {
    try {
      const result = await command.mutateAsync({ mutation, observedRevision: observed.revision, observedManual: observed.item });
      if (!result.confirmedCurrent) {
        setError('Your change was confirmed, but the list changed afterwards. Reload before starting another edit.');
        return true;
      }
      const saved = result.document.manualItems.find(candidate => candidate.id === item.id);
      if (saved) setObserved({ item: saved, revision: result.contentRevision });
      setError(''); return true;
    }
    catch (error) { setError(errorText(error)); return false; }
  };
  if (identity.removed) return null;
  return <details className="rounded-xl border p-3" data-testid={`need-${item.id}`}>
    <summary className="cursor-pointer break-words font-medium">{item.displayName}: {amountLabel(item.quantity)} — {legacy ? 'Legacy amount — meaning not set' : identity.meaning === 'reminder' ? 'Reminder' : 'Extra'}</summary>
    <div className="mt-3 grid gap-3">
      {item.checked && <p>Previously checked; confirm current need.</p>}
      <label>Name<Input aria-label={`Name for ${item.displayName}`} value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label>Amount<Input aria-label={`Amount for ${item.displayName}`} value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>Unit<Input aria-label={`Unit for ${item.displayName}`} value={unit} onChange={e => setUnit(e.target.value)} /></label>
      </div>
      <Button variant="outline" disabled={command.isPending || !name.trim()} onClick={() => void submit(
        !legacy && purchaseKey !== identity.purchaseKey ? {
          type: 'rebindManualItem', id: item.id, expectedVersion: observed.item.identity!.version, displayName: name, quantity: draftQuantity(amount, unit, observed.item.quantity),
        } : { type: 'editManualItem', id: item.id, changes: { displayName: name, quantity: draftQuantity(amount, unit, observed.item.quantity) } }
      )}>Save {legacy ? 'independent amount' : 'extra or reminder'}</Button>
      {!legacy && purchaseKey !== identity.purchaseKey && <p role="status">This changes the purchase to {purchaseKey}. It will share its saved position in {currentCategory === 'legacy-placement' ? pinnedPurchaseDefault(purchaseKey).categoryKey : currentCategory}. New total: {sumShoppingRequirements([...recipeParts, ...otherExtras, draftQuantity(amount, unit, observed.item.quantity)]).map(amountLabel).join(' + ')}. Other requirements are retained.</p>}
      {legacy && <>
        <label className="flex gap-2"><input type="checkbox" checked={item.checked} disabled={command.isPending}
          onChange={e => void submit({ type: 'editManualItem', id: item.id, changes: { checked: e.target.checked } })} />Previous check</label>
        <fieldset className="grid gap-2 rounded-lg border p-3">
          <legend>Choose what this amount means now</legend>
          <label>Meaning<select className="w-full rounded border p-2" aria-label={`Meaning for ${item.displayName}`} value={choice} onChange={e => setChoice(e.target.value as typeof choice)}>
            <option value="extra">This is extra</option><option value="total">It meant a total; enter an extra amount now</option><option value="reminder">Confirm as a reminder</option>
          </select></label>
          {choice === 'total' && <label>Extra amount now, including zero<Input aria-label="Extra amount now" value={extra} onChange={e => setExtra(e.target.value)} /></label>}
          <p>Recipe baseline: {recipeParts.length ? sumShoppingRequirements(recipeParts).map(amountLabel).join(' + ') : 'none'}. Other extras: {otherExtras.length ? sumShoppingRequirements(otherExtras).map(amountLabel).join(' + ') : 'none'}.</p>
          <p>Preview: {total}. Recipe amounts and extra amounts remain inspectable. Availability may hide recipe parts.</p>
          {existing && <p>Current location: {currentCategory}. Keeping it preserves the saved position. A different location moves the whole purchase, including recipe requirements.</p>}
          <>
            <label>Location<select className="w-full rounded border p-2" aria-label="Resolution location" value={destination} onChange={e => { setCategory(e.target.value); setAnchor(''); }}>
              <option value="">Choose a location</option><option value="@default">Reset Category to the pinned default</option>{categories.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select></label>
            <label>Position<select className="w-full rounded border p-2" aria-label="Resolution position" value={anchor} onChange={e => setAnchor(e.target.value)}>
              <option value="">{existing && destination === currentCategory ? 'Keep the saved position' : 'At the end, after saved hidden purchases'}</option>{(state.document.preferences.ingredientOrderByCategory[destination] ?? []).filter(key => key !== purchaseKey).map(key => <option key={key} value={key}>Before {key}</option>)}
            </select></label>
          </>
          {unsavedEdit && <p>Save your independent amount edits before confirming its meaning.</p>}
          <Button disabled={command.isPending || unsavedEdit || !destination || !name.trim() || (choice === 'total' && !extra.trim())} onClick={() => void submit({
            type: 'resolveLegacy', id: item.id, expectedVersion: observed.item.identity!.version, choice,
            quantity: nextQuantity, purchaseName: name, categoryKey: destination, anchor: anchor || null,
          })}>Confirm meaning and location</Button>
        </fieldset>
      </>}
      <Button variant="outline" disabled={command.isPending} onClick={async () => {
        if (await submit({ type: 'deleteManualItem', id: item.id })) toast.show({ message: `${item.displayName} removed`, onUndo: async () => {
          await submit({ type: 'restoreManualItem', id: item.id, expectedVersion: identity.version + 1 });
        } });
      }}>Remove this {legacy ? 'legacy amount' : 'extra or reminder'}</Button>
      {(identity.legacy || identity.conversion) && <details><summary>Original saved evidence</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(identity.legacy?.raw ?? identity.conversion?.raw, null, 2)}</pre></details>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

function SelectionYield({ recipe, state }: { recipe: Recipe; state: ShoppingDocumentStateV3 }) {
  const command = useShoppingFoundationCommand();
  const entry = state.document.recipeEntries[recipe.id];
  const basis = getScalingBasis(recipe.yield_metadata, recipe.servings);
  const [mode, setMode] = useState<'yield' | 'batches'>('yield');
  const [yieldText, setYieldText] = useState(String(entry.scaleV1 ? Number(entry.scaleV1.numerator) / Number(entry.scaleV1.denominator) * basis : entry.selectedServings));
  const [observed, setObserved] = useState({ revision: state.contentRevision, version: entry.sourceEvidence!.version });
  const [error, setError] = useState('');
  return <form className="flex flex-wrap items-end gap-2" onSubmit={async event => {
    event.preventDefault();
    const quantity = parseRationalLexeme(yieldText), authored = parseRationalLexeme(String(basis));
    const scale = mode === 'batches' ? quantity : quantity && authored ? divideRationals(quantity, authored) : null;
    if (!scale || scale.numerator === '0') { setError('Enter a positive total yield or batch multiplier.'); return; }
    try {
      const result = await command.mutateAsync({ observedRevision: observed.revision,
        observedSelections: { [recipe.id]: observed.version }, mutation: { type: 'upsertRecipe',
          entry: createShoppingRecipeEntry(recipe, recipe.servings * Number(scale.numerator) / Number(scale.denominator), scale) } });
      if (!result.confirmedCurrent) {
        setError('Your change was confirmed, but the selection may have changed afterwards. Reload before starting another yield edit.');
        return;
      }
      setObserved({ revision: result.contentRevision, version: result.document.recipeEntries[recipe.id].sourceEvidence!.version });
      setError('');
    } catch (error) { setError(errorText(error)); }
  }}>
    <p className="w-full text-sm">Current recipe yield: {getAuthoredYieldText(recipe.yield_metadata, recipe.servings)}. Use batches when that yield does not describe your recipe.</p>
    <label>Quantity mode<select className="w-full rounded border p-2" aria-label={'Quantity mode for ' + recipe.name} value={mode} onChange={e => { setMode(e.target.value as typeof mode); setYieldText(''); }}>
      <option value="yield">Total yield</option><option value="batches">Explicit batch multiplier</option>
    </select></label>
    <label>{mode === 'yield' ? 'Total Shopping yield' : 'Total batches'}<Input aria-label={'Total Shopping yield for ' + recipe.name} value={yieldText} onChange={e => setYieldText(e.target.value)} /></label>
    <Button type="submit" variant="outline" disabled={command.isPending}>Set total yield</Button>
    <p className="w-full text-sm">Replace this selection with {yieldText || '…'} {mode === 'batches' ? 'batches' : 'total yield'} from the current recipe.</p>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function ShoppingFoundationControls({ state }: { state: ShoppingDocumentStateV3 }) {
  const pantry = usePantryItems();
  const recipes = useRecipes();
  const command = useShoppingFoundationCommand();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [error, setError] = useState('');
  const selections = shoppingRecipeSelections(state.document.recipeEntries);
  return <details className="mb-4 rounded-xl border bg-card p-4" open>
    <summary className="cursor-pointer font-semibold">Extras, source quantities and legacy amounts</summary>
    <p className="my-3 text-sm">New manual amounts are extra. Saved checks remain previous-check evidence; current-need check-off is not available yet.</p>
    <form className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]" onSubmit={async event => {
      event.preventDefault();
      try {
        await command.mutateAsync({ observedRevision: state.contentRevision, mutation: { type: 'addManualItem', item: {
          id: crypto.randomUUID(), displayName: name, quantity: draftQuantity(amount, unit), categoryKey: 'misc', bucket: 'items', checked: false,
        } } });
        setName(''); setAmount(''); setUnit(''); setError('');
      } catch (error) { setError(errorText(error)); }
    }}>
      <label>Purchase<Input aria-label="Purchase" value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Extra amount<Input aria-label="Extra amount" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Reminder if blank" /></label>
      <label>Unit<Input aria-label="Extra unit" value={unit} onChange={e => setUnit(e.target.value)} /></label>
      <Button className="self-end" type="submit" disabled={command.isPending || !name.trim() || !pantry.isSuccess}>Add extra or reminder</Button>
    </form>
    {error && <p role="alert">{error}</p>}
    <section className="mt-4 space-y-3" aria-label="Extras and legacy amounts">
      {state.document.manualItems.filter(item => !item.identity?.removed).map(item => <ManualNeedEditor key={item.id} item={item} state={state} />)}
    </section>
    <section className="mt-4 space-y-3" aria-label="Selection quantities and frozen evidence">
      {selections.map(selection => <details key={selection.recipeId} className="rounded-lg border p-3">
        <summary>{selection.label}: {selection.selectedServings} selected servings</summary>
        {recipes.data?.find(recipe => recipe.id === selection.recipeId) && <SelectionYield recipe={recipes.data.find(recipe => recipe.id === selection.recipeId)!} state={state} />}
        <details><summary>Frozen source evidence {state.document.recipeEntries[selection.recipeId].sourceEvidence?.history === 'reconstructed' ? '(original history unavailable)' : ''}</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(state.document.recipeEntries[selection.recipeId].sourceEvidence, null, 2)}</pre>
        </details>
      </details>)}
    </section>
    {Object.entries(state.document.placementEvidence!.unresolved).map(([key, evidence]) =>
      <PlacementResolution key={key} purchaseKey={key} evidence={evidence} state={state} />)}
  </details>;
}

function PlacementResolution({ purchaseKey, evidence, state }: {
  purchaseKey: string; evidence: { categories: string[]; sequences: Record<string, string[]> }; state: ShoppingDocumentStateV3;
}) {
  const command = useShoppingFoundationCommand();
  const [category, setCategory] = useState('');
  const [anchor, setAnchor] = useState('');
  const [error, setError] = useState('');
  const categories = [...Object.entries(SHOPPING_CATEGORIES).map(([key, value]) => ({ key, name: value.name })),
    ...state.document.preferences.customCategories.map(c => ({ key: `custom_${c.id}`, name: c.name }))];
  return <section className="mt-3 grid gap-2 rounded border p-3" aria-label={`Resolve location for ${purchaseKey}`}>
    <h3>Choose the remembered location for {purchaseKey}</h3>
    <p>Stored choices: {evidence.categories.join(', ')}. This choice applies to the whole purchase.</p>
    <label>Destination<select className="w-full rounded border p-2" value={category} onChange={e => { setCategory(e.target.value); setAnchor(''); }}>
      <option value="">Choose a destination</option><option value="@default">Reset Category to the pinned default</option>
      {categories.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
    </select></label>
    <label>Position<select className="w-full rounded border p-2" value={anchor} onChange={e => setAnchor(e.target.value)}>
      <option value="">After every saved purchase</option>{(state.document.preferences.ingredientOrderByCategory[category] ?? []).map(key => <option key={key} value={key}>Before {key}</option>)}
    </select></label>
    <Button disabled={command.isPending || !category} onClick={async () => {
      try { await command.mutateAsync({ observedRevision: state.contentRevision, mutation: {
        type: 'resolvePlacement', purchaseKey, categoryKey: category, anchor: anchor || null,
      } }); setError(''); } catch (error) { setError(errorText(error)); }
    }}>Confirm purchase location</Button>
    <details><summary>Original location and order evidence</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(evidence, null, 2)}</pre></details>
    {error && <p role="alert">{error}</p>}
  </section>;
}
