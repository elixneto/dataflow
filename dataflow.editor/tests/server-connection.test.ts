import { afterEach, describe, expect, test } from 'bun:test';
import { pingServer } from '../src/lib/server-connection';

describe('server ping', () => {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];

  const respond = (handler: (signal: AbortSignal) => Promise<Response>) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      urls.push(url);
      return handler(init.signal!);
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    globalThis.fetch = realFetch;
    urls.length = 0;
  });

  test('online: the environment from /api/health', async () => {
    respond(async () => Response.json({ ok: true, environment: 'DEV' }));

    expect(await pingServer()).toBe('DEV');
    expect(urls).toEqual(['/api/health']);
  });

  test('offline when the request fails (server down)', async () => {
    respond(async () => {
      throw new TypeError('fetch failed');
    });

    expect(await pingServer()).toBeNull();
  });

  test('offline on an error status (the proxy answers 5xx while the server is down)', async () => {
    respond(async () => new Response(null, { status: 502 }));

    expect(await pingServer()).toBeNull();
  });

  test('offline when the server does not answer in time', async () => {
    respond(signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))));

    expect(await pingServer(20)).toBeNull();
  });
});
