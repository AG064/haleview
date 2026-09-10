import type { ReactNode } from "react";
import { isDashboardRoute, type AppRoute } from "../routing";

interface AppShellProps {
  route: Exclude<AppRoute, "not-found">;
  hasProfile: boolean;
  guestMode: boolean;
  signedIn: boolean;
  onNavigate: (route: Exclude<AppRoute, "not-found">) => void;
  onOpenAccount: () => void;
  children: ReactNode;
}

export function AppShell({ route, hasProfile, guestMode, signedIn, onNavigate, onOpenAccount, children }: AppShellProps) {
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="product-name">
          <h1>Haleview</h1>
          <span>Health and progress</span>
        </div>
        <nav className="main-tabs" aria-label="Main pages">
          <NavButton active={isDashboardRoute(route)} onClick={() => onNavigate("dashboard")}>Dashboard</NavButton>
          <NavButton active={route === "profile" || route === "profile-setup"} onClick={() => onNavigate(hasProfile ? "profile" : "profile-setup")}>Profile</NavButton>
          <NavButton active={route === "settings" || route === "tutorial"} onClick={() => onNavigate("settings")}>Settings</NavButton>
        </nav>
        {guestMode ? (
          <div className="top-account">
            <span>Guest</span>
            <button className="text-button" type="button" onClick={onOpenAccount}>Sign in</button>
          </div>
        ) : signedIn ? (
          <div className="top-account"><span>Account</span></div>
        ) : null}
      </header>

      {isDashboardRoute(route) && (
        <nav className="dashboard-tabs" aria-label="Dashboard pages">
          <NavButton active={route === "dashboard"} onClick={() => onNavigate("dashboard")}>Overview</NavButton>
          <NavButton active={route === "progress"} onClick={() => onNavigate("progress")}>Progress</NavButton>
          <NavButton active={route === "records"} onClick={() => onNavigate("records")}>Records</NavButton>
          <NavButton active={route === "hale"} onClick={() => onNavigate("hale")}>Hale</NavButton>
        </nav>
      )}

      {children}
    </main>
  );
}

interface NavButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

function NavButton({ active, onClick, children }: NavButtonProps) {
  return (
    <button className={active ? "active" : ""} type="button" aria-current={active ? "page" : undefined} onClick={onClick}>
      {children}
    </button>
  );
}
