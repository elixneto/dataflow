import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {EnvelopeData} from '#types/envelope-data.type';

/**
 * Split: the opposite of Aggregate. Evaluates an expression that must give a list (default `$items`) and yields one
 * envelope per item, with the item as the whole DATA: {items: [DATA, DATA, ...]} → DATA, DATA, ...
 * Every item must be an object; a value that is not a list (or a list with something else) is an error of the envelope.
 * An empty list yields nothing.
 */

export function splitList(config: Record<string, unknown>): string {
  return typeof config.list === 'string' ? config.list : '$items';
}

function isObject(value: unknown): value is EnvelopeData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const split: ComponentLogic = {
  type: 'split',
  inputs: 1,
  outputs: 1,

  validate(config) {
    return splitList(config).trim() ? [] : ['has no list.'];
  },

  async* execute(inputs, config, ctx) {
    const list = splitList(config);
    let received = 0;
    let items = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      received += 1;
      let value: unknown;
      try {
        value = ctx.fieldValue({value: list, expression: true}, doc);
        if (!Array.isArray(value)) throw new TypeError(`${list} is not a list (${value === null ? 'null' : typeof value}).`);
        const index = value.findIndex(item => !isObject(item));
        if (index >= 0) throw new TypeError(`${list}[${index}] is not an object.`);
      } catch (e) {
        yield {error: toError(e), doc};
        continue;
      }
      for (const item of value as EnvelopeData[]) {
        items += 1;
        yield {port: 'out-0', doc: {WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA: item}};
      }
    }
    ctx.log('info', `${received} envelope(s) split into ${items}.`);
  },
};
