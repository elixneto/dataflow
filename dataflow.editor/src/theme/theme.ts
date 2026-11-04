/*
 * Light, dark or the system's choice. The choice is stored in localStorage; the page gets the `dark` class on <html>.
 * index.html runs the same rule before React loads, so a dark page never flashes light (keep both in sync).
 */

export type Theme = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'dataflow.theme';

const THEMES: Theme[] = ['light', 'dark', 'system'];

/** the stored value, or 'system' when there is none or it is not a theme */
export function parseTheme(stored: string | null | undefined): Theme {
  return THEMES.includes(stored as Theme) ? (stored as Theme) : 'system';
}

/** whether the page is dark for this theme */
export function isDark(theme: Theme, systemPrefersDark: boolean): boolean {
  if (theme === 'system') {
    return systemPrefersDark;
  }

  return theme === 'dark';
}
