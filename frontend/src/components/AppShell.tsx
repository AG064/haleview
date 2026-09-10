import type { ReactNode } from "react";
import { BookOpen, CalendarDays, ChartLine, CircleUserRound, ClipboardList, HeartPulse, LayoutDashboard, Settings, ShoppingCart, Soup, UserRound, type LucideIcon } from "lucide-react";
import { isDashboardRoute, type AppRoute } from "../routing";
import { ThemeToggle } from "./ThemeToggle";

interface AppShellProps {
  route: Exclude<AppRoute, "not-found">;
  hasProfile: boolean;
  guestMode: boolean;
  signedIn: boolean;
  onNavigate: (route: Exclude<AppRoute, "not-found">) => void;
  onOpenAccount: () => void;
  onOpenTutorial: () => void;
  children: ReactNode;
}

export function AppShell({ route, hasProfile, guestMode, signedIn, onNavigate, onOpenAccount, onOpenTutorial, children }: AppShellProps) {
  const setupTitle = hasProfile ? undefined : "Complete the profile first.";
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="product-name">
          <h1>Haleview</h1>
          <span>Health and progress</span>
        </div>
        <nav className="main-tabs" aria-label="Main pages">
          <NavButton icon={LayoutDashboard} active={isDashboardRoute(route) && route !== "hale"} disabled={!hasProfile} title={setupTitle} onClick={() => onNavigate("dashboard")}>Dashboard</NavButton>
          <NavButton className="hale-nav" icon={HeartPulse} active={route === "hale"} disabled={!hasProfile} title={guestMode ? "Sign in to use Hale." : setupTitle} onClick={() => guestMode ? onOpenAccount() : onNavigate("hale")}>Hale</NavButton>
          <NavButton icon={CalendarDays} active={route === "meal-plan"} disabled={!hasProfile} title={setupTitle} onClick={() => onNavigate("meal-plan")}>Meal plan</NavButton>
          <NavButton icon={Soup} active={route === "nutrition"} disabled={!hasProfile} title={setupTitle} onClick={() => onNavigate("nutrition")}>Nutrition</NavButton>
          <NavButton icon={ShoppingCart} active={route === "shopping-list"} disabled={!hasProfile} title={setupTitle} onClick={() => onNavigate("shopping-list")}>Shopping list</NavButton>
          <NavButton icon={BookOpen} active={route === "recipes"} disabled={!hasProfile} title={setupTitle} onClick={() => onNavigate("recipes")}>Recipes</NavButton>
          <NavButton icon={UserRound} active={route === "profile" || route === "profile-setup"} onClick={() => onNavigate(hasProfile ? "profile" : "profile-setup")}>Profile</NavButton>
          <NavButton icon={Settings} active={route === "settings"} disabled={!hasProfile} title={setupTitle} onClick={() => onNavigate("settings")}>Settings</NavButton>
        </nav>
        <div className="top-account">
          <ThemeToggle />
          <button className="text-button guide-button button-with-icon" type="button" onClick={onOpenTutorial}><BookOpen aria-hidden="true" /><span>Guide</span></button>
          {guestMode ? (
            <>
            <span className="account-label"><CircleUserRound aria-hidden="true" />Guest</span>
            <button className="text-button" type="button" onClick={onOpenAccount}>Sign in</button>
            </>
          ) : signedIn ? <span>Account</span> : null}
        </div>
      </header>

      {isDashboardRoute(route) && route !== "dashboard" && route !== "hale" && <DashboardNavigation route={route} guestMode={guestMode} onNavigate={onNavigate} />}

      {children}
    </main>
  );
}

export function DashboardNavigation({ route, onNavigate }: Pick<AppShellProps, "route" | "guestMode" | "onNavigate">) {
  return (
        <nav className="dashboard-tabs" aria-label="Dashboard pages">
          <NavButton icon={LayoutDashboard} active={route === "dashboard"} onClick={() => onNavigate("dashboard")}>Overview</NavButton>
          <NavButton icon={ChartLine} active={route === "progress"} onClick={() => onNavigate("progress")}>Progress</NavButton>
          <NavButton icon={ClipboardList} active={route === "records"} onClick={() => onNavigate("records")}>Records</NavButton>

        </nav>
  );
}

interface NavButtonProps {
  className?: string;
  icon?: LucideIcon;
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}

function NavButton({ icon: Icon, active, disabled = false, title, onClick, children, className = "" }: NavButtonProps) {
  return (
    <button className={`${active ? "active" : ""} ${className}`.trim()} type="button" aria-current={active ? "page" : undefined} disabled={disabled} title={title} onClick={onClick}>
      {Icon && <Icon aria-hidden="true" />}
      <span>{children}</span>
    </button>
  );
}
