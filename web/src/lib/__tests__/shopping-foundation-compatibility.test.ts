import { describe, expect, it } from 'vitest'
import { deepFreeze, legacyIndependentFixture, ONE, shoppingCompatibilityFixture } from '@/test/shopping-compatibility-fixtures'
import { createEmptyShoppingDocument, applyShoppingDocumentMutation, projectShoppingDocument } from '../shopping-document'
import { shoppingDocumentToList } from '../shopping-view'
import { readShoppingCompatibility } from '../shopping-compatibility'
import { validateManualPurchaseIntent } from '../shopping-manual-rules'
import { shoppingRecipeSelections } from '../shopping-sources'
import { compareShoppingCoverage, planShoppingAcknowledgement, isShoppingCoverageBasis, type CoveragePart, type ShoppingCoverageBasis } from '../shopping-coverage'
import { appendPurchasePlacements as planAppend, canonicalPurchaseDefault, splicePurchasePlacement, type PurchaseOrganization } from '../shopping-target-order'
import { replaceTargetSelection, type ShoppingSourceCapture } from '../shopping-target-selection'
import { editLegacyIndependentNeed } from '../shopping-target-legacy'
import { initializeShoppingDocument } from '../shopping-initialization'

const rational = (n: number, d = 1) => ({ numerator: String(n), denominator: String(d) })
const scalar = (n: number, unit = 'count', d = 1): CoveragePart => ({
  purchaseKey: 'lemon', materialKey: '', unit, kind: 'scalar', amount: rational(n, d),
})
const token = (token = 'as needed'): CoveragePart => ({ purchaseKey: 'lemon', materialKey: '', unit: '', kind: 'token', token })
const range = (min: number, max: number): CoveragePart => ({ purchaseKey: 'lemon', materialKey: '', unit: 'count',
  kind: 'range', minimum: rational(min), maximum: rational(max) })
const pack = (n: number, size = 400): CoveragePart => ({ purchaseKey: 'lemon', materialKey: '', unit: 'can',
  kind: 'package', descriptor: 'can', size: rational(size), sizeUnit: 'g', amount: rational(n) })
const basis = (parts: CoveragePart[]): ShoppingCoverageBasis => ({ comparisonVersion: 1, parts })
const organization = (): PurchaseOrganization => ({ categories: ['produce', 'misc'], placements: {}, sequences: {} })
const incoming = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, { categoryKey: 'produce', policyVersion: 'catalog-1' }]))

function appendPurchasePlacements(org: PurchaseOrganization, entries: Parameters<typeof planAppend>[1]) {
  const result = planAppend(org, entries)
  if (!('organization' in result)) throw new Error(result.status)
  return result.organization
}

