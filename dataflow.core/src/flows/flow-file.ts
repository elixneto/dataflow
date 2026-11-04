import {parse, stringify} from 'yaml';
import {END, START} from '#engine/constants';
import type {ExecutableEdge} from '#types/executable-edge.type';
import type {ExecutableFlow} from '#types/executable-flow.type';
import {startParameters} from '../components/start';
import {errorEdgeIssues} from '#validation/ports';
import {portConnectionIssues} from '#validation/port-connections';

/*
 * A flow as a file (YAML): what Download gives and Upload reads, and what the server can keep. One description, here,
 * for all of them. It has the components with their config and where they are on the canvas, the edges (the error
 * port's too), and the groups. No secret value is ever in it: a sensitive setting only names a project secret, and a
 * connection is a profile's id. The parameters are the Start's (in its config). `version` is the file's format: a
 * change to it gets a new number, and reading an older one converts it.
 */

export const FLOW_FILE_VERSION = 1;

export type Point = {x: number; y: number};

export type FlowFileNode = {
  id: string;
  type: string;
  /** its name on the canvas (empty: the component's own) */
  label?: string;
  position: Point;
  config: Record<string, unknown>;
  outputKey?: string;
  disabled?: boolean;
  pinned?: boolean;
  notes?: string;
};

export type FlowFileGroup = {id: string; title: string; color: string; position: Point; size: {width: number; height: number}};

export type FlowFile = {
  version: typeof FLOW_FILE_VERSION;
  id?: string;
  name: string;
  nodes: FlowFileNode[];
  edges: ExecutableEdge[];
  groups?: FlowFileGroup[];
};

