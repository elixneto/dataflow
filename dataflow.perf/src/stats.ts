import { metricOf } from '#perf/metrics';
import type { Ruler, RulerResult, Sample, Scenario } from '#perf/scenario';

/*
 * The median and the spread of each ruler's metric over the measured runs, with the previous result's median beside
 * it. The caller passes only the runs that count (no warm-up, no failed run). No verdict: the person reading compares.
 */

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function spread(values: number[]): { min: number; max: number } {
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function summarize(rulers: Ruler[], samples: Sample[], scenario: Scenario, previous?: RulerResult[]): RulerResult[] {
  return rulers.map(ruler => {
    const before = previous?.find(p => p.metric === ruler.metric)?.median;
    const base: RulerResult = { metric: ruler.metric, direction: ruler.direction, ...(before !== undefined ? { previous: before } : {}) };
    const values = samples.map(s => metricOf(ruler.metric, s, scenario));
    if (values.length === 0 || values.some(v => v === undefined || !Number.isFinite(v))) {
      return base;
    }

    const numbers = values as number[];
    return { ...base, median: median(numbers), ...spread(numbers) };
  });
}
