import { describe, expect, test } from 'bun:test';
import type { CompactComponent, CompactRecord } from '#perf/compact';
import { metricOf } from '#perf/metrics';
import type { Metric, Sample, Scenario } from '#perf/scenario';

const component = (label: string, extra: Partial<CompactComponent> = {}): CompactComponent => ({
    nodeId: label.toLowerCase(),
    label,
    type: 'mapper',
    status: 'completed',
    inputs: {},
    outputs: {},
    ...extra,
});

const record = (components: CompactComponent[], durationMs = 2000): CompactRecord => ({
    run: { id: 'r', mode: 'execution', project: 'perf', flow: 'f', startedAt: '2026-01-01T00:00:00.000Z' },
    parameters: {},
    status: 'completed',
    end: '2026-01-01T00:00:02.000Z',
    durationMs,
    components,
});

const sample = (components: CompactComponent[], extra: Partial<Sample> = {}): Sample => ({
    iteration: 1,
    warmup: false,
    record: record(components),
    memory: { startRssBytes: 100, peakRssBytes: 350, endRssBytes: 200, heapStartBytes: 10, heapEndBytes: 20, samples: 200 },
    cpu: { cpuMs: 1000, userMs: 900, systemMs: 100 },
    ...extra,
});

const scenario = { throughputNode: 'Source' } as Scenario;

describe('metricOf', () => {
    const s = sample([
        component('Source', { outputs: { 'out-0': 3000, 'out-1': 1000 }, activeTimeMs: 40, waitingMs: 900 }),
        component('Sort v1.2', { activeTimeMs: 7, memory: { peakEnvelopes: 10, peakBytes: 4096 } }),
    ]);

    test('throughput counts every output of the scenario’s throughput node per second of engine time', () => {
        expect(metricOf('envelopesPerSecond', s, scenario)).toBe(2000);
        expect(metricOf('envelopesPerSecond', s, { throughputNode: 'Missing' } as Scenario)).toBeUndefined();
    });

    test('memory delta is the peak minus the start; CPU percent is CPU over engine time', () => {
        expect(metricOf('memoryDeltaBytes', s, scenario)).toBe(250);
        expect(metricOf('cpuPercent', s, scenario)).toBe(50);
        expect(metricOf('durationMs', s, scenario)).toBe(2000);
    });

    test('component metrics by label, a label with dots included; missing ones are undefined', () => {
        expect(metricOf('component.Source.waitingMs', s, scenario)).toBe(900);
        expect(metricOf('component.Source.activeMs', s, scenario)).toBe(40);
        expect(metricOf('component.Sort v1.2.peakBytes', s, scenario)).toBe(4096);
        expect(metricOf('component.Nope.activeMs', s, scenario)).toBeUndefined();
        expect(metricOf('component.Source.peakBytes', s, scenario)).toBeUndefined();
    });

    test('fake API metrics only when the sample has them; unknown names are undefined', () => {
        expect(metricOf('fakeApi.p95Ms', s, scenario)).toBeUndefined();
        expect(metricOf('fakeApi.p95Ms', { ...s, fakeApi: { requests: 10, failures: 1, p50Ms: 20, p95Ms: 31 } }, scenario)).toBe(31);
        expect(metricOf('nothing' as Metric, s, scenario)).toBeUndefined();
    });
});
