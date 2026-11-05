import type { RunProgress, RunRecord } from '@dataflow/core';

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

/** one error of a run, stacked: the component, the message and how many times it came (the first time) */
export type RunError = { nodeId: string; message: string; count: number; at: string };

/** the End's closing line ("Run … finished (Failed) …"): a summary, not an error of its own */
const CLOSING_LINE = /^Run \S+ finished \(/;

/**
 * The run's errors, from its components' error lines (not the log's other lines): the same message of the same
 * component once, with its count, in the order they first came.
 */
export function runErrors(record: Shown): RunError[] {
  const stacked = new Map<string, RunError>();
  for (const c of record.components) {
    for (const line of c.logs) {
      if (line.level !== 'error' || (c.type === 'end' && CLOSING_LINE.test(line.message))) {
        continue;
      }

      const key = `${c.nodeId}\n${line.message}`;
      const seen = stacked.get(key);
      if (seen) {
        seen.count += 1;
      } else {
        stacked.set(key, { nodeId: c.nodeId, message: line.message, count: 1, at: line.at });
      }
    }
  }

  return [...stacked.values()].sort((a, b) => a.at.localeCompare(b.at));
}
