# Haleview

Haleview is a wellness and nutrition planning application.

Haleview reuses the saved health profile for nutrition settings and conversational data access, so users do not enter the same information twice.

The current nutrition work includes validated preferences, standard units, backend nutrition calculations, a local catalogue of 558 ingredients and 542 recipes, recipe search, filters, recipe details, local relevance retrieval, meal plans, saved plan versions, shopping lists, intake records, and progress analysis. It is not medical data.

The application is not a medical service. Check health advice before using it.

## Chat with Hale

Open Hale after completing your profile. You can ask about health metrics, progress, meal plans, recipe ingredients and preparation, recorded nutrition, or general wellness. For example, ask "What nutrients are in my breakfast?" and then "Is that enough protein?". The follow-up stays attached to that breakfast. Existing guidance remains below the conversation.

Hale can draw three conversational charts from saved data. Ask "Show me my weight trend this month" for a line chart, "Show how my protein intake compares with my target today" for a bar chart, or "Show the breakdown of my macronutrients today" for a pie chart. A protein or weight discussion can offer a related chart prompt without opening one automatically.

Choose Concise or Detailed before sending. Both modes show the same core facts. Detailed replies add context, limitations and supporting records. Full recipe requests include the ingredient list and ordered preparation steps in either mode. Add an optional Name for Hale under Profile's optional details if you want personal replies.

### Conversation and data access

The conversation layer validates messages, tracks the account-owned history, chooses response detail and manages the provider exchange. The data-access layer retrieves only the permitted fields for the authenticated account and formats the numerical results. Account identity never comes from model arguments or user-written identifiers.

The seven read-only functions are:

| Function | Data returned |
| --- | --- |
| get_health_metrics | Current weight, BMI, height, activity, fitness and wellness components, or exact records for a specified date |
| get_health_goals | Chosen name, fitness and weight goals, distance to the target, exercise and dietary preferences |
| get_health_progress | Recorded weight, BMI, health-score or activity changes, including dates, differences, missing-data limits and an optional line chart |
| get_meal_plan | A daily or seven-day meal plan, optionally restricted to breakfast, lunch, dinner or snack |
| get_recipe | A planned or own saved recipe's scaled ingredients, preparation and nutritional contribution |
| get_nutrition_intake | Recorded intake versus targets, dietary suggestions, trends, protein bar charts and macro pie charts |
| get_wellness_guidance | General guidance on sleep, activity, gentle stretching, hydration and stress |

A message is added to recent context, the model selects a function, arguments are validated before retrieval, and the result is returned with its function-call identifier. Hale then produces a brief explanation. The application renders exact figures, comparisons, chart points, ingredients and steps from backend-produced sections. Completed turns are saved and returned to the browser. Recognized personal-data requests require function use; one recognized request can also require the specific relevant function.

The assistant cannot update health data, meals or account settings. Email, date of birth, age, credentials, account identifiers and other users' records are excluded from chat tool payloads. Private recipes require ownership even when a caller knows the recipe identifier. Numbers and target comparisons are calculated by the existing health and nutrition modules. Planned food remains distinct from recorded consumption. A meal's protein is shown as a contribution to the daily target, not as a whole day's intake.

Health progress uses the current calendar month, previous calendar month or trailing seven days. Nutrition supports today, trailing seven/thirty days and the previous calendar month. Historical health scores do not reconstruct later nutrition adjustments. Missing measurements are not interpolated, and days without food records are unknown rather than proof of zero intake. A saved fitness level is self-reported; activity entries alone cannot prove a change in fitness.

### Prompts, model and memory

The system prompt defines Hale's scope, tone, terminology, output structure, medical limitations and privacy rules. It includes examples for all six conversation categories, goal queries, indirect references, personalization, missing data and sensitive requests. Model prose explains the data; numerical results come from backend sections. Output checks reject malformed JSON, numerical prose, unsafe markup, private identifiers and selected unsafe treatment claims. These checks reduce risk and do not prove every qualitative model statement is correct.