describe('approved V3 compatibility through production rules', () => {
  it('S01/S02/S18/S38/S40/S55/S71/S72: deterministic, lossless, immutable projection and adapter', () => {
    const { document, recipes } = shoppingCompatibilityFixture()
    const before = structuredClone(document)
    deepFreeze(document); deepFreeze(recipes)
    expect(readShoppingCompatibility(document, 7).status).toBe('Supported')
    const list = shoppingDocumentToList('owner', { document, contentRevision: 7 }, [])
    expect(shoppingDocumentToList('owner', { document, contentRevision: 7 }, [])).toEqual(list)
    expect(list.items.filter(row => row.orderingKey === 'lemon').map(row => row.amount)).toEqual([3, 3])
    const carrots = list.items.find(row => row.orderingKey === 'carrot')!
    expect(carrots.quantityParts).toHaveLength(2)
    expect(carrots.sources).toHaveLength(2)
    expect(carrots.sources!.every(source => source.recipeId === recipes[2].id && !source.manualId)).toBe(true)
    expect(list.items.find(row => row.rowId === 'manual:unknown-category')?.categoryKey).toBe('missing-category')
    expect(shoppingRecipeSelections(document.recipeEntries).map(entry => entry.label)).toEqual(
      expect.arrayContaining(['Soup (1)', 'Soup (2)', 'Manual', 'Hidden', 'Empty']))
    const cleared = applyShoppingDocumentMutation({ document, contentRevision: 7 }, { type: 'complete' })
    expect(cleared.document.preferences).toEqual(document.preferences)
    expect(document).toEqual(before)
  })

  it('S18/S19/S20: amount edits allow coexistence; rebind collision and missing target are explicit', () => {
    const { document } = shoppingCompatibilityFixture()
    deepFreeze(document)
    expect(validateManualPurchaseIntent(document, { type: 'edit', rowRef: 'manual:manual-extra', purchaseKey: 'lemon' })).toBe('Allowed')
    expect(validateManualPurchaseIntent(document, { type: 'edit', rowRef: 'manual:manual-extra', purchaseKey: 'carrot' })).toBe('Conflict')
    expect(validateManualPurchaseIntent(document, { type: 'edit', rowRef: 'manual:gone', purchaseKey: 'lemon' })).toBe('TargetGone')
  })

  it('S15/S21 temporary collision policy retained, not blessed as the target extras contract', () => {
    const { document } = shoppingCompatibilityFixture()
    expect(validateManualPurchaseIntent(document, { type: 'add', rowRef: 'manual:new', purchaseKey: 'lemon', pantryItems: [] })).toBe('Conflict')
    expect(validateManualPurchaseIntent(document, { type: 'add', rowRef: 'manual:new', purchaseKey: 'lime', pantryItems: [] })).toBe('Allowed')
  })

  it.each([1, 2, 3])('S70: empty older shape %s reads without writing or inventing history', version => {
    const document: Record<string, unknown> = structuredClone(createEmptyShoppingDocument())
    document.schemaVersion = version
    if (version === 1) {
      document.order = []
      delete (document.preferences as Record<string, unknown>).ingredientOrderByCategory
    }
    const original = structuredClone(document)
    const result = readShoppingCompatibility(deepFreeze(document), 0)
    expect(result.status).toBe('Supported')
    expect(document).toEqual(original)
  })

  it.each([null, [], {}, { schemaVersion: 3 }, { schemaVersion: '3' }])('S71 malformed %j never becomes empty', document => {
    const result = readShoppingCompatibility(document, 0)
    expect(result).toEqual({ status: 'Malformed', original: document })
  })
  it('S71 unsupported, invalid revision, and valid empty are distinct', () => {
    expect(readShoppingCompatibility({ schemaVersion: 99 }, 0).status).toBe('UnsupportedDocument')
    expect(readShoppingCompatibility(createEmptyShoppingDocument(), -1).status).toBe('Malformed')
    expect(readShoppingCompatibility(createEmptyShoppingDocument(), 0).status).toBe('Supported')
  })
  it('S27/S42/S44/S55: Pantry/excluded/hidden selections and dormant order survive projections', () => {
    const { document } = shoppingCompatibilityFixture()
    document.preferences.excludedIngredientKeys = ['lemon']
    const before = structuredClone(document)
    const projected = projectShoppingDocument(deepFreeze(document), [])
    expect(projected.excluded.some(row => row.orderingKey === 'lemon')).toBe(true)
    expect(Object.keys(document.recipeEntries)).toHaveLength(5)
    expect(document).toEqual(before)
  })
})

describe('target coverage specification only; runtime Slice 8 deferred', () => {
  const cases: [string, CoveragePart[], CoveragePart[], string][] = [
    ['S77 increase', [scalar(2)], [scalar(5)], 'RequirementChanged'],
    ['S78 decrease', [scalar(5)], [scalar(3)], 'Covered'],
    ['S79 composition', [scalar(2), scalar(3)], [scalar(4), scalar(1)], 'Covered'],
    ['S14 manual-first extras', [scalar(3), scalar(2)], [scalar(5)], 'Covered'],
    ['S15 recipe-first extras', [scalar(2), scalar(3)], [scalar(5)], 'Covered'],
    ['S80 exact fraction', [scalar(1, 'cup', 2)], [scalar(5, 'cup', 10)], 'Covered'],
    ['S81 material', [scalar(2)], [{ ...scalar(2), materialKey: 'frozen' }], 'RequirementChanged'],
    ['S82 range removal', [range(1, 2), range(1, 2)], [range(1, 2)], 'Covered'],
    ['S82 range change', [range(1, 3)], [range(1, 2)], 'RequirementChanged'],
    ['S83 package decrease', [pack(2)], [pack(1)], 'Covered'],
    ['S83 package change', [pack(2)], [pack(1, 800)], 'RequirementChanged'],
    ['S83 package unknown', [token('can:unknown')], [token('can:unknown'), token('can:unknown')], 'RequirementChanged'],
    ['S84 token removal', [scalar(2, 'cup'), token()], [scalar(2, 'cup')], 'Covered'],
    ['S84 token increase', [scalar(2, 'cup'), token()], [scalar(2, 'cup'), token(), token()], 'RequirementChanged'],
    ['S84 changed token', [token()], [token('to taste')], 'RequirementChanged'],
    ['S84 unspecified', [token('unspecified')], [token('unspecified')], 'Covered'],
    ['S85 mixed decrease', [scalar(2), scalar(100, 'g')], [scalar(1), scalar(100, 'g')], 'Covered'],
    ['S85 mixed increase', [scalar(2), scalar(100, 'g')], [scalar(150, 'g')], 'RequirementChanged'],
    ['S86 hide/restore', [scalar(5)], [scalar(5)], 'Covered'],
    ['S87 hidden at check', [scalar(3)], [scalar(5)], 'RequirementChanged'],
    ['S88 covered inspected decrease', [scalar(5)], [scalar(3)], 'Covered'],
    ['unrounded increase', [scalar(11, 'count', 10)], [scalar(19, 'count', 10)], 'RequirementChanged'],
    ['absent basis', [scalar(2)], [], 'Empty'],
    ['zero basis is not checkable', [scalar(2)], [scalar(0)], 'Empty'],
  ]
  it.each(cases)('%s', (_id, saved, current, expected) => {
    const obtained = deepFreeze(basis(saved)), needed = deepFreeze(basis(current))
    const before = structuredClone([obtained, needed])
    expect(compareShoppingCoverage(obtained, needed)).toBe(expected)
    expect(compareShoppingCoverage(obtained, needed)).toBe(expected)
    expect([obtained, needed]).toEqual(before)
  })
  it('unknown package size cannot enter numeric package coverage', () => {
    expect(isShoppingCoverageBasis({ comparisonVersion: 1, parts: [{ ...pack(1), size: null }] })).toBe(false)
  })
  it('invalid exact denominator cannot acknowledge need', () => {
    expect(compareShoppingCoverage(basis([scalar(2)]), basis([scalar(1, 'count', 0)]))).toBe('InvalidInput')
  })
})

