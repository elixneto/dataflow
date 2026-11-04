import { afterEach, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServerGateView } from '../src/components/server-gate';
import { check, reportUnavailable, retryDelay, serverConnection, watchServer } from '../src/lib/server-connection';

describe('server disconnected', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('the screen is blurred and blocked with "Server disconnected" / "Reconnecting…" only while offline', () => {
    const offline = renderToStaticMarkup(
      <ServerGateView connection={{ state: 'offline' }}>
        <p>canvas</p>
      </ServerGateView>,
    );
    expect(offline).toContain('Server disconnected');
    expect(offline).toContain('Reconnecting…');
    expect(offline).toMatch(/<div inert="" aria-hidden="true" class="[^"]*blur/);

    for (const connection of [{ state: 'online', environment: 'DEV' }, { state: 'checking' }] as const) {
      const html = renderToStaticMarkup(
        <ServerGateView connection={connection}>
          <p>canvas</p>
        </ServerGateView>,
      );
      expect(html).not.toContain('Server disconnected');
      expect(html).not.toContain('inert');
    }
  });

  test('while offline the checks wait longer each time, up to 15 s', () => {
    expect([0, 1, 2, 3, 4, 5].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);
  });

  test('a request that cannot reach the server marks it offline; a /health that answers brings it back', async () => {
    globalThis.fetch = (async () => Response.json({ ok: true, environment: 'DEV' })) as unknown as typeof fetch;
    const stop = watchServer(() => {});
    try {
      await check();
      expect(serverConnection()).toEqual({ state: 'online', environment: 'DEV' });
      reportUnavailable();
      expect(serverConnection()).toEqual({ state: 'offline' });
      await check();
      expect(serverConnection()).toEqual({ state: 'online', environment: 'DEV' });
    } finally {
      stop();
    }
  });
});
