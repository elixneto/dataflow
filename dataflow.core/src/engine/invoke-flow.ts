import {Channel} from '../channel';
import {MAX_SUB_RUNS, MAX_FLOW_DEPTH, SUB_RUN_SAMPLE_SIZE} from '#engine/constants';
import {flowRunner} from '#engine/flow-runner';
import {inputIssues} from '../scripts/type-shape';
import type {FlowExecution} from '#engine/flow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {ComponentRun, SubRun} from '#types/component-run.type';
import type {RunProgress, RunRecord} from '#types/run-record.type';

type Invoke = ComponentContext['invokeFlow'];

/**
 * What both kinds of call check first: a circular call, a chain longer than MAX_FLOW_DEPTH, a flow that is not there or
 * cannot be called, an input that does not fit its Start type (then the flow does not run: an error of the envelope).
 */
export function checkedCall(execution: FlowExecution, flowId: string, input: unknown) {
  const {wf, options} = execution;
  // a circular call first: the root flow is not among the callable ones (the run's own), so it would read as not found
  const chain = [...(options.chain ?? [wf.id ?? wf.flow]), flowId];
  if (chain.slice(0, -1).includes(flowId)) {
    const name = (id: string) => options.flows?.[id]?.flow ?? (id === chain[0] ? (options.rootName ?? wf.flow) : id);
    throw new Error(`Circular flow call: ${chain.map(name).join(' → ')}.`);
  }
  if (chain.length > MAX_FLOW_DEPTH + 1) {
    throw new Error(`More than ${MAX_FLOW_DEPTH} flows called in sequence.`);
  }
  const child = options.flows?.[flowId];
  if (!child) throw new Error(`The called flow (${flowId}) was not found.`);
  if (child.unavailable) throw new Error(`The flow "${child.flow}" cannot be called: ${child.unavailable}`);
  if (input !== undefined && child.inputType) {
    const issues = inputIssues(input, child.inputType.shape);
    if (issues.length) {
      throw Object.assign(new Error(`The input does not fit ${child.inputType.name} (the Start of "${child.flow}"): ${issues.join(' ')}`), {name: 'InputTypeError'});
    }
  }
  return {chain, child};
}

/**
 * Queues another flow as a run of its own (the Flow Invoker's fire and forget, in a real run), after the same checks
 * as a call it waits for; the runner (RunOptions.queueFlow) stores it for a supervisor. Its entry in the caller's
 * `subRuns` says it was queued, with its id (its record is its own run's).
 */
export async function queueFlow(execution: FlowExecution, node: ExecutableNode, flowId: string, {parameters, input}: {parameters: Record<string, string>; input?: unknown}): Promise<{id: string}> {
  const {wf, options} = execution;
  const {chain, child} = checkedCall(execution, flowId, input);
  if (!options.queueFlow) throw new Error('This runner does not queue runs: fire and forget needs a server.');
  const queued = await options.queueFlow({
    flowId, parameters, ...(input !== undefined ? {input} : {}), chain, rootName: options.rootName ?? wf.flow, nodeId: node.id, nodeLabel: node.label,
  });
  const list = (execution.recordOf(node.id).subRuns ??= []);
  if (list.length < MAX_SUB_RUNS) list.push({id: queued.id, flow: child.flow, status: 'queued', durationMs: 0, fireAndForget: true, ...(Array.isArray(input) ? {envelopes: input.length} : {})});
  return queued;
}

/**
 * Runs another flow for the Flow Invoker (`ctx.invokeFlow`). Blocks circular calls and chains longer than
 * MAX_FLOW_DEPTH; the child stops with this run. The input is checked against the child's Start type first: when it does
 * not fit, the child does not run and the call is an error (the caller envelope's, on the On error policy). The DATA of each envelope that reaches the child's End comes out in `envelopes`.
 * The child's record (as it goes, then as it ended) is kept in the caller's `subRuns`, for the first MAX_SUB_RUNS calls,
 * with its samples cut to SUB_RUN_SAMPLE_SIZE: the parent's panel shows the child's logs, errors and metrics from it.
 */
export function invokeFlow(execution: FlowExecution, node: ExecutableNode, flowId: string, {parameters: values, input, fireAndForget}: Parameters<Invoke>[1]): ReturnType<Invoke> {
  const {wf, options, run, control} = execution;
  const {chain, child} = checkedCall(execution, flowId, input);
  // the child stops when this run stops, or when the caller gives up reading
  const childControl = new AbortController();
  const cancel = () => childControl.abort();
  control.signal.addEventListener('abort', cancel);
  const queue = new Channel<EnvelopeData>();
  const id = crypto.randomUUID();
  const list = (execution.recordOf(node.id).subRuns ??= []);
  // the call's entry in the caller's record, live while the child runs; past the cap, only the child runs
  const entry: SubRun | undefined = list.length < MAX_SUB_RUNS
    ? {id, flow: child.flow, status: 'running', durationMs: 0, ...(fireAndForget ? {fireAndForget: true as const, ...(Array.isArray(input) ? {envelopes: input.length} : {})} : {})}
    : undefined;
  if (entry) list.push(entry);
  const result = flowRunner(child, {
    ...options,
    id,
    parameterValues: values,
    input,
    signal: childControl.signal,
    // the timeout is this run's (which cancels the child along with it)
    timeoutMs: undefined,
    parentId: run.id,
    chain,
    rootName: options.rootName ?? wf.flow,
    onReachEnd: doc => queue.send(doc.DATA),
    // the child's progress goes into its entry (the parent's progress carries it), never out as the parent's
    onProgress: entry
      ? progress => {
        entry.durationMs = progress.durationMs;
        entry.record = trimSamples(progress);
      }
      : undefined,
  }).then(record => {
    if (entry) {
      Object.assign(entry, {status: record.status, durationMs: record.durationMs, ...(record.error ? {error: record.error} : {}), record: trimSamples(record)});
    }
    return record;
  }, (e: unknown) => {
    if (entry) Object.assign(entry, {status: 'failed', error: e instanceof Error ? e.message : String(e)});
    throw e;
  }).finally(() => {
    control.signal.removeEventListener('abort', cancel);
    queue.close();
  });
  return {
    envelopes: queue,
    result,
    cancel: () => {
      cancel();
      queue.abort();
    },
  };
}

/** the child's record with up to SUB_RUN_SAMPLE_SIZE envelopes per port (its logs, counts and times whole) */
function trimSamples<T extends RunRecord | RunProgress>(record: T): T {
  const cut = (sample: EnvelopeData[]) => sample.slice(0, SUB_RUN_SAMPLE_SIZE);
  const cutPorts = (ports: Record<string, EnvelopeData[]>) => Object.fromEntries(Object.entries(ports).map(([port, sample]) => [port, cut(sample)]));
  const components: ComponentRun[] = record.components.map(c => ({
    ...c,
    inputSample: cut(c.inputSample),
    outputSample: cutPorts(c.outputSample),
    ...(c.inputSampleByPort ? {inputSampleByPort: cutPorts(c.inputSampleByPort)} : {}),
  }));
  return {...record, components};
}
