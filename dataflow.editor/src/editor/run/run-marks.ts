import { createContext, useContext } from 'react';
import type { ComponentRun, EnvelopeData, RunProgress, RunRecord } from '@dataflow/core';

/**
 * What the canvas shows of a run on its components: a spinner on each while it runs, then each one's status and how
 * many envelopes went through its ports (from the run's record).
 */
export type RunMarks = {
  running: boolean;
  byNode: Map<string, ComponentRun>;
  /** a click on a port's count: the run's Data tab on that component and port */
  onShow?: (nodeId: string, port: string) => void;
  /** the last full test run's components: Run from here starts from what reached them there */
  full?: Map<string, ComponentRun>;
};

export const RunMarksContext = createContext<RunMarks | null>(null);

/** Run from here: a test run of the component and what follows it (the page runs it) */
export const RunFromContext = createContext<(nodeId: string) => void>(() => {});

export const useRunMark = (nodeId: string) => {
  const marks = useContext(RunMarksContext);
  const runFrom = useContext(RunFromContext);
  return marks
    ? {
        running: marks.running,
        run: marks.byNode.get(nodeId),
        full: marks.full?.get(nodeId),
        show: (port: string) => marks.onShow?.(nodeId, port),
        runFrom: () => runFrom(nodeId),
      }
    : null;
};

/** while it runs, the run so far (each component running or how it ended); then the record */
export const runMarks = (record: RunRecord | RunProgress | null, running: boolean, onShow?: RunMarks['onShow'], full?: RunRecord | null): RunMarks | null =>
  record || running
    ? { running, byNode: new Map((record?.components ?? []).map(c => [c.nodeId, c])), onShow, full: full ? new Map(full.components.map(c => [c.nodeId, c])) : undefined }
    : null;

/**
 * What a pin keeps: the envelopes that went out of the component in the last run, per port, as the run's Data tab
 * shows them (the run keeps the first ones of each port, credentials and secrets hidden).
 */
export const pinnedOutput = (run: ComponentRun | undefined): Record<string, EnvelopeData[]> | undefined =>
  run ? structuredClone(run.outputSample) : undefined;

const sum = (ports: Record<string, number> | undefined) => Object.values(ports ?? {}).reduce((n, v) => n + v, 0);

/**
 * What a component's run lets it offer (after a run only): Pin output needs something that went out of it, Run from
 * here something that came in. A component already pinned keeps Pin, to unpin it.
 */
export const runActions = (run: ComponentRun | undefined, pinned: boolean) => ({
  pin: pinned || sum(run?.outputs) > 0,
  runFromHere: sum(run?.inputs) > 0,
});
