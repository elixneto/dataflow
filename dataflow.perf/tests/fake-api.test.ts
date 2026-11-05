import { afterAll, describe, expect, test } from 'bun:test';
import { DEFAULT_PARAMS, fakeApiUrl, parseParams } from '#fake-api/params';
import { createFakeApi } from '#fake-api/server';

const api = createFakeApi(0);
const base = `http://127.0.0.1:${api.port}`;
afterAll(() => api.stop());

const statusOf = async (id: number, query: string) => (await fetch(`${base}/items/${id}?${query}`)).status;
const reset = () => fetch(`${base}/_reset`, { method: 'POST' });

describe('fake API', () => {
  test('the same item and seed always get the same answer, whatever the order of the requests', async () => {
    const query = 'failRate=0.3&seed=7';
    const ids = Array.from({ length: 40 }, (_, i) => i + 1);
    await reset();
    const first = await Promise.all(ids.map(id => statusOf(id, query)));
    await reset();
    const second = await Promise.all([...ids].reverse().map(id => statusOf(id, query)));
    expect(second.reverse()).toEqual(first);
    expect(first).toContain(503);
    expect(first).toContain(200);
  });

  test('without a failure rate nothing fails; /_stats counts since /_reset', async () => {
    await reset();
    const statuses = await Promise.all([1, 2, 3, 4].map(id => statusOf(id, 'seed=3')));
    expect(statuses).toEqual([200, 200, 200, 200]);
    await statusOf(5, 'failRate=1');
    const stats = (await (await fetch(`${base}/_stats`)).json()) as { requests: number; failures: number; p95Ms: number };
    expect(stats.requests).toBe(5);
    expect(stats.failures).toBe(1);
    expect(stats.p95Ms).toBeGreaterThanOrEqual(0);
  });

  test('an item has its id, name and price', async () => {
    const item = (await (await fetch(`${base}/items/12?seed=1`)).json()) as { id: number; name: string; price: number };
    expect(item.id).toBe(12);
    expect(item.name).toBe('item 12');
    expect(typeof item.price).toBe('number');
  });
});

describe('params', () => {
  test('invalid values fall back to the defaults; the failure rate stays between 0 and 1', () => {
    expect(parseParams(new URL('http://x/items/1?delayMs=abc&jitterMs=-5&failRate=4&seed='))).toEqual({ ...DEFAULT_PARAMS, failRate: 1 });
  });

  test('fakeApiUrl and parseParams round-trip', () => {
    const params = { delayMs: 20, failRate: 0.02, jitterMs: 10, seed: 7 };
    const url = fakeApiUrl('http://127.0.0.1:5195/', '/items/1', params);
    expect(url).toBe('http://127.0.0.1:5195/items/1?delayMs=20&failRate=0.02&jitterMs=10&seed=7');
    expect(parseParams(new URL(url))).toEqual({ ...DEFAULT_PARAMS, ...params });
  });
});
