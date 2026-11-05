import type { ComponentRun, RunProgress, RunRecord, SubRun } from '@dataflow/core';

/** a run as the panel shows it: ended, or still going */
export type Shown = RunRecord | RunProgress;

const total = (ports: Record<string, number>) => Object.values(ports).reduce((n, v) => n + v, 0);

/** the components the Data tab lists: all but an End nothing reached */
export const dataTabComponents = (record: Shown) => record.components.filter(c => c.type !== 'end' || total(c.inputs) > 0);

/**
 * The component the Data tab shows: the one chosen, kept from run to run (while a run has not reached it yet, it waits
 * on it); the first after the Start when nothing was chosen, or when a run ended without it (removed from the flow).
 */
export function dataTabSelection(record: Shown, chosen: string | undefined): string | undefined {
  const shown = dataTabComponents(record);
  if (chosen && (record.status === 'running' || shown.some(c => c.nodeId === chosen))) {
    return chosen;
  }

  return shown.find(c => c.type !== 'start')?.nodeId ?? shown[0]?.nodeId;
}

/** how long the timeline's axis is: the run's duration, or where the last component closed if that is later */
export function timelineSpan(record: Shown, runStart: number): number {
  return Math.max(record.durationMs, ...record.components.map(c => (c.start ? Date.parse(c.start) - runStart + (c.durationMs ?? 0) : 0)));
}

/**
 * one error of a run, stacked: the component, the message and how many times it came (the first time); one from a flow
 * a Flow Invoker called says where (`via`: the flow and the component in it, down the chain), under the Flow Invoker
 */
export type RunError = { nodeId: string; message: string; count: number; at: string; via?: string };

/** a component's name as the panel shows it, without the catalog: its label, or its type */
const labelOf = (c: ComponentRun) => c.label || c.type;

/** the sub-runs of a component that have a record (the first MAX_SUB_RUNS calls of a Flow Invoker) */
export const subRunsOf = (c: ComponentRun): (SubRun & { record: RunRecord | RunProgress })[] =>
  (c.subRuns ?? []).filter((s): s is SubRun & { record: RunRecord | RunProgress } => !!s.record);

/** a Flow Invoker's fire and forget calls of a real run: queued as runs of their own (no record here, their own) */
export const queuedRunsOf = (c: ComponentRun): SubRun[] => (c.subRuns ?? []).filter(s => s.status === 'queued');

/** the End's closing line ("Run … finished (Failed) …"): a summary, not an error of its own */
const CLOSING_LINE = /^Run \S+ finished \(/;

/**
 * The run's errors, from the error lines the engine wrote (not the log's other lines, nor what a component logs at
 * the error level, e.g. a Log set to Error): the same message of the same component once, with its count, in the
 * order they first came.
 */
export function runErrors(record: Shown): RunError[] {
  const stacked = new Map<string, RunError>();
  // the lines of a run, and of the runs its Flow Invokers called: those under the Flow Invoker, with where they came from
  const collect = (shown: Shown, nodeId: string | undefined, via: string) => {
    for (const c of shown.components) {
      for (const line of c.logs) {
        if (line.level !== 'error' || line.byComponent || (c.type === 'end' && CLOSING_LINE.test(line.message))) {
          continue;
        }

        const where = via ? `${via} › ${labelOf(c)}` : '';
        const key = `${nodeId ?? c.nodeId}\n${where}\n${line.message}`;
        const seen = stacked.get(key);
        if (seen) {
          seen.count += 1;
        } else {
          stacked.set(key, { nodeId: nodeId ?? c.nodeId, message: line.message, count: 1, at: line.at, ...(where ? { via: where } : {}) });
        }
      }

      for (const sub of subRunsOf(c)) {
        collect(sub.record, nodeId ?? c.nodeId, via ? `${via} › ${sub.flow}` : sub.flow);
      }
    }
  };
  collect(record, undefined, '');
  return [...stacked.values()].sort((a, b) => a.at.localeCompare(b.at));
}
