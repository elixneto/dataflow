import type {ParameterValue} from '#types/parameter.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {FlowCurrentRun} from '#types/flow-current-run.type';

/** What passes from one component to another (see "The envelope" in docs/architecture.md). */
export type Envelope = {
  FLOW_CURRENT_RUN: FlowCurrentRun;
  PARAMETERS: Record<string, ParameterValue>;
  DATA: EnvelopeData;
};
