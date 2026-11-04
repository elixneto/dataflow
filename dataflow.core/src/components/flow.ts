import {toError} from '#errors/normalize-error';
import {mergeFields} from '#envelope/envelope-data';
import type {ExpressionField} from '#types/expression-field.type';
import type {ComponentLogic} from '#types/component-logic.type';

/**
 * Workflow Invoker (in SnapLogic, Pipeline Execute): for each incoming envelope, runs another workflow, passing the
 * parameters of its Start (text or expression on the envelope) and, if checked, the envelope's DATA as input.
 * Each envelope that reaches the other workflow's End goes out of here with its DATA merged into the caller envelope's
 * (Override = only the other one's). If the other workflow fails, it is an error of the caller envelope and follows the "On error"
 * policy: with Divert, the error port can call a third workflow. Circular calls and more than 10 levels are blocked.
 */

export type InvokerParameter = ExpressionField & {name: string};

export function workflowInvokerConfig(config: Record<string, unknown>) {
  return {
    workflowId: typeof config.workflowId === 'string' ? config.workflowId : '',
    parameters: Array.isArray(config.parameters) ? (config.parameters as InvokerParameter[]) : [],
    sendEnvelope: config.sendEnvelope === true,
  };
}

export const workflowInvoker: ComponentLogic = {
  type: 'workflow',
  inputs: 1,
  outputs: 1,

  validate(config) {
    return workflowInvokerConfig(config).workflowId ? [] : ['has no workflow selected.'];
  },

  async* execute(inputs, config, ctx) {
    const {workflowId, parameters, sendEnvelope} = workflowInvokerConfig(config);
    let calls = 0;
    let outputs = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      calls += 1;
      let call: ReturnType<typeof ctx.invokeWorkflow> | undefined;
      try {
        // an empty field is left out: the other workflow uses the parameter's default
        const values: Record<string, string> = {};
        for (const p of parameters) {
          if (!p.expression && p.value === '') continue;
          const value = ctx.fieldValue(p, doc);
          if (value !== undefined && value !== null) values[p.name] = typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
        call = ctx.invokeWorkflow(workflowId, {parameters: values, input: sendEnvelope ? doc.DATA : undefined});
        let thisCall = 0;
        // waiting for the other workflow is not this one's active time
        for await (const data of ctx.waitEach(call.envelopes)) {
          thisCall += 1;
          yield {port: 'out-0', doc: mergeFields(doc, data, ctx.node.override)};
        }
        outputs += thisCall;
        const record = await ctx.wait(call.result);
        if (record.status === 'failed') {
          throw Object.assign(new Error(`The workflow "${record.run.workflow}" failed: ${record.error ?? 'no details'}`), {name: 'WorkflowError'});
        }
        ctx.log(record.status === 'completed' ? 'info' : 'warning',
          `Call ${calls}: "${record.run.workflow}" ${record.status.replace('-', ' ')} in ${record.durationMs} ms, ${thisCall} envelope(s) at the End.`);
      } catch (e) {
        yield {error: toError(e), doc};
      } finally {
        call?.cancel();
      }
    }
    ctx.log('info', `${calls} call(s), ${outputs} envelope(s) returned.`);
  },
};
