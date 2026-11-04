import { createContext, useContext } from 'react';
import type { ComponentRun, RunRecord } from '@dataflow/core';

/**
 * What the canvas shows of a run on its components: a spinner on each while it runs, then each one's status and how
 * many envelopes went through its ports (from the run's record).
 */
export type RunMarks = {
  running: boolean;
  byNode: Map<string, ComponentRun>;
  /** a click on a port's count: the run's Data tab on that component and port */
  onShow?: (nodeId: string, port: string) => void;
};

export const RunMarksContext = createContext<RunMarks | null>(null);

export const useRunMark = (nodeId: string) => {
  const marks = useContext(RunMarksContext);
  return marks ? { running: marks.running, run: marks.byNode.get(nodeId), show: (port: string) => marks.onShow?.(nodeId, port) } : null;
};

export const runMarks = (record: RunRecord | null, running: boolean, onShow?: RunMarks['onShow']): RunMarks | null =>
  record || running ? { running, byNode: new Map(running ? [] : (record?.components ?? []).map(c => [c.nodeId, c])), onShow } : null;

const sum = (ports: Record<string, number> | undefined) => Object.values(ports ?? {}).reduce((n, v) => n + v, 0);

/**
 * What a component's run lets it offer (after a run only): Pin output needs something that went out of it, Run from
 * here something that came in. A component already pinned keeps Pin, to unpin it.
 */
export const runActions = (run: ComponentRun | undefined, pinned: boolean) => ({
  pin: pinned || sum(run?.outputs) > 0,
  runFromHere: sum(run?.inputs) > 0,
});
