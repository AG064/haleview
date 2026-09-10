export const dietaryPreferenceOptions = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "flexitarian",
  "keto",
  "paleo",
  "mediterranean",
  "gluten_free",
  "dairy_free",
  "low_carb",
  "high_protein",
  "low_sodium",
  "halal",
  "kosher",
  "whole_food",
  "low_fat",
  "nut_free",
  "fodmap_friendly",
  "diabetic_friendly",
  "plant_forward"
] as const;

export const allergyOptions = [
  "peanuts",
  "tree_nuts",
  "milk",
  "eggs",
  "wheat",
  "soy",
  "fish",
  "shellfish",
  "sesame",
  "mustard",
  "celery",
  "sulfites",
  "lupin",
  "corn",
  "kiwi"
] as const;

export { sentenceLabel as nutritionLabel } from "../format";
