import { describe, expect, test } from 'bun:test';
import { machineInfo } from '#perf/machine';
import { SCHEMA_VERSION, type ResultLine } from '#perf/results';
import type { Sample } from '#perf/scenario';
import { changeOf, compareComponents, compareMetrics, defaultSelection, executionsOf, noise, parseResults, seriesOf, sizesOf, summaries, type ReportLine } from '../report/model';

const run = (iteration: number, durationMs: number, active = 30, status: 'completed' | 'failed' = 'completed'): Sample => ({
  iteration,
  warmup: iteration === 0,
  record: {
    run: { id: `r${iteration}`, mode: 'execution', project: 'perf', flow: 'f', startedAt: '2026-01-01T00:00:00.000Z' },
    parameters: {},
    status,
    end: '2026-01-01T00:00:01.000Z',
    durationMs,
    components: [
      { nodeId: 's', label: 'Start', type: 'start', status: 'completed', activeTimeMs: 1, inputs: {}, outputs: { 'out-0': 100 } },
      { nodeId: 'm', label: 'Mapper', type: 'mapper', status: 'completed', activeTimeMs: active, waitingMs: 2, inputs: { 'in-0': 100 }, outputs: { 'out-0': 100 } },
    ],
  },
  memory: { startRssBytes: 100, peakRssBytes: 300, endRssBytes: 200, heapStartBytes: 1, heapEndBytes: 2, samples: 10 },
  cpu: { cpuMs: 40, userMs: 30, systemMs: 10 },
});

const line = (at: string, time: number, options: { id?: string; size?: number; partial?: boolean; active?: number; times?: number[] } = {}): ResultLine => ({
  schemaVersion: SCHEMA_VERSION,
  at,
  partial: options.partial ?? false,
  scenario: { id: options.id ?? 'a', description: 'scenario a', size: options.size ?? 100, seed: 1, dataVersion: 1, services: [], runs: 2, quick: false },
  git: { sha: 'abcdef1234', dirty: false },
  machine: machineInfo(),
  images: {},
  warmup: run(0, time),
  samples: (options.times ?? [time, time]).map((t, i) => run(i + 1, t, options.active)),
  rulers: [
    { metric: 'durationMs', direction: 'lower-is-better', median: time, min: time, max: time },
    { metric: 'envelopesPerSecond', direction: 'higher-is-better', median: 100_000 / time, min: 1, max: 1 },
  ],
});

const fits: ReportLine = line('2026-01-01T00:00:00.000Z', 1);

const jsonl = (lines: ResultLine[]) => lines.map(l => JSON.stringify(l)).join('\n');

describe('parseResults', () => {
  test('every valid line, oldest first; broken lines are skipped', () => {
    const text = `${JSON.stringify(line('2026-01-02T00:00:00.000Z', 2))}\nnot json\n{}\n\n${JSON.stringify(line('2026-01-01T00:00:00.000Z', 1))}`;
    expect(parseResults(text).map(l => l.at)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z']);
    expect(fits.scenario.id).toBe('a');
  });
});

describe('summaries', () => {
  const all = parseResults(
    jsonl([
      line('2026-01-01T00:00:00.000Z', 100),
      line('2026-01-02T00:00:00.000Z', 80),
      line('2026-01-03T00:00:00.000Z', 10, { size: 5 }),
      line('2026-01-04T00:00:00.000Z', 1, { partial: true }),
      line('2026-01-01T00:00:00.000Z', 50, { id: 'b' }),
    ]),
  );

  test('the latest complete execution of each scenario, against the previous one at the same size', () => {
    const [a, b] = summaries(all);
    expect(a!.latest.at).toBe('2026-01-03T00:00:00.000Z');
    expect(a!.previous).toBeUndefined();
    expect(a!.executions).toBe(4);
    expect(a!.description).toBe('scenario a');
    expect(b!.id).toBe('b');
    expect(b!.change).toBeUndefined();
  });

  test('sizes, the most recent first, and the executions at one size', () => {
    expect(sizesOf(all, 'a')).toEqual([100, 5]);
    expect(executionsOf(all, 'a', 100).map(l => l.at)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-04T00:00:00.000Z']);
    expect(defaultSelection(executionsOf(all, 'a', 100))).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z']);
    expect(seriesOf(executionsOf(all, 'a', 100), 'durationMs').map(p => p.value)).toEqual([100, 80]);
  });
});

describe('comparing executions', () => {
  const [base, next] = parseResults(jsonl([line('2026-01-01T00:00:00.000Z', 100, { active: 40 }), line('2026-01-02T00:00:00.000Z', 80, { active: 30 })]));

  test('metrics side by side, each change against the baseline and read in its direction', () => {
    const [time, rate] = compareMetrics([base!, next!]);
    expect(time!.values).toEqual([100, 80]);
    expect(time!.changes[0]).toBeUndefined();
    expect(time!.changes[1]).toMatchObject({ text: '-20.0 %', kind: 'better' });
    expect(rate!.changes[1]).toMatchObject({ text: '+25.0 %', kind: 'better' });
  });

  test('components side by side, the busiest first', () => {
    const [mapper, start] = compareComponents([base!, next!]);
    expect(mapper).toMatchObject({ label: 'Mapper', active: [40, 30], waiting: [2, 2], outputs: [100, 100] });
    expect(start!.label).toBe('Start');
  });

  test('changes under 2 % are the same; a missing baseline gives none', () => {
    expect(changeOf(101, 100, 'lower-is-better')?.kind).toBe('same');
    expect(changeOf(110, 100, 'higher-is-better')?.kind).toBe('better');
    expect(changeOf(1, undefined, 'lower-is-better')).toBeUndefined();
  });

  test('noise is the spread of the engine time over its median', () => {
    expect(noise(parseResults(jsonl([line('2026-01-01T00:00:00.000Z', 100, { times: [90, 100, 110] })]))[0]!)).toBeCloseTo(0.2);
  });
});
