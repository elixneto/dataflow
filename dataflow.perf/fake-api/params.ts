/*
 * The fake API's knobs, read from the query string of each request: the delay, its jitter, the share of requests that
 * fail and the seed that makes both repeatable. The server reads them with parseParams; a scenario writes its URL with
 * fakeApiUrl, so a misspelled name breaks the scenario's test instead of being ignored.
 */

export type FakeApiParams = { delayMs: number; jitterMs: number; failRate: number; seed: number };

export const DEFAULT_PARAMS: FakeApiParams = { delayMs: 0, jitterMs: 0, failRate: 0, seed: 1 };

const KEYS = Object.keys(DEFAULT_PARAMS) as (keyof FakeApiParams)[];

const number = (text: string | null, fallback: number) => {
  if (text === null || text.trim() === '') {
    return fallback;
  }

  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
};

export function parseParams(url: URL): FakeApiParams {
  const read = (key: keyof FakeApiParams) => number(url.searchParams.get(key), DEFAULT_PARAMS[key]);
  return {
    delayMs: Math.max(0, read('delayMs')),
    jitterMs: Math.max(0, read('jitterMs')),
    failRate: Math.min(1, Math.max(0, read('failRate'))),
    seed: read('seed'),
  };
}

export function fakeApiUrl(base: string, path: string, params: Partial<FakeApiParams>): string {
  const query = KEYS.filter(key => params[key] !== undefined)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}${query ? `?${query}` : ''}`;
}
