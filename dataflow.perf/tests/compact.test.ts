import { describe, expect, test } from 'bun:test';
import type { ComponentRun, RunRecord } from '@dataflow/core';
import { compactRecord } from '#perf/compact';

const full = (extra: Partial<ComponentRun> = {}): ComponentRun => ({
  nodeId: 'm',
  label: 'Mapper',
  type: 'mapper',
  status: 'with-errors',
  durationMs: 50,
  activeTimeMs: 40,
  waitingMs: 5,
  memory: { peakEnvelopes: 3, peakBytes: 300 },
  inputs: { 'in-0': 100 },
  outputs: { 'out-0': 98 },
  logs: [
    { at: '2026-01-01T00:00:00.000Z', level: 'debug', message: 'x'.repeat(10_000) },
    { at: '2026-01-01T00:00:00.000Z', level: 'error', message: 'first failure' },
    { at: '2026-01-01T00:00:00.000Z', level: 'error', message: 'second failure' },
  ],
  inputSample: Array.from({ length: 50 }, (_, i) => ({ i, text: 'y'.repeat(1000) })),
  outputSample: { 'out-0': Array.from({ length: 50 }, (_, i) => ({ i })) },
  subRuns: [{ id: 'a', flow: 'child', status: 'completed', durationMs: 1 }],
  ...extra,
});

const record = (components: ComponentRun[]): RunRecord => ({
  run: { id: 'r', mode: 'execution', project: 'perf', flow: 'f', startedAt: '2026-01-01T00:00:00.000Z' },
  parameters: { size: 10 },
  status: 'completed',
  end: '2026-01-01T00:00:01.000Z',
  durationMs: 1000,
  components,
});

describe('compactRecord', () => {
  test('keeps what the metrics read and drops logs and envelope samples', () => {
    const [c] = compactRecord(record([full()])).components;
    expect(c).toEqual({
      nodeId: 'm',
      label: 'Mapper',
      type: 'mapper',
      status: 'with-errors',
      durationMs: 50,
      activeTimeMs: 40,
      waitingMs: 5,
      memory: { peakEnvelopes: 3, peakBytes: 300 },
      inputs: { 'in-0': 100 },
      outputs: { 'out-0': 98 },
      subRuns: 1,
      errors: 2,
      firstError: 'first failure',
    });
  });

  test('a compact line is small and compacting it again changes nothing', () => {
    const big = record(Array.from({ length: 8 }, () => full()));
    const once = compactRecord(big);
    expect(JSON.stringify(once).length).toBeLessThan(JSON.stringify(big).length / 50);
    expect(compactRecord(once)).toEqual(once);
  });

  test('a component without errors or sub-runs gets neither field', () => {
    const [c] = compactRecord(record([full({ logs: [], subRuns: undefined })])).components;
    expect(c).not.toHaveProperty('errors');
    expect(c).not.toHaveProperty('subRuns');
  });
});
