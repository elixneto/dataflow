import {toError} from '#errors/normalize-error';
import {mergeFields} from '#envelope/envelope-data';
import type {ExpressionField} from '#types/expression-field.type';
import type {ComponentLogic} from '#types/component-logic.type';
import type {ComponentContext} from '#types/component-context.type';
import type {ComponentOutput} from '#types/component-output.type';
import type {Envelope} from '#types/envelope.type';

/**
 * Flow Invoker (in SnapLogic, Pipeline Execute): for each incoming envelope, runs another flow, passing the
 * parameters of its Start (text or expression on the envelope) and, if "Send an input" is checked, an input: the
 * envelope's DATA or an expression on it (`{__requester__: $__requester__, count: $assets.length}`: only what the other
 * flow needs). The input sent is checked against the other flow's Start type first (ExecutableFlow.inputType): one that does not fit
 * is an error of the envelope, and the flow does not run. Circular calls and more than 10 levels are blocked. Two ways:
 *
 * - wait (default): each envelope that reaches the other flow's End goes out of here with its DATA merged into the
 *   caller envelope's (Override = only the other one's). If the other flow fails, it is an error of the caller envelope
 *   and follows the "On error" policy: with Divert, the error port can call a third flow.
 * - fire and forget: the envelope goes on as it came, at once, and joins a batch (Batch size, those with the same
 *   parameter values together); each full batch, and what is left at the end, is one run of the other flow: with "Send
 *   an input", the envelopes' inputs are its input (its Start: one envelope per item; an input that is a list adds its
 *   items); without it, the run starts with no
 *   input (once per batch). In a real run that run is queued as a run of its own (a supervisor runs it later, its
 *   status and errors its own; its parent is this run). In a test run nothing is queued: it runs beside this one,
 *   without holding the envelopes, and shows under the Flow Invoker as a called run. On error is always Throw: the
 *   calls answer nothing to continue or divert with, so an envelope that would not start (circular, input type) stops
 *   the run. A batch that cannot be queued is logged (its envelopes already went on) and the rest go on.
 */

export type InvokerParameter = ExpressionField & {name: string};

export type InvokerCall = 'wait' | 'fire-and-forget';

export type InvokerInputSource = 'data' | 'expression';

/** envelopes per fire and forget run, by default; at most MAX_BATCH_SIZE */
export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 10_000;

export function flowInvokerConfig(config: Record<string, unknown>) {
  const size = Number(config.batchSize);
  const input = config.input as ExpressionField | undefined;
  return {
    flowId: typeof config.flowId === 'string' ? config.flowId : '',
    parameters: Array.isArray(config.parameters) ? (config.parameters as InvokerParameter[]) : [],
    sendEnvelope: config.sendEnvelope === true,
    inputSource: (config.inputSource === 'expression' ? 'expression' : 'data') as InvokerInputSource,
    input: {value: typeof input?.value === 'string' ? input.value : '', expression: true} as ExpressionField,
    call: (config.call === 'fire-and-forget' ? 'fire-and-forget' : 'wait') as InvokerCall,
    batchSize: Number.isInteger(size) && size >= 1 ? Math.min(size, MAX_BATCH_SIZE) : DEFAULT_BATCH_SIZE,
  };
}

/** the Start parameters of the other flow, from the envelope: an empty field is left out (it takes the default) */
function parameterValues(parameters: InvokerParameter[], doc: Envelope, ctx: ComponentContext) {
  const values: Record<string, string> = {};
  for (const p of parameters) {
    if (!p.expression && p.value === '') continue;
    const value = ctx.fieldValue(p, doc);
    if (value !== undefined && value !== null) values[p.name] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return values;
}

/** what a call sends as the other flow's input: nothing, the envelope's DATA or the expression's value on it */
function inputOf({sendEnvelope, inputSource, input}: ReturnType<typeof flowInvokerConfig>, ctx: ComponentContext) {
  return (doc: Envelope): unknown => (!sendEnvelope ? undefined : inputSource === 'expression' ? ctx.fieldValue(input, doc) : doc.DATA);
}

export const flowInvoker: ComponentLogic = {
  type: 'flow',
  inputs: 1,
  outputs: 1,
  usesOverride: true,
  settings: [
    {key: 'flowId', label: 'Flow', kind: 'flow', required: true},
    {
      key: 'call', label: 'Call', kind: 'select', default: 'wait',
      options: [
        {value: 'wait', label: 'Wait for the result'},
        {value: 'fire-and-forget', label: 'Fire and forget (a run of its own per batch)'},
      ],
    },
    {
      key: 'batchSize', label: 'Batch size', kind: 'number', default: DEFAULT_BATCH_SIZE, min: 1, max: MAX_BATCH_SIZE,
      when: {key: 'call', values: ['fire-and-forget']},
    },
    {
      key: 'parameters', label: 'Parameters', kind: 'list', itemLabel: 'parameter', parametersOf: 'flowId',
      item: [
        {key: 'name', label: 'Name', kind: 'text', required: true},
        {key: 'value', label: 'Value', kind: 'value', spread: true, default: {value: '', expression: false}},
      ],
    },
    {key: 'sendEnvelope', label: 'Send an input to the flow', kind: 'boolean'},
    {
      key: 'inputSource', label: 'Input', kind: 'select', default: 'data',
      options: [{value: 'data', label: "The envelope's DATA"}, {value: 'expression', label: 'An expression'}],
      when: {key: 'sendEnvelope', values: [true]},
    },
    {
      key: 'input', label: 'Input expression', kind: 'value', default: {value: '', expression: true},
      placeholder: '{id: $id, total: $price * $quantity}',
      when: [{key: 'sendEnvelope', values: [true]}, {key: 'inputSource', values: ['expression']}],
    },
  ],

  validate(config) {
    const {flowId, call, sendEnvelope, inputSource, input} = flowInvokerConfig(config);
    if (!flowId) return ['has no flow selected.'];
    if (sendEnvelope && inputSource === 'expression' && !input.value.trim()) return ['has no input expression.'];
    return call === 'fire-and-forget' && (config.onError === 'continue' || config.onError === 'divert')
      ? ['fires and forgets: its On error is always Throw (the calls answer nothing to continue or divert with).']
      : [];
  },

  fixedOnError: config => (flowInvokerConfig(config).call === 'fire-and-forget' ? 'throw' : undefined),

  async* execute(inputs, config, ctx) {
    const settings = flowInvokerConfig(config);
    const {flowId, parameters, call: how, batchSize} = settings;
    const input = inputOf(settings, ctx);
    if (how === 'fire-and-forget') {
      yield* fireAndForget(inputs['in-0'] ?? [], {flowId, parameters, input, sends: settings.sendEnvelope, batchSize}, ctx);
      return;
    }
    let calls = 0;
    let outputs = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      calls += 1;
      let call: ReturnType<typeof ctx.invokeFlow> | undefined;
      try {
        call = ctx.invokeFlow(flowId, {parameters: parameterValues(parameters, doc, ctx), input: input(doc)});
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
        ctx.log(record.status === 'completed' ? 'debug' : 'warning',
          `Call ${calls}: "${record.run.flow}" ${record.status.replace('-', ' ')} in ${record.durationMs} ms, ${thisCall} envelope(s) at the End.`);
      } catch (e) {
        yield {error: toError(e), doc};
      } finally {
        call?.cancel();
      }
    }
    ctx.log('debug', `${calls} call(s), ${outputs} envelope(s) returned.`);
  },
};

