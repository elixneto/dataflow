import {toError} from '#errors/normalize-error';
import {scriptImport} from '../scripts/script-path';
import {inputTypeRef} from '../scripts/type-shape';
import type {ComponentContext} from '#types/component-context.type';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';
import type {ExpressionField} from '#types/expression-field.type';
import {scriptOutputs, typescriptConfig} from './typescript';
import {DYNAMIC_TARGET} from './dynamic-target';

/**
 * Script Invoker: for each incoming envelope, calls a function a project script exports (`export function name(...)`),
 * its arguments in the order of its parameters, each a fixed value or an expression on the envelope (empty: undefined,
 * its default applies). What it returns goes where a TypeScript component's does: the output key, or with Override
 * the whole DATA. It runs as a TypeScript component that imports the function (the same runner, globals and limits);
 * an exception is an error of the envelope (On error). Always waits for the call: there is no fire and forget.
 * "By path (expression)": the function is the one an expression on each envelope names (`folders/script#function`);
 * its arguments are then a plain list, in order (a fixed value is text, an expression any value).
 */

/** an argument as the config keeps it: the parameter's name and type (as the function declares them) and its value */
export type ScriptArgument = ExpressionField & {name: string; type?: string};

export function scriptInvokerConfig(config: Record<string, unknown>) {
  const path = config.functionPath as ExpressionField | undefined;
  return {
    target: inputTypeRef(config.function),
    /** the function named by an expression on each envelope (`folder/script#function`): the function setting is DYNAMIC_TARGET */
    functionPath: config.function === DYNAMIC_TARGET ? {value: typeof path?.value === 'string' ? path.value : '', expression: path?.expression !== false} as ExpressionField : null,
    arguments: Array.isArray(config.arguments) ? (config.arguments as ScriptArgument[]) : [],
  };
}

/** the code that runs the call: a TypeScript component whose process spreads its input (the arguments) into the function */
export const invokerCode = (path: string, name: string) =>
  `import { ${name} as __dataflowCalled } from '${scriptImport(path)}';\n\nasync function process($input: unknown[]) {\n  return await __dataflowCalled(...$input);\n}\n`;

/** The code a component runs, for those that run one (a TypeScript component, a Script Invoker with its function set). */
export function scriptCodeOf(type: string, config: Record<string, unknown>): string | undefined {
  if (type === 'typescript') return typescriptConfig(config).code;
  if (type === scriptInvoker.type) {
    const {target} = scriptInvokerConfig(config);
    return target ? invokerCode(target.path, target.name) : undefined;
  }
  return undefined;
}

/** a fixed value as the parameter's type takes it: text for a string (or no type), a number, yes/no, or JSON (text when it is not) */
function fixedValue(text: string, type: string): unknown {
  const t = type.replace(/\s/g, '');
  if (!t || (/\bstring\b/.test(t) && !/[[{]/.test(t))) return text;
  if (t === 'number') return Number(text);
  if (t === 'boolean') return text === 'true';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function argumentValue(arg: ScriptArgument, doc: Envelope, ctx: ComponentContext): unknown {
  if (arg.expression) return arg.value.trim() ? ctx.fieldValue(arg, doc) : undefined;
  return arg.value === '' ? undefined : fixedValue(arg.value, arg.type ?? '');
}

export const scriptInvoker: ComponentLogic = {
  type: 'script',
  inputs: 1,
  outputs: 1,
  usesOverride: true,
  defaultOutputKey: 'result',
  settings: [
    {key: 'function', label: 'Function', kind: 'script-function', required: true},
    {
      key: 'functionPath', label: 'Function path', kind: 'value', required: true, default: {value: '', expression: true},
      placeholder: "'pricing/' + $country + '#total'", when: {key: 'function', values: [DYNAMIC_TARGET]},
    },
    {
      key: 'arguments', label: 'Arguments', kind: 'list', itemLabel: 'argument', argumentsOf: 'function',
      item: [
        {key: 'name', label: 'Name', kind: 'text', required: true},
        {key: 'value', label: 'Value', kind: 'value', spread: true, default: {value: '', expression: false}},
      ],
    },
  ],

  validate(config) {
    const {target, functionPath} = scriptInvokerConfig(config);
    if (functionPath) return functionPath.value.trim() ? [] : ['has no function path.'];
    return target ? [] : ['has no function selected.'];
  },

  async* execute(inputs, config, ctx) {
    const {target: chosen, functionPath, arguments: args} = scriptInvokerConfig(config);
    if (!chosen && !functionPath) throw new Error('No function selected.');
    // one prepared call per function (a function named by expression may differ per envelope)
    const prepared = new Map<string, ReturnType<typeof ctx.prepareScript>>();
    const callOf = (target: {path: string; name: string}) => {
      const code = invokerCode(target.path, target.name);
      if (!prepared.has(code)) prepared.set(code, ctx.prepareScript(code));
      return prepared.get(code)!;
    };
    const targetOf = (doc: Envelope) => {
      if (!functionPath) return chosen!;
      const path = ctx.fieldValue(functionPath, doc);
      const target = typeof path === 'string' ? inputTypeRef(path.trim()) : null;
      if (!target) throw new Error(`The function path ${JSON.stringify(path) ?? 'undefined'} is not a script and a function: folders/script#function (e.g. pricing/total#withVat).`);
      return target;
    };
    let calls = 0;
    let sent = 0;
    const called = new Set<string>();
    for await (const doc of inputs['in-0'] ?? []) {
      calls += 1;
      try {
        const target = targetOf(doc);
        called.add(`${target.name} (${scriptImport(target.path)})`);
        const call = await callOf(target);
        const returned = await call(args.map(a => argumentValue(a, doc, ctx)));
        for (const out of scriptOutputs(doc, returned, ctx.node, target.name)) {
          sent += 1;
          yield {port: 'out-0', doc: out};
        }
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    ctx.log('debug', `${calls} call(s) of ${[...called].join(', ') || 'no function'}, ${sent} envelope(s) out.`);
  },
};
