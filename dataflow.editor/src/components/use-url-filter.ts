import { useSearchParams } from 'react-router';

/**
 * A list's filters in the URL: ?<kindParam>=<one of `kinds`>&q=<search>. A reload or a link keeps them; each change
 * replaces the URL (no history entry per keystroke). The first kind is "everything" and is left out of the URL.
 */
export function useUrlFilter<K extends string>(kindParam: string, kinds: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const all = kinds[0]!;
  const requested = params.get(kindParam) as K | null;
  const kind: K = requested && kinds.includes(requested) ? requested : all;
  const search = params.get('q') ?? '';

  const setFilter = (changes: { kind?: K; search?: string }) => {
    const next = { kind, search, ...changes };
    const query = new URLSearchParams();
    if (next.kind !== all) {
      query.set(kindParam, next.kind);
    }

    if (next.search) {
      query.set('q', next.search);
    }

    setParams(query, { replace: true });
  };

  return { kind, search, setFilter, clear: () => setFilter({ kind: all, search: '' }) };
}
