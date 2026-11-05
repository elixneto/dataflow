import { useCallback, useEffect, useState } from 'react';
import { getRun, type RunView } from '@/data/flows/flows-api';
import { followRun } from '@/data/flows/run-events';
import { isOpen } from './run-history';
import { useLive, type Loaded } from './use-runs';

/**
 * One run (its logs page): read once, then followed while it waits or runs (its progress, GET /runs/:id/events) and read
 * again when it ends; the runs it queued change status on their own, so it is read again when the organization's runs
 * change while one of them still goes on.
 */
export function useRun(id: string) {
  const [state, setState] = useState<{ for: string; loaded: Loaded<RunView> }>({ for: id, loaded: { status: 'loading' } });
  const load = useCallback(() => {
    void getRun(id).then(result =>
      setState(s =>
        result.ok
          ? { for: id, loaded: { status: 'ready', value: result.value } }
          : s.for === id && s.loaded.status === 'ready'
            ? s
            : { for: id, loaded: { status: 'error', error: result.error } },
      ),
    );
  }, [id]);
  useEffect(load, [load]);

  const loaded: Loaded<RunView> = state.for === id ? state.loaded : { status: 'loading' };
  const run = loaded.status === 'ready' ? loaded.value : null;
  const going = run !== null && isOpen(run.status);

  useEffect(() => {
    if (!going) return;
    let stopped = false;
    void followRun(id, progress => {
      if (stopped) return;
      setState(s => (s.for === id && s.loaded.status === 'ready' ? { for: id, loaded: { status: 'ready', value: { ...s.loaded.value, status: 'running', record: progress } } } : s));
    }).then(() => !stopped && load());
    return () => {
      stopped = true;
    };
  }, [id, going, load]);

  const below = run?.calledRuns?.some(r => isOpen(r.status)) ?? false;
  useLive(going || below, load);

  return { state: loaded, refresh: load };
}
