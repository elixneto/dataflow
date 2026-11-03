import type {ParameterValue} from '#types/parameter.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {WorkflowCurrentRun} from '#types/workflow-current-run.type';

/** What passes from one component to another (see "The envelope" in docs/architecture.md). */
export type Envelope = {
  WORKFLOW_CURRENT_RUN: WorkflowCurrentRun;
  PARAMETERS: Record<string, ParameterValue>;
  DATA: EnvelopeData;
};
