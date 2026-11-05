import type { Db } from 'mongodb';
import type { ISqlType } from 'mssql';
import type { CompactRecord } from '#perf/compact';

/*
 * The shapes the perf package shares: a scenario (what it runs, on which services, how it loads and resets its data,
 * which metrics its report shows), what its loader gets, and what one measured run produces.
 */

export type ServiceName = 'mssql' | 'mongodb' | 'fake-api';

export type Direction = 'lower-is-better' | 'higher-is-better';

/** a metric the report shows for a scenario, and which way is better */
export type Ruler = { metric: string; direction: Direction };

export type FakeApiStats = { requests: number; failures: number; p50Ms: number; p95Ms: number };

export type SqlColumn = { name: string; type: ISqlType | (() => ISqlType); nullable?: boolean };

/** what a scenario's load and reset get: only the services it lists are filled in; `sqlserver` runs in the database `perf` */
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
  /** the label of the component whose outputs count as envelopes processed */
  throughputNode: string;
  rulers: Ruler[];
  load(ctx: LoadContext): Promise<void>;
  reset(ctx: LoadContext): Promise<void>;
  input?(size: number, seed: number): unknown;
};

/** one run, as the measuring process writes it (the orchestrator adds `warmup` and `fakeApi`) */
export type Sample = {
  iteration: number;
  warmup: boolean;
  record: CompactRecord;
  memory: { startRssBytes: number; peakRssBytes: number; endRssBytes: number; heapStartBytes: number; heapEndBytes: number; samples: number };
  cpu: { cpuMs: number; userMs: number; systemMs: number };
  fakeApi?: FakeApiStats;
};

/** a ruler over the measured runs: no `median` means unavailable */
export type RulerResult = { metric: string; direction: Direction; median?: number; min?: number; max?: number; previous?: number };
