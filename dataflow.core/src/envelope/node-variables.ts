import type {AvailableVariable} from '#types/available-variable.type';
import type {FlowParameter} from '#types/flow-parameter.type';
import type {RunRecord} from '#types/run-record.type';
import {dataVariables, memberPath, mergeSamples} from './available-variables';

/*
 * What an expression can use at a component, for the editor's suggestions: the DATA that reached it in the runs so far
 * (what came out of the ports feeding it), and the system variables: the flow's parameters, the project's variables
 * and secrets (by name: a secret's value is never shown), the run.
 */

/** the variables seen going out of each component's ports in the runs so far: node id → output port → variables */
export type KnownVariables = Record<string, Record<string, AvailableVariable[]>>;

/**
 * The known variables after a run: each port that produced envelopes takes what they had; the others keep what an
 * earlier run saw.
 */
export function knownVariablesAfter(previous: KnownVariables, record: RunRecord): KnownVariables {
  const next: KnownVariables = {...previous};
  for (const component of record.components) {
    for (const [port, samples] of Object.entries(component.outputSample)) {
      if (samples.length) next[component.nodeId] = {...next[component.nodeId], [port]: dataVariables(mergeSamples(samples))};
    }
  }
  return next;
}

const RUN_FIELDS: AvailableVariable[] = [
  {path: '$FLOW_CURRENT_RUN', type: 'object'},
  {path: '$FLOW_CURRENT_RUN.id', type: 'string'},
  {path: '$FLOW_CURRENT_RUN.mode', type: 'string', example: '"validation"'},
  {path: '$FLOW_CURRENT_RUN.project', type: 'string'},
  {path: '$FLOW_CURRENT_RUN.flow', type: 'string'},
  {path: '$FLOW_CURRENT_RUN.startedAt', type: 'string'},
];

/**
 * the system variables: the flow's parameters (from its Start), the project's variables and secrets (names), the run;
 * a group with nothing in it is left out
 */
export function systemVariables(parameters: FlowParameter[], variables: {name: string; value?: string}[], secrets: string[]): AvailableVariable[] {
  const group = (root: string, members: AvailableVariable[]): AvailableVariable[] => (members.length ? [{path: root, type: 'object'}, ...members] : []);
  return [
    ...group('$PARAMETERS', parameters.filter(p => p.name).map(p => ({path: memberPath('$PARAMETERS', p.name), type: p.type === 'text' ? 'string' : p.type, ...(p.default ? {example: p.type === 'text' ? JSON.stringify(p.default) : p.default} : {})}))),
    ...group('$VARIABLES', variables.map(v => ({path: memberPath('$VARIABLES', v.name), type: 'string', ...(v.value !== undefined ? {example: JSON.stringify(v.value).slice(0, 40)} : {})}))),
    // a secret: its name only, never a sample of its value
    ...group('$SECRETS', secrets.map(name => ({path: memberPath('$SECRETS', name), type: 'secret'}))),
    ...RUN_FIELDS,
  ];
}

/** what reaches a component (at `port`, when given): the DATA variables of the ports feeding it, without repeats */
export function inputVariables(known: KnownVariables, edges: {source: string; sourcePort: string; target: string; targetPort: string}[], nodeId: string, port?: string): {variables: AvailableVariable[]; seen: boolean} {
  const feeding = edges.filter(e => e.target === nodeId && (port === undefined || e.targetPort === port));
  const byPath = new Map<string, AvailableVariable>();
  let seen = false;
  for (const edge of feeding) {
    const variables = known[edge.source]?.[edge.sourcePort];
    if (!variables) continue;
    seen = true;
    for (const v of variables) if (!byPath.has(v.path)) byPath.set(v.path, v);
  }
  return {variables: [...byPath.values()], seen};
}
