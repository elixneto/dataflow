import type {ComponentRun} from '#types/component-run.type';
import type {EnvelopeData} from '#types/envelope-data.type';
import type {ExecutableFlow} from '#types/executable-flow.type';
import type {ExecutableNode} from '#types/executable-node.type';
import type {RunMode} from '#types/run-mode.type';

/*
 * Pins and Run from here. A pinned node (test runs) does not need its input: what only feeds pinned nodes is skipped.
 * Run from here runs one component and what comes after it: the envelopes that reached it in the last run go straight
 * into its inputs. Nothing before it runs; an input of a later component fed from outside that part gets nothing.
 */

/** whether the node sends envelopes it already has instead of executing */
const replays = (node: ExecutableNode, mode: RunMode) => mode === 'validation' && Boolean(node.pinned);

/**
 * The nodes that do not need to run: everything they feed replays (or is skipped too). A node with no outgoing edge
 * (the End, a Discard) always runs; so does a node feeding at least one that executes.
 */
export function skippedNodes(wf: ExecutableFlow, mode: RunMode): Set<string> {
  const byId = new Map(wf.nodes.map(n => [n.id, n]));
  const targets = new Map<string, string[]>(wf.nodes.map(n => [n.id, []]));
  for (const e of wf.edges) targets.get(e.source)?.push(e.target);
  const needed = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const node of wf.nodes) {
      if (needed.has(node.id)) continue;
      const out = targets.get(node.id) ?? [];
      const feedsOne = out.some(t => needed.has(t) && !replays(byId.get(t)!, mode));
      if (out.length === 0 || feedsOne) {
        needed.add(node.id);
        grew = true;
      }
    }
  }
  return new Set(wf.nodes.filter(n => !needed.has(n.id)).map(n => n.id));
}

/** the node and everything after it */
export function downstreamOf(edges: ExecutableFlow['edges'], nodeId: string): Set<string> {
  const part = new Set([nodeId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      if (part.has(e.source) && !part.has(e.target)) {
        part.add(e.target);
        grew = true;
      }
    }
  }
  return part;
}

/** What Run from here needs, worked out from the last run: plain data (it is stored with the run). */
export type RunFromPlan = {
  nodeId: string;
  /** the component's name, for the record and its first log line */
  label: string;
  /** the envelopes that reached it in the last run, per input port (the first ones: a run keeps a sample) */
  inputs: Record<string, EnvelopeData[]>;
  /** how many reached each port in the last run */
  totals: Record<string, number>;
};

/**
 * Run from `nodeId`, with what reached it in the last run (`last`, its components); refused when nothing did. A
 * component with one input has its sample as one list; with several, per port.
 */
export function planRunFrom(wf: ExecutableFlow, nodeId: string, last: ComponentRun[]): {ok: true; plan: RunFromPlan} | {ok: false; error: string} {
  const node = wf.nodes.find(n => n.id === nodeId);
  if (!node) return {ok: false, error: 'The component is not in the flow.'};
  const ran = last.find(c => c.nodeId === nodeId);
  const totals = Object.fromEntries(Object.entries(ran?.inputs ?? {}).filter(([, n]) => n > 0));
  if (!ran || Object.keys(totals).length === 0) return {ok: false, error: `Nothing reached "${node.label}" in the last run: run the flow first.`};
  const ports = Object.keys(totals);
  const inputs = ran.inputSampleByPort
    ? Object.fromEntries(ports.map(p => [p, ran.inputSampleByPort![p] ?? []]))
    : {[ports[0]!]: ran.inputSample};
  return {ok: true, plan: {nodeId, label: node.label, inputs, totals}};
}

/** The flow Run from here runs: the component and what follows it, nothing before it. */
export function applyRunFrom(wf: ExecutableFlow, plan: RunFromPlan): ExecutableFlow {
  const part = downstreamOf(wf.edges, plan.nodeId);
  return {
    ...wf,
    nodes: wf.nodes.filter(n => part.has(n.id)),
    edges: wf.edges.filter(e => part.has(e.source) && part.has(e.target)),
  };
}
