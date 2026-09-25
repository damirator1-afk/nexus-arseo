"use client";

import { useEffect, useState } from "react";
import styles from "./replenishment.module.css";

type Theme = "light" | "dark" | "system";
const STORAGE_KEY = "nexus-replenishment-theme";
const LABEL: Record<Theme, string> = { light: "Светлая", dark: "Тёмная", system: "Системная" };
const ORDER: Theme[] = ["system", "light", "dark"];

/**
 * Cycles light -> dark -> system on click, persisted per-viewer in localStorage. Starts at "system"
 * on both server and first client render (theme is read from storage only inside useEffect) to avoid
 * a hydration mismatch, since Next's shared layout has no theme-detection script.
 */
export function ThemeToggle({ shellRef }: { shellRef: React.RefObject<HTMLElement | null> }) {
  const [theme, setTheme] = useState<Theme>("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "system") setTheme(stored);
    } catch {
      // Private browsing / blocked storage: fall back silently to the default "system" theme.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (theme === "system") shell.removeAttribute("data-theme");
    else shell.setAttribute("data-theme", theme);
    if (hydrated) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch {
        // Nothing to do if storage is unavailable — the choice just won't persist across reloads.
      }
    }
  }, [theme, hydrated, shellRef]);

  const cycle = () => setTheme((current) => ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);

  return (
    <button type="button" className={`${styles.btn} ${styles.btnSm}`} onClick={cycle} aria-label={`Тема оформления: ${LABEL[theme]}. Нажмите, чтобы переключить.`}>
      {LABEL[theme]}
    </button>
  );
}
