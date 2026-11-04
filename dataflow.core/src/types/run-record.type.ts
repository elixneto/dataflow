import type {ParameterValue} from '#types/parameter.type';
import type {ComponentRun} from '#types/component-run.type';
import type {RunStatus} from '#types/run-status.type';
import type {FlowCurrentRun} from '#types/flow-current-run.type';

/** a run as it goes (RunOptions.onProgress): the record so far, the components that ended with their status */
export type RunProgress = Omit<RunRecord, 'status' | 'end' | 'error'> & {status: 'running'};

export type RunRecord = {
  run: FlowCurrentRun;
  parameters: Record<string, ParameterValue>;
  status: RunStatus;
  end: string;
  durationMs: number;
  error?: string;
  /** Run from here: the component it ran from (only it and what follows it ran) */
  from?: {nodeId: string; label: string};
  components: ComponentRun[];
};
