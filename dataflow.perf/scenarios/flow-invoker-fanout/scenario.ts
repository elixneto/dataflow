import type { Scenario } from '#perf/scenario';
import { amounts, DATA_VERSION } from './data';

const scenario: Scenario = {
    id: 'flow-invoker-fanout',
    description: 'Start with input → Flow Invoker (a child flow with a Mapper) → End: the cost of one flow run per envelope.',
    services: [],
    size: 20_000,
    quickSize: 2_000,
    seed: 1,
    timeoutMs: 180_000,
    dataVersion: DATA_VERSION,
    throughputNode: 'Start',
    rulers: [
        { metric: 'durationMs', direction: 'lower-is-better' },
        { metric: 'envelopesPerSecond', direction: 'higher-is-better' },
        { metric: 'memoryDeltaBytes', direction: 'lower-is-better' },
        { metric: 'component.Flow Invoker.waitingMs', direction: 'lower-is-better' },
    ],
    load: async () => undefined,
    reset: async () => undefined,
    input: amounts,
};

export default scenario;
