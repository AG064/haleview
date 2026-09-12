import { accessTokenUserId, AuthError } from "./auth.js";
import { getPrivacy } from "./storage.js";
import type { NutritionProvider } from "./nutrition/provider.js";

export function accountAccess(userId: number, authorization: string | undefined) {
  const check = () => {
    if (accessTokenUserId(authorization) !== userId) throw new AuthError(401, "Your session ended. Sign in again to continue.");
    if (!getPrivacy(userId)?.consentGiven) throw new AuthError(403, "Confirm data use before continuing.");
  };
  const checkOnline = () => {
    check();
    if (!getPrivacy(userId)?.dataForRecommendations) throw new AuthError(403, "Online AI is off. Your saved data remains available.");
  };
  return { check, checkOnline };
}

export function guardNutritionProvider(provider: NutritionProvider | null, checkOnline: () => void): NutritionProvider | null {
  if (!provider) return null;
  return {
    name: provider.name,
    model: provider.model,
    complete: async (...args) => {
      checkOnline();
      const result = await provider.complete(...args);
      checkOnline();
      return result;
    },
  };
}
