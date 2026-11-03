import {useEffect, useState} from 'react';
import {X} from 'lucide-react';
import {onSaveError} from '#data/api';

/** Banner at the bottom when a change could not be saved to the runner; it goes away when a later save works. */
export function SaveStatus() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => onSaveError(setError), []);
  if (!error) return null;
  return (
    <div role="alert" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-destructive px-4 py-2 text-sm text-white shadow-lg">
      {error}
      <button type="button" aria-label="Close" onClick={() => setError(null)} className="opacity-80 hover:opacity-100"><X className="size-4"/></button>
    </div>
  );
}
