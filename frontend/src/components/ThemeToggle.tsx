import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, saveTheme, themeStorageKey, type Theme } from "../theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === "light" ? "light" : "dark");

  useEffect(() => {
    const syncTheme = (event: StorageEvent) => {
      if (event.key !== themeStorageKey && event.key !== null) return;
      const next = readTheme();
      applyTheme(next);
      setTheme(next);
    };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  const next = theme === "dark" ? "light" : "dark";
  return <button className="theme-toggle" type="button" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} onClick={() => {
    saveTheme(next);
    setTheme(next);
  }}>
    {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
  </button>;
}
