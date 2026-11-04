import { createContext, useContext } from 'react';
import type { Theme } from './theme';

export type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

/** filled by ThemeProvider (theme-provider.tsx) */
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider.');
  }

  return context;
}
