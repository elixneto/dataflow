import { describe, expect, test } from 'bun:test';
import type { Sample, Scenario } from '#perf/scenario';
import { median, spread, summarize } from '#perf/stats';

const timed = (durationMs: number) => ({ record: { durationMs, components: [] }, memory: {}, cpu: {} }) as unknown as Sample;

describe('median and spread', () => {
  test('odd and even counts', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(spread([4, 1, 3, 2])).toEqual({ min: 1, max: 4 });
  });
});

describe('summarize', () => {
  const scenario = { throughputNode: 'Start' } as Scenario;
  const rulers = [{ metric: 'durationMs', direction: 'lower-is-better' as const }];

  test('median, min and max of the metric, with the previous median beside them', () => {
    const [result] = summarize(rulers, [timed(30), timed(10), timed(20)], scenario, [{ metric: 'durationMs', direction: 'lower-is-better', median: 25 }]);
    expect(result).toEqual({ metric: 'durationMs', direction: 'lower-is-better', median: 20, min: 10, max: 30, previous: 25 });
  });

  test('unavailable (no median) without samples, or when a sample lacks the metric', () => {
    expect(summarize(rulers, [], scenario)[0]!.median).toBeUndefined();
    const [missing] = summarize([{ metric: 'fakeApi.p95Ms', direction: 'lower-is-better' }], [timed(10)], scenario);
    expect(missing).toEqual({ metric: 'fakeApi.p95Ms', direction: 'lower-is-better' });
  });
});
