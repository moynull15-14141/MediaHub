import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

// Single source of truth for the theme localStorage key - kept in sync by
// hand with the inline bootstrap script in index.html (which can't import
// this file; it runs before any JS module graph loads), so both places
// agree on the same key name and 'light'/'dark' values.
export const THEME_STORAGE_KEY = 'mediahub-theme';

const readStoredTheme = (): ThemeMode => (localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark');

// Thin wrapper around the theme already applied by index.html's bootstrap
// script (see that file for why FOUC prevention has to happen there, not
// here) - this hook just gives React components a way to read the current
// theme and change it, persisting immediately rather than requiring a
// separate "Save" step.
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStoredTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}
