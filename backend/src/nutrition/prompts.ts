export type NutritionPromptName =
  | "profile_assessment"
  | "meal_structure"
  | "recipe_generation"
  | "nutrition_review"
  | "plan_correction";

export interface NutritionModelSettings {
  temperature: number;
  topP: number;
  maxTokens: number;
}

export interface NutritionPromptExample {
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface NutritionPromptDefinition {
  name: NutritionPromptName;
  purpose: string;
  settings: NutritionModelSettings;
  examples: NutritionPromptExample[];
  exampleSelectionReason: string;
}

export interface NutritionPromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PreviousPromptResult {
  step: NutritionPromptName;
  output: Record<string, unknown>;
}

export interface NutritionPromptRequest {
  name: NutritionPromptName | "ingredient_substitution" | "recipe_variation" | "recipe_idea" | "recipe_creation" | "recipe_creation_review";
  previousStep: NutritionPromptName | null;
  settings: NutritionModelSettings;
  messages: NutritionPromptMessage[];
}

const exampleSelectionReason = "The example shows the required output shape, a common constraint, and standard units without personal data.";

export const nutritionPromptDefinitions: readonly NutritionPromptDefinition[] = [
  {
    name: "profile_assessment",
    purpose: "Assess the saved targets and food constraints before meals are selected.",
    settings: { temperature: 0.1, topP: 1, maxTokens: 1200 },
    examples: [
      {
        input: { calorieTargetKcal: 2000, dietaryPreferences: ["vegetarian"] },
        output: { strategy: "Use balanced vegetarian meals across the saved meal times.", priorities: ["protein", "fiber"] },
      },
    ],
    exampleSelectionReason,
  },
  {
    name: "meal_structure",
    purpose: "Return one meals array containing every main meal and snack, with exactly mealsPerDay plus snacksPerDay entries. Do not use a separate snacks array. Each entry needs a unique mealType, a time in HH:mm, and a short goal. Copy the supplied mealSchedule mealType and time exactly. Keep goals short so up to thirteen entries fit.",
    settings: { temperature: 0.2, topP: 1, maxTokens: 1600 },
    examples: [
      {
        input: { mealsPerDay: 3, snacksPerDay: 1, mealTimes: ["08:00", "13:00", "19:00"] },
        output: { meals: [
          { mealType: "breakfast", time: "08:00", goal: "steady energy" },
          { mealType: "lunch", time: "13:00", goal: "include protein" },
          { mealType: "snack_1", time: "16:00", goal: "include fiber" },
          { mealType: "dinner", time: "19:00", goal: "balanced meal" },
        ] },
      },
    ],
    exampleSelectionReason,
  },
  {
    name: "recipe_generation",
    purpose: "Return a selections array with one entry per supplied meal, in the same order. Copy each mealType and time exactly. Each entry needs a recipeId from retrievedRecipeIds, servings from 0.25 to 4, and a short reason. Servings is the amount of the complete source recipe, not a guessed serving yield. Use only the retrieved catalogue.",
    settings: { temperature: 0.5, topP: 1, maxTokens: 2000 },
    examples: [
      {
        input: { mealType: "dinner", time: "19:00", restriction: "peanuts", retrievedRecipeIds: ["recipe-000001"] },
        output: { selections: [{ mealType: "dinner", time: "19:00", recipeId: "recipe-000001", servings: 1, reason: "Matches the retrieved food restrictions." }] },
      },
    ],
    exampleSelectionReason,
  },
  {
    name: "nutrition_review",
    purpose: "When requiredFunction is supplied, call that function exactly once using every selected recipeId and servings in the same order. Otherwise review calculatedNutrition and return status, gaps as a text array, excesses as a text array, needsCorrection as a boolean, and summary as short text. Never calculate nutrition yourself.",
    settings: { temperature: 0.1, topP: 1, maxTokens: 1200 },
    examples: [
      {
        input: { caloriesKcal: 1900, proteinG: 110, unit: "g" },
        output: { status: "review", gaps: ["protein"], excesses: [], needsCorrection: true, summary: "The calculated protein is below the supplied target." },
      },
    ],
    exampleSelectionReason,
  },
  {
    name: "plan_correction",
    purpose: "Return a correction recommendation for the backend bounded serving and recipe adjustment. The backend recalculates all changes and reports residual gaps. Return required as a boolean, action as short text, reasons as a text array, and keepsSavedPreferences set to true. Use the prior review and keep all supplied food restrictions. Use action none when no correction is required.",
    settings: { temperature: 0.2, topP: 1, maxTokens: 1600 },
    examples: [
      {
        input: { gap: "protein", excludedIngredients: ["peanut"], standardUnit: "g" },
        output: { required: true, action: "replace_recipe", reasons: ["Use a higher protein recipe that keeps the saved restriction."], keepsSavedPreferences: true },
      },
    ],
    exampleSelectionReason,
  },
];

const previousStepByName: Record<NutritionPromptName, NutritionPromptName | null> = {
  profile_assessment: null,
  meal_structure: "profile_assessment",
  recipe_generation: "meal_structure",
  nutrition_review: "recipe_generation",
  plan_correction: "nutrition_review",
};

function definitionFor(name: NutritionPromptName): NutritionPromptDefinition {
  const definition = nutritionPromptDefinitions.find((item) => item.name === name);
  if (!definition) {
    throw new Error("The nutrition prompt name is not supported.");
  }
  return definition;
}

export function buildNutritionPrompt(
  name: NutritionPromptName,
  input: Record<string, unknown>,
  previous?: PreviousPromptResult,
): NutritionPromptRequest {
  const definition = definitionFor(name);
  const expectedPrevious = previousStepByName[name];
  if (expectedPrevious === null && previous) {
    throw new Error("The first nutrition prompt cannot have a prior result.");
  }
  if (expectedPrevious !== null && previous?.step !== expectedPrevious) {
    throw new Error(`The ${name} prompt requires the ${expectedPrevious} result.`);
  }

  const messages: NutritionPromptMessage[] = [
    {
      role: "system",
      content: `${definition.purpose} Return one JSON object. Use only supplied data. Do not calculate or replace nutrition values.`,
    },
  ];
  for (const example of definition.examples) {
    messages.push({ role: "user", content: JSON.stringify({ input: example.input }) });
    messages.push({ role: "assistant", content: JSON.stringify(example.output) });
  }
  messages.push({
    role: "user",
    content: JSON.stringify({
      input,
      ...(previous ? { previousOutput: previous.output } : {}),
    }),
  });

  return {
    name,
    previousStep: expectedPrevious,
    settings: { ...definition.settings },
    messages,
  };
}
