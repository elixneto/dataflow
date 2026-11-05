import { parseParams } from './params';
import { hashSeed, mulberry32 } from './random';

/*
 * The fake API of the HTTP scenarios: GET /items/:id answers after a delay, or fails, as its query string asks
 * (params.ts). The delay and the failure of an item come from the seed and the item's id, never from the order the
 * requests arrive in, so concurrent requests see the same answers on every run. /_stats counts what it served since
 * /_reset. The orchestrator runs it as a local process (`bun fake-api/server.ts`, PORT, default 5195).
 */

export type FakeApi = { port: number; stop(): void };

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]! : 0);

const json = (body: unknown, status = 200) => Response.json(body, { status });

export function createFakeApi(port: number): FakeApi {
  let requests = 0;
  let failures = 0;
  let latencies: number[] = [];

  const item = async (id: string, url: URL) => {
    const t0 = performance.now();
    requests += 1;
    const { delayMs, jitterMs, failRate, seed } = parseParams(url);
    const random = mulberry32(hashSeed(seed, id));
    const jitter = (random() * 2 - 1) * jitterMs;
    const fails = random() < failRate;
    await Bun.sleep(Math.max(0, delayMs + jitter));
    latencies.push(performance.now() - t0);
    if (fails) {
      failures += 1;
      return json({ error: 'injected failure' }, 503);
    }

    const updated = new Date(Date.UTC(2025, 0, 1) + Math.floor(random() * 365 * 86_400_000));
    return json({ id: Number(id), name: `item ${id}`, price: Math.round(random() * 1_000_000) / 100, updatedAt: updated.toISOString() });
  };

  const server = Bun.serve({
    port,
    fetch(request) {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true });
      }

      if (request.method === 'GET' && url.pathname === '/_stats') {
        const sorted = [...latencies].sort((a, b) => a - b);
        return json({ requests, failures, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) });
      }

      if (request.method === 'POST' && url.pathname === '/_reset') {
        requests = 0;
        failures = 0;
        latencies = [];
        return new Response(null, { status: 204 });
      }

      const found = request.method === 'GET' ? url.pathname.match(/^\/items\/([^/]+)$/) : null;
      return found ? item(decodeURIComponent(found[1]!), url) : json({ error: 'not found' }, 404);
    },
  });
  return { port: server.port ?? port, stop: () => void server.stop(true) };
}

if (import.meta.main) {
  const api = createFakeApi(Number(process.env.PORT ?? 5195));
  console.log(`fake API on :${api.port}`);
}
