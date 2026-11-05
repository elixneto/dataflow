import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { machineInfo } from '#perf/machine';
import { appendResult, historyOf, lastResult, latestPerScenario, readResults, resultsPath, SCHEMA_VERSION, type ResultLine } from '#perf/results';

const dir = mkdtempSync(join(tmpdir(), 'perf-results-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const machine = { ...machineInfo(), hostname: 'Test Box' };

const line = (id: string, size: number, partial = false, at = '2026-01-01T00:00:00.000Z'): ResultLine => ({
  schemaVersion: SCHEMA_VERSION,
  at,
  partial,
  scenario: { id, size, seed: 1, dataVersion: 1, services: [], runs: 5, quick: false },
  git: { sha: 'abc', dirty: false },
  machine,
  images: {},
  warmup: null,
  samples: [],
  rulers: [],
});

describe('results', () => {
  test('one JSON line per result, in a file named after the machine', async () => {
    appendResult(line('a', 10), dir);
    appendResult(line('a', 10, false, '2026-01-02T00:00:00.000Z'), dir);
    const path = resultsPath('Test Box', dir);
    expect(path.endsWith('test-box.jsonl')).toBe(true);
    const lines = (await Bun.file(path).text()).trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).schemaVersion).toBe(SCHEMA_VERSION);
  });

  test('the last complete result of a scenario at a size; partial ones are skipped', () => {
    appendResult(line('a', 10, true, '2026-01-03T00:00:00.000Z'), dir);
    appendResult(line('a', 20, false, '2026-01-04T00:00:00.000Z'), dir);
    expect(lastResult('Test Box', 'a', 10, dir)?.at).toBe('2026-01-02T00:00:00.000Z');
    expect(lastResult('Test Box', 'a', 20, dir)?.at).toBe('2026-01-04T00:00:00.000Z');
    expect(lastResult('Test Box', 'b', 10, dir)).toBeUndefined();
    expect(lastResult('Other', 'a', 10, dir)).toBeUndefined();
  });

  test('a host name becomes a safe file name', () => {
    expect(resultsPath('My Laptop.local', dir).endsWith('my-laptop-local.jsonl')).toBe(true);
  });

  test('the history of a scenario at a size, and the latest complete result of each scenario', () => {
    appendResult(line('b', 10, false, '2026-01-05T00:00:00.000Z'), dir);
    const all = readResults('Test Box', dir);
    expect(historyOf(all, 'a', 10).map(l => l.at)).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z']);
    expect(latestPerScenario(all).map(l => `${l.scenario.id}@${l.at}`)).toEqual(['a@2026-01-04T00:00:00.000Z', 'b@2026-01-05T00:00:00.000Z']);
  });
});
