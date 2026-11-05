import type { Scenario } from '#perf/scenario';
import { DATA_VERSION, orders, type Order } from './data';

const BATCH = 10_000;

const scenario: Scenario = {
  id: 'mongodb-pipeline-aggregate',
  description: 'MongoDB Pipeline ($group in the database) → Filter → Aggregate (batches of 500) → TypeScript → Sort → Limit → End: accumulators and the memory they hold.',
  services: ['mongodb'],
  size: 100_000,
  quickSize: 10_000,
  seed: 1,
  timeoutMs: 300_000,
  dataVersion: DATA_VERSION,
  throughputNode: 'MongoDB Pipeline',
  rulers: [
    { metric: 'durationMs', direction: 'lower-is-better' },
    { metric: 'memoryDeltaBytes', direction: 'lower-is-better' },
    { metric: 'component.Aggregate.peakBytes', direction: 'lower-is-better' },
    { metric: 'component.Sort.peakBytes', direction: 'lower-is-better' },
    { metric: 'component.MongoDB Pipeline.waitingMs', direction: 'lower-is-better' },
  ],
  load: async ctx => {
    const collection = ctx.mongo!.collection<Order>('orders');
    await collection.drop().catch(() => undefined);
    let batch: Order[] = [];
    for (const order of orders(ctx.size, ctx.seed)) {
      batch.push(order);
      if (batch.length === BATCH) {
        await collection.insertMany(batch, { ordered: false });
        batch = [];
      }
    }

    if (batch.length) {
      await collection.insertMany(batch, { ordered: false });
    }

    await collection.createIndex({ orderId: 1 });
  },
  reset: async () => undefined,
};

export default scenario;
