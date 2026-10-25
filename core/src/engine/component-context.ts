import {timed, timedRequests} from '#engine/stopwatch';
import {invokeWorkflow} from '#engine/invoke-workflow';
import {envelopeVariables} from '#envelope/expression-variables';
import {toError} from '#errors/normalize-error';
import type {WorkflowExecution} from '#engine/workflow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {ExecutableNode} from '#types/executable-node.type';

/** How many of the upserts a test run would send are written out in full in the log. */
const LOGGED_UPSERTS = 3;
/** How much of a request body a test run writes in the log. */
const BODY_EXCERPT = 300;

/**
 * What the engine gives a component while it runs (`ctx`): expressions, scripts, waits, database, memory...
 * `dryRun`: a target in a test run; its writes send nothing (see WorkflowExecution.runNode).
 */
export function componentContext(execution: WorkflowExecution, node: ExecutableNode, log: ComponentContext['log'], dryRun = false): ComponentContext {
  const {run, options, parameters} = execution;
  const stopwatch = execution.stopwatchOf(node.id);
  // runs only while waiting for an outside system: a pull of the next row, a write, the next envelope of a called flow
  const waiting = execution.waitingOf(node.id);
  let logged = 0;
  let inFlight = 0;
  // secret values never go to a log: longest first, so one that contains another is hidden whole
  const secretValues = Object.values(options.secrets ?? {}).filter(v => v.length >= 4).sort((a, b) => b.length - a.length);
  const mask = (text: string) => secretValues.reduce((t, secret) => t.split(secret).join('***'), text);
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
    invokeWorkflow: (workflowId, call) => {
      const called = invokeWorkflow(execution, node, workflowId, call);
      return {...called, envelopes: timedRequests(called.envelopes, waiting)};
    },
    queryDatabase: (kind, {secret, ...query}) => {
      const driver = options.databases?.[kind];
      if (!driver) throw new Error(`This runner does not query ${kind}.`);
      const connection = options.secrets?.[secret];
      if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`);
      // only the pull of the next row: while the component is held by the next one (backpressure), it is not waiting here
      return timedRequests(driver({...query, connection, signal: execution.control.signal}), waiting);
    },
    aggregateDocuments: (kind, {secret, ...query}) => {
      const driver = options.documentQueries?.[kind];
      if (!driver) throw new Error(`This runner does not read from ${kind}.`);
      const connection = options.secrets?.[secret];
      if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`);
      // like queryDatabase: only the pull of the next document is waiting
      return timedRequests(driver({...query, connection, signal: execution.control.signal}), waiting);
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
        waiting.resume();
        return await driver({...batch, connection, signal: execution.control.signal});
      } finally {
        waiting.stop();
        stopwatch.resume();
      }
    },
    deleteDocuments: async (kind, {secret, ...request}) => {
      const driver = options.documentDeletes?.[kind];
      if (!driver) throw new Error(`This runner does not delete from ${kind}.`);
      const connection = options.secrets?.[secret];
      if (!connection) throw new Error(`The secret "${secret}" does not exist in this runner.`);
      const target = `${request.database}.${request.collection}`;
      stopwatch.stop();
      waiting.resume();
      try {
        // a test run deletes nothing: it only counts what the filter matches (a read)
        const n = await driver({...request, connection, countOnly: dryRun, signal: execution.control.signal});
        if (!dryRun) return {deleted: n};
        log('info', `Test run: ${n} document(s) of ${target} match the filter ${JSON.stringify(request.filter)}; none deleted.`);
        return {notSent: true, matched: n};
      } finally {
        waiting.stop();
        stopwatch.resume();
      }
    },
    sendHttp: async request => {
      if (!options.http) throw new Error('This runner does not send HTTP requests.');
      if (dryRun) {
        const body = request.body === undefined ? '' : `, body ${mask(request.body.slice(0, BODY_EXCERPT))}${request.body.length > BODY_EXCERPT ? '…' : ''}`;
        log('info', `Test run: ${request.method} ${mask(request.url)} not sent${body}.`);
        return null;
      }
      // several requests at once: waiting runs while at least one is in flight
      if (inFlight++ === 0) waiting.resume();
      const t0 = performance.now();
      try {
        const response = await options.http({...request, signal: execution.control.signal});
        log('debug', `${request.method} ${mask(request.url)} → ${response.status} in ${Math.round(performance.now() - t0)} ms.`);
        return response;
      } catch (e) {
        throw new Error(mask(toError(e).message));
      } finally {
        if (--inFlight === 0) waiting.stop();
      }
    },
    mask,
    holding: (envelopes, held) => execution.memoryOf(node.id).holding(envelopes, held),
  };
}
