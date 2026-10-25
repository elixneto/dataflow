import type {LogLine} from '#types/log-line.type';
import type {RunStatus} from '#types/run-status.type';
import type {EnvelopeData} from '#types/envelope-data.type';

export type ComponentRun = {
  nodeId: string;
  label: string;
  type: string;
  /**
   * disabled = bypass (did not execute, only passed through); with-warnings = ran, but something deserves attention
   * (e.g. envelopes dropped by an unconnected output, nothing reached the End); pinned = did not execute, replayed its
   * pinned output (editor runs only)
   */
  status: 'not-run' | 'completed' | 'disabled' | 'pinned' | 'with-warnings' | 'with-errors' | 'failed';
  start?: string;
  end?: string;
  durationMs?: number;
  /**
   * Time the component spent processing, not counting the wait for envelopes nor for the next component.
   * Since everything runs on a single thread, it is practically its CPU. Includes what the script awaits inside (e.g. an HTTP call).
   */
  activeTimeMs?: number;
  /** workflows the component called (Workflow Invoker): a summary of each run, up to 50 */
  subRuns?: {id: string; workflow: string; status: RunStatus; durationMs: number; error?: string}[];
  /** What the component held at once (only accumulators: Lookup, Aggregate, Sort...). Bytes estimated from the DATA JSON. */
  memory?: {peakEnvelopes: number; peakBytes: number};
  /** envelopes per port */
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  logs: LogLine[];
  /** only the DATA of the first envelopes */
  inputSample: EnvelopeData[];
  outputSample: Record<string, EnvelopeData[]>;
};
