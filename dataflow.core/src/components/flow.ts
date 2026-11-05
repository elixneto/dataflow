import {toError} from '#errors/normalize-error';
import {mergeFields} from '#envelope/envelope-data';
import type {ExpressionField} from '#types/expression-field.type';
import type {ComponentLogic} from '#types/component-logic.type';

/**
 * Flow Invoker (in SnapLogic, Pipeline Execute): for each incoming envelope, runs another flow, passing the
 * parameters of its Start (text or expression on the envelope) and, if checked, the envelope's DATA as input.
 * Each envelope that reaches the other flow's End goes out of here with its DATA merged into the caller envelope's
 * (Override = only the other one's). If the other flow fails, it is an error of the caller envelope and follows the "On error"
 * policy: with Divert, the error port can call a third flow. The DATA sent is checked against the other flow's Start
 * type first (ExecutableFlow.inputType): one that does not fit is an error of the envelope, and the flow does not run.
 * Circular calls and more than 10 levels are blocked.
 */

export type InvokerParameter = ExpressionField & {name: string};

export function flowInvokerConfig(config: Record<string, unknown>) {
  return {
    flowId: typeof config.flowId === 'string' ? config.flowId : '',
    parameters: Array.isArray(config.parameters) ? (config.parameters as InvokerParameter[]) : [],
    sendEnvelope: config.sendEnvelope === true,
  };
}

export const flowInvoker: ComponentLogic = {
  type: 'flow',
  inputs: 1,
  outputs: 1,
  usesOverride: true,
  settings: [
    {key: 'flowId', label: 'Flow', kind: 'flow', required: true},
    {
      key: 'parameters', label: 'Parameters', kind: 'list', itemLabel: 'parameter', parametersOf: 'flowId',
      item: [
        {key: 'name', label: 'Name', kind: 'text', required: true},
        {key: 'value', label: 'Value', kind: 'value', spread: true, default: {value: '', expression: false}},
      ],
    },
    {key: 'sendEnvelope', label: "Send the envelope's DATA as the flow's input", kind: 'boolean'},
  ],

  validate(config) {
    return flowInvokerConfig(config).flowId ? [] : ['has no flow selected.'];
  },

  async* execute(inputs, config, ctx) {
    const {flowId, parameters, sendEnvelope} = flowInvokerConfig(config);
    let calls = 0;
    let outputs = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      calls += 1;
      let call: ReturnType<typeof ctx.invokeFlow> | undefined;
      try {
        // an empty field is left out: the other flow uses the parameter's default
        const values: Record<string, string> = {};
        for (const p of parameters) {
          if (!p.expression && p.value === '') continue;
          const value = ctx.fieldValue(p, doc);
          if (value !== undefined && value !== null) values[p.name] = typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
        call = ctx.invokeFlow(flowId, {parameters: values, input: sendEnvelope ? doc.DATA : undefined});
        let thisCall = 0;
        // waiting for the other flow is not this one's active time
        for await (const data of ctx.waitEach(call.envelopes)) {
          thisCall += 1;
          yield {port: 'out-0', doc: mergeFields(doc, data, ctx.node.override)};
        }
        outputs += thisCall;
        const record = await ctx.wait(call.result);
        if (record.status === 'failed') {
          throw Object.assign(new Error(`The flow "${record.run.flow}" failed: ${record.error ?? 'no details'}`), {name: 'FlowError'});
        }
        ctx.log(record.status === 'completed' ? 'info' : 'warning',
          `Call ${calls}: "${record.run.flow}" ${record.status.replace('-', ' ')} in ${record.durationMs} ms, ${thisCall} envelope(s) at the End.`);
      } catch (e) {
        yield {error: toError(e), doc};
      } finally {
        call?.cancel();
      }
    }
    ctx.log('info', `${calls} call(s), ${outputs} envelope(s) returned.`);
  },
};
