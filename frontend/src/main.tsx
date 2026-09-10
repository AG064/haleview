import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fortawesome/fontawesome-free/css/fontawesome.min.css";
import "@fortawesome/fontawesome-free/css/brands.min.css";
import "@fortawesome/fontawesome-free/css/solid.min.css";
import App from "./App";
import ErrorBoundary from "./ErrorBoundary";
import "./styles/foundation.css";
import "./styles/entry.css";
import "./styles/shell.css";
import "./styles/profile.css";
import "./styles/summary.css";
import "./styles/health.css";
import "./styles/responsive.css";
import "./styles/pages.css";
import "./styles/pages-responsive.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