/** the file's name for a flow name: lower case, no accents, words joined by "-" (`flow` when nothing is left) */
export function flowFileName(name: string): string {
  const slug = name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'flow'}.yaml`;
}

/** the flow as YAML: multi-line text (code, SQL, a pipeline) as literal blocks, so it reads well and diffs line by line */
export function flowToYaml(file: FlowFile): string {
  const lean: FlowFile = {
    version: FLOW_FILE_VERSION,
    ...(file.id ? {id: file.id} : {}),
    name: file.name,
    nodes: file.nodes.map(n => ({
      id: n.id,
      type: n.type,
      ...(n.label ? {label: n.label} : {}),
      position: {x: Math.round(n.position.x), y: Math.round(n.position.y)},
      config: n.config,
      ...(n.outputKey ? {outputKey: n.outputKey} : {}),
      ...(n.disabled ? {disabled: true} : {}),
      ...(n.pinned ? {pinned: true} : {}),
      ...(n.notes ? {notes: n.notes} : {}),
    })),
    edges: file.edges.map(e => ({source: e.source, sourcePort: e.sourcePort, target: e.target, targetPort: e.targetPort})),
    ...(file.groups?.length ? {groups: file.groups} : {}),
  };
  return stringify(lean, {blockQuote: 'literal', lineWidth: 0, indent: 2});
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPoint = (v: unknown): v is Point => isObject(v) && Number.isFinite(v.x) && Number.isFinite(v.y);

export type FlowFileResult = {ok: true; value: FlowFile} | {ok: false; errors: string[]};

/** reads a flow file: the flow, or what is wrong with it (nothing half-read) */
export function flowFromYaml(text: string): FlowFileResult {
  let data: unknown;
  try {
    data = parse(text);
  } catch (e) {
    return {ok: false, errors: [`Not valid YAML: ${e instanceof Error ? e.message : String(e)}`]};
  }
  return validateFlowFile(data);
}

/**
 * Checks a flow file already parsed (YAML, or the JSON the editor saves): its shape (the version, a name, the nodes with
 * an id, a type and a position, one Start and one End, edges between nodes of the flow, the groups) and the connection
 * rules (validation/ports.ts). A component's own settings may be incomplete: a flow being built is saved as it is.
 */
export function validateFlowFile(data: unknown): FlowFileResult {
  if (!isObject(data)) return {ok: false, errors: ['Not a flow file.']};

  const errors: string[] = [];
  if (data.version !== FLOW_FILE_VERSION) errors.push(`Unknown file version ${JSON.stringify(data.version)} (this app reads ${FLOW_FILE_VERSION}).`);
  if (typeof data.name !== 'string' || !data.name.trim()) errors.push('The flow has no name.');
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  if (!Array.isArray(data.nodes)) errors.push('The flow has no nodes.');
  const ids = new Set<string>();
  nodes.forEach((n: unknown, i) => {
    if (!isObject(n) || typeof n.id !== 'string' || !n.id || typeof n.type !== 'string' || !n.type) {
      errors.push(`Node ${i + 1} has no id or type.`);
      return;
    }
    if (ids.has(n.id)) errors.push(`The node id "${n.id}" is used more than once.`);
    ids.add(n.id);
    if (!isPoint(n.position)) errors.push(`Node "${n.id}" has no position.`);
    if (n.config !== undefined && !isObject(n.config)) errors.push(`Node "${n.id}" has a config that is not an object.`);
  });
  for (const type of [START, END]) {
    const count = nodes.filter((n: unknown) => isObject(n) && n.type === type).length;
    if (count !== 1) errors.push(`The flow needs exactly one ${type === START ? 'Start' : 'End'} (it has ${count}).`);
  }
  const edges = Array.isArray(data.edges) ? data.edges : [];
  edges.forEach((e: unknown, i) => {
    if (!isObject(e) || [e.source, e.sourcePort, e.target, e.targetPort].some(v => typeof v !== 'string')) {
      errors.push(`Edge ${i + 1} is incomplete.`);
    } else if (!ids.has(e.source as string) || !ids.has(e.target as string)) {
      errors.push(`Edge ${i + 1} connects a node that is not in the flow.`);
    }
  });
  const groups = Array.isArray(data.groups) ? data.groups : [];
  groups.forEach((g: unknown, i) => {
    if (!isObject(g) || typeof g.id !== 'string' || !isPoint(g.position) || !isObject(g.size)) errors.push(`Group ${i + 1} is incomplete.`);
  });
  if (errors.length) return {ok: false, errors};

  const typeOf = (id: string) => (nodes as Record<string, unknown>[]).find(n => n.id === id)?.type as string | undefined;
  const plainEdges = (edges as ExecutableEdge[]).map(e => ({source: e.source, sourcePort: e.sourcePort, target: e.target, targetPort: e.targetPort}));
  const nodeOf = (id: string) => {
    const n = (nodes as Record<string, unknown>[]).find(node => node.id === id);
    return n ? {type: n.type as string, config: (n.config as Record<string, unknown> | undefined) ?? {}} : undefined;
  };
  const ports = [...portConnectionIssues(plainEdges, typeOf), ...errorEdgeIssues(plainEdges, nodeOf)];
  if (ports.length) return {ok: false, errors: ports.map(i => `Node "${i.nodeId}" ${i.message}`)};

  const value: FlowFile = {
    version: FLOW_FILE_VERSION,
    ...(typeof data.id === 'string' ? {id: data.id} : {}),
    name: (data.name as string).trim(),
    nodes: nodes.map((n: Record<string, unknown>) => ({
      id: n.id as string,
      type: n.type as string,
      ...(typeof n.label === 'string' && n.label ? {label: n.label} : {}),
      position: n.position as Point,
      config: (n.config as Record<string, unknown> | undefined) ?? {},
      ...(typeof n.outputKey === 'string' && n.outputKey ? {outputKey: n.outputKey} : {}),
      ...(n.disabled === true ? {disabled: true} : {}),
      ...(n.pinned === true ? {pinned: true} : {}),
      ...(typeof n.notes === 'string' && n.notes ? {notes: n.notes} : {}),
    })),
    edges: edges.map((e: Record<string, string>) => ({source: e.source, sourcePort: e.sourcePort, target: e.target, targetPort: e.targetPort})),
    ...(groups.length ? {groups: groups.map((g: Record<string, unknown>) => ({
      id: g.id as string,
      title: typeof g.title === 'string' ? g.title : '',
      color: typeof g.color === 'string' ? g.color : '',
      position: g.position as Point,
      size: g.size as FlowFileGroup['size'],
    }))} : {}),
  };
  return {ok: true, value};
}

/** a new flow: its Start and its End, apart on the canvas, nothing between them */
export function newFlowFile(name: string, id?: string): FlowFile {
  return {
    version: FLOW_FILE_VERSION,
    ...(id ? {id} : {}),
    name,
    nodes: [
      {id: START, type: START, position: {x: 0, y: 0}, config: {}},
      {id: END, type: END, position: {x: 640, y: 0}, config: {}},
    ],
    edges: [],
  };
}

/** the flow as the runner takes it: no positions, groups or notes; the parameters from its Start */
export function toExecutableFlow(file: FlowFile, project: string): ExecutableFlow {
  return {
    ...(file.id ? {id: file.id} : {}),
    project,
    flow: file.name,
    parameters: startParameters(file.nodes),
    nodes: file.nodes.map(n => ({
      id: n.id,
      type: n.type,
      label: n.label || n.type,
      config: n.config,
      ...(n.outputKey ? {outputKey: n.outputKey} : {}),
      ...(n.disabled ? {disabled: true} : {}),
    })),
    edges: file.edges,
  };
}
