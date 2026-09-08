import { CombineRecipeIcon } from "./CombineRecipeIcon";
import { WaitingState } from "./WaitingState";
import { nutritionLabel } from "../nutrition/preferences";
import { PageDataState } from "./PageDataState";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChefHat, Plus, Sparkles, X } from "lucide-react";
import { ApiError } from "../api";
import { createRecipe, listCreatedRecipes, searchCreationSources, saveCreatedRecipe, removeCreatedRecipe, listMealPlans, addCreatedRecipeToPlan, type SessionRequest } from "../nutrition/api";
import type { RecipeCreation, RecipeSearchResult, MealPlan } from "../nutrition/types";

const starters = ["A cozy potato dinner with a little crunch", "Something fresh with tomatoes and beans", "A quick breakfast worth getting up for"];
const errorText = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;

export function RecipeCreatePanel({ request, onOpen, refreshKey, collectionOnly = false, onCreate }: { request: SessionRequest; onOpen: (recipe: RecipeCreation) => void; refreshKey: number; collectionOnly?: boolean; onCreate: () => void }) {
  const [mode, setMode] = useState<"describe" | "combine" | "saved">(collectionOnly ? "saved" : "describe");
  const [query, setQuery] = useState("");
  const [servings, setServings] = useState("2");
  const [minutes, setMinutes] = useState("30");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sources, setSources] = useState<RecipeSearchResult[]>([]);
  const [picked, setPicked] = useState<RecipeSearchResult[]>([]);
  const [saved, setSaved] = useState<RecipeCreation[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError(null);
    Promise.all([request(token => listCreatedRecipes(token)), collectionOnly ? Promise.resolve([]) : request(token => searchCreationSources("", token))])
      .then(([recipes, results]) => { if (active) { setSaved(recipes); setSources(results); setLoaded(true); } })
      .catch(error => { if (active) setError(errorText(error, "Recipes could not be loaded.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [request, refreshKey, retry, collectionOnly]);
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "saved" || busy) return;
    setError(null);
    setBusy(true);
    try {
      onOpen(await request(token => createRecipe({ mode, query: query.trim(), servings: Number(servings), maxMinutes: Number(minutes),
        sourceRecipeIds: mode === "combine" ? picked.map(item => item.recipe.id) : [] }, token)));
    } catch (error) { setError(errorText(error, "The recipe could not be created. Your idea is still here to try again.")); }
    finally { setBusy(false); }
  };
  const search = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError(null);
    try { setSources(await request(token => searchCreationSources(sourceQuery, token))); }
    catch (error) { setError(errorText(error, "Source recipes could not be loaded.")); }
    finally { setLoading(false); }
  };
  if (!loaded) return <PageDataState compact view={collectionOnly ? "recipes" : "form"} title={collectionOnly ? "My saved recipes" : "Recipe creation"} loading={loading} error={error} onRetry={() => setRetry((value) => value + 1)} />;

  return <div className="recipe-create">
    {!collectionOnly && <div className="create-intro"><span className="create-mark"><ChefHat aria-hidden="true" /></span><div><p className="eyebrow">A little kitchen curiosity</p><h3>What sounds good?</h3><p>Start with an idea. Let Hale help turn it into dinner.</p></div></div>}
    {!collectionOnly && <div className="create-tabs" role="group" aria-label="Recipe creation mode">
      <button type="button" aria-pressed={mode === "describe"} disabled={busy} onClick={() => setMode("describe")}><Sparkles aria-hidden="true" />Describe</button>
      <button type="button" aria-pressed={mode === "combine"} disabled={busy} onClick={() => setMode("combine")}><CombineRecipeIcon />Combine</button>
    </div>}
    {collectionOnly && <h3>My saved recipes <span>({saved.length})</span></h3>}
    {busy && <WaitingState label={mode === "combine" ? "Hale is combining your recipes." : "Hale is creating your recipe."} detail="Your request includes catalogue checks and a recipe review. You can keep your idea here while it runs." />}
    {error && <p className="error-text" role="alert">{error}</p>}
    {mode === "saved" ? <div className="created-collection">
      {loading && <p role="status">Opening your recipe book...</p>}
      {!loading && !error && saved.length === 0 && <div className="create-empty"><ChefHat aria-hidden="true" /><h4>Your next favorite starts here.</h4><p>Save a creation and it will be waiting here next time.</p><button className="secondary-button" type="button" onClick={onCreate}>Create your first recipe</button></div>}
      {saved.map(item => <button className="created-saved-card" type="button" key={item.recipe.id} onClick={() => onOpen(item)}><span className="eyebrow">{item.mode === "combine" ? "Combined with Hale" : "Created with Hale"}</span><strong>{item.recipe.title}</strong><span>{item.recipe.summary}</span><small>{item.recipe.time} min · {item.recipe.servings} servings</small><span className="tag-row">{item.recipe.dietary_tags.map(tag => <span className="tag" key={tag}>{nutritionLabel(tag)}</span>)}</span><ArrowRight aria-hidden="true" /></button>)}
    </div> : <>
      {mode === "combine" && <div className="create-source-picker">
        <div className="create-section-heading"><div><h4>Pick your inspiration</h4><p>Choose two or three recipes that fit your saved food preferences.</p></div><span>{picked.length} / 3</span></div>
        {picked.length > 0 && <div className="create-picked" aria-label="Selected source recipes">{picked.map(item => <button type="button" key={item.recipe.id} disabled={busy} onClick={() => setPicked(current => current.filter(r => r.recipe.id !== item.recipe.id))} aria-label={`Remove ${item.recipe.title}`}><Check aria-hidden="true" />{item.recipe.title}<X aria-hidden="true" /></button>)}</div>}
        <form className="create-source-search" onSubmit={search}><label>Find a source recipe<input value={sourceQuery} maxLength={160} onChange={event => setSourceQuery(event.target.value)} placeholder="Try potatoes, soup or Italian" /></label><button className="secondary-button" disabled={loading || busy}>Find recipes</button></form>
        {loading && <WaitingState label="Finding source recipes." />}
        {!loading && !error && sources.length === 0 && <p>No matching recipes. Try a different search.</p>}
        <div className="create-source-grid">{sources.map(item => {
          const selected = picked.some(r => r.recipe.id === item.recipe.id);
          return <article className="create-source-card" key={item.recipe.id} data-selected={selected}><a className="recipe-title-open" href={`/recipes?recipe=${encodeURIComponent(item.recipe.id)}`} target="_blank" rel="noreferrer"><strong>{item.recipe.title}</strong><span className="sr-only"> (opens in a new tab)</span></a><small>{item.recipe.cuisine} / {item.recipe.time} min</small><button className="text-button" type="button" aria-pressed={selected} disabled={busy || (!selected && picked.length >= 3)} onClick={() => setPicked(current => selected ? current.filter(r => r.recipe.id !== item.recipe.id) : [...current, item])}>{selected ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}{selected ? "Selected" : "Select recipe"}</button></article>;
        })}</div>
      </div>}
      <form className="create-idea-form" onSubmit={generate}>
        <label>{mode === "describe" ? "Tell Hale what you have in mind" : "What should come together?"}<textarea rows={4} maxLength={600} required disabled={busy} value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === "describe" ? "I have potatoes and tomatoes. Something warm, a little spicy, with leftovers for tomorrow." : "Use the filling from the first recipe and the sauce from the second. Keep it simple."} /></label>
        {mode === "describe" && <div className="create-starters" aria-label="Recipe ideas">{starters.map(idea => <button type="button" key={idea} disabled={busy} onClick={() => setQuery(idea)}>{idea}<ArrowRight aria-hidden="true" /></button>)}</div>}
        <div className="create-limits"><label>Servings<input type="number" min={1} max={12} step={1} required disabled={busy} value={servings} onChange={event => setServings(event.target.value)} /></label><label>Time to cook<select value={minutes} disabled={busy} onChange={event => setMinutes(event.target.value)}>{[15, 30, 45, 60, 90].map(value => <option key={value} value={value}>Up to {value} minutes</option>)}</select></label></div>
        <div className="create-footer"><p>Your saved allergies and food restrictions stay in place. Online AI is needed to create; browsing and local variations are always available.</p><button className="primary-button" disabled={busy || (mode === "combine" && picked.length < 2)} aria-busy={busy}><Sparkles aria-hidden="true" />{busy ? "Hale is putting it together..." : mode === "combine" ? "Combine recipes" : "Create recipe"}</button></div>
      </form>
    </>}
  </div>;
}

