import {Channel} from '../channel';
import {MAX_SUB_RUNS, MAX_WORKFLOW_DEPTH} from '#engine/constants';
import {workflowRunner} from '#engine/workflow-runner';
import type {WorkflowExecution} from '#engine/workflow-execution';
import type {ComponentContext} from '#types/component-context.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {ExecutableNode} from '#types/executable-node.type';

type Invoke = ComponentContext['invokeWorkflow'];

/**
 * Runs another workflow for the Workflow Invoker (`ctx.invokeWorkflow`). Blocks circular calls and chains longer than
 * MAX_WORKFLOW_DEPTH; the child stops with this run. The DATA of each envelope that reaches the child's End comes out in `envelopes`.
 */
export function invokeWorkflow(execution: WorkflowExecution, node: ExecutableNode, workflowId: string, {parameters: values, input}: Parameters<Invoke>[1]): ReturnType<Invoke> {
  const {wf, options, run, control} = execution;
  const child = options.workflows?.[workflowId];
  if (!child) throw new Error(`The called workflow (${workflowId}) was not found.`);
  const chain = [...(options.chain ?? [wf.id ?? wf.workflow]), workflowId];
  if (chain.slice(0, -1).includes(workflowId)) {
    const name = (id: string) => options.workflows?.[id]?.workflow ?? (id === wf.id ? wf.workflow : id);
    throw new Error(`Circular workflow call: ${chain.map(name).join(' → ')}.`);
  }
  if (chain.length > MAX_WORKFLOW_DEPTH + 1) {
    throw new Error(`More than ${MAX_WORKFLOW_DEPTH} workflows called in sequence.`);
  }
  // the child stops when this run stops, or when the caller gives up reading
  const childControl = new AbortController();
  const cancel = () => childControl.abort();
  control.signal.addEventListener('abort', cancel);
  const queue = new Channel<EnvelopeData>();
  const rec = execution.recordOf(node.id);
  const result = workflowRunner(child, {
    ...options,
    id: crypto.randomUUID(),
    parameterValues: values,
    input,
    signal: childControl.signal,
    // the timeout is this run's (which cancels the child along with it)
    timeoutMs: undefined,
    parentId: run.id,
    chain,
    onReachEnd: doc => queue.send(doc.DATA),
  }).then(record => {
    const list = (rec.subRuns ??= []);
    if (list.length < MAX_SUB_RUNS) {
      list.push({id: record.run.id, workflow: record.run.workflow, status: record.status, durationMs: record.durationMs, ...(record.error ? {error: record.error} : {})});
    }
    return record;
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
