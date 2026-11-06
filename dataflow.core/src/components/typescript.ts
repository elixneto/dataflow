import {withKey} from '#envelope/envelope-data';
import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';
import type {ExecutableNode} from '#types/executable-node.type';

/**
 * TypeScript: the user writes `async function process($input)` (and as many helper functions as they want).
 * $input is the envelope's DATA (to process many at once, put an Aggregate before it).
 * Without Override, the return value (any value) goes to the node's output key ($result) and the envelope moves on with the rest.
 * With Override, the return value becomes the whole DATA: object = 1 envelope, list = 1 per item, null/undefined = none.
 * An exception is an error of the envelope (follows the "On error" policy). Globals: $PARAMETERS, $SECRETS, $VARIABLES,
 * $FLOW_CURRENT_RUN and log().
 */

export const DEFAULT_CODE = `async function process($input: Data) {
  return null
}
`;

export function typescriptConfig(config: Record<string, unknown>) {
  return {code: typeof config.code === 'string' ? config.code : DEFAULT_CODE};
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Where what a script returned goes: without Override, into the node's output key of the envelope; with it, the whole
 * DATA (object = 1 envelope, list = 1 per item, null/undefined = none). `who` names the function in the error.
 */
export function scriptOutputs(doc: Envelope, returned: unknown, node: ExecutableNode, who = 'process'): Envelope[] {
  if (!node.override) return [withKey(doc, node.outputKey || 'result', returned ?? null)];
  if (returned === null || returned === undefined) return [];
  const items = Array.isArray(returned) ? returned : [returned];
  if (!items.every(isObject)) throw new TypeError(`With Override, ${who} must return an object, a list of objects or null.`);
  return items.map(DATA => ({FLOW_CURRENT_RUN: doc.FLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA}));
}

export const typescript: ComponentLogic = {
  type: 'typescript',
  inputs: 1,
  outputs: 1,
  usesOverride: true,
  defaultOutputKey: 'result',
  settings: [{key: 'code', label: 'Code', kind: 'code', language: 'typescript', required: true, default: DEFAULT_CODE}],

  validate(config) {
    const {code} = typescriptConfig(config);
    return /\bfunction\s+process\s*\(/.test(code) ? [] : ['has no process function.'];
  },

  async* execute(inputs, config, ctx) {
    const {code} = typescriptConfig(config);
    const process = await ctx.prepareScript(code);
    let received = 0;
    let sent = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      received += 1;
      try {
        const returned = await process(doc.DATA);
        for (const out of scriptOutputs(doc, returned, ctx.node)) {
          sent += 1;
          yield {port: 'out-0', doc: out};
        }
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    ctx.log('debug', `${received} envelope(s) in and ${sent} out.`);
  },
};
