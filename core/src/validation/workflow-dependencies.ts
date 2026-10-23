import type {ExecutableWorkflow} from '#types/executable-workflow.type';

/** A call from one workflow to another (a Workflow Invoker node). */
export type WorkflowCall = {
  /** id of the calling workflow */
  from: string;
  /** id of the called workflow */
  to: string;
  /** the Workflow Invoker node that calls it */
  nodeId: string;
  nodeLabel: string;
};

/** Every Workflow Invoker call in the workflows (the ones without a workflow chosen are left out). */
export function workflowCalls(workflows: ExecutableWorkflow[]): WorkflowCall[] {
  return workflows.flatMap(wf => wf.nodes
    .filter(n => n.type === 'workflow' && typeof n.config.workflowId === 'string' && n.config.workflowId)
    .map(n => ({from: wf.id ?? '', to: n.config.workflowId as string, nodeId: n.id, nodeLabel: n.label})));
}

/** What the workflow calls (uses) and who calls it (used by), directly. */
export function workflowDependencies(workflows: ExecutableWorkflow[], id: string): {uses: WorkflowCall[]; usedBy: WorkflowCall[]} {
  const calls = workflowCalls(workflows);
  return {uses: calls.filter(c => c.from === id), usedBy: calls.filter(c => c.to === id && c.from !== id)};
}
