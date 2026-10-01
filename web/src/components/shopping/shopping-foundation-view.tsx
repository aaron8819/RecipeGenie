'use client';
import { initialShoppingSelection, createSelectedShoppingEntry } from '@/lib/shopping-selection';

import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePantryItems } from '@/hooks/use-pantry';
import { useAddShoppingItem, useShoppingDocumentState, useShoppingFoundationCommand } from '@/hooks/shopping/use-shopping-document';
import { type ShoppingDocumentStateV3, type ShoppingManualItemV1 } from '@/lib/shopping-document';
import { formatShoppingQuantityPart } from '@/lib/shopping-quantity-display';
import { parseQuantityV1, parseRationalLexeme, divideRationals, getScalingBasis, getAuthoredYieldText } from '@/lib/recipe-quantity';
import { sumShoppingRequirements } from '@/lib/shopping-extra-quantities';
import { initializedCategory, pinnedPurchaseDefault } from '@/lib/shopping-initialization';
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics';
import { SHOPPING_CATEGORIES } from '@/lib/shopping-categories';
import { shoppingPlacementRecoveryCandidates } from '@/lib/shopping-placement-recovery';
import { isAlreadyInShoppingListError } from '@/lib/shopping-feedback';
import { createShoppingManualItemId } from '@/lib/shopping-row-reference';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { PlacementResolution } from './shopping-placement-resolution';
import type { Recipe, ShoppingItem, ShoppingQuantity } from '@/types/database';

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
  if (!query.data || query.error) return null;
  const recovery = query.data.document.schemaVersion === 4;
  if (recovery && !Object.keys(shoppingPlacementRecoveryCandidates(query.data.document)).length) return null;
  return <section className="mb-4 rounded-xl border bg-card p-4" aria-label="Shopping update">
    <h2 className="font-semibold">{recovery ? 'Review remembered shopping locations' : 'Keep recipe amounts and extras together'}</h2>
    <p className="my-2 text-sm">{recovery ? 'Some original locations differ from the saved defaults. Recover verified locations and choose a destination where later changes cannot be distinguished.' : 'Update this list to remember purchase positions and combine new extras. Existing manual amounts stay separate until you choose their meaning. Saved checks remain previous-check evidence.'}</p>
    <Button disabled={command.isPending} onClick={async () => {
      try { await command.mutateAsync({ mutation: { type: 'initialize' }, observedRevision: query.data!.contentRevision }); setError(''); }
      catch (error) { setError(errorText(error)); }
    }}>{recovery ? 'Review retained locations' : 'Update this shopping list'}</Button>
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
      if (saved) {
        setObserved({ item: saved, revision: result.contentRevision });
        // Reconcile untouched inputs without erasing typing during the refresh.
        setName(current => current === name ? saved.displayName : current);
        setAmount(current => current === amount ? amountText(saved.quantity) : current);
        setUnit(current => current === unit ? saved.quantity?.unit ?? '' : current);
      }
      setError(''); return true;
    }
    catch (error) { setError(errorText(error)); return false; }
  };
  if (identity.removed) return null;
  return <details className="rounded-xl border p-3" data-testid={`need-${item.id}`}>
    <summary className="min-h-11 cursor-pointer content-center break-words font-medium">{legacy ? 'Resolve legacy amount' : 'Edit manual addition'}: {item.displayName}</summary>
    <div className="mt-3 grid gap-3">
      {item.checked && <p>Previously checked; confirm current need.</p>}
      <label>Name<Input aria-label={`Name for ${item.displayName}`} value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label>Amount<Input aria-label={`Amount for ${item.displayName}`} value={amount} onChange={e => setAmount(e.target.value)} /></label>
        <label>Unit<Input aria-label={`Unit for ${item.displayName}`} value={unit} onChange={e => setUnit(e.target.value)} /></label>
      </div>
      <Button variant="outline" disabled={command.isPending || !name.trim()} onClick={() => void submit(
        !legacy && purchaseKey !== observed.item.identity!.purchaseKey ? {
          type: 'rebindManualItem', id: item.id, expectedVersion: observed.item.identity!.version, displayName: name, quantity: draftQuantity(amount, unit, observed.item.quantity),
        } : { type: 'editManualItem', id: item.id, changes: {
          ...(name !== observed.item.displayName ? { displayName: name } : {}),
          ...(amount !== amountText(observed.item.quantity) || unit !== (observed.item.quantity?.unit ?? '')
            ? { quantity: draftQuantity(amount, unit, observed.item.quantity) } : {}),
        } }
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

export function SelectionYield({ recipe, state }: { recipe: Recipe; state: ShoppingDocumentStateV3 }) {
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
      const recovered = initialShoppingSelection(recipe, entry);
      if (recovered.notice) throw new Error('Review ingredients in Planner before changing this saved selection.');
      const selection = { ...recovered.selection, selectedYield: basis * Number(scale.numerator) / Number(scale.denominator) };
      const result = await command.mutateAsync({ sourceSelections: [selection], observedRevision: observed.revision,
        observedSelections: { [recipe.id]: observed.version }, mutation: { type: 'upsertRecipe',
          entry: createSelectedShoppingEntry(recipe, selection) } });
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

/** The normal Add item flow for initialized lists uses the accepted extra command. */
export function ShoppingAddItem({ inputRef }: {
  state: ShoppingDocumentStateV3;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const pantry = usePantryItems();
  const addItem = useAddShoppingItem();
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  return <form className="grid gap-2" aria-label="Add shopping item" onSubmit={async event => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    try {
      const items = name.split(',').map(item => item.trim()).filter(Boolean);
      if (!items.length) { setError('Enter an item or paste a comma-separated list.'); input.current?.focus(); return; }
      if (name.includes(',')) {
        const added: string[] = [];
        const duplicates: string[] = [];
        let failed: string | null = null;
        let failure: unknown;
        for (const item of items) {
          try {
            await addItem.mutateAsync({ itemName: item, rowId: createShoppingManualItemId() });
            added.push(item);
          } catch (error) {
            if (isAlreadyInShoppingListError(error)) duplicates.push(item);
            else { failed = item; failure = error; break; }
          }
        }
        const unresolved = [...duplicates, ...(failed ? items.slice(added.length + duplicates.length) : [])];
        setName(unresolved.join(', '));
        if (unresolved.length) {
          const parts = [added.length ? `Added: ${added.join(', ')}.` : '',
            duplicates.length ? `Already on the list: ${duplicates.join(', ')}.` : '',
            failed ? `Could not confirm ${failed}: ${errorText(failure)}. Review the list before retrying; remaining items were not submitted.` : ''];
          setError(parts.filter(Boolean).join(' '));
        } else setError('');
        input.current?.focus();
        return;
      }
      await addItem.mutateAsync({ itemName: items[0], rowId: createShoppingManualItemId() });
      setName(''); setError(''); input.current?.focus();
    } catch (error) {
      setError(errorText(error));
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }}>
    <div className="flex gap-2">
      <Input ref={input} aria-label="Item name" placeholder="Add an item…" value={name} onChange={e => setName(e.target.value)} className="h-12 min-w-0 rounded-xl bg-white" />
      <Button className="h-12 shrink-0 rounded-xl" type="submit" disabled={isSubmitting || addItem.isPending || !name.trim() || !pantry.isSuccess}>Add item</Button>
    </div>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function ShoppingRowControls({ item, state }: { item: ShoppingItem; state: ShoppingDocumentStateV3 }) {
  const manualIds = new Set(item.requirementBreakdown?.map(part => part.manualId).filter(Boolean));
  if (item.rowId?.startsWith('manual:')) manualIds.add(item.rowId.slice(7));
  return <div className="space-y-2">
    {state.document.manualItems.filter(manual => manualIds.has(manual.id) && !manual.identity?.removed)
      .map(manual => <ManualNeedEditor key={manual.id} item={manual} state={state} />)}
    {item.orderingKey && state.document.placementEvidence?.unresolved[item.orderingKey] &&
      <PlacementResolution purchaseKey={item.orderingKey} state={state} />}
  </div>;
}

/** Dormant placement evidence has no ingredient row; show only those exceptions. */
export function ShoppingDormantRecovery({ state, items }: { state: ShoppingDocumentStateV3; items: ShoppingItem[] }) {
  const visible = new Set(items.map(item => item.orderingKey));
  return <>{Object.keys(state.document.placementEvidence?.unresolved ?? {}).filter(key => !visible.has(key))
    .map(key => <PlacementResolution key={key} purchaseKey={key} state={state} />)}</>;
}
