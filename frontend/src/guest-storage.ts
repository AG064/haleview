const tutorialStoragePrefix = "haleview-tutorial-v1";
let guestTutorialSeen = false;
export type TutorialMode = "account" | "guest";

export function clearGuestSession(): void {
  guestTutorialSeen = false;
  try {
    window.localStorage.removeItem("haleview-guest-v1");
    window.localStorage.removeItem(`${tutorialStoragePrefix}-guest`);
  } catch {
    // Guest mode never depends on browser storage.
  }
}

export function tutorialWasSeen(mode: TutorialMode): boolean {
  if (mode === "guest") return guestTutorialSeen;
  try { return window.localStorage.getItem(`${tutorialStoragePrefix}-account`) === "seen"; }
  catch { return false; }
}

export function markTutorialSeen(mode: TutorialMode): void {
  if (mode === "guest") { guestTutorialSeen = true; return; }
  try { window.localStorage.setItem(`${tutorialStoragePrefix}-account`, "seen"); }
  catch { /* The guide remains available without browser storage. */ }
}
