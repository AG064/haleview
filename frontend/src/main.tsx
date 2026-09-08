import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import { applyTheme, readTheme } from "./theme";
import "./styles/foundation.css";
import "./styles/entry.css";
import "./styles/shell.css";
import "./styles/profile.css";
import "./styles/summary.css";
import "./styles/health.css";
import "./styles/responsive.css";
import "./styles/pages.css";
import "./styles/pages-responsive.css";
import "./styles/nutrition.css";
import "./styles/recipe-create.css";
import "./styles/nutrition-progress.css";
import "./styles/planner.css";
import "./styles/ui-controls.css";
import "./styles/theme.css";
import "./styles/app-design.css";
import "./styles/component-system.css";
import "./styles/motion.css";
import "./styles/waiting.css";

applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