describe('target command specifications; no activation in V3', () => {
  it('S89–S92: batch tie-break, commit order, return and duplicate append', () => {
    const first = appendPurchasePlacements(organization(), incoming('c', 'b'))
    const second = appendPurchasePlacements(deepFreeze(first), incoming('a', 'b'))
    expect(second.sequences.produce).toEqual(['b', 'c', 'a'])
    expect(appendPurchasePlacements(second, incoming('b'))).toEqual(second)
    expect(appendPurchasePlacements(organization(), incoming('c', 'a', 'b')).sequences.produce).toEqual(['a', 'b', 'c'])
    expect(first.sequences.produce).toEqual(['b', 'c'])
  })
  it('S59/S93: moved-key splice preserves hidden untouched pairs and accepts empty destination', () => {
    const org = appendPurchasePlacements(organization(), incoming('apple', 'hidden', 'banana', 'carrot'))
    org.sequences.produce = ['apple', 'hidden', 'banana', 'carrot']
    const result = splicePurchasePlacement(deepFreeze(org), { key: 'carrot', expectedVersion: 0,
      destination: { categoryKey: 'produce', at: 'before', anchor: 'banana', anchorVersion: 0 } })
    expect(result.status).toBe('Applied')
    if ('organization' in result) expect(result.organization.sequences.produce).toEqual(['apple', 'hidden', 'carrot', 'banana'])
    const empty = splicePurchasePlacement(org, { key: 'carrot', expectedVersion: 0, destination: { categoryKey: 'misc', at: 'end' } })
    if ('organization' in empty) expect(empty.organization.sequences.misc).toEqual(['carrot'])
    else throw new Error(empty.status)
    expect(splicePurchasePlacement(org, { key: 'carrot', expectedVersion: 1, destination: { categoryKey: 'misc', at: 'start' } }).status).toBe('Conflict')
  })
  it('S95 canonical defaults use pinned identity evidence, no source vote', () => {
    const policy = { version: '1', semantic: { lemon: 'produce' }, keyword: { towel: 'misc' }, miscellaneous: 'misc' }
    expect(canonicalPurchaseDefault('lemon', policy)).toEqual({ categoryKey: 'produce', policyVersion: '1' })
    expect(canonicalPurchaseDefault('unknown', policy).categoryKey).toBe('misc')
    expect(canonicalPurchaseDefault('paper towel', policy).categoryKey).toBe('misc')
    expect(canonicalPurchaseDefault('constructor', policy).categoryKey).toBe('misc')
    const existing = appendPurchasePlacements(organization(), incoming('lemon'))
    expect(appendPurchasePlacements(existing, { lemon: { categoryKey: 'misc', policyVersion: '2' } })).toEqual(existing)
  })
  it('S64/S66: stale/missing anchors refuse without changing any saved slot', () => {
    const org = deepFreeze(appendPurchasePlacements(organization(), incoming('a', 'b')))
    const move = { key: 'a', expectedVersion: 0, destination: {
      categoryKey: 'produce', at: 'before' as const, anchor: 'b', anchorVersion: 1 } }
    expect(splicePurchasePlacement(org, move).status).toBe('Conflict')
    expect(splicePurchasePlacement(org, { ...move, destination: { ...move.destination, anchor: 'gone' } }).status).toBe('TargetGone')
    expect(org.sequences.produce).toEqual(['a', 'b'])
  })
  it('S76/S11/S30 exact scale replacement preserves full source capture and conflicts', () => {
    const recipe = shoppingCompatibilityFixture().recipes[0]
    const source: ShoppingSourceCapture = { recipeId: recipe.id, snapshot: recipe, sourceRevision: 'r1',
      occurrenceIds: ['occurrence-1'], semanticsVersion: '1' }
    const intent = deepFreeze({ expectedVersion: null, tripId: 'trip', source, scale: rational(2) })
    const context = { tripId: 'trip', ownedSourceRevision: 'r1' }
    const first = replaceTargetSelection(undefined, intent, context)
    expect(first.status).toBe('Applied')
    if (!('selection' in first)) throw new Error(first.status)
    expect(first.selection.scale).toEqual(rational(2))
    expect(replaceTargetSelection(first.selection, { ...intent, expectedVersion: 0 }, context).status).toBe('Unchanged')
    expect(replaceTargetSelection(first.selection, intent, context).status).toBe('Conflict')
    expect(replaceTargetSelection(undefined, intent, { ...context, ownedSourceRevision: 'r2' }).status).toBe('Conflict')
    expect(replaceTargetSelection(undefined, intent, { ...context, ownedSourceRevision: null }).status).toBe('TargetGone')
    expect(replaceTargetSelection(undefined, intent, { ...context, tripId: 'next' }).status).toBe('TripEnded')
    expect(source.snapshot).toEqual(recipe)
  })
  it('S112–S116 safe legacy edits preserve all ambiguity and raw evidence in mixed V4 content', () => {
    const legacy = deepFreeze(structuredClone(legacyIndependentFixture))
    const edited = editLegacyIndependentNeed(legacy, 3, { displayName: 'lemon' })
    expect(edited.status).toBe('Applied')
    if (!('need' in edited)) throw new Error(edited.status)
    expect(edited.need.raw).toEqual(legacy.raw)
    expect(edited.need.orderEvidence).toEqual(legacy.orderEvidence)
    expect(edited.need.sourceHistory).toBeNull()
    expect(editLegacyIndependentNeed(edited.need, 3, { previousChecked: false }).status).toBe('Conflict')
    const content = initializeShoppingDocument(shoppingCompatibilityFixture().document, [])
    expect(readShoppingCompatibility(deepFreeze(content), 0).status).toBe('Supported')
    expect(readShoppingCompatibility({ ...content, placementEvidence: null }, 0).status).toBe('Malformed')
    expect(legacy.quantity).toEqual(legacyIndependentFixture.quantity)
  })
})


