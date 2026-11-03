import {useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import {Button} from '#ui/button';

const KEY = 'dataflow-theme';

function readTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Applies the saved theme before the first render (the default is dark, as in v0). */
export function applySavedTheme() {
  document.documentElement.classList.toggle('dark', readTheme() === 'dark');
}

export function ThemeButton() {
  const [theme, setTheme] = useState(readTheme);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // no storage: only lasts until reload
    }
  }
  return (
    <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      {theme === 'dark' ? <Sun className="size-4" aria-hidden="true"/> : <Moon className="size-4" aria-hidden="true"/>}
    </Button>
  );
}