/**
 * Fire and forget: each envelope goes on as it came and joins the batch of its parameter values. A full batch, and
 * each one left at the end, is one call (the batch its input, with Send an input): a real run queues it as a run of its
 * own; a test run runs it beside this one (its End's envelopes go nowhere) and waits for them all at the end, so its
 * record shows them. A called run that fails is its own failure, not this run's; a batch that cannot be queued is an
 * error line of this component (the runner logs it too) and the others go on.
 *
 * At most `ctx.maxFireAndForgetRuns` runs (the open batches count): once the next full batch would leave no room, the
 * batches stop closing on their size and take the rest of the envelopes (none is lost; a warning says so). Parameter
 * values that need a new batch past the limit stop the run (On error is Throw).
 */
async function* fireAndForget(source: AsyncIterable<Envelope>, {flowId, parameters, input, sends, batchSize}: {flowId: string; parameters: InvokerParameter[]; input: (doc: Envelope) => unknown; sends: boolean; batchSize: number}, ctx: ComponentContext): AsyncGenerator<ComponentOutput> {
  type Batch = {parameters: Record<string, string>; items: unknown[]; count: number};
  const batches = new Map<string, Batch>();
  const beside: Promise<unknown>[] = [];
  const limit = ctx.maxFireAndForgetRuns ?? Number.POSITIVE_INFINITY;
  let runs = 0;
  let sent = 0;
  let lost = 0;
  let capped = false;
  const fire = async (batch: Batch) => {
    const call = {parameters: batch.parameters, input: sends ? batch.items : undefined};
    try {
      if (ctx.run.mode === 'execution') {
        await ctx.queueFlow(flowId, call);
      } else {
        const running = ctx.invokeFlow(flowId, {...call, fireAndForget: true});
        beside.push((async () => {
          for await (const _ of running.envelopes) { /* its End's envelopes go nowhere */ }
          await running.result;
        })().catch(() => {}));
      }
      runs += 1;
      sent += batch.count;
    } catch (e) {
      lost += batch.count;
      ctx.log('error', `A batch of ${batch.count} envelope(s) was not ${ctx.run.mode === 'execution' ? 'queued' : 'run'}: ${toError(e).message}`);
    }
  };

  for await (const doc of source) {
    const values = parameterValues(parameters, doc, ctx);
    const data = input(doc);
    // On error is Throw: an envelope whose call would not start stops the run here
    ctx.checkFlowCall(flowId, data);
    const key = JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
    let batch = batches.get(key);
    if (!batch) {
      if (runs + batches.size >= limit) {
        throw new Error(`More than ${limit} fire and forget runs: these parameter values need a batch of their own past the limit (4 × the server's workers).`);
      }
      batch = {parameters: values, items: [], count: 0};
      batches.set(key, batch);
    }
    // a full batch kept open at the limit takes one more: the runs left are fewer than the batches would need
    if (batch.count >= batchSize && !capped) {
      capped = true;
      ctx.log('warning', `Limit of ${limit} fire and forget runs reached (4 × the server's workers): the last batches take more than ${batchSize} envelopes each.`);
    }
    if (sends) batch.items.push(...(Array.isArray(data) ? data : [data]));
    batch.count += 1;
    yield {port: 'out-0', doc};
    // firing it would leave no room for the next batch of these values: it stays open and grows instead
    if (batch.count >= batchSize && runs + batches.size < limit) {
      batches.delete(key);
      await fire(batch);
    }
  }
  for (const batch of batches.values()) await fire(batch);
  if (beside.length) await ctx.wait(Promise.all(beside));
  ctx.log('debug', ctx.run.mode === 'execution'
    ? `${sent} envelope(s) in ${runs} run(s) queued (fire and forget, batches of up to ${batchSize})${lost ? `; ${lost} not queued` : ''}.`
    : `${sent} envelope(s) in ${runs} call(s) fired beside this test run (a real run queues each batch as a run of its own).`);
}
