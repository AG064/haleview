import { PageDataState } from "../components/PageDataState";
import { useEffect, useState } from "react";
import {
  ShoppingBasket,
  Carrot,
  Fish,
  Milk,
  Wheat,
  Package,
  GlassWater,
  Search,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { ApiError } from "../api";
import { AppAccordion } from "../components/AppAccordion";
import {
  createShoppingList,
  listMealPlans,
  listShoppingLists,
  updateShoppingItem,
  type SessionRequest,
} from "../nutrition/api";
import type { ShoppingList, ShoppingItem } from "../nutrition/types";
import { displayDateOnly } from "../format";

const shoppingGroups = [
  "Produce",
  "Protein",
  "Dairy",
  "Grains",
  "Pantry",
  "Drinks",
  "Other",
];
const shoppingGroupTones: Record<string, "sage" | "oat" | "clay"> = {
  Produce: "sage",
  Protein: "clay",
  Dairy: "oat",
  Grains: "oat",
  Pantry: "clay",
  Drinks: "sage",
  Other: "sage",
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "The shopping list could not be loaded.";
}

function listLabel(list: ShoppingList): string {
  const source = list.sourceType === "meal" ? "Meal" : "Plan";
  const createdAt = displayDateOnly(list.createdAt);
  return `${source} list · ${createdAt}`;
}

function displayQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface ShoppingQuantityEditorProps {
  item: ShoppingItem;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}

function ShoppingQuantityEditor({
  item,
  draft,
  busy,
  onDraftChange,
  onSave,
  onCancel,
  onRemove,
}: ShoppingQuantityEditorProps) {
  return (
    <form
      className="shop-edit"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label>
        Quantity ({item.unit})
        <input
          autoFocus
          type="number"
          min="0.001"
          max="1000000"
          step="0.001"
          value={draft}
          disabled={busy}
          onChange={(event) => onDraftChange(event.target.value)}
          required
        />
      </label>
      <button type="submit" disabled={busy}>
        <Check aria-hidden="true" />
        Save
      </button>
      <button type="button" disabled={busy} onClick={onCancel}>
        <X aria-hidden="true" />
        Cancel
      </button>
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={onRemove}
      >
        Remove from list
      </button>
    </form>
  );
}

export function ShoppingListScreen({
  request,
  signedIn,
}: {
  request: SessionRequest;
  signedIn: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [selected, setSelected] = useState<ShoppingList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [neededOnly, setNeededOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const checkedCount =
    selected?.items.filter((item) => item.checked).length ?? 0;
  const remaining = (selected?.items.length ?? 0) - checkedCount;
  const groupIcons = {
    Produce: Carrot,
    Protein: Fish,
    Dairy: Milk,
    Grains: Wheat,
    Pantry: Package,
    Drinks: GlassWater,
    Other: ShoppingBasket,
  };
  const matchingItems =
    selected?.items.filter(
      (item) =>
        (!neededOnly || !item.checked) &&
        item.name
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  const visibleGroups = selected
    ? shoppingGroups.filter((group) =>
        selected.items.some((item) => item.group === group),
      )
    : [];

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError(null);
    request(listShoppingLists)
      .then((savedLists) => {
        if (!active) return;
        setLists(savedLists);
        setSelected(savedLists[0] ?? null);
        setLoaded(true);
      })
      .catch((loadError: unknown) => { if (active) setError(errorMessage(loadError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, signedIn, retry]);

  if (!signedIn) {
    return (
      <section className="panel shopping-panel shopping-workspace">
        <p className="eyebrow">Meal planning</p>
        <h2>Sign in to use shopping lists</h2>
        <p className="recipe-intro">
          Shopping lists are saved with the meal plan in your account.
        </p>
      </section>
    );
  }

  if (!loaded) return <PageDataState view="list" title="Shopping list" loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} />;

  const createList = async () => {
    setBusy(true);
    setError(null);
    try {
      const plans = await request(listMealPlans);
      const plan = plans[0];
      if (!plan)
        throw new Error(
          "Generate a meal plan before creating a shopping list.",
        );
      const created = await request((token) =>
        createShoppingList(plan.id, undefined, token),
      );
      setLists((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
      setSelected(created);
      setMessage("Shopping list created.");
    } catch (createError: unknown) {
      setError(errorMessage(createError));
    } finally {
      setBusy(false);
    }
  };

  const changeItem = async (
    itemId: string,
    quantity: number | undefined,
    removed = false,
    checked?: boolean,
  ) => {
    if (!selected || busy) return;
    if (
      quantity !== undefined &&
      (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000)
    ) {
      setError("Enter a quantity greater than zero and at most one million.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await request((token) =>
        updateShoppingItem(
          selected.id,
          itemId,
          {
            ...(quantity === undefined ? {} : { quantity }),
            ...(checked === undefined ? {} : { checked }),
            removed,
          },
          token,
        ),
      );
      setSelected(updated);
      setLists((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditing(null);
      setMessage(
        removed
          ? "Item removed."
          : checked === undefined
            ? "Quantity saved."
            : checked
              ? "Item checked off."
              : "Item returned to your list.",
      );
    } catch (changeError: unknown) {
      setError(errorMessage(changeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel shopping-panel shopping-workspace">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Meal planning</p>
          <h2>Shopping list</h2>
        </div>
      </div>
      <p className="recipe-intro">
        Check your cupboards, then tick off each item as you shop.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success-text" role="status">
          {message}
        </p>
      )}
      <div className="shopping-toolbar">
        {lists.length > 0 && (
          <label className="saved-plan-select">
            Saved list
            <select
              value={selected?.id ?? ""}
              disabled={busy}
              onChange={(event) => {
                setSelected(
                  lists.find((item) => item.id === event.target.value) ?? null,
                );
                setEditing(null);
                setQuery("");
                setMessage(null);
              }}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {listLabel(list)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="primary-button compact-button"
          type="button"
          disabled={busy}
          onClick={() => void createList()}
        >
          Create from latest plan
        </button>
      </div>
      {!selected && (
        <div className="shop-empty">
          <ShoppingBasket aria-hidden="true" />
          <h3>Your next shop starts here</h3>
          <p>
            Create a list from your latest meal plan. Ingredients are combined
            for you.
          </p>
        </div>
      )}
      {selected && (
        <>
          <div className="shop-hero">
            <span className="shop-hero-icon">
              <ShoppingBasket aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">
                {remaining ? "Ready to shop" : "All set"}
              </p>
              <h3>
                {remaining
                  ? remaining + (remaining === 1 ? " item left" : " items left")
                  : "Everything is checked off"}
              </h3>
              <p>
                {checkedCount} of {selected.items.length} collected ·{" "}
                {visibleGroups.length} categories
              </p>
            </div>
            <progress
              value={checkedCount}
              max={Math.max(1, selected.items.length)}
              aria-label="Shopping progress"
            />
          </div>
          <div className="shop-controls">
            <label className="shop-search">
              <Search aria-hidden="true" />
              <span className="sr-only">Find an item</span>
              <input
                type="search"
                placeholder="Find an item"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="shop-tabs segmented-switch" role="group" aria-label="Show shopping items" data-index={neededOnly ? "1" : "0"} data-segments="2">
              <button
                type="button"
                aria-pressed={!neededOnly}
                onClick={() => setNeededOnly(false)}
              >
                All items
              </button>
              <button
                type="button"
                aria-pressed={neededOnly}
                onClick={() => setNeededOnly(true)}
              >
                Still needed · {remaining}
              </button>
            </div>
          </div>
          {matchingItems.length === 0 && (
            <p className="shop-empty" role="status">
              {query
                ? "No items match your search."
                : neededOnly
                  ? "You have everything. Switch to All items to review your list."
                  : "This list is empty. Create a list from your latest plan."}
            </p>
          )}
          <div className="shopping-groups">
            {shoppingGroups.map((group) => {
              const items = matchingItems.filter(
                (item) => item.group === group,
              );
              if (!items.length) return null;
              const left = items.filter((item) => !item.checked).length;
              return (
                <AppAccordion
                  className="shopping-group"
                  key={selected.id + group}
                  title={group}
                  meta={left + " to get"}
                  icon={groupIcons[group as keyof typeof groupIcons]}
                  tone={shoppingGroupTones[group]}
                  defaultOpen
                >
                  {items.map((item) => (
                    <div
                      className={
                        "shop-row" + (item.checked ? " is-collected" : "")
                      }
                      key={item.id}
                    >
                      <label className="shop-check">
                        <input
                          type="checkbox"
                          checked={!!item.checked}
                          disabled={busy}
                          onChange={(event) =>
                            void changeItem(
                              item.id,
                              undefined,
                              false,
                              event.target.checked,
                            )
                          }
                        />
                        <span>{item.name}</span>
                      </label>
                      <span className="shop-amount">
                        {displayQuantity(item.quantity)}{" "}
                        <small>{item.unit}</small>
                      </span>
                      <button
                        className="shop-icon-button"
                        type="button"
                        aria-label={"Edit " + item.name}
                        disabled={busy}
                        onClick={() => {
                          setEditing(editing === item.id ? null : item.id);
                          setDraft(String(displayQuantity(item.quantity)));
                          setError(null);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      {editing === item.id && (
                        <ShoppingQuantityEditor
                          item={item}
                          draft={draft}
                          busy={busy}
                          onDraftChange={setDraft}
                          onSave={() => void changeItem(item.id, Number(draft))}
                          onCancel={() => setEditing(null)}
                          onRemove={() =>
                            void changeItem(item.id, undefined, true)
                          }
                        />
                      )}
                    </div>
                  ))}
                </AppAccordion>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
