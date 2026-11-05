import type { Scenario } from '#perf/scenario';
import { DATA_VERSION, sales } from './data';

const scenario: Scenario = {
  id: 'in-memory-pipeline',
  description: 'Start with input → Mapper → Filter → Router → TypeScript → End: CPU and allocation of the engine alone.',
  services: [],
  size: 10_000,
  quickSize: 1_000,
  seed: 1,
  timeoutMs: 120_000,
  dataVersion: DATA_VERSION,
  throughputNode: 'Start',
  rulers: [
    { metric: 'durationMs', direction: 'lower-is-better' },
    { metric: 'envelopesPerSecond', direction: 'higher-is-better' },
    { metric: 'memoryDeltaBytes', direction: 'lower-is-better' },
    { metric: 'cpuPercent', direction: 'lower-is-better' },
  ],
  load: async () => undefined,
  reset: async () => undefined,
  input: sales,
};

export default scenario;
