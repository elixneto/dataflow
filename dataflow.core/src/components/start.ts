import {START} from '#engine/constants';
import {nameIssue} from '#validation/key-name';
import type {FlowParameter} from '#types/flow-parameter.type';
import type {Issue} from '#types/issue.type';
import type {ParameterType} from '#types/parameter.type';
import type {SettingField} from '#types/setting-field.type';

/*
 * The Start's settings: whether the flow accepts an input (a webhook body, a calling flow's envelope) and the input a
 * test run uses, and the flow's parameters ($PARAMETERS: each trigger passes the values, the default otherwise; a
 * required one without a value stops the run). They live in the Start's config; whoever builds the ExecutableFlow
 * takes the parameters from here (`startParameters`), so the runner keeps reading `ExecutableFlow.parameters`.
 * The Start is not one of COMPONENTS: the engine runs it itself.
 */

const PARAMETER_TYPES: ParameterType[] = ['text', 'number', 'boolean'];

export const START_SETTINGS: SettingField[] = [
  {key: 'acceptsInput', label: 'Accepts input', kind: 'boolean'},
  {key: 'testInput', label: 'Default input (JSON)', kind: 'code', language: 'json', placeholder: '{"id": 1}', when: {key: 'acceptsInput', values: [true]}},
  {
    key: 'parameters', label: 'Parameters', kind: 'list', itemLabel: 'parameter',
    item: [
      {key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'since'},
      {key: 'type', label: 'Type', kind: 'select', default: 'text', options: [{value: 'text', label: 'Text'}, {value: 'number', label: 'Number'}, {value: 'boolean', label: 'Yes/no'}]},
      {key: 'default', label: 'Default', kind: 'text'},
      {key: 'required', label: 'Required', kind: 'boolean'},
    ],
  },
];

/** the Start's config as the editor and the runner read it */
export function startConfig(config: Record<string, unknown>) {
  const parameters = Array.isArray(config.parameters) ? (config.parameters as Partial<FlowParameter>[]) : [];
  return {
    acceptsInput: config.acceptsInput === true,
    testInput: typeof config.testInput === 'string' ? config.testInput : '',
    parameters: parameters.map((p): FlowParameter => ({
      name: typeof p?.name === 'string' ? p.name.trim() : '',
      type: PARAMETER_TYPES.includes(p?.type as ParameterType) ? (p?.type as ParameterType) : 'text',
      default: typeof p?.default === 'string' ? p.default : p?.default === undefined || p?.default === null ? '' : String(p.default),
      ...(p?.required === true ? {required: true} : {}),
    })),
  };
}

/** the flow's parameters, from its Start (what ExecutableFlow.parameters holds) */
export function startParameters(nodes: {type: string; config: Record<string, unknown>}[]): FlowParameter[] {
  const start = nodes.find(n => n.type === START);
  return start ? startConfig(start.config).parameters : [];
}

/** why a default does not fit its type, or null */
function defaultIssue(p: FlowParameter): string | null {
  const value = p.default.trim();
  if (value === '') return null;
  if (p.type === 'number' && !Number.isFinite(Number(value))) return `"${p.default}" is not a number`;
  if (p.type === 'boolean' && value !== 'true' && value !== 'false') return `"${p.default}" is not true or false`;
  return null;
}

/** the Start's configuration issues: parameter names (valid, unique), defaults of their type, the input as JSON */
export function validateStart(config: Record<string, unknown>): Issue[] {
  const {acceptsInput, testInput, parameters} = startConfig(config);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  parameters.forEach((p, i) => {
    const issue = nameIssue(p.name);
    if (issue) issues.push(`parameter ${i + 1} ${issue}.`);
    else if (seen.has(p.name)) issues.push(`has the parameter "${p.name}" more than once.`);
    seen.add(p.name);
    const wrong = defaultIssue(p);
    if (wrong) issues.push(`parameter "${p.name || i + 1}": ${wrong}.`);
  });
  if (acceptsInput && testInput.trim()) {
    try {
      JSON.parse(testInput);
    } catch {
      issues.push('has a default input that is not valid JSON.');
    }
  }
  return issues;
}
