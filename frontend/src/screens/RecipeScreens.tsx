import { PageDataState } from "../components/PageDataState";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Clock, Flame, ListChecks, Minus, Plus, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star } from "lucide-react";
import { ApiError } from "../api";
import { AppAccordion } from "../components/AppAccordion";
import { addRecipeFavourite, listRecipeFavourites, removeRecipeFavourite, getCreatedRecipe, generateCustomRecipe, getIngredientSubstitutions, getRecipe, saveNutritionFeedback, scaleCustomRecipe, scaleCreatedRecipe, searchRecipeGroups, type SessionRequest } from "../nutrition/api";
import { RecipeCreatePanel, CreatedRecipeActions } from "../components/RecipeCreatePanel";
import type { RecipeCreation, RecipeFavourite, RecipeGroup } from "../nutrition/types";
import type { CommunityRecipeSignal, EnhancedNutritionProfile, IngredientSubstitution, RecipeRecord, RecipeSearchFilters, RecipeSearchResult } from "../nutrition/types";
import { NutritionSummary } from "../components/NutritionSummary";
import { allergyOptions, dietaryPreferenceOptions, nutritionLabel } from "../nutrition/preferences";
import { recipeVisual } from "../nutrition/recipe-images";

const mealValues = ["", "breakfast", "lunch", "dinner", "snack", "dessert", "side", "drink"];
const dietaryValues = ["", ...dietaryPreferenceOptions];
const allergyValues = ["", ...allergyOptions];

interface SelectedRecipe {
  recipe: RecipeRecord;
  nutrition: RecipeSearchResult["nutrition"];
  enhancedNutrition: EnhancedNutritionProfile;
  community?: CommunityRecipeSignal;
  custom?: boolean;
  creation?: RecipeCreation;
  generationSource?: "local" | "deepseek";
  variation?: { baseRecipeId: string; substitutions: Array<{ fromIngredientId: string; toIngredientId: string }> };
}

function recipeAmountLabel(value: number): string {
  if (value === 1) return "Whole recipe";
  return `${value} recipe portions`;
}

function archiveRecipeUrl(source: string): string | null {
  const match = /^open-recipe-archive:([^/]+)\/(.+)$/u.exec(source);
  if (!match) return null;
  const collection = encodeURIComponent(match[1]);
  const slug = match[2].split("/").map(encodeURIComponent).join("/");
  return `https://github.com/AdamBouhmad/open-recipe-archive/blob/ae3bd2c009a8899dfe63b9166fa98ae3fa8041a8/collections/${collection}/recipes/${slug}.md`;
}

function RecipePhoto({ recipe, detail = false, onOpen }: { recipe: RecipeRecord; detail?: boolean; onOpen?: () => void }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const visual = recipeVisual(recipe, failedSources);
  if (visual.kind === "none") return null;
  return (
    <figure className={`recipe-photo has-photo${detail ? " recipe-photo-detail" : ""}`}>
      {onOpen ? <button className="recipe-photo-open" type="button" aria-label={`Open ${recipe.title}`} onClick={onOpen}><img src={visual.src} alt={visual.alt} loading="lazy" decoding="async" onError={() => setFailedSources((current) => current.includes(visual.src) ? current : [...current, visual.src])} /></button> : <img src={visual.src} alt={visual.alt} loading={detail ? "eager" : "lazy"} decoding="async" onError={() => setFailedSources((current) => current.includes(visual.src) ? current : [...current, visual.src])} />}
      <figcaption>
        <span>{visual.label}{detail ? ". Not a photo of this exact recipe." : ""}</span>
        <span>Photo: <a href={visual.credit.sourceUrl} target="_blank" rel="noreferrer">{visual.credit.creator}</a> · <a href={visual.credit.licenseUrl} target="_blank" rel="noreferrer">{visual.credit.license}</a>. Display cropped to fit.</span>
      </figcaption>
    </figure>
  );
}

function RecipeStars({ value, label }: { value: number; label: string }) {
  const rounded = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span className="recipe-stars" role="img" aria-label={`${value.toFixed(1)} out of 5 stars, ${label}`}>
      <span aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <Star className={star <= rounded ? "is-filled" : undefined} key={star} />)}</span>
    </span>
  );
}

