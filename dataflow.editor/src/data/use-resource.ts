import { useEffect, useRef, useState } from 'react';
import type { ApiError, ApiResult } from '@/lib/api';

export type ResourceState<T> = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; value: T };

const toState = <T,>(result: ApiResult<T>): ResourceState<T> =>
  result.ok ? { status: 'ready', value: result.value } : { status: 'error', error: result.error };

/**
 * Something loaded from the api for a key (e.g. a project's secrets): loads when the key changes, `reload` after a
 * failure, and `run` makes a change and reloads when it succeeds, returning the answer (field errors for dialogs).
 */
export function useResource<T>(key: string, load: () => Promise<ApiResult<T>>) {
  const [loaded, setLoaded] = useState<{ for: string; state: ResourceState<T> } | null>(null);
  const state: ResourceState<T> = loaded?.for === key ? loaded.state : { status: 'loading' };
  // the latest `load` (it is a new function every render; the key says when to load again)
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    // set to false when the key changes before the answer arrives (that answer is then dropped)
    const request = { active: true };
    void loader.current().then(result => {
      if (request.active) {
        setLoaded({ for: key, state: toState(result) });
      }
    });

    return () => {
      request.active = false;
    };
  }, [key]);

  const reload = async () => {
    setLoaded({ for: key, state: { status: 'loading' } });
    setLoaded({ for: key, state: toState(await loader.current()) });
  };

  const run = async <R,>(change: Promise<ApiResult<R>>): Promise<ApiResult<R>> => {
    const result = await change;
    if (result.ok) {
      const fresh = await loader.current();
      if (fresh.ok) {
        setLoaded({ for: key, state: toState(fresh) });
      }
    }

    return result;
  };

  return { state, reload, run };
}
