import { useEffect, useState } from 'react';

/*
 * Whether dataflow.server answers: GET /api/health (it needs no X-Org-Id) every few seconds while the tab is visible,
 * and right away when the browser goes back online or the tab is shown again.
 */

export type ServerConnection =
  | { state: 'checking' }
  | { state: 'online'; environment: string }
  | { state: 'offline' };

const CHECK_EVERY_MS = 5_000;
const TIMEOUT_MS = 3_000;

/** the server's environment (DEV, STAGING...) when /health answered 2xx in time; null otherwise */
export async function pingServer(timeoutMs = TIMEOUT_MS): Promise<string | null> {
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json().catch(() => ({}))) as { environment?: unknown };
    return typeof body.environment === 'string' ? body.environment : '';
  } catch {
    return null;
  }
}

export function useServerConnection(): ServerConnection {
  const [connection, setConnection] = useState<ServerConnection>({ state: 'checking' });

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (document.hidden) {
        return;
      }

      const environment = await pingServer();
      if (active) {
        setConnection(environment === null ? { state: 'offline' } : { state: 'online', environment });
      }
    };

    void check();
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    const now = () => void check();
    const offline = () => setConnection({ state: 'offline' });
    window.addEventListener('online', now);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', now);

    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('online', now);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', now);
    };
  }, []);

  return connection;
}
