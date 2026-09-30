'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import {
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  ShoppingCart,
  Package,
  MoreHorizontal,
  Plus,
  ArrowRight,
  Check,
  X,
  Utensils,
  HelpCircle,
  LogOut,
} from 'lucide-react';
import {
  applyShoppingDocumentMutation,
  createShoppingRecipeEntry,
  projectShoppingDocument,
  type ShoppingDocumentMutation,
  type ProjectedShoppingRow,
} from '@/lib/shopping-document';
import { resolveShoppingIngredientSemantics } from '@/lib/shopping-ingredient-semantics';
import type { Recipe } from '@/types/database';
import {
  days,
  fixture,
  recipes,
  scenarios,
  today,
  todayIndex,
  type Meal,
} from '../fixtures';

type Modal =
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'picker'; day: number; swap?: string }
  | { kind: 'move'; meal: Meal }
  | { kind: 'shopping'; ids: string[]; weekly: boolean }
  | { kind: 'list' }
  | null;
const nav = [
  ['Dashboard', LayoutDashboard],
  ['Recipes', BookOpen],
  ['Planner', CalendarDays],
  ['Shopping', ShoppingCart],
  ['Pantry', Package],
] as const;
const dateLabel = (date: Date) =>
  date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function ProfileButton({
  onMessage,
}: {
  onMessage: (message: string) => void;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button className="profile-button" aria-label="Open profile menu">
          <span className="profile-avatar">RG</span>
          <span className="profile-details">
            <small>ACCOUNT</small>
            <span>preview@example.com</span>
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={8}>
          <p className="menu-note">Preview account · fixture only</p>
          <Menu.Item
            onSelect={() =>
              onMessage(
                'Profile uses a fixture account in this mockup. Your real account is unchanged.',
              )
            }
          >
            Profile
          </Menu.Item>
          <Menu.Item
            onSelect={() =>
              onMessage(
                'Sign out is a preview action. No real account was signed out.',
              )
            }
          >
            Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MealMenu({
  meal,
  onAction,
}: {
  meal: Meal;
  onAction: (action: string, meal: Meal) => void;
}) {
  const recipe = recipes.find((r) => r.id === meal.recipeId)!;
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        <button
          className="icon-button"
          aria-label={`Meal actions for ${recipe.name}`}
        >
          <MoreHorizontal size={21} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={5}>
          <Menu.Item
            disabled={meal.cooked}
            onSelect={() => onAction('swap', meal)}
          >
            Swap meal
          </Menu.Item>
          <Menu.Item
            disabled={meal.cooked}
            onSelect={() => onAction('shopping', meal)}
          >
            Add to shopping
          </Menu.Item>
          <Menu.Item onSelect={() => onAction('move', meal)}>
            Move to another day
          </Menu.Item>
          <Menu.Separator />
          <Menu.Item
            className="danger"
            onSelect={() => onAction('remove', meal)}
          >
            Remove from plan
          </Menu.Item>
          {meal.cooked && (
            <p className="menu-note">Cooked meals can be moved or removed.</p>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ShoppingRow({
  row,
  onCheck,
}: {
  row: ProjectedShoppingRow;
  onCheck: () => void;
}) {
  const quantities = [row.quantity, ...(row.additionalQuantities || [])].filter(
    Boolean,
  );
  return (
    <label className={`shopping-row ${row.checked ? 'checked' : ''}`}>
      <input type="checkbox" checked={row.checked} onChange={onCheck} />
      <span>
        <strong>{row.displayName}</strong>
        <small>
          {quantities.length
            ? quantities
                .map((q) => `${q!.amount ?? ''} ${q!.unit}`.trim())
                .join(' + ')
            : 'As needed'}
        </small>
      </span>
    </label>
  );
}

export default function Dashboard() {
  const [scenario, setScenario] = useState(scenarios[0]);
  const [state, setState] = useState(() => fixture(scenarios[0]));
  const [shoppingUndo, setShoppingUndo] = useState<
    typeof state.shopping | null
  >(null);
  const [modal, setModal] = useState<Modal>(null);
  const [destination, setDestination] = useState('Dashboard');
  const [draft, setDraft] = useState('');
  const quickAddInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [ingredientSelection, setIngredientSelection] = useState<
    Record<string, boolean>
  >({});
  const [servings, setServings] = useState<Record<string, number>>({});
  const projection = projectShoppingDocument(state.shopping.document);
  const remaining = projection.items.filter((r) => !r.checked);
  const todaysMeals = state.meals.filter((m) => m.day === todayIndex);

  function reset(next: string) {
    setShoppingUndo(null);
    setScenario(next);
    setState(fixture(next));
    setModal(null);
    setMessage('');
    setDestination('Dashboard');
  }
  function mutateShopping(mutation: ShoppingDocumentMutation) {
    setShoppingUndo(null);
    setState((s) => ({
      ...s,
      shopping: applyShoppingDocumentMutation(s.shopping, mutation),
    }));
  }
  function openShopping(ids: string[], weekly = false) {
    setSelected(ids);
    setIngredientSelection({});
    setServings({});
    setModal({ kind: 'shopping', ids, weekly });
  }
  function action(action: string, meal: Meal) {
    if (action === 'swap') {
      setSearch('');
      setModal({ kind: 'picker', day: meal.day, swap: meal.recipeId });
    }
    if (action === 'shopping') openShopping([meal.recipeId]);
    if (action === 'move') setModal({ kind: 'move', meal });
    if (action === 'remove') {
      setState((s) => ({
        ...s,
        meals: s.meals.filter((m) => m.recipeId !== meal.recipeId),
      }));
      setMessage('Meal removed from plan. The recipe is still in Recipes.');
    }
  }
  function picker(day: number) {
    setSearch('');
    setModal({ kind: 'picker', day });
  }
  function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    setShoppingUndo(null);
    if (!draft.trim()) {
      setMessage('Enter an item or paste a comma-separated list.');
      quickAddInput.current?.focus();
      return;
    }
    let shopping = state.shopping;
    let addedCount = 0;
    const duplicate: string[] = [];
    for (const name of draft
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)) {
      const semantics = resolveShoppingIngredientSemantics({ item: name });
      if (
        projectShoppingDocument(shopping.document).items.some(
          (row) => row.orderingKey === semantics.purchaseKey,
        )
      ) {
        duplicate.push(name);
        continue;
      }
      shopping = applyShoppingDocumentMutation(shopping, {
        type: 'addManualItem',
        item: {
          id: crypto.randomUUID(),
          displayName: name,
          quantity: null,
          categoryKey: semantics.defaultCategoryKey,
          bucket: 'items',
          checked: false,
        },
      });
      addedCount += 1;
    }
    setState((s) => ({ ...s, shopping }));
    setDraft('');
    quickAddInput.current?.focus();
    setMessage(
      duplicate.length
        ? `${duplicate.join(', ')} already on the shopping list.${addedCount ? ' Other items added.' : ''}`
        : 'Added to shopping.',
    );
  }
  function addSelected() {
    const entries = recipes
      .filter((r) => selected.includes(r.id))
      .map((recipe) => {
        const count = servings[recipe.id] || recipe.servings;
        const entry = createShoppingRecipeEntry(recipe, count, {
          numerator: String(count),
          denominator: String(recipe.servings),
        });
        return {
          ...entry,
          ingredients: entry.ingredients.filter(
            (_, i) => ingredientSelection[`${recipe.id}:${i}`] !== false,
          ),
        };
      });
    mutateShopping({ type: 'upsertRecipes', entries });
    setModal(null);
    setMessage(
      'Selected ingredients added. Existing recipe contributions updated without duplication.',
    );
  }
  function navigate(label: string) {
    setDestination(label);
    setMessage('');
  }

  const quickAddForm = (
    <form className="quick-add" onSubmit={quickAdd}>
      <input
        aria-label="Quick add shopping items"
        ref={quickAddInput}
        placeholder="Quick add item…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="icon-button" aria-label="Add shopping items">
        <Plus size={22} />
      </button>
    </form>
  );
  const week = (
    <section className="week-section">
      <div className="section-heading">
        <div>
          <h2>{destination === 'Planner' ? 'Planner' : 'This week'}</h2>
          <p>
            {dateLabel(days[0])} – {dateLabel(days[6])}, 2026
          </p>
        </div>
        <div className="header-actions">
          <button onClick={() => navigate('Planner')}>
            Open planner <ArrowRight size={16} />
          </button>
          <button
            onClick={() =>
              openShopping(
                state.meals.map((m) => m.recipeId),
                true,
              )
            }
            disabled={!state.meals.length}
          >
            <ShoppingCart size={16} /> Add week to shopping
          </button>
        </div>
      </div>
      {!state.meals.length && (
        <div className="empty">
          <p>No meals planned this week</p>
          <button className="primary" onClick={() => picker(todayIndex)}>
            Plan your week
          </button>
        </div>
      )}
      <div className="week-days">
        {days.map((day, index) => (
          <div
            className={`day-row ${index === todayIndex ? 'is-today' : ''}`}
            key={index}
          >
            <div className="day-date">
              <span>
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <strong>{day.getDate()}</strong>
              {index === todayIndex && <small>Today</small>}
            </div>
            <div className="day-meals">
              {state.meals
                .filter((m) => m.day === index)
                .map((meal) => {
                  const recipe = recipes.find((r) => r.id === meal.recipeId)!;
                  return (
                    <div className="week-meal" key={meal.recipeId}>
                      <button
                        className="meal-title"
                        onClick={() => setModal({ kind: 'recipe', recipe })}
                      >
                        {recipe.name}
                        <small>
                          {meal.cooked
                            ? '✓ Cooked'
                            : `${recipe.total_time_minutes} min · ${recipe.servings} servings`}
                        </small>
                      </button>
                      <MealMenu meal={meal} onAction={action} />
                    </div>
                  );
                })}
              {!state.meals.some((m) => m.day === index) && (
                <span className="unplanned">No meals planned</span>
              )}
            </div>
            <button
              className="icon-button day-add"
              aria-label={`Plan a meal for ${dateLabel(day)}`}
              onClick={() => picker(index)}
            >
              <Plus size={18} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Image
          src="/recipe-genie-lockup.png"
          width={180}
          height={125}
          alt="Recipe Genie"
          priority
        />
        <nav aria-label="Main navigation">
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              aria-current={destination === label ? 'page' : undefined}
              className={destination === label ? 'active' : ''}
              onClick={() => navigate(label)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="account-footer">
          <ProfileButton onMessage={setMessage} />
          <div className="account-actions">
            <button
              onClick={() =>
                setMessage(
                  'Help preview: plan meals from Dashboard, add ingredients to Shopping, and use the scenario selector to explore states.',
                )
              }
            >
              <HelpCircle size={16} />
              Help
            </button>
            <button
              onClick={() =>
                setMessage(
                  'Sign out is a preview action. No real account was signed out.',
                )
              }
            >
              <LogOut size={16} />
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <header className="mobile-header">
        <Image
          src="/recipe-genie-mark.png"
          width={44}
          height={44}
          alt="Recipe Genie"
        />
        <ProfileButton onMessage={setMessage} />
      </header>
      <main id="main">
        <header className="page-heading">
          <div>
            <span className="eyebrow">YOUR KITCHEN, AT A GLANCE</span>
            <h1>{destination === 'Dashboard' ? 'Today' : destination}</h1>
            <p>
              {today.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <span className="preview-badge">Local mockup · fixture data</span>
        </header>
        {destination !== 'Dashboard' && (
          <p className="placeholder-note">
            {destination} mockup placeholder. The existing app screen will be
            retained.
          </p>
        )}
        {message && (
          <div className="feedback" role="status">
            {message}
            {shoppingUndo && (
              <button
                onClick={() => {
                  setState((s) => ({ ...s, shopping: shoppingUndo }));
                  setShoppingUndo(null);
                  setMessage('Shopping list restored.');
                }}
              >
                Undo
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setMessage('')}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {scenario === 'Loading' ? (
          <div className="loading" role="status" aria-busy="true">
            <h2>Loading your dashboard…</h2>
            <div />
            <div />
            <div />
          </div>
        ) : scenario === 'Load failure' ? (
          <div className="empty error" role="alert">
            <h2>Couldn’t load your dashboard</h2>
            <p>
              Your plan and shopping list are unavailable. Please try again.
            </p>
            <button className="primary" onClick={() => reset(scenarios[0])}>
              Retry
            </button>
          </div>
        ) : destination === 'Dashboard' ? (
          <div className="dashboard-grid">
            <section className="today-section">
              <div className="section-heading">
                <h2>Today’s meals</h2>
                <button onClick={() => picker(todayIndex)}>
                  <Plus size={17} /> Plan a meal
                </button>
              </div>
              {!todaysMeals.length ? (
                <div className="empty">
                  <p>No meals planned today</p>
                  <button
                    className="primary"
                    onClick={() => picker(todayIndex)}
                  >
                    Plan a meal
                  </button>
                </div>
              ) : (
                <div className="meal-cards">
                  {todaysMeals.map((meal) => {
                    const recipe = recipes.find((r) => r.id === meal.recipeId)!;
                    return (
                      <article
                        className={`meal-card ${meal.cooked ? 'cooked' : ''}`}
                        key={meal.recipeId}
                      >
                        <div className="card-top">
                          <span>
                            {meal.cooked ? '✓ COOKED' : 'PLANNED FOR TODAY'}
                          </span>
                          <MealMenu meal={meal} onAction={action} />
                        </div>
                        <button
                          className="recipe-image"
                          aria-label={`Open ${recipe.name}`}
                          onClick={() => setModal({ kind: 'recipe', recipe })}
                        >
                          {recipe.image_url ? (
                            <Image
                              src={recipe.image_url}
                              alt=""
                              width={500}
                              height={330}
                            />
                          ) : (
                            <Utensils size={40} />
                          )}
                        </button>
                        <button
                          className="card-title"
                          onClick={() => setModal({ kind: 'recipe', recipe })}
                        >
                          {recipe.name}
                        </button>
                        <p>
                          {recipe.total_time_minutes} min · {recipe.servings}{' '}
                          servings
                        </p>
                        <button
                          className={meal.cooked ? 'cooked-label' : 'primary'}
                          disabled={meal.cooked}
                          onClick={() => {
                            setState((s) => ({
                              ...s,
                              meals: s.meals.map((m) =>
                                m.recipeId === meal.recipeId
                                  ? { ...m, cooked: true }
                                  : m,
                              ),
                            }));
                            setMessage(`${recipe.name} marked as cooked.`);
                          }}
                        >
                          <Check size={17} />
                          {meal.cooked ? 'Cooked' : 'Mark as cooked'}
                        </button>
                      </article>
                    );
                  })}
                  <button
                    className="plan-card"
                    onClick={() => picker(todayIndex)}
                  >
                    <span>
                      <Plus size={26} />
                    </span>
                    <strong>Plan a meal</strong>
                    <small>Add a recipe to today’s plan</small>
                  </button>
                </div>
              )}
            </section>
            <section className="shopping-section">
              <div className="section-heading">
                <div>
                  <h2>Shopping</h2>
                  <p>{remaining.length} items remaining</p>
                </div>
                <button onClick={() => navigate('Shopping')}>
                  View all <ArrowRight size={17} />
                </button>
              </div>
              {quickAddForm}
              <div className="shopping-items">
                {remaining.slice(0, 5).map((row) => (
                  <ShoppingRow
                    key={row.rowRef}
                    row={row}
                    onCheck={() =>
                      mutateShopping({
                        type: 'setChecked',
                        rowRef: row.rowRef,
                        checked: true,
                      })
                    }
                  />
                ))}
              </div>
              {!remaining.length && (
                <div className="empty">
                  <p>
                    {projection.items.length
                      ? 'Everything is checked off'
                      : 'Your shopping list is empty'}
                  </p>
                  {projection.items.length > 0 && (
                    <button onClick={() => navigate('Shopping')}>
                      View list <ArrowRight size={17} />
                    </button>
                  )}
                </div>
              )}
              {remaining.length > 5 && (
                <button
                  className="more-items"
                  onClick={() => navigate('Shopping')}
                >
                  + {remaining.length - 5} more items to buy{' '}
                  <ArrowRight size={17} />
                </button>
              )}
              <p className="subtle">
                Check items off as you go. Your list updates here.
              </p>
            </section>
            {week}
          </div>
        ) : destination === 'Planner' ? (
          week
        ) : destination === 'Shopping' ? (
          <section className="full-list">
            <div className="section-heading">
              <h2>Your shopping list</h2>
              <p>{remaining.length} items remaining</p>
            </div>
            {quickAddForm}
            {!projection.items.length && (
              <div className="empty">Your shopping list is empty</div>
            )}
            {projection.items.length > 0 && !remaining.length && (
              <p>Everything is checked off</p>
            )}
            {projection.items.map((row) => (
              <ShoppingRow
                key={row.rowRef}
                row={row}
                onCheck={() =>
                  mutateShopping({
                    type: 'setChecked',
                    rowRef: row.rowRef,
                    checked: !row.checked,
                  })
                }
              />
            ))}
            {projection.items.length > 0 && remaining.length === 0 && (
              <button
                className="secondary"
                onClick={() => {
                  mutateShopping({ type: 'complete' });
                  setShoppingUndo(state.shopping);
                  setMessage('Shopping completed. Your list has been cleared.');
                }}
              >
                Complete shopping
              </button>
            )}
          </section>
        ) : destination === 'Recipes' ? (
          <section className="recipe-library">
            <h2>Your recipes</h2>
            {recipes.map((recipe) => (
              <button
                key={recipe.id}
                onClick={() => setModal({ kind: 'recipe', recipe })}
              >
                <BookOpen size={20} />
                <span>
                  {recipe.name}
                  <small>
                    {recipe.total_time_minutes} min · {recipe.servings} servings
                  </small>
                </span>
                <ArrowRight size={17} />
              </button>
            ))}
          </section>
        ) : (
          <div className="empty">
            <Package size={30} />
            <h2>Pantry preview</h2>
            <p>
              No pantry items in these fixtures. Pantry editing remains in the
              full app.
            </p>
          </div>
        )}
        <details className="development" open>
          <summary>Development scenarios · isolated in-memory fixtures</summary>
          <label>
            Scenario{' '}
            <select
              aria-label="Development scenario"
              value={scenario}
              onChange={(e) => reset(e.target.value)}
            >
              {scenarios.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button onClick={() => reset(scenario)}>Reset scenario</button>
          <p>
            Fixed evaluation date: September 30, 2026 · Monday–Sunday week.
            Changes reset on reload. No account, storage, or database
            connections.
          </p>
        </details>
      </main>
      <Dialog.Root
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="overlay" />
          <Dialog.Content className="dialog">
            <Dialog.Title>
              {modal?.kind === 'recipe'
                ? modal.recipe.name
                : modal?.kind === 'picker'
                  ? modal.swap
                    ? 'Swap meal'
                    : 'Plan a meal'
                  : modal?.kind === 'move'
                    ? 'Move to another day'
                    : modal?.kind === 'shopping'
                      ? modal.weekly
                        ? 'Add week to shopping'
                        : 'Add to shopping'
                      : 'Shopping list'}
            </Dialog.Title>
            <Dialog.Description>
              {modal?.kind === 'shopping'
                ? `Choose recipes, servings, and ingredients${modal.weekly ? ` for ${dateLabel(days[0])} – ${dateLabel(days[6])}. Cooked meals are included, as in Planner.` : '.'}`
                : modal?.kind === 'picker'
                  ? `Choose a recipe for ${dateLabel(days[modal.day])}.`
                  : modal?.kind === 'move'
                    ? 'Move this scheduled meal. Its cooked status stays the same.'
                    : 'Representative recipe · fixture data only'}
            </Dialog.Description>
            <Dialog.Close
              className="icon-button dialog-close"
              aria-label="Close dialog"
            >
              <X size={21} />
            </Dialog.Close>
            {modal?.kind === 'recipe' && (
              <>
                <div className="recipe-meta">
                  {modal.recipe.total_time_minutes} min ·{' '}
                  {modal.recipe.servings} servings
                </div>
                {modal.recipe.image_url && (
                  <Image
                    className="detail-image"
                    src={modal.recipe.image_url}
                    alt={modal.recipe.name}
                    width={500}
                    height={300}
                  />
                )}
                <h3>Ingredients</h3>
                <ul>
                  {modal.recipe.ingredientSections
                    .flatMap((s) => s.ingredients)
                    .map((i, n) => (
                      <li key={n}>
                        {i.amount} {i.unit} {i.item}
                      </li>
                    ))}
                </ul>
                <h3>Instructions</h3>
                <ol>
                  {modal.recipe.instructionSections
                    .flatMap((s) => s.steps)
                    .map((s, n) => (
                      <li key={n}>{s}</li>
                    ))}
                </ol>
                <button className="primary" onClick={() => picker(todayIndex)}>
                  Plan for today
                </button>
              </>
            )}
            {modal?.kind === 'picker' && (
              <>
                <label className="field">
                  Scheduled day
                  <select
                    aria-label="Scheduled day"
                    value={modal.day}
                    onChange={(e) =>
                      setModal({ ...modal, day: Number(e.target.value) })
                    }
                  >
                    {days.map((d, i) => (
                      <option key={i} value={i}>
                        {d.toLocaleDateString('en-US', { weekday: 'long' })},{' '}
                        {dateLabel(d)}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  className="search"
                  aria-label="Search recipes"
                  placeholder="Search recipes…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {recipes
                  .filter((r) =>
                    r.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((recipe) => {
                    const planned = state.meals.some(
                      (m) => m.recipeId === recipe.id,
                    );
                    return (
                      <button
                        className="picker-row"
                        key={recipe.id}
                        disabled={planned}
                        onClick={() => {
                          setState((s) => ({
                            ...s,
                            meals: [
                              ...s.meals.filter(
                                (m) => m.recipeId !== modal.swap,
                              ),
                              {
                                recipeId: recipe.id,
                                day: modal.day,
                                cooked: false,
                              },
                            ],
                          }));
                          setModal(null);
                          setMessage(
                            modal.swap ? 'Meal swapped.' : 'Meal planned.',
                          );
                        }}
                      >
                        <span>
                          {recipe.name}
                          <small>
                            {recipe.servings} servings ·{' '}
                            {recipe.total_time_minutes} min
                            {planned ? ' · Already planned this week' : ''}
                          </small>
                        </span>
                        <Plus size={19} />
                      </button>
                    );
                  })}
              </>
            )}
            {modal?.kind === 'move' &&
              days.map((d, i) => (
                <button
                  key={i}
                  className="picker-row"
                  disabled={i === modal.meal.day}
                  onClick={() => {
                    setState((s) => ({
                      ...s,
                      meals: s.meals.map((m) =>
                        m.recipeId === modal.meal.recipeId
                          ? { ...m, day: i }
                          : m,
                      ),
                    }));
                    setModal(null);
                    setMessage('Meal moved.');
                  }}
                >
                  {d.toLocaleDateString('en-US', { weekday: 'long' })},{' '}
                  {dateLabel(d)}
                  {i === modal.meal.day && ' · Current day'}
                </button>
              ))}
            {modal?.kind === 'shopping' && (
              <>
                {recipes
                  .filter((r) => modal.ids.includes(r.id))
                  .map((recipe) => {
                    const entry = createShoppingRecipeEntry(
                      recipe,
                      servings[recipe.id] || recipe.servings,
                      {
                        numerator: String(
                          servings[recipe.id] || recipe.servings,
                        ),
                        denominator: String(recipe.servings),
                      },
                    );
                    return (
                      <fieldset className="shopping-choice" key={recipe.id}>
                        <legend>
                          <label>
                            <input
                              type="checkbox"
                              checked={selected.includes(recipe.id)}
                              onChange={(e) =>
                                setSelected((s) =>
                                  e.target.checked
                                    ? [...s, recipe.id]
                                    : s.filter((id) => id !== recipe.id),
                                )
                              }
                            />
                            {recipe.name}
                          </label>
                        </legend>
                        <label className="servings">
                          Servings{' '}
                          <input
                            type="number"
                            aria-label={`Servings for ${recipe.name}`}
                            min="1"
                            max="24"
                            value={servings[recipe.id] || recipe.servings}
                            onChange={(e) =>
                              setServings((s) => ({
                                ...s,
                                [recipe.id]: Math.max(
                                  1,
                                  Math.min(24, Number(e.target.value) || 1),
                                ),
                              }))
                            }
                          />
                        </label>
                        {entry.ingredients.map((ingredient, i) => (
                          <label className="ingredient-choice" key={i}>
                            <input
                              type="checkbox"
                              disabled={!selected.includes(recipe.id)}
                              checked={
                                ingredientSelection[`${recipe.id}:${i}`] !==
                                false
                              }
                              onChange={(e) =>
                                setIngredientSelection((s) => ({
                                  ...s,
                                  [`${recipe.id}:${i}`]: e.target.checked,
                                }))
                              }
                            />
                            {ingredient.displayName}
                            <small>
                              {ingredient.quantity?.amount}{' '}
                              {ingredient.quantity?.unit}
                            </small>
                          </label>
                        ))}
                      </fieldset>
                    );
                  })}
                <div className="dialog-footer">
                  <button onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="primary"
                    disabled={!selected.length}
                    onClick={addSelected}
                  >
                    Add selected ingredients
                  </button>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