export function RecipeScreen({ request, signedIn }: { request: SessionRequest; signedIn: boolean }) {
  const [view, setView] = useState<"browse" | "create" | "saved" | "favourites">("browse");
  const creating = view === "create" || view === "saved";
  const [favourites, setFavourites] = useState<RecipeFavourite[] | null>(null);
  const [favouritesError, setFavouritesError] = useState<string | null>(null);
  const [favouritesBusy, setFavouritesBusy] = useState(false);
  const [favouritesRetry, setFavouritesRetry] = useState(0);
  const [collectionVersion, setCollectionVersion] = useState(0);
  const [query, setQuery] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [meal, setMeal] = useState("");
  const [dietaryTag, setDietaryTag] = useState("");
  const [allergy, setAllergy] = useState("");
  const [excludedIngredient, setExcludedIngredient] = useState("");
  const [maxCalories, setMaxCalories] = useState("");
  const [maxProtein, setMaxProtein] = useState("");
  const [maxCarbs, setMaxCarbs] = useState("");
  const [maxFats, setMaxFats] = useState("");
  const [maxTime, setMaxTime] = useState("");
  const [minFiber, setMinFiber] = useState("");
  const [maxSodium, setMaxSodium] = useState("");
  const [minIron, setMinIron] = useState("");
  const [minCalcium, setMinCalcium] = useState("");
  const [results, setResults] = useState<RecipeGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<RecipeGroup | null>(null);
  const [groupTotal, setGroupTotal] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const resultsHeading = useRef<HTMLDivElement>(null);
  const [recipeTotal, setRecipeTotal] = useState(0);
  const [activeFilters, setActiveFilters] = useState<RecipeSearchFilters>({});
  const searchVersion = useRef(0);
  const [selected, setSelected] = useState<SelectedRecipe | null>(null);
  const [servings, setServings] = useState("1");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackStars, setFeedbackStars] = useState("0");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [customQuery, setCustomQuery] = useState("");
  const [customBusy, setCustomBusy] = useState(false);
  const [substitutionFor, setSubstitutionFor] = useState<string | null>(null);
  const [substitutions, setSubstitutions] = useState<IngredientSubstitution[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) { setFavourites(null); return; }
    let active = true;
    setFavourites(null);
    setFavouritesError(null);
    request(listRecipeFavourites).then(value => { if (active) setFavourites(value); })
      .catch(error => { if (active) setFavouritesError(error instanceof Error ? error.message : "Favourites could not be loaded."); });
    return () => { active = false; };
  }, [request, signedIn, collectionVersion, favouritesRetry]);

  const openFavourite = (item: RecipeFavourite) => {
    setSelected({ ...item, custom: Boolean(item.creation), generationSource: item.creation?.source });
    setServings(String(item.creation ? item.recipe.servings : 1));
  };

  const toggleFavourite = async () => {
    if (!selected || !favourites || favouritesBusy) return;
    setFavouritesBusy(true);
    setFavouritesError(null);
    const id = selected.recipe.id;
    try {
      if (favourites.some(item => item.recipe.id === id)) {
        await request(token => removeRecipeFavourite(id, token));
        setFavourites(current => current?.filter(item => item.recipe.id !== id) ?? null);
      } else {
        const added = await request(token => addRecipeFavourite(id, token));
        setFavourites(current => [added, ...(current ?? []).filter(item => item.recipe.id !== id)]);
      }
    } catch (error) { setFavouritesError(error instanceof Error ? error.message : "Favourites could not be updated."); }
    finally { setFavouritesBusy(false); }
  };

  const loadRecipes = async (filters: RecipeSearchFilters = {}, targetPage = 1) => {
    const version = ++searchVersion.current;
    setBusy(true);
    setError(null);
    try {
      const page = await searchRecipeGroups({ ...filters, limit: 24, offset: (targetPage - 1) * 24 });
      if (version !== searchVersion.current) return;
      setLoaded(true);
      setResults(page.groups);
      setRecipeTotal(page.totalRecipes);
      setGroupTotal(page.totalGroups);
      setActiveFilters(filters);
      setPageNumber(targetPage);
    } catch (loadError: unknown) {
      if (version === searchVersion.current) setError(loadError instanceof ApiError ? loadError.message : "Recipes could not be loaded.");
    } finally {
      if (version === searchVersion.current) setBusy(false);
    }
  };

  useEffect(() => {
    void loadRecipes();
    return () => { searchVersion.current += 1; };
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("recipe");
    if (!id) return;
    if (id.startsWith("created-") && !signedIn) { setError("Sign in to open a saved creation."); return; }
    let active = true;
    setDetailBusy(true);
    const load = id.startsWith("created-")
      ? request(token => getCreatedRecipe(id, token)).then(result => ({ ...result, creation: result, custom: true, generationSource: result.source }))
      : getRecipe(id);
    load.then(result => { if (active) { setSelected(result); setServings(String("creation" in result ? result.recipe.servings : 1)); } })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Recipe could not be opened."); })
      .finally(() => { if (active) setDetailBusy(false); });
    return () => { active = false; };
  }, [request, signedIn]);

  const changePage = async (targetPage: number) => {
    if (busy || targetPage === pageNumber) return;
    await loadRecipes(activeFilters, targetPage);
    resultsHeading.current?.focus({ preventScroll: true });
    resultsHeading.current?.scrollIntoView({ block: "start" });
  };
  const pageCount = Math.ceil(groupTotal / 24);
  const visiblePages = Array.from({ length: pageCount }, (_, index) => index + 1)
    .filter(page => page === 1 || page === pageCount || Math.abs(page - pageNumber) <= 1);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const maxCaloriesKcal = maxCalories.trim() ? Number(maxCalories) : undefined;
    if (maxCaloriesKcal !== undefined && (!Number.isFinite(maxCaloriesKcal) || maxCaloriesKcal < 1)) {
      setError("Enter a calorie limit greater than zero.");
      return;
    }
    const maxProteinG = maxProtein.trim() ? Number(maxProtein) : undefined;
    if (maxProteinG !== undefined && (!Number.isFinite(maxProteinG) || maxProteinG < 1)) {
      setError("Enter a protein limit greater than zero.");
      return;
    }
    const maxCarbsG = maxCarbs.trim() ? Number(maxCarbs) : undefined;
    if (maxCarbsG !== undefined && (!Number.isFinite(maxCarbsG) || maxCarbsG < 1)) {
      setError("Enter a carbohydrate limit greater than zero.");
      return;
    }
    const maxFatsG = maxFats.trim() ? Number(maxFats) : undefined;
    if (maxFatsG !== undefined && (!Number.isFinite(maxFatsG) || maxFatsG < 1)) {
      setError("Enter a fat limit greater than zero.");
      return;
    }
    const maxTimeMinutes = maxTime.trim() ? Number(maxTime) : undefined;
    if (maxTimeMinutes !== undefined && (!Number.isFinite(maxTimeMinutes) || maxTimeMinutes < 1)) {
      setError("Enter a time limit greater than zero.");
      return;
    }
    const minFiberG = minFiber.trim() ? Number(minFiber) : undefined;
    const maxSodiumMg = maxSodium.trim() ? Number(maxSodium) : undefined;
    const minIronMg = minIron.trim() ? Number(minIron) : undefined;
    const minCalciumMg = minCalcium.trim() ? Number(minCalcium) : undefined;
    if ([minFiberG, maxSodiumMg, minIronMg, minCalciumMg].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))) {
      setError("Micronutrient filters must be zero or greater.");
      return;
    }
    void loadRecipes({
      query: query.trim() || undefined,
      cuisine: cuisine.trim() || undefined,
      meal: meal || undefined,
      dietaryTags: dietaryTag ? [dietaryTag] : undefined,
      allergies: allergy ? [allergy] : undefined,
      excludedIngredients: excludedIngredient.trim() ? [excludedIngredient.trim()] : undefined,
      maxCaloriesKcal,
      maxProteinG,
      maxCarbsG,
      maxFatsG,
      minFiberG,
      maxSodiumMg,
      minIronMg,
      minCalciumMg,
      maxTimeMinutes
    });
  };

  const openRecipe = async (result: RecipeSearchResult) => {
    setDetailBusy(true);
    setError(null);
    try {
      setSelected({ ...(await getRecipe(result.recipe.id)), community: result.community });
      setFeedbackStars("0");
      setFeedbackComment("");
      setFeedbackMessage(null);
      setServings("1");
      setSubstitutionFor(null);
      setSubstitutions([]);
    } catch (loadError: unknown) {
      setError(loadError instanceof ApiError ? loadError.message : "Recipe details could not be loaded.");
    } finally {
      setDetailBusy(false);
    }
  };

  const createCustomRecipe = async (input: { query: string; baseRecipeId?: string; substitutions?: Array<{ fromIngredientId: string; toIngredientId: string }> }) => {
    setCustomBusy(true);
    setError(null);
    try {
      const result = await request((token) => generateCustomRecipe(input, token));
      setSelected({ recipe: result.recipe, nutrition: result.nutrition, enhancedNutrition: result.enhancedNutrition, custom: true, generationSource: result.source,
        variation: { baseRecipeId: result.recipe.source.slice("haleview-custom:".length), substitutions: result.substitutions.map(({ fromIngredientId, toIngredientId }) => ({ fromIngredientId, toIngredientId })) },
      });
      setServings(String(result.recipe.servings));
      setSubstitutionFor(null);
      setSubstitutions([]);
    } catch (generationError: unknown) {
      setError(generationError instanceof ApiError ? generationError.message : "A custom recipe could not be created.");
    } finally {
      setCustomBusy(false);
    }
  };

  const findSubstitutions = async (ingredientId: string) => {
    if (!selected || selected.custom) return;
    setSubstitutionFor(ingredientId);
    setSubstitutions([]);
    setDetailBusy(true);
    setError(null);
    try {
      const result = await request((token) => getIngredientSubstitutions(selected.recipe.id, ingredientId, token));
      setSubstitutions(result.alternatives);
    } catch (substitutionError: unknown) {
      setError(substitutionError instanceof ApiError ? substitutionError.message : "No safe substitutions could be found.");
    } finally {
      setDetailBusy(false);
    }
  };

  const updateServings = async () => {
    if (!selected || detailBusy) return;
    const value = Number(servings);
    if (!Number.isFinite(value) || value < (selected.creation ? 1 : 0.25) || value > (selected.creation ? 12 : 100)) {
      setError(selected.creation ? "Enter servings from 1 to 12." : "Enter a recipe amount from 0.25 to 100.");
      return;
    }
    setDetailBusy(true);
    setError(null);
    try {
      const variation = selected.variation;
      if (selected.creation) {
        const result = await request(token => scaleCreatedRecipe(selected.recipe.id, value, token));
        setSelected({ ...selected, ...result, creation: result });
      } else if (selected.custom && variation) {
        const scaled = await request((token) => scaleCustomRecipe({ ...variation, servings: value }, token));
        setSelected({ ...selected, recipe: { ...scaled.recipe, id: selected.recipe.id, title: selected.recipe.title, summary: selected.recipe.summary }, nutrition: scaled.nutrition, enhancedNutrition: scaled.enhancedNutrition });
      } else {
        setSelected({ ...selected, ...(await getRecipe(selected.recipe.id, value)) });
      }
    } catch (loadError: unknown) {
      setError(loadError instanceof ApiError ? loadError.message : "Nutrition could not be recalculated.");
    } finally {
      setDetailBusy(false);
    }
  };

  const sendRecipeFeedback = async () => {
    if (!selected) return;
    const stars = Number(feedbackStars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      setError("Choose a rating from 1 to 5 stars before saving.");
      return;
    }
    const rating = stars >= 4 ? "helpful" : "not_helpful";
    setFeedbackBusy(true);
    setFeedbackMessage(null);
    setError(null);
    try {
      const feedback = await request((token) => saveNutritionFeedback({
        subjectType: "recipe",
        subjectId: selected.recipe.id,
        rating,
        decision: rating === "helpful" ? "saved" : "rejected",
        stars,
        comment: feedbackComment.trim() || undefined,
      }, token));
      setFeedbackMessage(feedback.moderationStatus === "approved"
        ? "Rating saved. It will improve later recipe results."
        : `Review rejected: ${feedback.moderationReason} It will not affect community ratings or recommendations.`);
    } catch (feedbackError: unknown) {
      setError(feedbackError instanceof ApiError ? feedbackError.message : "Feedback could not be saved.");
    } finally {
      setFeedbackBusy(false);
    }
  };

  if (!loaded) return <PageDataState view="recipes" title="Recipes" loading={busy} error={error} onRetry={() => void loadRecipes()} />;

  return (
    <section className="panel recipe-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Nutrition</p><h2>Recipes</h2></div>
        {selected && <button className="secondary-button" type="button" onClick={() => { setSelected(null); setError(null); }}>{view === "saved" ? "Back to My saved recipes" : view === "favourites" ? "Back to Favourites" : creating ? "Back to Create" : selectedGroup ? "Back to variations" : "Back to search"}</button>}
        {!selected && selectedGroup && <button className="secondary-button" type="button" onClick={() => setSelectedGroup(null)}>Back to recipe groups</button>}
      </div>
      {!selected && !selectedGroup && signedIn && <div className="recipe-view-switch segmented-switch" role="group" aria-label="Recipe workspace" data-index={view === "browse" ? "0" : view === "create" ? "1" : view === "saved" ? "2" : "3"} data-segments="4"><button type="button" aria-pressed={view === "browse"} onClick={() => setView("browse")}>Browse recipes</button><button type="button" aria-pressed={view === "create"} onClick={() => setView("create")}><Sparkles aria-hidden="true" />Create</button><button type="button" aria-pressed={view === "saved"} onClick={() => setView("saved")}>My saved recipes</button><button type="button" aria-pressed={view === "favourites"} onClick={() => setView("favourites")}><Star aria-hidden="true" />Favourites</button></div>}
      {creating && signedIn && <div hidden={selected !== null}><RecipeCreatePanel key={view} collectionOnly={view === "saved"} onCreate={() => setView("create")} request={request} refreshKey={collectionVersion} onOpen={result => { setSelected({ ...result, custom: true, generationSource: result.source, creation: result }); setServings(String(result.recipe.servings)); setError(null); }} /></div>}
      {selected && signedIn && (!selected.custom || selected.creation) && <div className="recipe-favourite-actions">
        <button className="secondary-button" type="button" disabled={favouritesBusy || !favourites || Boolean(selected.creation && !selected.creation.saved)} aria-pressed={favourites?.some(item => item.recipe.id === selected.recipe.id) ?? false} onClick={() => void toggleFavourite()}><Star aria-hidden="true" />{favouritesBusy ? "Saving..." : !favourites ? "Checking favourites..." : favourites.some(item => item.recipe.id === selected.recipe.id) ? "Remove from Favourites" : "Add to Favourites"}</button>
        {selected.creation && !selected.creation.saved && <p className="muted-text">Save this recipe before adding it to Favourites.</p>}
        {favouritesError && <p className="error-text" role="alert">{favouritesError}<button className="text-button" type="button" onClick={() => setFavouritesRetry(value => value + 1)}>Retry</button></p>}
      </div>}
      {selected ? (
        <>
          {selected.creation && <CreatedRecipeActions key={`${selected.recipe.id}:${selected.recipe.servings}`} creation={selected.creation} request={request} onSaved={() => { setSelected(current => current?.creation ? { ...current, creation: { ...current.creation, saved: true } } : current); setCollectionVersion(current => current + 1); }} onRemoved={() => { setSelected(null); setCollectionVersion(current => current + 1); }} />}
          <RecipeDetail
            recipe={selected.recipe}
            nutrition={selected.nutrition}
            enhancedNutrition={selected.enhancedNutrition}
            community={selected.community}
            custom={selected.custom === true}
            generationSource={selected.generationSource}
            servings={servings}
            onServingsChange={setServings}
            onUpdateServings={() => void updateServings()}
            signedIn={signedIn}
            feedbackBusy={feedbackBusy}
            feedbackMessage={feedbackMessage}
            feedbackStars={feedbackStars}
            feedbackComment={feedbackComment}
            onFeedbackStarsChange={setFeedbackStars}
            onFeedbackCommentChange={setFeedbackComment}
            onFeedback={() => void sendRecipeFeedback()}
            substitutionFor={substitutionFor}
            substitutions={substitutions}
            onFindSubstitutions={(ingredientId) => void findSubstitutions(ingredientId)}
            onApplySubstitution={(substitution) => void createCustomRecipe({
              query: `A safe variation of ${selected.recipe.title}`,
              baseRecipeId: selected.recipe.id,
              substitutions: [{ fromIngredientId: substitution.fromIngredientId, toIngredientId: substitution.toIngredientId }],
            })}
            substitutionBusy={detailBusy || customBusy}
          />
        </>
      ) : view === "favourites" && signedIn ? (
        favourites === null ? <PageDataState compact view="recipes" title="Favourites" loading={!favouritesError} error={favouritesError} onRetry={() => setFavouritesRetry(value => value + 1)} /> : <>
          <h3>Favourites</h3>
          {favourites.length === 0 ? <p>No favourites yet. Open a recipe and select Add to Favourites.</p> : <div className="recipe-grid">{favourites.map(item => <article className="recipe-card" key={item.recipe.id}><RecipePhoto recipe={item.recipe} onOpen={() => openFavourite(item)} /><div className="recipe-card-content"><p className="eyebrow">{item.creation ? "Saved creation" : "Catalogue recipe"}</p><h3><button className="recipe-title-open" type="button" onClick={() => openFavourite(item)}>{item.recipe.title}</button></h3><p>{item.recipe.summary}</p><div className="tag-row">{item.recipe.dietary_tags.map(tag => <span className="tag" key={tag}>{nutritionLabel(tag)}</span>)}</div></div><button className="text-button recipe-card-action" type="button" onClick={() => openFavourite(item)}>Open recipe<ArrowRight aria-hidden="true" /></button></article>)}</div>}
        </>
      ) : creating && signedIn ? null : selectedGroup ? (
        <div className="recipe-group-view">
          <p className="eyebrow">Recipe group</p><h3>{selectedGroup.title}</h3>
          <p className="recipe-intro">{selectedGroup.recipes.length} variations match your filters. Choose one to see its ingredients, method and nutrition.</p>
          {error && <p className="error-text" role="alert">{error}</p>}
          <div className="recipe-grid">{selectedGroup.recipes.map(result => <RecipeCard key={result.recipe.id} result={result} onOpen={() => void openRecipe(result)} />)}</div>
        </div>
      ) : (
        <>
          <p className="recipe-intro">Find a meal that fits your food choices. Start with a simple search and add filters only when you need them.</p>
          <form className="recipe-filters" onSubmit={submitSearch}>
            <div className="recipe-search-bar">
              <label className="recipe-query">Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try vegetarian lentil dinner" /></label>
              <button className="primary-button compact-button" type="submit" disabled={busy} aria-busy={busy}><Search aria-hidden="true" />{busy ? "Loading..." : "Search"}</button>
            </div>
            <AppAccordion className="recipe-filter-accordion" title="Diet, time, and nutrition" eyebrow="More filters" icon={SlidersHorizontal}>
              <div className="recipe-filter-grid">
                <label>Cuisine<input value={cuisine} onChange={(event) => setCuisine(event.target.value)} placeholder="Any cuisine" /></label>
                <label>Meal<select value={meal} onChange={(event) => setMeal(event.target.value)}>{mealValues.map((value) => <option key={value} value={value}>{value ? value[0].toUpperCase() + value.slice(1) : "Any meal"}</option>)}</select></label>
                <label>Diet<select value={dietaryTag} onChange={(event) => setDietaryTag(event.target.value)}>{dietaryValues.map((value) => <option key={value} value={value}>{value ? nutritionLabel(value) : "Any diet"}</option>)}</select></label>
                <label>Exclude allergy<select value={allergy} onChange={(event) => setAllergy(event.target.value)}>{allergyValues.map((value) => <option key={value} value={value}>{value ? nutritionLabel(value) : "No allergy filter"}</option>)}</select></label>
                <label>Exclude ingredient<input value={excludedIngredient} onChange={(event) => setExcludedIngredient(event.target.value)} placeholder="No exclusion" /></label>
                <label>Maximum time (min)<input type="number" min="1" value={maxTime} onChange={(event) => setMaxTime(event.target.value)} placeholder="No limit" /></label>
              </div>
              <fieldset className="recipe-nutrition-filters" aria-describedby="recipe-nutrition-basis">
                <legend>Nutrition per whole recipe</legend>
                <p id="recipe-nutrition-basis">Every limit below applies to one whole recipe, using the ingredient quantities listed in the catalogue.</p>
                <div className="recipe-filter-grid">
                  <label>Maximum energy (kcal)<input type="number" min="1" value={maxCalories} onChange={(event) => setMaxCalories(event.target.value)} placeholder="No limit" /></label>
                  <label>Maximum protein (g)<input type="number" min="1" value={maxProtein} onChange={(event) => setMaxProtein(event.target.value)} placeholder="No limit" /></label>
                  <label>Maximum carbohydrate (g)<input type="number" min="1" value={maxCarbs} onChange={(event) => setMaxCarbs(event.target.value)} placeholder="No limit" /></label>
                  <label>Maximum fat (g)<input type="number" min="1" value={maxFats} onChange={(event) => setMaxFats(event.target.value)} placeholder="No limit" /></label>
                  <label>Minimum fibre (g)<input type="number" min="0" step="0.1" value={minFiber} onChange={(event) => setMinFiber(event.target.value)} placeholder="No minimum" /></label>
                  <label>Maximum sodium (mg)<input type="number" min="0" step="1" value={maxSodium} onChange={(event) => setMaxSodium(event.target.value)} placeholder="No limit" /></label>
                  <label>Minimum iron (mg)<input type="number" min="0" step="0.1" value={minIron} onChange={(event) => setMinIron(event.target.value)} placeholder="No minimum" /></label>
                  <label>Minimum calcium (mg)<input type="number" min="0" step="1" value={minCalcium} onChange={(event) => setMinCalcium(event.target.value)} placeholder="No minimum" /></label>
                </div>
              </fieldset>
            </AppAccordion>
          </form>
          {signedIn && <AppAccordion className="custom-recipe-accordion" title="Create a recipe variation" eyebrow="Try something different" icon={Sparkles} tone="oat">
            <form className="custom-recipe-form" onSubmit={(event) => {
              event.preventDefault();
              if (!customQuery.trim()) {
                setError("Describe the recipe you want.");
                return;
              }
              void createCustomRecipe({ query: customQuery.trim() });
            }}>
              <label>What do you want?<input value={customQuery} onChange={(event) => setCustomQuery(event.target.value)} maxLength={160} placeholder="Try a quick vegetarian dinner" /></label>
              <button className="primary-button compact-button" type="submit" disabled={customBusy} aria-busy={customBusy}><Sparkles aria-hidden="true" />{customBusy ? "Creating..." : "Create variation"}</button>
              <p>The variation starts from a source recipe and uses ingredients from the Haleview catalogue.</p>
            </form>
          </AppAccordion>}
          {error && <p className="error-text" role="alert">{error}</p>}
          {detailBusy && <p className="muted-text" role="status">Loading recipe.</p>}
          {!busy && !error && results.length === 0 && <p className="muted-text">No recipes match these filters.</p>}
          {results.length > 0 && <div className="recipe-results-heading" ref={resultsHeading} tabIndex={-1}><strong>{recipeTotal} recipes in {groupTotal} groups</strong><span role="status">{busy ? "Loading recipes..." : `Page ${pageNumber} of ${pageCount} · Groups ${(pageNumber - 1) * 24 + 1}–${(pageNumber - 1) * 24 + results.length} of ${groupTotal}`}</span></div>}
          <div className="recipe-grid" aria-busy={busy}>
            {results.map(group => <RecipeGroupCard key={group.id} group={group} onOpen={() => group.recipes.length === 1 ? void openRecipe(group.recipes[0]) : setSelectedGroup(group)} />)}
          </div>
          {pageCount > 1 && <nav className="recipe-pagination" aria-label="Recipe pages">
            <button className="secondary-button" type="button" disabled={busy || pageNumber === 1} onClick={() => void changePage(pageNumber - 1)}>Previous</button>
            <div className="recipe-page-numbers">{visiblePages.map((page, index) => <span className="recipe-page-item" key={page}>
              {index > 0 && page - visiblePages[index - 1] > 1 && <span className="page-gap" aria-hidden="true">...</span>}
              <button className="secondary-button" type="button" aria-label={`Page ${page}`} aria-current={page === pageNumber ? "page" : undefined} disabled={busy} onClick={() => void changePage(page)}>{page}</button>
            </span>)}</div>
            <button className="secondary-button" type="button" disabled={busy || pageNumber === pageCount} onClick={() => void changePage(pageNumber + 1)}>Next</button>
          </nav>}
        </>
      )}
      {selected && error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
}

function RecipeGroupCard({ group, onOpen }: { group: RecipeGroup; onOpen: () => void }) {
  if (group.recipes.length === 1) return <RecipeCard result={group.recipes[0]} onOpen={onOpen} />;
  const representative = group.recipes[0].recipe;
  const cuisines = [...new Set(group.recipes.map(item => item.recipe.cuisine))];
  return <article className="recipe-card recipe-family-card">
    <RecipePhoto recipe={representative} onOpen={onOpen} />
    <div className="recipe-card-content"><p className="eyebrow">Recipe group</p><h3><button className="recipe-title-open" type="button" onClick={onOpen}>{group.title}</button></h3>
      <p className="recipe-family-count">{group.recipes.length} variations</p>
      <p className="recipe-family-description">{cuisines.slice(0, 3).join(" / ")}{cuisines.length > 3 ? " and more" : ""}. Compare ingredients and preparation.</p>
    </div>
    <button className="text-button recipe-card-action" type="button" onClick={onOpen}>View {group.recipes.length} variations<ArrowRight aria-hidden="true" /></button>
  </article>;
}

function RecipeCard({ result, onOpen }: { result: RecipeSearchResult; onOpen: () => void }) {
  const visibleTags = result.recipe.dietary_tags;
  return (
    <article className="recipe-card">
      <RecipePhoto recipe={result.recipe} onOpen={onOpen} />
      <div className="recipe-card-content">
        <p className="eyebrow">{nutritionLabel(result.recipe.meal)} · {result.recipe.cuisine}</p>
        <h3><button className="recipe-title-open" type="button" onClick={onOpen}>{result.recipe.title}</button></h3>
        {result.community && <div className="community-rating"><RecipeStars value={result.community.averageStars} label={`${result.community.ratingCount} ratings`} /><strong>{result.community.averageStars.toFixed(1)}</strong><span>({result.community.ratingCount})</span>{result.community.verified && <span className="verified-recipe"><ShieldCheck aria-hidden="true" />Verified</span>}</div>}
        <div className="recipe-card-facts"><span><Clock aria-hidden="true" />{result.recipe.time} min</span><span><Flame aria-hidden="true" />{Math.round(result.nutrition.caloriesKcal)} kcal total</span></div>
        {visibleTags.length > 0 && <div className="tag-row">{visibleTags.map((tag) => <span className="tag" key={tag}>{nutritionLabel(tag)}</span>)}</div>}
      </div>
      <button className="text-button recipe-card-action" type="button" onClick={onOpen}>View recipe<ArrowRight aria-hidden="true" /></button>
    </article>
  );
}

function RecipeDetail({
  recipe,
  nutrition,
  enhancedNutrition,
  community,
  custom,
  generationSource,
  servings,
  onServingsChange,
  onUpdateServings,
  signedIn,
  feedbackBusy,
  feedbackMessage,
  feedbackStars,
  feedbackComment,
  onFeedbackStarsChange,
  onFeedbackCommentChange,
  onFeedback,
  substitutionFor,
  substitutions,
  onFindSubstitutions,
  onApplySubstitution,
  substitutionBusy,
}: {
  recipe: RecipeRecord;
  nutrition: RecipeSearchResult["nutrition"];
  enhancedNutrition: EnhancedNutritionProfile;
  community?: CommunityRecipeSignal;
  custom: boolean;
  generationSource?: "local" | "deepseek";
  servings: string;
  onServingsChange: (value: string) => void;
  onUpdateServings: () => void;
  signedIn: boolean;
  feedbackBusy: boolean;
  feedbackMessage: string | null;
  feedbackStars: string;
  feedbackComment: string;
  onFeedbackStarsChange: (value: string) => void;
  onFeedbackCommentChange: (value: string) => void;
  onFeedback: () => void;
  substitutionFor: string | null;
  substitutions: IngredientSubstitution[];
  onFindSubstitutions: (ingredientId: string) => void;
  onApplySubstitution: (substitution: IngredientSubstitution) => void;
  substitutionBusy: boolean;
}) {
  const sourceUrl = archiveRecipeUrl(recipe.source);
  const created = recipe.source === "haleview-created";
  const amount = Number(servings);
  const changeAmount = (difference: number) => {
    const current = Number.isFinite(amount) ? amount : 1;
    onServingsChange(String(Math.max(created ? 1 : 0.25, Math.min(created ? 12 : 100, Math.round((current + difference) * 4) / 4))));
  };
  return (
    <div className="recipe-detail">
      {recipe.planningWarning && <p className="notice error" role="note">{recipe.planningWarning}</p>}
      <div className="recipe-detail-hero">
        {!created && <RecipePhoto recipe={recipe} detail />}
        <div className="recipe-detail-heading">
          <div><p className="eyebrow">{nutritionLabel(recipe.meal)} · {recipe.cuisine}</p><h3>{recipe.title}</h3><p>{recipe.summary}</p>{community && <div className="community-rating detail-rating"><RecipeStars value={community.averageStars} label={`${community.ratingCount} community ratings`} /><strong>{community.averageStars.toFixed(1)}</strong><span>({community.ratingCount})</span>{community.verified && <span className="verified-recipe"><ShieldCheck aria-hidden="true" />Verified</span>}</div>}{custom && <p className="custom-source"><Sparkles aria-hidden="true" />{created ? "Created with Hale using online AI. This recipe has not been kitchen-tested." : `Grounded variation, created ${generationSource === "deepseek" ? "with online ranking" : "locally"}`}</p>}</div>
          <div className="recipe-detail-meta"><span>{recipe.time} minutes</span><span>{nutritionLabel(recipe.difficulty_level)}</span><span>{created ? `${recipe.servings} servings` : recipeAmountLabel(recipe.servings)}</span></div>
          <div className="recipe-actions">
            <div className="recipe-amount-copy"><strong>{created ? "Servings" : "Recipe amount"}</strong><span>{created ? "Ingredients and nutrition update together." : "1 is the complete source recipe."}</span></div>
            <div className="recipe-amount-control">
              <button type="button" aria-label="Use less of the recipe" disabled={substitutionBusy} onClick={() => changeAmount(created ? -1 : -0.25)}><Minus aria-hidden="true" /></button>
              <label><span className="sr-only">Recipe amount</span><input type="number" min={created ? 1 : 0.25} max={created ? 12 : 100} step={created ? 1 : 0.25} value={servings} disabled={substitutionBusy} onChange={(event) => onServingsChange(event.target.value)} /></label>
              <button type="button" aria-label="Use more of the recipe" disabled={substitutionBusy} onClick={() => changeAmount(created ? 1 : 0.25)}><Plus aria-hidden="true" /></button>
            </div>
            <button className="secondary-button compact-button" type="button" disabled={substitutionBusy} onClick={onUpdateServings}>Update</button>
          </div>
        </div>
      </div>
      <NutritionSummary nutrition={nutrition} enhanced={enhancedNutrition} label={created ? `Nutrition for all ${recipe.servings} servings` : "Nutrition for selected recipe amount"} />
      {signedIn && !custom && <form className="recipe-feedback" onSubmit={(event) => { event.preventDefault(); onFeedback(); }}>
        <div className="recipe-rating-column"><div className="recipe-feedback-heading"><strong>Rate this recipe</strong><span>Help other people choose.</span></div>
        <fieldset className="star-rating"><legend>Your rating</legend><div role="radiogroup" aria-label="Recipe rating">{[1, 2, 3, 4, 5].map((star) => <button className={star <= Number(feedbackStars) ? "is-filled" : undefined} key={star} type="button" role="radio" aria-checked={Number(feedbackStars) === star} aria-label={`${star} star${star === 1 ? "" : "s"}`} onClick={() => onFeedbackStarsChange(String(star))}><Star aria-hidden="true" /></button>)}</div></fieldset></div>
        <div className="recipe-review-column"><label className="recipe-review-field">Short review<input value={feedbackComment} onChange={(event) => onFeedbackCommentChange(event.target.value)} maxLength={500} placeholder="Optional" /></label>
        <button className="secondary-button compact-button" type="submit" disabled={feedbackBusy || Number(feedbackStars) < 1}>{feedbackBusy ? "Saving..." : "Save rating"}</button></div>
        {feedbackMessage && <span role="status">{feedbackMessage}</span>}
      </form>}
      <div className="recipe-detail-columns">
        <AppAccordion title="Ingredients" meta={`${recipe.ingredients.length} item(s)`} icon={ListChecks} defaultOpen><ul className="ingredient-list">{recipe.ingredients.map((ingredient) => <li key={ingredient.id}><span>{ingredient.name}</span><span className="ingredient-controls"><strong>{ingredient.quantity} {ingredient.unit}</strong>{signedIn && !custom && <button className="text-button" type="button" disabled={substitutionBusy} onClick={() => onFindSubstitutions(ingredient.id)}>Find swap</button>}</span>{substitutionFor === ingredient.id && <div className="substitution-list">{substitutions.length === 0 ? <span className="muted-text">{substitutionBusy ? "Checking safe catalogue options..." : "No safe swap was found."}</span> : substitutions.map((item) => <button key={item.toIngredientId} type="button" onClick={() => onApplySubstitution(item)} disabled={substitutionBusy}><strong>{item.toLabel}</strong><span>{item.reason}</span></button>)}</div>}</li>)}</ul></AppAccordion>
        <AppAccordion title="Preparation" meta={`${recipe.preparation.length} step(s)`} icon={ListChecks} tone="oat"><ol className="preparation-list">{recipe.preparation.map((step) => <li key={step.step}><strong>Step {step.step}</strong><span>{step.description}</span></li>)}</ol></AppAccordion>
      </div>
      <p className="source-note">Source: {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Open Recipe Archive</a> : created ? "Created with Hale from catalogue ingredients and recipe references" : custom ? "Haleview variation of an Open Recipe Archive recipe" : recipe.source}. {created ? "Generated content. Nutrition is calculated for all selected servings." : "Public domain source data. Nutrition is calculated for the selected recipe amount."}</p>
    </div>
  );
}
