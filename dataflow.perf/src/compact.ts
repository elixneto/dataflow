import type { ComponentRun, RunRecord } from '@dataflow/core';

export type CompactComponent = Pick<
    ComponentRun,
    'nodeId' | 'label' | 'type' | 'status' | 'durationMs' | 'activeTimeMs' | 'waitingMs' | 'memory' | 'inputs' | 'outputs'
> & {
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
                ...(errors.length
                    ? {
                          errors: errors.length,
                          firstError: errors[0]!.message.slice(0, FIRST_ERROR_CHARS),
                      }
                    : 'errors' in c && c.errors
                      ? { errors: c.errors, firstError: c.firstError }
                      : {}),
            };
        }),
    };
}
