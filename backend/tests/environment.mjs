import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, resolve} from "node:path";

const directory = mkdtempSync(join(tmpdir(), "haleview-test-"));
process.env.DATA_FILE = join(directory, "test.db");
process.env.NODE_ENV = "test";
process.env.PUBLIC_APP_URL = "http://127.0.0.1:5173";
for (const name of ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY_FILE", "AUTH_JWT_SECRET", "AUTH_JWT_SECRET_FILE", "RESEND_API_KEY", "RESEND_API_KEY_FILE", "GOOGLE_CLIENT_ID", "GITHUB_CLIENT_ID"]) {
  delete process.env[name];
}

export async function cleanup() {
  const {database} = await import("../dist/storage.js");
  database.close();
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("haleview-test-")) {
    throw new Error("Unexpected test directory.");
  }
  rmSync(directory, {recursive: true, force: true});
}

export const profileInput = {
  age: 32, gender: "female", heightCm: 168, weightKg: 72,
  occupationType: "mixed", activityLevel: "moderate", dietaryPreferences: ["vegetarian"],
  dietaryRestrictions: ["peanuts"], fitnessGoal: "general_fitness", weeklyActivityDays: 3,
  exerciseTypes: ["cardio"], sessionDuration: "30_60", fitnessLevel: "beginner",
  exerciseEnvironment: "home", exerciseTime: "morning", enduranceMinutes: 20, pushups: 0, squats: 10,
};
export const preferences = {
  version: 1, dietaryPreferences: ["vegetarian"], allergies: ["peanuts"], dislikedIngredients: [],
  cuisinePreferences: [], calorieTargetKcal: 2000, macroTargets: {proteinG: 100, carbsG: 240, fatsG: 65},
  mealsPerDay: 3, snacksPerDay: 1, mealTimes: ["08:00", "13:00", "19:00"],
  timezone: "Europe/Tallinn", effectiveFrom: "2026-01-01T00:00:00.000Z",
};
