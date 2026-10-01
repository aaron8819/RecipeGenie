'use client';

import { useEffect, useRef, useState } from 'react';
import type { ShoppingDocumentV3 } from '@/lib/shopping-document';
import { applyOrganization, inspectOrganization, organizationInverse, purchaseOrganization, sectionSequence,
  type OrganizationAction, type OrganizationIntent } from '@/lib/shopping-organization';
import { SHOPPING_CATEGORIES, generateCategoryId } from '@/lib/shopping-categories';
import { useOrganizeShopping, useShoppingDocumentState } from '@/hooks/shopping/use-shopping-document';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** A mounted editor owns its inspected snapshot. Background reads cannot
 * silently grant fresh approval to a draft, drag, reset or inverse. */
export function ShoppingOrganizationDialog({ document, onClose }: {
  document: ShoppingDocumentV3; onClose: () => void;
}) {
  const [inspected, setInspected] = useState(document);
  const [key, setKey] = useState(Object.keys(document.placementEvidence?.defaults ?? {})[0] ?? '');
  const [destination, setDestination] = useState('produce');
  const [position, setPosition] = useState('end');
  const [anchor, setAnchor] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [feedback, setFeedback] = useState('');
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (feedback) feedbackRef.current?.scrollIntoView({ block: 'nearest' }); }, [feedback]);
  const [undo, setUndo] = useState<OrganizationIntent | null>(null);
  const update = useOrganizeShopping();
  const query = useShoppingDocumentState();
  const toast = useUndoToast();
  const org = purchaseOrganization(inspected);
  const categories = sectionSequence(inspected);
  const label = (c: string) => inspected.preferences.customCategories.find(item => `custom_${item.id}` === c)?.name ?? SHOPPING_CATEGORIES[c]?.name ?? c;

  const submit = async (action: OrganizationAction, saved?: OrganizationIntent) => {
    const intent = saved ?? inspectOrganization(inspected, action);
    const planned = applyOrganization(inspected, intent);
    const inverse = organizationInverse(inspected, action);
    try {
      await update.mutateAsync(intent);
      // Use only the known local effect for the next draft. Concurrent state
      // becomes approvable only through the explicit Review latest control.
      if ('document' in planned) {
        setInspected(planned.document);
        setUndo(!saved && inverse ? inspectOrganization(planned.document, inverse) : null);
      }
      setFeedback(saved ? 'Organization change undone.' : 'Organization saved. Hidden and returning purchases remember this placement.');
    } catch {
      setFeedback('Shopping changed, or the change could not be confirmed. Your choices are preserved. Review the latest saved organization before retrying.');
    }
  };
  const review = async () => {
    try {
      const fresh = await query.refetch();
      if (fresh.error || !fresh.data) throw new Error('read');
      setInspected(fresh.data.document); setUndo(null);
      setFeedback('Latest organization loaded. Review your choices before applying them.');
    } catch { toast.show({ message: 'Could not load organization. Your choices are preserved.' }); }
  };
  const selectClass = 'w-full rounded-md border bg-background p-2 text-sm';
  const keys = categories.flatMap(c => org.sequences[c] ?? []);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Shopping organization</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Placement is shared by equivalent recipe ingredients and manual extras, including hidden and returning purchases.</p>
      {feedback && <p ref={feedbackRef} role="status" className="text-sm">{feedback}</p>}
      <fieldset disabled={update.isPending} className="space-y-3 min-w-0">
        <label className="block text-sm">Purchase
          <select aria-label="Purchase to organize" className={selectClass} value={key} onChange={e => setKey(e.target.value)}>
            {!keys.length && <option value="">No remembered purchases</option>}
            {keys.map(k => <option key={k} value={k}>{k} — {label(org.placements[k].categoryKey)}</option>)}
          </select>
        </label>
        <label className="block text-sm">Destination category
          <select aria-label="Destination category" className={selectClass} value={destination} onChange={e => { setDestination(e.target.value); setAnchor(''); }}>
            {categories.map(c => <option key={c} value={c}>{label(c)}</option>)}
          </select>
        </label>
        <label className="block text-sm">Position
          <select aria-label="Purchase position" className={selectClass} value={position} onChange={e => setPosition(e.target.value)}>
            <option value="start">Category start</option>
            <option value="end">Category end</option>
            <option value="before">Before a purchase</option><option value="after">After a purchase</option>
          </select>
        </label>
        {['before', 'after'].includes(position) && <select aria-label="Anchor purchase" className={selectClass} value={anchor} onChange={e => setAnchor(e.target.value)}>
          <option value="">Choose a purchase</option>
          {(org.sequences[destination] ?? []).filter(k => k !== key).map(k => <option key={k}>{k}</option>)}
        </select>}
        <p className="text-xs text-muted-foreground">Start and end include hidden and dormant purchases.</p>
        <Button disabled={!org.placements[key] || (['before', 'after'].includes(position) && !anchor)} onClick={() => void submit({ kind: 'move', key,
          destination: position === 'start' || position === 'end' ? { categoryKey: destination, at: position } : {
            categoryKey: destination, at: position as 'before' | 'after', anchor, anchorVersion: org.placements[anchor]?.version ?? 0 } })}>Move purchase</Button>
        <div className="flex flex-wrap gap-2">
          {(['position', 'category', 'both'] as const).map(mode => <Button key={mode} variant="outline" disabled={!org.placements[key]}
            onClick={() => void submit({ kind: 'reset', keys: [key], mode, bulk: false })}>Reset {mode}</Button>)}
        </div>
        <p className="text-xs text-muted-foreground">Reset position appends within the current category. Reset category uses the remembered default. Neither forgets placement or clears demand.</p>
        <details><summary className="cursor-pointer text-sm">Reset all remembered purchases</summary>
          <p className="text-xs my-2">Includes hidden and dormant purchases. Position reset sorts purchase keys within categories.</p>
          <div className="flex flex-wrap gap-2">{(['position', 'category', 'both'] as const).map(mode => <Button key={mode} variant="outline" disabled={!keys.length}
            onClick={() => void submit({ kind: 'reset', keys, mode, bulk: true })}>Reset all {mode === 'position' ? 'positions' : mode === 'category' ? 'categories' : 'both'}</Button>)}</div>
        </details>
        <hr />
        <h3 className="font-medium">Categories</h3>
        <select aria-label="Category to edit" className={selectClass} value={category} onChange={e => { setCategory(e.target.value); setName(label(e.target.value)); }}>
          <option value="">Choose a category</option>{categories.map(c => <option key={c} value={c}>{label(c)}</option>)}
        </select>
        <Input aria-label="Category name" value={name} onChange={e => setName(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!name.trim()} onClick={() => void submit({ kind: 'createCategory', id: generateCategoryId(), name })}>Create category</Button>
          <Button variant="outline" disabled={!category.startsWith('custom_') || !name.trim()} onClick={() => void submit({ kind: 'renameCategory', key: category, name })}>Rename category</Button>
          <Button variant="outline" disabled={!category.startsWith('custom_') || category === destination} onClick={() => void submit({ kind: 'deleteCategory', key: category, fallback: destination })}>Delete category</Button>
        </div>
        <p className="text-xs text-muted-foreground">Deletion immediately moves every remembered purchase to the destination selected above. Reset and category Undo refuse intervening changes in their scope.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={categories.indexOf(category) <= 0} onClick={() => void submit({ kind: 'moveSection', key: category, anchor: categories[categories.indexOf(category) - 1], at: 'before' })}>Move category up</Button>
          <Button variant="outline" disabled={!category || categories.indexOf(category) >= categories.length - 1} onClick={() => void submit({ kind: 'moveSection', key: category, anchor: categories[categories.indexOf(category) + 1], at: 'after' })}>Move category down</Button>
          <Button variant="outline" onClick={() => void submit({ kind: 'resetSections' })}>Reset category order</Button>
        </div>
        {undo && <Button variant="outline" onClick={() => void submit(undo.action, undo)}>{undo.action.kind === 'restoreCategory' ? 'Undo category deletion' : undo.action.kind === 'restorePlacements' ? 'Undo reset' : 'Undo move'}</Button>}
        <Button variant="outline" onClick={() => void review()}>Review latest organization</Button>
      </fieldset>
    </DialogContent>
  </Dialog>;
}
