import type { FakeApiParams } from '#fake-api/params';
import type { Scenario } from '#perf/scenario';
import { DATA_VERSION, itemIds } from './data';

/** what the HTTP Request's URL asks of the fake API (tests/flows.test.ts checks the URL in the YAML against it) */
export const FAKE_API_PARAMS: Partial<FakeApiParams> = { delayMs: 20, jitterMs: 10, failRate: 0.02, seed: 7 };

const scenario: Scenario = {
  id: 'http-slow-api',
  description: 'Start with input (ids) → HTTP Request (8 at once, 20 ms ± 10 ms, 2 % failures diverted to the error port) → Mapper → End: waiting outside and error handling.',
  services: ['fake-api'],
  size: 2_000,
  quickSize: 200,
  seed: 7,
  timeoutMs: 180_000,
  dataVersion: DATA_VERSION,
  throughputNode: 'Start',
  rulers: [
    { metric: 'durationMs', direction: 'lower-is-better' },
    { metric: 'envelopesPerSecond', direction: 'higher-is-better' },
    { metric: 'component.HTTP Request.waitingMs', direction: 'lower-is-better' },
    { metric: 'fakeApi.p95Ms', direction: 'lower-is-better' },
    { metric: 'fakeApi.failures', direction: 'lower-is-better' },
  ],
  load: async () => undefined,
  reset: async ctx => {
    await ctx.fakeApi!.reset();
  },
  input: itemIds,
};

export default scenario;
