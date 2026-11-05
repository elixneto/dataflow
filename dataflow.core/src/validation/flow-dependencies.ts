import type {ExecutableFlow} from '#types/executable-flow.type';
import {MAX_FLOW_DEPTH} from '#engine/constants';
import {componentSettings, settingVisible} from '../components/settings';
import {scriptImports} from '../scripts/script-path';
import {inputTypeRef} from '../scripts/type-shape';

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

/** The shortest chain of calls from one flow to another (ids, both ends included), or null when it does not reach it. */
export function callPath(calls: FlowCall[], from: string, to: string): string[] | null {
  const previous = new Map<string, string>([[from, '']]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    for (const c of calls) {
      if (c.from !== current) continue;
      if (c.to === to) {
        const chain = [to, current];
        for (let at = current; previous.get(at); at = previous.get(at)!) chain.push(previous.get(at)!);
        return chain.reverse();
      }
      if (!previous.has(c.to)) {
        previous.set(c.to, current);
        queue.push(c.to);
      }
    }
  }
  return null;
}

/**
 * Every circular chain of calls (the first flow repeated at the end: a → b → a), each once whatever flow it is read
 * from; the engine refuses each such call when it comes.
 */
export function callCycles(calls: FlowCall[]): string[][] {
  const seen = new Set<string>();
  const cycles: string[][] = [];
  for (const c of calls) {
    const back = c.from === c.to ? [c.to] : callPath(calls, c.to, c.from);
    if (!back) continue;
    const ring = c.from === c.to ? [c.from] : [c.from, ...back.slice(0, -1)];
    // the same ring read from another of its flows: kept once, starting from its smallest id
    const start = ring.indexOf([...ring].sort()[0]!);
    const key = [...ring.slice(start), ...ring.slice(0, start)].join('>');
    if (seen.has(key)) continue;
    seen.add(key);
    cycles.push([...ring, ring[0]!]);
  }
  return cycles;
}

/**
 * One call of a flow's call tree: the call, how deep (1 = the flow's own Flow Invokers), what the called flow calls in
 * turn; `cycle` when the called flow is already up the chain (its calls are not followed again), `tooDeep` past
 * MAX_FLOW_DEPTH (the engine refuses the call).
 */
export type CallTreeNode = {call: FlowCall; depth: number; cycle?: true; tooDeep?: true; children: CallTreeNode[]};

/** How many calls a tree holds at most (one that calls the same flows from many places grows fast); past it, `truncated`. */
export const MAX_CALL_TREE = 500;

/** What a flow calls, and what those call, down the chain: each call once per place it is made. */
export function callTree(calls: FlowCall[], root: string): {nodes: CallTreeNode[]; truncated: boolean} {
  let size = 0;
  let truncated = false;
  const grow = (from: string, chain: string[], depth: number): CallTreeNode[] => {
    const nodes: CallTreeNode[] = [];
    for (const call of calls.filter(c => c.from === from)) {
      if (size >= MAX_CALL_TREE) {
        truncated = true;
        break;
      }
      size += 1;
      const node: CallTreeNode = {call, depth, children: []};
      if (chain.includes(call.to)) node.cycle = true;
      else if (depth > MAX_FLOW_DEPTH) node.tooDeep = true;
      else node.children = grow(call.to, [...chain, call.to], depth + 1);
      nodes.push(node);
    }
    return nodes;
  };
  const nodes = grow(root, [root], 1);
  return {nodes, truncated};
}

/**
 * A project script a flow uses: imported by a TypeScript component's code (`import`), or named as a type by a setting
 * (`type`: the Start's input type, any setting of kind script-type that is in use).
 */
export type ScriptUse = {from: string; path: string; nodeId: string; nodeLabel: string; how: 'import' | 'type'};

/** Every script the flows use, once per component and script. */
export function flowScriptUses(flows: ExecutableFlow[]): ScriptUse[] {
  return flows.flatMap(wf =>
    wf.nodes.flatMap(n => {
      const uses = new Map<string, ScriptUse>();
      const add = (path: string, how: ScriptUse['how']) => {
        if (!uses.has(path)) uses.set(path, {from: wf.id ?? '', path, nodeId: n.id, nodeLabel: n.label, how});
      };
      if (n.type === 'typescript' && typeof n.config.code === 'string') scriptImports(n.config.code).forEach(path => add(path, 'import'));
      const fields = componentSettings(n.type);
      for (const field of fields.filter(f => f.kind === 'script-type' && settingVisible(f, n.config, fields))) {
        const ref = inputTypeRef(n.config[field.key]);
        if (ref) add(ref.path, 'type');
      }
      return [...uses.values()];
    }),
  );
}

/** What each script imports from the others: one per importing script and imported path. */
export function scriptLinks(scripts: {path: string; content: string}[]): {from: string; to: string}[] {
  return scripts.flatMap(s => scriptImports(s.content).filter(to => to !== s.path).map(to => ({from: s.path, to})));
}
