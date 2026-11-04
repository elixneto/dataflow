import type {ExecutableFlow} from '#types/executable-flow.type';

/** A call from one flow to another (a Flow Invoker node). */
export type FlowCall = {
  /** id of the calling flow */
  from: string;
  /** id of the called flow */
  to: string;
  /** the Flow Invoker node that calls it */
  nodeId: string;
  nodeLabel: string;
  /**
   * When the node is fed by the error port of another Flow Invoker: the flow that one calls. The call only
   * happens when that one fails (e.g. an error-handling flow).
   */
  onErrorOf?: string;
  /** label of that other Flow Invoker node */
  onErrorOfLabel?: string;
};

const INVOKER = 'flow';
const ERROR_PORT = 'error';

const target = (config: Record<string, unknown>) => (typeof config.flowId === 'string' ? config.flowId : '');

/** Every Flow Invoker call in the flows (the ones without a flow chosen are left out). */
export function flowCalls(flows: ExecutableFlow[]): FlowCall[] {
  return flows.flatMap(wf => {
    const byId = new Map(wf.nodes.map(n => [n.id, n]));
    return wf.nodes
      .filter(n => n.type === INVOKER && target(n.config))
      .map(n => {
        const call: FlowCall = {from: wf.id ?? '', to: target(n.config), nodeId: n.id, nodeLabel: n.label};
        // fed by the error port of another Flow Invoker: it handles that call's errors
        const upstream = wf.edges
          .filter(e => e.target === n.id && e.sourcePort === ERROR_PORT)
          .map(e => byId.get(e.source))
          .find(s => s?.type === INVOKER && target(s.config));
        return upstream ? {...call, onErrorOf: target(upstream.config), onErrorOfLabel: upstream.label} : call;
      });
  });
}

/** What the flow calls (uses) and who calls it (used by), directly. */
export function flowDependencies(flows: ExecutableFlow[], id: string): {uses: FlowCall[]; usedBy: FlowCall[]} {
  const calls = flowCalls(flows);
  return {uses: calls.filter(c => c.from === id), usedBy: calls.filter(c => c.to === id && c.from !== id)};
}