describe('compatibility and target boundary distinctions', () => {
  it('S70/S112 populated V2 retains ambiguity, amounts and dormant slots without rewriting input', () => {
    const { document } = shoppingCompatibilityFixture()
    const legacy = { ...document, schemaVersion: 2,
      recipeEntries: Object.fromEntries(Object.entries(document.recipeEntries).map(([id, entry]) => [id, {
        ...entry, ingredients: entry.ingredients.map(ingredient => ({
          ingredientKey: ingredient.purchaseKey, aggregateKey: ingredient.aggregateKey,
          displayName: ingredient.displayName, quantity: ingredient.quantity,
          purchaseUnit: ingredient.purchaseUnit, defaultCategoryKey: ingredient.defaultCategoryKey,
          pantryMatchKeys: ingredient.pantryMatchKeys,
        })),
      }])) }
    const before = structuredClone(legacy)
    const read = readShoppingCompatibility(deepFreeze(legacy), 2)
    expect(read.status).toBe('Supported')
    if (read.status !== 'Supported') throw new Error(read.status)
    expect(read.state.document.manualItems).toEqual(document.manualItems)
    expect(read.state.document.preferences.ingredientOrderByCategory).toEqual(document.preferences.ingredientOrderByCategory)
    expect(legacy).toEqual(before)
  })
  it('S88 acknowledgement preconditions distinguish stale, unavailable and covered decrease', () => {
    const input = deepFreeze({ expectedVersion: 1, currentVersion: 1, inspected: basis([scalar(5)]),
      current: basis([scalar(3)]), availability: 'available' as const })
    expect(planShoppingAcknowledgement(input)).toEqual({ status: 'Checked', obtained: basis([scalar(5)]) })
    expect(planShoppingAcknowledgement({ ...input, current: basis([scalar(6)]) }).status).toBe('RequirementChanged')
    expect(planShoppingAcknowledgement({ ...input, currentVersion: 2 }).status).toBe('Conflict')
    expect(planShoppingAcknowledgement({ ...input, availability: 'unavailable' }).status).toBe('DependencyUnavailable')
    expect(planShoppingAcknowledgement({ ...input, current: null }).status).toBe('TargetGone')
  })
})
