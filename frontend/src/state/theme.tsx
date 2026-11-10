import React, { createContext, useContext, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "auto";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  theme: ThemeChoice;
  resolvedTheme: ResolvedTheme;
  setTheme: (choice: ThemeChoice) => void;
}

const THEME_STORAGE_KEY = "autonexis_theme";

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeChoice>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeChoice | null;
      if (stored && ["light", "dark", "auto"].includes(stored)) {
        return stored;
      }
    }
    return "auto";
  });

  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(getSystemTheme);

  // Listen to system OS theme changes and synced Firestore theme updates
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    const syncHandler = (e: Event) => {
      const choice = (e as CustomEvent<ThemeChoice>).detail;
      if (choice === "dark" || choice === "light" || choice === "auto") {
        setThemeState(choice);
        try {
          localStorage.setItem(THEME_STORAGE_KEY, choice);
        } catch {
          // Storage unavailable / private mode
        }
      }
    };

    mediaQuery.addEventListener("change", handler);
    window.addEventListener("autonexis:sync-theme", syncHandler);
    return () => {
      mediaQuery.removeEventListener("change", handler);
      window.removeEventListener("autonexis:sync-theme", syncHandler);
    };
  }, []);

  const resolvedTheme: ResolvedTheme = theme === "auto" ? systemTheme : theme;

  // Apply data-theme attribute on <html> element
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = (choice: ThemeChoice) => {
    setThemeState(choice);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
      // Storage unavailable / private mode
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};

