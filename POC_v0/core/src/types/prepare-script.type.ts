import type {ParameterValue} from '#types/parameter.type';
import type {ScriptFunction} from '#types/script-function.type';
import type {WorkflowCurrentRun} from '#types/workflow-current-run.type';

/**
 * Prepares a component's script (e.g. TypeScript) once per run. Lives in the runner, like the expression
 * evaluator. The globals apply to every call of process: $PARAMETERS, $SECRETS, $WORKFLOW_CURRENT_RUN and log.
 */
export type PrepareScript = (code: string, globals: {
  run: WorkflowCurrentRun;
  parameters: Record<string, ParameterValue>;
  secrets: Record<string, string>;
  log: (message: string) => void;
}) => Promise<ScriptFunction>;
