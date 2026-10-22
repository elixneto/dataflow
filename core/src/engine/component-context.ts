import {timed} from '#engine/stopwatch';
import {invokeWorkflow} from '#engine/invoke-workflow';
import {envelopeVariables} from '#envelope/expression-variables';
import type {WorkflowExecution} from '#engine/workflow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {ExecutableNode} from '#types/executable-node.type';

/** What the engine gives a component while it runs (`ctx`): expressions, scripts, waits, database, memory... */
export function componentContext(execution: WorkflowExecution, node: ExecutableNode, log: ComponentContext['log']): ComponentContext {
  const {run, options, parameters} = execution;
  const stopwatch = execution.stopwatchOf(node.id);
  return {
    run, node, log,
    prepareScript: async code => {
      if (!options.prepareScript) throw new Error('This runner does not execute scripts.');
      return options.prepareScript(code, {run, parameters, secrets: options.secrets ?? {}, log: m => log('info', m)});
    },
    fieldValue: (field, doc) => (field.expression
      ? options.evaluate(field.value, envelopeVariables(doc, options.secrets))
      : field.value),
    wait: async promise => {
      stopwatch.stop();
      try {
        return await promise;
      } finally {
        stopwatch.resume();
      }
    },
    waitEach: source => timed(source, stopwatch),
    invokeWorkflow: (workflowId, call) => invokeWorkflow(execution, node, workflowId, call),
    querySqlServer: ({secret, ...query}) => {
      if (!options.querySqlServer) throw new Error('This runner does not query databases.');
      const connection = options.secrets?.[secret];
      if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`);
      return options.querySqlServer({...query, connection, signal: execution.control.signal});
    },
    holding: (envelopes, held) => execution.memoryOf(node.id).holding(envelopes, held),
  };
}
