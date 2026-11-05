import type {LogLine} from '#types/log-line.type';
import type {RunStatus} from '#types/run-status.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {RunProgress, RunRecord} from '#types/run-record.type';

/**
 * One run of a flow the component called (Flow Invoker): how it went and its record (what its components did: counts,
 * times, logs, and up to SUB_RUN_SAMPLE_SIZE envelopes per port), as it goes while it runs. A record only for the
 * first MAX_SUB_RUNS calls.
 */
export type SubRun = {id: string; flow: string; status: RunStatus | 'running'; durationMs: number; error?: string; record?: RunRecord | RunProgress};

export type ComponentRun = {
  nodeId: string;
  label: string;
  type: string;
  /**
   * running = started, not finished yet (only in a run's progress); disabled = bypass (did not execute, only passed through); with-warnings = ran, but something deserves attention
   * (e.g. envelopes dropped by an unconnected output, nothing reached the End); pinned = did not execute, replayed its
   * pinned output (test runs); skipped = did not run: it only fed pinned components
   */
  status: 'not-run' | 'running' | 'completed' | 'disabled' | 'pinned' | 'skipped' | 'with-warnings' | 'with-errors' | 'failed';
  start?: string;
  end?: string;
  durationMs?: number;
  /**
   * Time the component spent processing, not counting the wait for envelopes nor for the next component.
   * Since everything runs on a single thread, it is practically its CPU: one component's time is never also counted for
   * another, so the components' active times add up to no more than the run. What a script awaits counts as Waiting
   * when it goes through the engine's wait (the server's runner does that for its fetch and timers), and is not active.
   */
  activeTimeMs?: number;
  /**
   * Time waiting for an outside system: rows coming from a database, a write to MongoDB, the envelopes of a called
   * flow. Not counted: waiting for envelopes, or for the next component to take them (backpressure).
   */
  waitingMs?: number;
  /** flows the component called (Flow Invoker): each run with its record, up to MAX_SUB_RUNS */
  subRuns?: SubRun[];
  /** What the component held at once (only accumulators: Lookup, Aggregate, Sort...). Bytes estimated from the DATA JSON. */
  memory?: {peakEnvelopes: number; peakBytes: number};
  /** envelopes per port */
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  logs: LogLine[];
  /** only the DATA of the first envelopes */
  inputSample: EnvelopeData[];
  /** a component with several inputs (Lookup): the first envelopes of each one (Run from here feeds them back) */
  inputSampleByPort?: Record<string, EnvelopeData[]>;
  outputSample: Record<string, EnvelopeData[]>;
};
