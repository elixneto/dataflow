import {COMPONENTS} from '../components';
import {END, START} from '#engine/constants';

/*
 * A component's ports and who may connect to what: the one place for it. The editor draws the ports and refuses an
 * edge with these; the runner refuses a flow that breaks them (a flow may come from the API or a file, not only the
 * canvas).
 *
 * Ports: inputs in-0, in-1... and outputs out-0, out-1... (the error port is apart). A component with a chosen number
 * of ports reads it from the config, within its limits; the Router has one output per case and the else. The Start has
 * only an output and the End only an input.
 *
 * Edges: every port takes several. An output sends each envelope to all its edges (each path gets its own copy); an
 * input joins its edges in arrival order. A component whose inputs mean different things (Lookup) takes one edge on each
 * (single). No component connects to itself, the same two ports are not connected twice, and the Start never goes
 * straight to the End.
 */

/**
 * label: the port's name, when it has one (Filter's true and false).
 * optional: an output that may stay unconnected (what goes out through it is dropped), e.g. Filter's false.
 * single: the port takes one edge only (Lookup's inputs); every other port takes several.
 */
export type PortInfo = {id: string; label?: string; optional?: boolean; single?: boolean};

export type PortSide = 'source' | 'target';

const chosen = (config: Record<string, unknown>, limits: {min: number; max: number; key: string}) => {
  const n = Math.round(Number(config[limits.key] ?? limits.min));
  return Math.min(limits.max, Math.max(limits.min, Number.isFinite(n) ? n : limits.min));
};

const label = (labels: string[] | undefined, i: number) => (labels?.[i] ? {label: labels[i]} : {});

export function inputPorts(type: string, config: Record<string, unknown> = {}): PortInfo[] {
  if (type === START) return [];
  if (type === END) return [{id: 'in-0'}];
  const logic = COMPONENTS[type];
  if (!logic) return [];
  const total = logic.variableInputs ? chosen(config, logic.variableInputs) : logic.inputs;
  return Array.from({length: total}, (_, i) => ({id: `in-${i}`, ...label(logic.inputLabels, i), ...(logic.singleEdgeInputs ? {single: true} : {})}));
}

export function outputPorts(type: string, config: Record<string, unknown> = {}): PortInfo[] {
  if (type === START) return [{id: 'out-0'}];
  if (type === END) return [];
  const logic = COMPONENTS[type];
  if (!logic) return [];
  const optional = typeof logic.optionalOutputs === 'function' ? logic.optionalOutputs(config) : (logic.optionalOutputs ?? []);
  const fromConfig = logic.outputsFromConfig?.(config);
  const labels = fromConfig?.map(o => o.label) ?? logic.outputLabels;
  const total = fromConfig?.length ?? (logic.variableOutputs ? chosen(config, logic.variableOutputs) : logic.outputs);
  return Array.from({length: total}, (_, i) => {
    const id = `out-${i}`;
    return {id, ...label(labels, i), ...(optional.includes(id) ? {optional: true} : {})};
  });
}

/** the error port's id: where a component on Divert sends the envelopes that fail in it (with DATA.errors) */
export const ERROR_PORT = 'error';

/**
 * The error port of a component with this config: there only while its On error is Divert (config.onError), and never on
 * the Start or the End. Like any output it takes several edges. Undefined when there is none.
 */
export function errorPort(type: string, config: Record<string, unknown> = {}): PortInfo | undefined {
  if (type === START || type === END || !COMPONENTS[type]) return undefined;
  return config.onError === 'divert' ? {id: ERROR_PORT} : undefined;
}

/**
 * Edges out of an error port that is not there (the component is not on Divert): the runner refuses them, as the
 * envelopes would never go that way. `nodeOf` gives a node's type and config. Without the component's name (the caller
 * puts it in front).
 */
export function errorEdgeIssues(
  edges: PortEdge[],
  nodeOf: (nodeId: string) => {type: string; config: Record<string, unknown>} | undefined,
): {nodeId: string; message: string}[] {
  const sources = [...new Set(edges.filter(e => e.sourcePort === ERROR_PORT).map(e => e.source))];
  return sources
    .filter(id => {
      const node = nodeOf(id);
      return !node || !errorPort(node.type, node.config);
    })
    .map(nodeId => ({nodeId, message: 'has an edge out of its error port, but its On error is not Divert.'}));
}

/** whether this port of a component of this type takes several edges (all but the single ones, like Lookup's inputs) */
export function takesSeveral(type: string | undefined, side: PortSide, port: string | null | undefined): boolean {
  if (!type) return true;
  return !(side === 'source' ? outputPorts(type) : inputPorts(type)).some(p => p.id === port && p.single);
}

export type PortEdge = {source: string; sourcePort: string; target: string; targetPort: string};

/** a node as the port rules read it: its component type and config */
export type PortNode = {type: string; config: Record<string, unknown>};

/**
 * Whether a node has the port on that side, with its config as it is now (a Lookup without its not found output, a
 * Router with one case less, On error not on Divert: no error port). A type the core does not know keeps its edges.
 */
export function hasPort(node: PortNode, side: PortSide, port: string): boolean {
  if (node.type !== START && node.type !== END && !COMPONENTS[node.type]) return true;
  if (side === 'target') return inputPorts(node.type, node.config).some(p => p.id === port);
  return outputPorts(node.type, node.config).some(p => p.id === port) || errorPort(node.type, node.config)?.id === port;
}

/** the edges whose ports still exist (and whose nodes do): what a changed config leaves connected */
export function withoutDanglingEdges<E extends PortEdge>(edges: E[], nodeOf: (id: string) => PortNode | undefined): E[] {
  return edges.filter(e => {
    const source = nodeOf(e.source);
    const target = nodeOf(e.target);
    return !!source && !!target && hasPort(source, 'source', e.sourcePort) && hasPort(target, 'target', e.targetPort);
  });
}

/**
 * Why `edge` may not be added next to `edges` (undefined: it may). `typeOf` gives a node's component type. The message
 * has no component name (the caller puts it in front, or shows it on the canvas).
 */
export function connectionProblem(edge: PortEdge, edges: PortEdge[], typeOf: (nodeId: string) => string | undefined): string | undefined {
  if (edge.source === edge.target) return 'A component does not connect to itself.';
  if (typeOf(edge.source) === START && typeOf(edge.target) === END) return 'The Start does not go straight to the End.';
  if (edges.some(e => e.source === edge.source && e.sourcePort === edge.sourcePort && e.target === edge.target && e.targetPort === edge.targetPort)) {
    return 'These two ports are already connected.';
  }
  if (!takesSeveral(typeOf(edge.source), 'source', edge.sourcePort) && edges.some(e => e.source === edge.source && e.sourcePort === edge.sourcePort)) {
    return 'This output already goes to an input.';
  }
  if (!takesSeveral(typeOf(edge.target), 'target', edge.targetPort) && edges.some(e => e.target === edge.target && e.targetPort === edge.targetPort)) {
    return 'This input takes one edge only.';
  }
  return undefined;
}
