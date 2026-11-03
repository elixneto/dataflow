import {useSyncExternalStore} from 'react';

/*
 * Whether the runner is reachable: polls /api/health every few seconds (faster while it is down). A request that does
 * not reach the runner (data/api.ts) also reports it right away, without waiting for the next check.
 */

const INTERVAL_MS = 5_000;
const RETRY_MS = 2_000;
export const LOST = 'Lost the connection to the runner.';

/** null = connected; otherwise, why the connection is lost */
let problem: string | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function reportConnection(next: string | null) {
  if (next === problem) return;
  problem = next;
  listeners.forEach(l => l());
}

async function check() {
  try {
    const response = await fetch('/api/health', {cache: 'no-store'});
    const body = await response.json().catch(() => ({})) as {error?: string};
    // without its own {error}, the answer came from the proxy in front (the runner is down)
    reportConnection(response.ok ? null : body.error ?? LOST);
  } catch {
    reportConnection(LOST);
  }
  timer = setTimeout(check, problem ? RETRY_MS : INTERVAL_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) void check();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) clearTimeout(timer);
  };
}

/** the connection problem right now (null = connected); polls while someone is listening */
export const useConnectionProblem = () => useSyncExternalStore(subscribe, () => problem);
