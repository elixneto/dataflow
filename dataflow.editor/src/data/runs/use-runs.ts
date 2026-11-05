import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '@/lib/api';
import type { RunFilter, RunPeriod, RunSummary } from './run-history';
import { followRunChanges, getRunNumbers, listRuns, type RunChange, type RunNumbers } from './runs-api';

/*
 * The run history, live: one stream of the organization's run changes per tab (GET /runs/events, SSE), shared by the
 * Runs page and the sidebar's count, and the lists asked again when something changed. While the stream is down,
 * they are asked again every POLL_MS instead, and the stream is tried again.
 */

/** a burst of changes (a run that fires 40 batches) asks the lists again once */
const COALESCE_MS = 1000;
/** while the stream is down */
const POLL_MS = 10_000;
const RETRY_MS = 5000;

type Listener = (change: RunChange | null) => void;
const listeners = new Set<Listener>();
let connected = false;
let abort: AbortController | null = null;

/** one stream for the tab while someone listens; null to the listeners when it (re)connects (ask everything again) */
function connect() {
  if (abort) return;
  const current = new AbortController();
  abort = current;
  void followRunChanges(
    change => listeners.forEach(l => l(change)),
    current.signal,
    () => {
      connected = true;
      listeners.forEach(l => l(null));
    },
  ).finally(() => {
    // an older stream that ends late does not say the newer one is down
    if (abort !== current && abort !== null) return;
    connected = false;
    abort = null;
    if (!current.signal.aborted && listeners.size > 0) setTimeout(() => listeners.size > 0 && connect(), RETRY_MS);
  });
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      abort?.abort();
      abort = null;
      connected = false;
    }
  };
}

/** calls `reload` when a run of the organization changes (a burst once) while `live`, and every POLL_MS while the stream is down */
export function useLive(live: boolean, reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (!live) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        latest.current();
      }, COALESCE_MS);
    };
    const stop = subscribe(soon);
    const poll = setInterval(() => !connected && latest.current(), POLL_MS);
    return () => {
      stop();
      clearInterval(poll);
      clearTimeout(timer);
    };
  }, [live]);
}

export type Loaded<T> = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; value: T };

/** the numbers above the list over `period` (the sidebar's count of runs going on too), kept up to date while `live` */
export function useRunNumbers(live = true, period: RunPeriod = '24h') {
  const [state, setState] = useState<Loaded<RunNumbers>>({ status: 'loading' });
  const asked = useRef(period);
  asked.current = period;
  const load = useCallback(() => {
    // an answer for a period no longer shown is dropped
    void getRunNumbers(period).then(result => asked.current === period && setState(result.ok ? { status: 'ready', value: result.value } : { status: 'error', error: result.error }));
  }, [period]);
  useEffect(load, [load]);
  useLive(live, load);
  return { state, refresh: load };
}

export type RunPageValue = { runs: RunSummary[]; treeSizes: Record<string, number>; next: string | null };

/**
 * The top runs that fit the filter with their trees, the first page; `more` adds the next. While `live`, the pages
 * shown are asked again when a run changes (an answer for a filter no longer shown is dropped).
 */
export function useRunPage(filter: RunFilter, live = true) {
  const key = JSON.stringify(filter);
  const [state, setState] = useState<{ for: string; loaded: Loaded<RunPageValue> }>({ for: key, loaded: { status: 'loading' } });
  const pages = useRef(1);
  const shown = useRef(key);
  shown.current = key;

  const load = useCallback(async () => {
    const asked = key;
    const runs: RunSummary[] = [];
    const treeSizes: Record<string, number> = {};
    let next: string | null = null;
    // the pages already shown, again: a change may be on any of them
    for (let page = 0; page < pages.current; page++) {
      const result = await listRuns(filter, page === 0 ? undefined : (next ?? undefined));
      if (asked !== shown.current) return;
      if (!result.ok) {
        // a failure after a good answer keeps it (the next change tries again)
        setState(s => (s.for === asked && s.loaded.status === 'ready' ? s : { for: asked, loaded: { status: 'error', error: result.error } }));
        return;
      }
      runs.push(...result.value.runs);
      Object.assign(treeSizes, result.value.treeSizes);
      next = result.value.next;
      if (!next) break;
    }
    setState({ for: asked, loaded: { status: 'ready', value: { runs, treeSizes, next } } });
  }, [key]);

  useEffect(() => {
    pages.current = 1;
    void load();
  }, [load]);
  useLive(live, () => void load());

  const loaded: Loaded<RunPageValue> = state.for === key ? state.loaded : { status: 'loading' };
  // what was shown before stays while another filter loads (the page does not blank on each change)
  const last = useRef<RunPageValue | null>(null);
  if (loaded.status === 'ready') last.current = loaded.value;
  return {
    state: loaded,
    /** the runs to show: this filter's, or the last ones while it loads */
    value: loaded.status === 'ready' ? loaded.value : last.current,
    loading: loaded.status === 'loading',
    refresh: () => void load(),
    more: async () => {
      pages.current += 1;
      await load();
    },
  };
}