Online chat reuses the configured DeepSeek provider and the Online AI consent setting. The default model is deepseek-v4-flash. Its function calling and JSON responses fit the existing nutrition integration, while keeping one provider simplifies configuration and failure handling. Chat uses temperature 0.2 and top-p 1 with thinking disabled. Concise replies have an output limit of 900 tokens and detailed replies 1600 tokens. Deterministic calculations stay outside the model in both modes.

A request allows at most two tool rounds, a final response and one format repair within a shared 55-second deadline. Context size and total returned token usage are bounded. The backend stores provider token totals with the turn for inspection. One account can have one active reply, and the service caps simultaneous active accounts.

Conversation history is encrypted at rest and retained until the account clears it. The browser initially loads forty turns and can load earlier messages. Personal data export includes the full conversation. The provider receives up to five full previous turns, using the latest two and the most recent turns related to the current topic. Older turns are compacted when ten turns accumulate or when the pending context reaches a size or provider-token threshold. The deterministic summary keeps bounded user-stated preferences and the latest server-owned reference for each topic. It does not copy earlier measurements because current values are retrieved again. Less relevant topics are reduced to topic labels, while the current topic keeps its compact reference and detailed recent turns. Loading earlier messages does not expand provider context. The summary is encrypted and is removed with chat history.

### Errors and boundaries

Without online access, labelled local replies can still retrieve the same saved data and general guidance. Provider timeouts, rejected requests, invalid function calls and unusable output return a clear fallback without exposing provider credentials or internal error text. Request identifiers prevent a retry from creating a second saved reply. Input errors preserve the browser draft.

The assistant blocks contact details and credential-like text, keeps retrieved text separate from instructions, and refuses requests for other people's data. Medical concerns receive appropriate professional-care guidance. General sleep and movement guidance is informed by the [NHS sleep guide](https://www.nhs.uk/every-mind-matters/mental-health-issues/sleep/) and [NHS back-pain guidance](https://www.nhs.uk/conditions/back-pain/). Hale cannot diagnose or prescribe treatment.

Sign-out revokes the server session and its refresh-token lineage. Password reset revokes all account sessions. Chat checks authorization again after provider requests, so a reply that finishes after sign-out is not saved or returned. Separate signed-in sessions are not ended by a normal sign-out on one device. If the server cannot be reached, the interface states that only the local session was cleared.

Line charts use recorded metric dates and values without filling missing dates. Protein bar charts compare recorded grams with the saved target for the same period. Macro pie charts show calculated energy shares using four kilocalories per gram for protein and carbohydrate and nine for fat. Every chart includes its source values as accessible text. The model cannot supply chart values.

This variation uses the haleview-platform Compose project name and ports 29450/29451, separate from earlier review deployments. Do not attach an earlier project's data volume to this variation.
## Repository variations

The GitHub repository keeps the application variations on separate branches. Main contains the latest integrated application. Each branch runs Docker build checks, and pull requests into main run the same checks.

| Branch | Variation |
| --- | --- |
| main | Latest integrated Haleview application |
| ai-assistant | Health analytics, nutrition planning and conversational Hale |
| counting-calories | Health analytics and nutrition planning |
| numbers-dont-lie | Health profiles, analytics, goals and progress |

The health functions originate in Numbers Don't Lie, the nutrition functions in Counting Calories, and the conversation/data-access layers in AI Assistant. Each earlier variation remains available independently.
## Recipe data

