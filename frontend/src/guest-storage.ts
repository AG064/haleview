import type { Guidance, HealthHistory, HealthProfile, PrivacySettings } from "./types";

const guestStorageKey = "numbers-dont-lie-guest-v1";
const tutorialStoragePrefix = "haleview-tutorial-v1";

export type TutorialMode = "account" | "guest";

interface GuestSnapshot {
  version: 1;
  profile: HealthProfile;
  privacy: PrivacySettings;
  history: HealthHistory;
  recommendations: Guidance;
}

function isStoredObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validGuestSnapshot(value: unknown): value is GuestSnapshot {
  if (!isStoredObject(value) || value.version !== 1) return false;
  const profile = value.profile;
  const privacy = value.privacy;
  const history = value.history;
  const recommendations = value.recommendations;
  return Boolean(
    isStoredObject(profile) && isStoredObject(profile.analytics) &&
    typeof profile.updatedAt === "string" && Number.isFinite(Date.parse(profile.updatedAt)) &&
    typeof profile.weightKg === "number" && typeof profile.heightCm === "number" &&
    Array.isArray(profile.dietaryPreferences) && Array.isArray(profile.dietaryRestrictions) && Array.isArray(profile.exerciseTypes) &&
    isStoredObject(privacy) && privacy.consentGiven === true &&
    isStoredObject(history) && Array.isArray(history.weights) && Array.isArray(history.activities) && Array.isArray(history.analytics) &&
    isStoredObject(recommendations) && recommendations.source === "local" && Array.isArray(recommendations.items) && isStoredObject(recommendations.summaries)
  );
}

export function tutorialWasSeen(mode: TutorialMode): boolean {
  try {
    return window.localStorage.getItem(`${tutorialStoragePrefix}-${mode}`) === "seen";
  } catch {
    return false;
  }
}

export function markTutorialSeen(mode: TutorialMode): void {
  try {
    window.localStorage.setItem(`${tutorialStoragePrefix}-${mode}`, "seen");
  } catch {
    // The tutorial can still open when browser storage is unavailable.
  }
}

export function readGuestSnapshot(): GuestSnapshot | null {
  try {
    const stored = window.localStorage.getItem(guestStorageKey);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    return validGuestSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeGuestSnapshot(snapshot: Omit<GuestSnapshot, "version">): void {
  window.localStorage.setItem(guestStorageKey, JSON.stringify({ version: 1, ...snapshot }));
}
