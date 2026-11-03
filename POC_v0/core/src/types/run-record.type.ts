import type {ParameterValue} from '#types/parameter.type';
import type {ComponentRun} from '#types/component-run.type';
import type {RunStatus} from '#types/run-status.type';
import type {WorkflowCurrentRun} from '#types/workflow-current-run.type';

export type RunRecord = {
  run: WorkflowCurrentRun;
  parameters: Record<string, ParameterValue>;
  status: RunStatus;
  end: string;
  durationMs: number;
  error?: string;
  components: ComponentRun[];
};
