import type { AppRoute } from "../routing";
import { LoadingView, WaitingState, type LoadingViewKind } from "./WaitingState";

export function LoadingDashboard({ view = "dashboard" }: { view?: AppRoute }) {
  const views: Partial<Record<AppRoute, {title: string; kind: LoadingViewKind}>> = {
    dashboard: {title: "Today", kind: "plan"},
    "meal-plan": {title: "Meal plan", kind: "plan"},
    "shopping-list": {title: "Shopping list", kind: "list"},
    recipes: {title: "Recipes", kind: "recipes"},
    nutrition: {title: "Nutrition", kind: "form"},
    progress: {title: "Progress", kind: "metrics"},
    records: {title: "Records", kind: "list"},
    hale: {title: "Hale", kind: "metrics"},
    profile: {title: "Profile", kind: "form"},
    "profile-setup": {title: "Profile", kind: "form"},
    settings: {title: "Settings", kind: "form"},
  };
  const current = views[view] ?? {title: "Your account", kind: "text"};
  return (
    <main className="app-shell loading-shell" aria-busy="true">
      <header className="loading-header">
        <div><strong>Haleview</strong><span>Health and progress</span></div>
        <div className="loading-tabs" aria-hidden="true"><span /><span /><span /></div>
      </header>
      <WaitingState label="Loading health data." />
      <section className="loading-panel">
        <h2>{current.title}</h2>
        <LoadingView view={current.kind} />
      </section>
    </main>
  );
}
