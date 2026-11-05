import type { ComponentRun, RunRecord } from '@dataflow/core';

/*
 * A run's record as the results keep it: what the metrics and the report read (status, times, envelope counts, held
 * memory) and nothing else. The engine's record also carries every component's logs and the first envelopes of each
 * port, which made a single result line weigh megabytes; here a component keeps only how many error lines it logged
 * and the first one.
 */

export type CompactComponent = Pick<ComponentRun, 'nodeId' | 'label' | 'type' | 'status' | 'durationMs' | 'activeTimeMs' | 'waitingMs' | 'memory' | 'inputs' | 'outputs'> & {
  subRuns?: number;
  errors?: number;
  firstError?: string;
};

export type CompactRecord = Omit<RunRecord, 'components'> & { components: CompactComponent[] };

const FIRST_ERROR_CHARS = 300;

export function compactRecord(record: RunRecord | CompactRecord): CompactRecord {
  return {
    ...record,
    components: record.components.map(c => {
      const errors = 'logs' in c && Array.isArray(c.logs) ? c.logs.filter(l => l.level === 'error') : [];
      const subRuns = Array.isArray(c.subRuns) ? c.subRuns.length : c.subRuns;
      return {
        nodeId: c.nodeId,
        label: c.label,
        type: c.type,
        status: c.status,
        ...(c.durationMs !== undefined ? { durationMs: c.durationMs } : {}),
        ...(c.activeTimeMs !== undefined ? { activeTimeMs: c.activeTimeMs } : {}),
        ...(c.waitingMs !== undefined ? { waitingMs: c.waitingMs } : {}),
        ...(c.memory ? { memory: c.memory } : {}),
        inputs: c.inputs,
        outputs: c.outputs,
        ...(subRuns ? { subRuns } : {}),
        ...(errors.length ? { errors: errors.length, firstError: errors[0]!.message.slice(0, FIRST_ERROR_CHARS) } : 'errors' in c && c.errors ? { errors: c.errors, firstError: c.firstError } : {}),
      };
    }),
  };
}
