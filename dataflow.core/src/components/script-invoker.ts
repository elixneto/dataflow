import {toError} from '#errors/normalize-error';
import {scriptImport} from '../scripts/script-path';
import {inputTypeRef} from '../scripts/type-shape';
import type {ComponentContext} from '#types/component-context.type';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';
import type {ExpressionField} from '#types/expression-field.type';
import {scriptOutputs, typescriptConfig} from './typescript';

/**
 * Script Invoker: for each incoming envelope, calls a function a project script exports (`export function name(...)`),
 * its arguments in the order of its parameters, each a fixed value or an expression on the envelope (empty: undefined,
 * its default applies). What it returns goes where a TypeScript component's does: the output key, or with Override
 * the whole DATA. It runs as a TypeScript component that imports the function (the same runner, globals and limits);
 * an exception is an error of the envelope (On error). Always waits for the call: there is no fire and forget.
 */

/** an argument as the config keeps it: the parameter's name and type (as the function declares them) and its value */
export type ScriptArgument = ExpressionField & {name: string; type?: string};

export function scriptInvokerConfig(config: Record<string, unknown>) {
  return {
    target: inputTypeRef(config.function),
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
      key: 'arguments', label: 'Arguments', kind: 'list', itemLabel: 'argument', argumentsOf: 'function',
      item: [
        {key: 'name', label: 'Name', kind: 'text', required: true},
        {key: 'value', label: 'Value', kind: 'value', spread: true, default: {value: '', expression: false}},
      ],
    },
  ],

  validate(config) {
    return scriptInvokerConfig(config).target ? [] : ['has no function selected.'];
  },

  async* execute(inputs, config, ctx) {
    const {target, arguments: args} = scriptInvokerConfig(config);
    if (!target) throw new Error('No function selected.');
    const call = await ctx.prepareScript(invokerCode(target.path, target.name));
    let calls = 0;
    let sent = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      calls += 1;
      try {
        const returned = await call(args.map(a => argumentValue(a, doc, ctx)));
        for (const out of scriptOutputs(doc, returned, ctx.node, target.name)) {
          sent += 1;
          yield {port: 'out-0', doc: out};
        }
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    ctx.log('debug', `${calls} call(s) of ${target.name} (${scriptImport(target.path)}), ${sent} envelope(s) out.`);
  },
};