export function CreatedRecipeActions({ creation, request, onSaved, onRemoved }: { creation: RecipeCreation; request: SessionRequest; onSaved: () => void; onRemoved: () => void }) {
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [mealType, setMealType] = useState("dinner");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (error) { setError(errorText(error, "The recipe could not be updated.")); }
    finally { setBusy(false); }
  };
  const plan = plans.find(item => item.id === planId);
  return <div className="created-actions">
    <div className="created-action-bar"><button className="primary-button" disabled={busy || creation.saved} type="button" onClick={() => void run(async () => { await request(token => saveCreatedRecipe(creation.recipe.id, creation.recipe.servings, token)); onSaved(); setMessage("A keeper. Saved to My saved recipes."); })}>{creation.saved ? "Saved to My saved recipes" : "Save recipe"}</button><button className="secondary-button" disabled={busy} type="button" onClick={() => void run(async () => { const results = await request(token => listMealPlans(token)); setPlans(results); setPlanId(results[0]?.id ?? ""); setDate(results[0]?.startDate ?? ""); setAdding(true); })}>Add to a plan</button>{creation.saved && <button className="text-button" type="button" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove saved recipe</button>}</div>
    {confirmRemove && <div className="created-remove"><p>Remove this saved recipe? Copies already in meal plans will stay.</p><button className="secondary-button" disabled={busy} type="button" onClick={() => void run(async () => { await request(token => removeCreatedRecipe(creation.recipe.id, token)); onRemoved(); })}>Remove recipe</button><button className="text-button" type="button" onClick={() => setConfirmRemove(false)}>Keep it</button></div>}
    {adding && (plans.length === 0 ? <p>Create a meal plan first, then come back to add this recipe.</p> : <form className="created-plan-form" onSubmit={event => { event.preventDefault(); void run(async () => { await request(token => addCreatedRecipeToPlan(planId, { recipeId: creation.recipe.id, servings: creation.recipe.servings, date, time, mealType }, token)); setAdding(false); setMessage("Added to your meal plan. The shopping list can use these ingredients too."); }); }}>
      <label>Meal plan<select required value={planId} onChange={event => { setPlanId(event.target.value); setDate(plans.find(item => item.id === event.target.value)?.startDate ?? ""); }}>{plans.map(item => <option value={item.id} key={item.id}>{item.startDate} to {item.endDate}</option>)}</select></label>
      <label>Day<select required value={date} onChange={event => setDate(event.target.value)}>{plan?.days.map(day => <option key={day.date} value={day.date}>{day.date}</option>)}</select></label>
      <label>Meal<select value={mealType} onChange={event => setMealType(event.target.value)}>{["breakfast", "lunch", "dinner", "snack"].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
      <label>Time ({plan?.timezone})<input type="time" required value={time} onChange={event => setTime(event.target.value)} /></label>
      <button className="primary-button" disabled={busy} aria-busy={busy}>Add recipe</button><button className="text-button" type="button" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
    </form>)}
    {message && <p role="status">{message}</p>}{error && <p className="error-text" role="alert">{error}</p>}
  </div>;
}
