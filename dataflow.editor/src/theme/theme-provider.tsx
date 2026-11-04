import { useEffect, useState, type ReactNode } from 'react';
import { isDark, parseTheme, THEME_STORAGE_KEY, type Theme } from './theme';
import { ThemeContext } from './use-theme';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function readStoredTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Keeps the `dark` class on <html> in step with the chosen theme (and with the system, while it is 'system'). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const query = darkQuery();
    const apply = () => document.documentElement.classList.toggle('dark', isDark(theme, query.matches));
    apply();

    if (theme !== 'system') {
      return;
    }

    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [theme]);

  const setTheme = (next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage blocked (private mode): the choice lasts until the page closes
    }

    setThemeState(next);
  };

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

