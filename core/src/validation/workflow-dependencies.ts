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
  /**
   * When the node is fed by the error port of another Workflow Invoker: the workflow that one calls. The call only
   * happens when that one fails (e.g. an error-handling workflow).
   */
  onErrorOf?: string;
  /** label of that other Workflow Invoker node */
  onErrorOfLabel?: string;
};

const INVOKER = 'workflow';
const ERROR_PORT = 'error';

const target = (config: Record<string, unknown>) => (typeof config.workflowId === 'string' ? config.workflowId : '');

/** Every Workflow Invoker call in the workflows (the ones without a workflow chosen are left out). */
export function workflowCalls(workflows: ExecutableWorkflow[]): WorkflowCall[] {
  return workflows.flatMap(wf => {
    const byId = new Map(wf.nodes.map(n => [n.id, n]));
    return wf.nodes
      .filter(n => n.type === INVOKER && target(n.config))
      .map(n => {
        const call: WorkflowCall = {from: wf.id ?? '', to: target(n.config), nodeId: n.id, nodeLabel: n.label};
        // fed by the error port of another Workflow Invoker: it handles that call's errors
        const upstream = wf.edges
          .filter(e => e.target === n.id && e.sourcePort === ERROR_PORT)
          .map(e => byId.get(e.source))
          .find(s => s?.type === INVOKER && target(s.config));
        return upstream ? {...call, onErrorOf: target(upstream.config), onErrorOfLabel: upstream.label} : call;
      });
  });
}

/** What the workflow calls (uses) and who calls it (used by), directly. */
export function workflowDependencies(workflows: ExecutableWorkflow[], id: string): {uses: WorkflowCall[]; usedBy: WorkflowCall[]} {
  const calls = workflowCalls(workflows);
  return {uses: calls.filter(c => c.from === id), usedBy: calls.filter(c => c.to === id && c.from !== id)};
}
