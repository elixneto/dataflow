import {withKey} from '#envelope/envelope-data';
import {isDate} from '#envelope/dates';
import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';

/**
 * Lookup (in Kettle, Stream lookup): for each envelope of the main input (in-0), looks for the envelope of the lookup
 * input (in-1) with the same key and writes its whole DATA into the node's output key (default `lookup`; null if
 * not found). Picking fields and giving default values is the job of a Mapper after it (e.g. `$company?.id`).
 * With Override, DATA becomes only the envelope found (empty if not found). E.g.: company code in the source system → company in the target.
 *
 * Reads the whole lookup input before yielding the first envelope (it stays in memory). Meanwhile, it holds what arrives
 * on the main input, so it does not deadlock when both inputs come from the same place. Keys are compared as text
 * (`1` matches `"1"`); with a repeated key in the lookup input, the first envelope wins.
 */

export type LookupKey = {main: string; lookup: string};
export type IfNotFound = 'null' | 'error';

export function lookupConfig(config: Record<string, unknown>) {
  return {
    keys: Array.isArray(config.keys) ? (config.keys as LookupKey[]) : [],
    ifNotFound: (config.ifNotFound === 'error' ? 'error' : 'null') as IfNotFound,
  };
}

class NotFound extends Error {
  constructor(key: string) {
    super(`Lookup did not find the key ${key}.`);
    this.name = 'NotFound';
  }
}

/** A key value as text: 1 matches "1"; a date is its instant (String() would drop the milliseconds). */
const keyText = (value: unknown) => (isDate(value) ? value.toISOString() : String(value));

export const lookup: ComponentLogic = {
  type: 'lookup',
  inputs: 2,
  outputs: 1,
  defaultOutputKey: 'lookup',

  validate(config) {
    const {keys} = lookupConfig(config);
    const issues: string[] = [];
    if (keys.length === 0) issues.push('has no keys.');
    keys.forEach((k, i) => {
      if (!k.main?.trim() || !k.lookup?.trim()) issues.push(`key ${i + 1} is incomplete.`);
    });
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const {keys, ifNotFound} = lookupConfig(config);
    const keyOf = (doc: Envelope, side: 'main' | 'lookup') =>
      JSON.stringify(keys.map(k => keyText(ctx.fieldValue({value: k[side], expression: true}, doc))));

    const table = new Map<string, Envelope>();
    // holds the main input while the lookup input has not finished (both may come from the same component)
    const held: Envelope[] = [];
    let mainDone = false;
    const waiting: {wake?: () => void} = {};
    const hold = (async () => {
      for await (const doc of inputs['in-0'] ?? []) {
        held.push(doc);
        ctx.holding(table.size + held.length, doc);
        waiting.wake?.();
      }
      mainDone = true;
      waiting.wake?.();
    })();

    let repeated = 0;
    for await (const doc of inputs['in-1'] ?? []) {
      const key = keyOf(doc, 'lookup');
      if (table.has(key)) repeated += 1;
      else {
        table.set(key, doc);
        ctx.holding(table.size + held.length, doc);
      }
    }
    ctx.log('info', `Lookup with ${table.size} key(s).`);
    if (repeated) ctx.log('warning', `${repeated} lookup envelope(s) with a repeated key: the first one wins.`);

    let found = 0;
    let unmatched = 0;
    while (true) {
      const doc = held.shift();
      if (!doc) {
        if (mainDone) break;
        await ctx.wait(new Promise<void>(resolve => (waiting.wake = resolve)));
        waiting.wake = undefined;
        continue;
      }
      ctx.holding(table.size + held.length);
      try {
        const key = keyOf(doc, 'main');
        const match = table.get(key);
        if (!match && ifNotFound === 'error') throw new NotFound(key);
        if (match) found += 1;
        else unmatched += 1;
        const output: Envelope = ctx.node.override
          ? {WORKFLOW_CURRENT_RUN: doc.WORKFLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA: {...match?.DATA}}
          : withKey(doc, ctx.node.outputKey || 'lookup', match ? match.DATA : null);
        yield {port: 'out-0', doc: output};
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    await hold;
    ctx.log('info', `${found} envelope(s) found and ${unmatched} without a match in the lookup.`);
  },
};