The landing-page lifestyle photo is by [olia danilevich on Pexels](https://www.pexels.com/photo/a-person-making-salad-9004734/), used under the [Pexels licence](https://www.pexels.com/license/). It illustrates everyday food preparation and is not a catalogue recipe photo.

The catalogue includes 522 public-domain records from the Open Recipe Archive and 20 original Haleview everyday meal templates. The templates are labelled separately and have not been kitchen-tested. Their ingredient amounts are explicit and nutrition is calculated from USDA records. Automatic plans use the meal-ready templates; the historical archive remains available for browsing. Recipes with uncertain consumption quantities, such as preserving brine, are excluded from planning and display a warning.

Ingredient nutrition data comes from USDA FoodData Central Foundation Foods and SR Legacy records. Haleview calculates recipe nutrition from the stored gram and millilitre quantities. Olive oil is currently weighed in grams because its source record is mass-based. No unsourced density conversion is applied; this is an exception to the usual millilitre convention for liquids.

The source archive does not give a reliable serving or yield value. Haleview stores each imported recipe as one recipe unit. It does not divide nutrition by a guessed serving count.

These are historical recipes. This project has not kitchen-tested them.

Recipe photos come from Wikimedia Commons. They show serving examples of similar dishes, not results from these exact archive recipes. Photos are selected by dish, ingredients, and preparation, not by title alone. Each photo keeps its creator, file page, and licence with the recipe. Cards and recipe pages link this credit. Photos are displayed with a crop to fit the layout.

When no suitable dish photo is available, the recipe uses a compact text card. Failed image loads also hide the photo area. All photos are local and work without an image service or AI key.

## Start the application

Docker is the only required setup tool.

```text
docker compose up --build
```

Open the application at:

```text
http://127.0.0.1:29450
```

Check the backend at:

```text
http://127.0.0.1:29451/health
```

Stop the application:

```text
docker compose down
```

Docker stores the local database in a named volume. The database is not stored in the source folder.

When running the backend without Docker, data is stored in `.haleview` under the user's home directory. Set `DATA_FILE` to an external database path to use an existing database. Keep its encryption and signing key files with it.

## Optional online AI

The application can run without an AI key. Local generation is used when online AI is not configured.

Keep all keys and environment files outside this repository. Store the DeepSeek key in a file that only the backend can read. Set `DEEPSEEK_API_KEY_FILE` in an external environment file to the path of that key file inside the backend container. Pass the external environment file to Compose when the application starts.

Do not put the key in the Compose environment or in this repository. The backend reads the key file when it needs the provider. Set `DEEPSEEK_MODEL` in the external environment file when a different model is required. The Compose file supplies a default model name when this value is not set.

The application shows whether Online AI is available. The key is not placed in frontend code, prompts, logs, or saved meal data.

## First setup and guide

Haleview keeps the main pages locked until the profile is complete. The Profile page and Guide stay available. Profile entries remain as a draft while the person moves through the setup steps. Haleview saves the complete profile only after Data use is confirmed on the final step.

The Guide contains ten short tasks. Each task opens the related page when that page is available. The Dashboard contains a short daily summary. Detailed nutrition and progress views have their own pages.

## Interface icons

Haleview uses selected icons from [Lucide](https://lucide.dev). The React package renders each selected icon as an inline SVG. Lucide is available under the [ISC License](https://lucide.dev/license).

## Meal planning

Sign in to save a daily or seven-day plan. Haleview uses the saved Project 1
profile and nutrition preferences. Each plan shows meal type, time, recipe,
servings, and calculated nutrition. Each meal and day also shows its backend-calculated share of the saved daily calorie and macronutrient targets.

Meals can be swapped, moved to another day, changed to another meal type,
regenerated, or entered manually. Each saved change creates a plan version.
Earlier versions can be restored without changing profile data.

Shopping lists can be made from a whole plan or a single planned meal. Items
are grouped and use grams or millilitres. Checked items, quantity changes, and
removals are saved to the account.

## Nutrition progress

Signed-in users can record a planned meal or enter calories and macros by hand.
Each record stays with its account. A user cannot read or remove another user's
intake records.

Haleview compares daily, seven-day, and thirty-day totals with saved targets.
The backend calculates calories, macros, micronutrients, and trend points. The
same input gives the same result. The frontend only displays these values.
The detailed view compares 7-day and 30-day daily calorie averages with the
saved target. Days without records count as zero in these averages.
The progress page has a colour-coded calorie progress bar and a macro chart.
It also compares six micronutrients and fibre with general adult Daily Values. Sodium
uses an upper limit. Other tracked nutrients use a daily reference. These
values are for display and do not diagnose a health condition. The reference
values come from the [FDA Daily Value guide](https://www.fda.gov/food/nutrition-facts-label/daily-value-nutrition-and-supplement-facts-labels).
Low-intake guidance links the user to catalogue recipes that still follow the
saved diet, allergy, and disliked-ingredient settings. Recipe search has
micronutrient filters. Recipe pages also show a macro chart for the selected
recipe amount.

Nutrition settings start with values calculated from the saved health profile.
The user can then change diet choices, allergies, disliked ingredients,
cuisines, targets, meal counts, meal times, and timezone. Haleview keeps the
health profile as the source for age, height, weight, goal, and activity.

The nutrition score changes the wellness score after a meal is recorded. The
saved health score supplies 75 percent of the result. The nutrition score
supplies 25 percent. If there is no intake for the current day, the saved health
score does not change.

The progress summary is calculated locally so Dashboard and Nutrition load without
waiting for an online provider. Online guidance is requested separately from Hale.
Feedback on recipes and
suggestions is stored with the account. Recipe ratings change later retrieval
priority. Highly rated recipes can receive a verified label. Review text passes
a basic moderation check before it contributes to community results. Saved
nutrition settings keep a short change history. Frequent choices from that
history also affect later recipe retrieval.

## Community feedback

Signed-in users can leave one-to-five-star ratings and review text. Each account has one current vote per recipe. Approved community ratings increase retrieval priority, while personal likes and dislikes also influence the query and ranking used by vector search. The hash-vector encoding is fixed; feedback changes retrieval and its stored ranking signals, rather than retraining an embedding model.

A recipe receives the community-verified label after at least three ratings, an average of at least four stars, and a helpful ratio of at least two thirds. That status adds a retrieval boost and is shown on recipe cards and details. It does not mean the recipe was kitchen-tested.

Moderation is automated: contact details are rejected, and control characters or repeated-character spam receive a stored rejected status and reason. Only approved feedback contributes to community ranking or verification. There is no human moderation console.

## Guest visits

Guest mode keeps profile, privacy choices and activity only in page memory. Reloading or leaving the visit clears them. Previous guest snapshots are removed when starting a guest visit. Guest values are not copied into account setup. Online AI, email notifications and public sharing require an account. Guest computation endpoints return results without storing account records.

## Usage guide

1. Create an account or sign in.
2. Complete Profile. Confirm Data use on the final step to save the profile.
3. Open Nutrition and confirm the pre-filled food preferences and targets.
4. Open Recipes to search the public-domain catalogue. The browser groups versions with the same base recipe name, ignoring trailing version numbers and parenthetical subtitles. View variations opens every matching version in a group. Counts show recipes and groups. Use the numbered pages or Previous and Next to move through groups while preserving your filters. Change the recipe amount to recalculate ingredient quantities and nutrition.
5. Use Create a recipe variation to retrieve a matching source recipe and make a grounded variation. Open a recipe and use Find swap to replace one ingredient with a safe catalogue alternative.
6. Rate a source recipe. Later searches use approved community ratings, personal feedback, and preference history.
7. Open Meal plan to create a day or week. Change meals, move them, add a manual meal, or restore an earlier plan version.
8. Create a shopping list from a plan or one meal. Adjust or remove items as needed.
9. Record eaten meals in Nutrition. Use Dashboard for today and Progress for weekly and monthly results.

### Create with Hale

In Recipes, open Create. Describe a dish in your own words, or choose Combine and select two or three source recipes. Set 1 to 12 servings and a cooking time. Hale composes a new ingredient list and preparation method using catalogue foods. Describe works best when you name ingredients and say how you want to cook them. Combine lets you specify which parts of each source you want to bring together.

Create requires a signed-in account, consent for recommendations, Online AI and a configured provider. It does not silently substitute a local recipe when generation fails. Browsing and local recipe variations remain available without AI. The catalogue is finite; an unavailable requested ingredient can prevent creation. Ingredient weights must match their catalogue cooking state. Creation rejects cooked-rice quantities paired with dry-rice nutrition and methods that discard an unknown amount of salted cooking liquid or fat. Older saved creations with these problems show a warning and cannot be added to a new plan; recreate them with a compatible ingredient or cooking method.

Review the result, adjust servings and choose Save recipe to keep it in My saved recipes. Add to a plan copies the recipe, ingredients and calculated nutrition into the selected day. Plan versions and shopping lists retain that copy even if you remove the saved recipe. A collection can hold 100 saved recipes. The latest 20 unsaved drafts are retained. Private creations are encrypted at rest, isolated by account and included in the personal data export.

My saved recipes is a separate tab on the Recipes page. Favourites holds up to 200 bookmarked catalogue recipes or saved creations. Open a recipe to add or remove its bookmark. Removing a favourite keeps the saved recipe. Removing a saved creation also removes its bookmark. Favourites are private to each account and included in data export.

Created recipes are AI suggestions and have not been kitchen-tested. Nutrition is calculated from catalogue ingredient quantities for all selected servings. It is not a measured laboratory result.

## Prompt and model strategy

Meal generation uses five small steps:

1. Assess the saved health targets and food restrictions.
2. Create meal types and times.
3. Select recipes or grounded variations from local retrieval results.
4. Review values from backend nutrition functions.
5. Correct reported gaps while keeping saved restrictions.

Each step receives the checked result from the prior step and the saved targets, restrictions, and schedule. Each planning prompt has a short example that shows its required JSON shape, a common constraint, and standard units. Temperature varies by task; top-p stays at 1.

| Task | Temperature | Maximum output tokens |
| --- | --- | --- |
| Profile assessment | 0.1 | 1200 |
| Meal structure | 0.2 | 1600 |
| Recipe selection | 0.5 | 2000 |
| Nutrition review | 0.1 | 1200 |
| Plan correction | 0.2 | 1600 |
| Ingredient substitution | 0.1 | 900 |
| Recipe variation | 0.4 | 900 |
| Interpret recipe idea | 0.1 | 1200 |
| Create recipe | 0.65 | 3000 |
| Review created recipe | 0.1 | 1200 |
| Nutrition suggestion review | 0.2 | 500 |
| Hale guidance | 0.2, or 0.1 on a repair request | 2000 |

Structured requests and Hale guidance disable DeepSeek thinking mode to keep responses within their output limits. Tool-only responses are accepted after validation. Truncated or malformed responses use the local recovery path.

The backend decides which targets are missed. A bounded search adjusts recipe amounts or selects another permitted recipe, accepts only a lower combined target error, and recalculates the result. This runs for every generated day. If available recipes cannot meet all targets, the plan shows the remaining gaps and excesses.

Allergies, disliked ingredients, and restrictive diets filter eligible recipes. Mediterranean and flexitarian choices guide ranking alongside cuisine preferences. When the catalogue cannot verify a restrictive choice, Haleview reports that no matching recipe is available instead of ignoring it.

Recipe variations and ingredient substitutions have separate prompts and output contracts. Changing the amount of a generated recipe preserves its selected ingredients and substitutions and calls the backend calculator again.

Create first uses DeepSeek to match explicitly requested foods to available catalogue ingredients. It then composes the recipe and separately critiques the result. The critique checks the request, ingredients and cooking method; one revision is allowed. The three Create prompts specify their output schemas. Source recipes and ingredient records provide context instead of a fixed example dish that could steer unrelated requests. Backend validation checks catalogue identifiers, units, quantities, restrictions, ingredient references and known food names in recipe text. The model cannot supply authoritative nutrition. Preparation avoids fixed ingredient amounts so serving changes remain consistent. These checks reduce errors but cannot prove culinary quality or the safety of every generated instruction.

The configured DeepSeek model handles both recipe composition and nutritional analysis. Using one provider keeps authentication, response validation, and recovery consistent. Recipe composition uses temperature 0.65 to allow different dishes, while nutritional analysis uses 0.2 to prioritize suggestions from calculated facts. The model is configured with DEEPSEEK_MODEL; the default is deepseek-v4-flash.

DeepSeek is used for structured assessment, selection, substitution ranking, and guidance. It supports the JSON output and function calls used by this application. The local catalogue remains the recipe and ingredient source. Provider output cannot add unknown recipe or ingredient identifiers. Backend functions remain the only source for displayed nutrition values and target comparisons.

Hale shows nutrition insights beside health guidance. The optional online nutrition review selects practical suggestions from the calculated local review. It cannot replace calorie comparisons or introduce unverified foods. This action respects the account's consent and Online AI setting.

## Data and recovery

Data export in Settings includes the account's health history, nutrition
preferences and history, plans and versions, shopping lists, intake, and feedback.
It does not include sign-in tokens or provider keys.

Nutrition generation sends only the health fields needed for planning and excludes names, email addresses, account IDs and access data. Hale chat can also use the optional chosen name under the Online AI consent setting; contact details and credentials remain excluded from its tools.

Provider JSON and function arguments are checked before use. Only the listed nutrition functions can run. Recipe selections must use IDs from the local retrieval result. Nutrition calls must match the selected recipes and serving sizes.

The backend handles timeouts, rate limits, connection errors, rejected requests, and malformed responses with stable error codes. A matching cached result is used first. If none is available, the backend creates a local result from the same saved preferences and catalogue.

## Main areas

- Access: account access and guest access.
- Profile: health data, goals, activity, and food preferences.
- Dashboard: today's health, meal, and activity summary.
- Hale: health guidance and optional AI nutrition review, accessible from the main navigation.
- Records: weight and activity records.
- Progress: health changes over time.
- Nutrition: intake, current targets, trends, micronutrients, and feedback.
- Recipes: catalogue search, filters, generated creations, My saved recipes, Favourites, ingredient substitutions, community ratings, recipe details, serving changes, source links, and calculated nutrition values.
- Meal plan: daily or seven-day plans, meal changes, manual meals, and version restore.
- Shopping list: grouped ingredients with saved quantity changes and removals.

The recipe catalogue and grounded variation flow work without an AI key. A variation starts from a retrieved Open Recipe Archive record and uses only mapped catalogue ingredients. Optional online ranking can select from those allowed records. Haleview does not accept invented ingredients or model-provided nutrition values.

## Units and dates

The data model uses these units:

- Solids: grams.
- Liquids: millilitres.
- Energy: kilocalories.
- Time: minutes.

Dates and times use ISO 8601. The user timezone is saved with nutrition settings.
New plans retain that timezone and each meal's ISO scheduled instant alongside its local date and time. Account activity entries use the saved timezone rather than the browser timezone. Nonexistent daylight-saving times are rejected; repeated times use the earlier occurrence. Older saved plans remain readable, and an old nonexistent local time is marked for correction.

Recipe and ingredient text use deterministic 48-dimensional hash vectors. Recipe ranking combines cosine similarity with text matches and permitted personalization signals. Ingredient ranking also uses cosine similarity, with exact-name and word-match priority. At least one text match is required so vector collisions alone cannot turn an unavailable ingredient into a result.

## Data model

Recipe records contain `id`, `title`, `cuisine`, `meal`, `servings`, `ingredients`, `summary`, `time`, `difficulty_level`, `dietary_tags`, `source`, `img`, optional `imageCredit`, and `preparation`. Every recipe ingredient contains `id`, `name`, `quantity`, and `unit`. Every preparation step contains `step`, `description`, and `ingredients`.

Ingredient records contain `id`, `label`, `unit`, `quantity`, `category`, `allergens`, `dietaryTags`, `aliases`, and `nutrition`. Nutrition contains `caloriesKcal`, `proteinG`, `carbsG`, `fatsG`, `fiberG`, `sugarG`, `sodiumMg`, `vitaminDMcg`, `vitaminB12Mcg`, `ironMg`, `calciumMg`, and `magnesiumMg`.
The required canonical names `nutrition.calories`, `carbs`, `protein`, and `fats` are also stored and returned. They match `caloriesKcal`, `carbsG`, `proteinG`, and `fatsG`; catalogue validation rejects conflicting values.

Nutrition preferences contain diet choices, allergies, disliked ingredients, cuisine choices, calorie and macro targets, meal and snack counts, meal times, timezone, and `effectiveFrom`. The backend stores the current version and up to 50 earlier versions per account.

Assistant turns contain the encrypted user message, structured reply, optional chart and server-owned reference. A separate encrypted context summary stores bounded conversational preferences and topic references for older turns. Clearing chat removes both records.

Meal plans contain an identifier, duration, ISO start and end dates, timezone, source, generation step names, days, meals, daily nutrition and review, and plan totals. Each meal has local date/time and an ISO `scheduledAt` value. Calculated plan insights contain a balance score, diversity index, micronutrient coverage, protein consistency, fibre trend, and sugar trend. Each saved edit creates a version. Shopping lists contain grouped catalogue items with quantities and checked state. Intake records contain an ISO date and time, source, meal details, and calculated nutrition.

Community records contain a recipe subject, one to five stars, helpful state, decision, optional review, moderation state, and ISO creation time. Community aggregates contain rating count, average stars, helpful counts, a rank score, and verified state.

## Bonus functions

- Tracked micronutrients are sodium, vitamin D, vitamin B12, iron, calcium, and magnesium. Fibre is tracked alongside them.
- Micronutrient progress has reference bars, low-intake guidance, safe recipe suggestions, and recipe search filters.
- Community RAG uses ratings, reviews, moderation state, verified labels, preference history, and personal feedback in retrieval ranking.
- Recipe results include calculated nutrient density, satiety, and ingredient diversity. Meal plans include calculated balance, diversity, micronutrient coverage, and trend fields. These fields use catalogue nutrition. They do not make glycaemic, antioxidant, or environmental claims.
- Account data is isolated, protected at rest, and excluded from prompts unless the user has confirmed recommendation data use.

## Code layout

- `frontend/src/App.tsx` controls the current session and page flow.
- `frontend/src/screens` contains page screens.
- `frontend/src/components` contains shared page parts and health visuals.
- `frontend/src/styles` contains the visual styles.
- `backend/src/app.ts` defines HTTP routes.
- `backend/src` contains account, profile, storage, guidance, and nutrition code.
- `docker-compose.yml` starts the frontend and backend.

## Development checks

The default Docker build runs lint, tests, and compilation before creating the runtime images:

```text
docker compose up --build
```

To run only the checks without starting the application:

```text
docker build --target build -t haleview-backend-check ./backend
docker build --target build -t haleview-frontend-check ./frontend
```

For local development, use Node.js 22.13 or newer. In each of `backend` and `frontend`, run:

```text
npm ci
npm run lint
npm test
npm run check
npm run build
```

The backend build copies the catalogue into its output directory. Tests use temporary databases and mocked provider responses; they do not need an API key, external account, or a running application. Temporary test data is removed after each test process.

Backend tests cover catalogue contracts, ingredient and recipe retrieval, preference reuse, nutrition function validation, daily and weekly plans, changes and restore, shopping lists, cooking-state validation, authentication boundaries, intake ownership, chart source values, context compression, topic selection, provider timeouts and errors, and cache recovery. Frontend tests cover pending and failed loads, the Hale navigation entry, guest AI controls, escaped error messages, ISO dates, chart accessibility, and the Combine icon. These tests complement manual browser checks; they do not prove that every generated cooking instruction is correct.

GitHub Actions runs the same Docker checks for main-branch changes and pull requests, using read-only repository permissions and no provider credentials.
