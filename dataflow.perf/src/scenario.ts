import type { Db } from 'mongodb';
import type { ISqlType } from 'mssql';
import type { CompactRecord } from '#perf/compact';

export type ServiceName = 'mssql' | 'mongodb' | 'fake-api';
export type Direction = 'lower-is-better' | 'higher-is-better';
export type FakeApiStats = { requests: number; failures: number; p50Ms: number; p95Ms: number };
export type RunMetric =
    | 'durationMs'
    | 'envelopesPerSecond'
    | 'cpuMs'
    | 'cpuPercent'
    | 'memoryStartBytes'
    | 'memoryPeakBytes'
    | 'memoryEndBytes'
    | 'memoryDeltaBytes';
export type ComponentField = 'activeMs' | 'waitingMs' | 'peakBytes';
export type ComponentMetric = `component.${string}.${ComponentField}`;
export type FakeApiMetric = `fakeApi.${keyof FakeApiStats}`;
export type Metric = RunMetric | ComponentMetric | FakeApiMetric;

export type Ruler = { metric: Metric; direction: Direction };
export type SqlColumn = { name: string; type: ISqlType | (() => ISqlType); nullable?: boolean };
export type LoadContext = {
    size: number;
    seed: number;
    log(line: string): void;
    sqlserver?: {
        query(sql: string, parameters?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
        bulk(table: string, columns: SqlColumn[], rows: unknown[][]): Promise<void>;
    };
    mongo?: Db;
    fakeApi?: { reset(): Promise<void>; stats(): Promise<FakeApiStats> };
};
export type Scenario = {
    id: string;
    description: string;
    services: ServiceName[];
    size: number;
    quickSize: number;
    seed: number;
    runs?: number;
    timeoutMs: number;
    dataVersion: number;
    throughputNode: string;
    rulers: Ruler[];
    load(ctx: LoadContext): Promise<void>;
    reset(ctx: LoadContext): Promise<void>;
    input?(size: number, seed: number): unknown;
};
export type Sample = {
    iteration: number;
    warmup: boolean;
    record: CompactRecord;
    memory: {
        startRssBytes: number;
        peakRssBytes: number;
        endRssBytes: number;
        heapStartBytes: number;
        heapEndBytes: number;
        samples: number;
    };
    cpu: { cpuMs: number; userMs: number; systemMs: number };
    fakeApi?: FakeApiStats;
};
export type RulerResult = {
    metric: Metric;
    direction: Direction;
    median?: number;
    min?: number;
    max?: number;
    previous?: number;
};
