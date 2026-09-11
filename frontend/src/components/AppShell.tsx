import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, CalendarDays, ChartLine, CircleUserRound, ClipboardList, HeartPulse, LayoutDashboard, Menu, Settings, ShoppingCart, Soup, UserRound, X, type LucideIcon } from "lucide-react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const topbarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!topbarRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [menuOpen]);

  const navigateFromMenu = (nextRoute: Exclude<AppRoute, "not-found">) => {
    setMenuOpen(false);
    onNavigate(nextRoute);
  };

  return (
    <main className="app-shell">
      <header className="topbar" ref={topbarRef}>
        <div className="product-name">
          <h1>Haleview</h1>
          <span>Health and progress</span>
        </div>
        <nav id="main-navigation" className={`main-tabs${menuOpen ? " is-open" : ""}`} aria-label="Main pages">
          <NavButton icon={LayoutDashboard} active={isDashboardRoute(route) && route !== "hale"} disabled={!hasProfile} title={setupTitle} onClick={() => navigateFromMenu("dashboard")}>Dashboard</NavButton>
          <NavButton className="hale-nav" icon={HeartPulse} active={route === "hale"} disabled={!hasProfile} title={guestMode ? "Sign in to use Hale." : setupTitle} onClick={() => { setMenuOpen(false); if (guestMode) onOpenAccount(); else onNavigate("hale"); }}>Hale</NavButton>
          <NavButton icon={CalendarDays} active={route === "meal-plan"} disabled={!hasProfile} title={setupTitle} onClick={() => navigateFromMenu("meal-plan")}>Meal plan</NavButton>
          <NavButton icon={Soup} active={route === "nutrition"} disabled={!hasProfile} title={setupTitle} onClick={() => navigateFromMenu("nutrition")}>Nutrition</NavButton>
          <NavButton icon={ShoppingCart} active={route === "shopping-list"} disabled={!hasProfile} title={setupTitle} onClick={() => navigateFromMenu("shopping-list")}>Shopping list</NavButton>
          <NavButton icon={BookOpen} active={route === "recipes"} disabled={!hasProfile} title={setupTitle} onClick={() => navigateFromMenu("recipes")}>Recipes</NavButton>
          <NavButton icon={UserRound} active={route === "profile" || route === "profile-setup"} onClick={() => navigateFromMenu(hasProfile ? "profile" : "profile-setup")}>Profile</NavButton>
          <NavButton icon={Settings} active={route === "settings"} disabled={!hasProfile} title={setupTitle} onClick={() => navigateFromMenu("settings")}>Settings</NavButton>
        </nav>
        <div className="top-account">
          <button className="text-button guide-button button-with-icon" type="button" aria-label="Open guide" title="Open guide" onClick={onOpenTutorial}><BookOpen aria-hidden="true" /><span>Guide</span></button>
          <ThemeToggle />
          {guestMode ? (
            <>
            <span className="account-label"><CircleUserRound aria-hidden="true" /><span>Guest</span></span>
            <button className="text-button" type="button" onClick={onOpenAccount}>Sign in</button>
            </>
          ) : signedIn ? <span className="account-label"><CircleUserRound aria-hidden="true" /><span>Account</span></span> : null}
          <button
            ref={menuButtonRef}
            className="main-menu-toggle"
            type="button"
            aria-controls="main-navigation"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close main menu" : "Open main menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </header>

      {isDashboardRoute(route) && route !== "dashboard" && route !== "hale" && <DashboardNavigation route={route} guestMode={guestMode} onNavigate={onNavigate} />}

      {children}
    </main>
  );
}

export function DashboardNavigation({ route, onNavigate }: Pick<AppShellProps, "route" | "guestMode" | "onNavigate">) {
  const selectedIndex = route === "progress" ? 1 : route === "records" ? 2 : 0;
  return (
        <nav className="dashboard-tabs segmented-switch" aria-label="Dashboard pages" data-segments="3" data-index={selectedIndex}>
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
