import type {FlowParameter} from '#types/flow-parameter.type';
import {SCRIPT_RUNTIME_TYPES} from './script-runtime';

/*
 * What a TypeScript component's code sees, as a declaration file: the editor gives it to its code editor (autocomplete
 * and checks), the runner provides these globals when it runs the code (PrepareScript). Kept here so both read one
 * description.
 */

const TS_TYPE = {text: 'string', number: 'number', boolean: 'boolean'} as const;

/**
 * the globals with $PARAMETERS typed from the flow's own parameters (its Start) and, when known, `Data` (what reaches
 * the component, from the runs: dataTypeFromSamples): autocomplete for their names
 */
export function scriptGlobals(parameters: FlowParameter[] = [], dataType?: string): string {
  const globals = dataType ? SCRIPT_GLOBALS.replace('type Data = Record<string, any>', `type Data = ${dataType}`) : SCRIPT_GLOBALS;
  if (parameters.length === 0) return globals;
  const typed = parameters.filter(p => p.name).map(p => `  ${JSON.stringify(p.name)}: ${TS_TYPE[p.type]}`).join('\n');
  return globals.replace('declare const $PARAMETERS: Record<string, string | number | boolean>', `declare const $PARAMETERS: {\n${typed}\n}`);
}

export const SCRIPT_GLOBALS = `
/** the envelope's DATA, what process receives as $input */
type Data = Record<string, any>
/** the flow's parameters (its Start), already converted to their types */
declare const $PARAMETERS: Record<string, string | number | boolean>
/** the project's secrets (a database password, an API token): their values never reach the logs */
declare const $SECRETS: Record<string, string>
/** the project's variables (plain values, e.g. a region or a base URL) */
declare const $VARIABLES: Record<string, string>
/** this run */
declare const $FLOW_CURRENT_RUN: {
  id: string
  mode: 'validation' | 'execution'
  project: string
  flow: string
  startedAt: string
  /** the run that called this one (Flow Invoker) */
  parentId?: string
}
/** writes to the component's log */
declare function log(...parts: unknown[]): void
${SCRIPT_RUNTIME_TYPES}`;
