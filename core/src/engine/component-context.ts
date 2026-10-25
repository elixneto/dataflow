import {timed} from '#engine/stopwatch';
import {invokeWorkflow} from '#engine/invoke-workflow';
import {envelopeVariables} from '#envelope/expression-variables';
import type {WorkflowExecution} from '#engine/workflow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {ExecutableNode} from '#types/executable-node.type';

/** How many of the upserts a test run would send are written out in full in the log. */
const LOGGED_UPSERTS = 3;

/**
 * What the engine gives a component while it runs (`ctx`): expressions, scripts, waits, database, memory...
 * `dryRun`: a target in a test run; its writes send nothing (see WorkflowExecution.runNode).
 */
export function componentContext(execution: WorkflowExecution, node: ExecutableNode, log: ComponentContext['log'], dryRun = false): ComponentContext {
  const {run, options, parameters} = execution;
  const stopwatch = execution.stopwatchOf(node.id);
  let logged = 0;
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
    queryDatabase: (kind, {secret, ...query}) => {
      const driver = options.databases?.[kind];
      if (!driver) throw new Error(`This runner does not query ${kind}.`);
      const connection = options.secrets?.[secret];
      if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`);
      return driver({...query, connection, signal: execution.control.signal});
    },
    upsertDocuments: async (kind, {secret, ...batch}) => {
      const driver = options.documentStores?.[kind];
      if (!driver) throw new Error(`This runner does not write to ${kind}.`);
      const connection = options.secrets?.[secret];
      if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`);
      if (dryRun) {
        const target = `${batch.database}.${batch.collection}`;
        log('info', `Test run: ${batch.upserts.length} upsert(s) into ${target} not sent.`);
        for (const upsert of batch.upserts.slice(0, Math.max(0, LOGGED_UPSERTS - logged))) {
          logged += 1;
          log('info', `Would upsert into ${target}: filter ${JSON.stringify(upsert.filter)}, $set ${JSON.stringify(upsert.document)}`);
        }
        return null;
      }
      stopwatch.stop();
      try {
        return await driver({...batch, connection, signal: execution.control.signal});
      } finally {
        stopwatch.resume();
      }
    },
    holding: (envelopes, held) => execution.memoryOf(node.id).holding(envelopes, held),
  };
}
