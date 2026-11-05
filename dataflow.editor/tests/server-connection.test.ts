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

describe('when the server is checked', () => {
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  let status = 200;
  const tick = () => new Promise(resolve => setTimeout(resolve, 30));

  afterEach(() => {
    globalThis.fetch = realFetch;
    urls.length = 0;
  });

  test('once when watched, not again while online; a request that reached the server brings it back from offline', async () => {
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      return status === 200 ? Response.json({ ok: true, environment: 'DEV' }) : new Response(null, { status });
    }) as unknown as typeof fetch;
    const { watchServer, serverConnection, reportUnavailable, reportReachable } = await import('../src/lib/server-connection');
    const stop = watchServer(() => {});
    await tick();
    expect(serverConnection()).toEqual({ state: 'online', environment: 'DEV' });
    expect(urls).toEqual(['/api/health']);
    // online: nothing polls, and an answered request changes nothing
    reportReachable();
    await tick();
    expect(urls).toHaveLength(1);
    // a request that could not reach it: offline, and the checks start again (the first one after 1 s)
    status = 502;
    reportUnavailable();
    expect(serverConnection()).toEqual({ state: 'offline' });
    // a request answered meanwhile: checked right away, online again
    status = 200;
    reportReachable();
    await tick();
    expect(serverConnection()).toEqual({ state: 'online', environment: 'DEV' });
    expect(urls).toHaveLength(2);
    stop();
  });
});
