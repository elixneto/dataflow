import {withKey} from '#envelope/envelope-data';
import {isDate} from '#envelope/dates';
import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';

/**
 * Lookup (in Kettle, Stream lookup): for each envelope of the main input (in-0), looks for the envelope of the lookup
 * input (in-1) with the same key and writes its whole DATA into the node's output key (default `lookup`; null if
 * not found). Picking fields and giving default values is the job of a Mapper after it (e.g. `$company?.id`).
 * With If not found on "Not found output", it has two outputs: found (out-0, the same port as before) and not found
 * (out-1), where the envelopes without a match go as they came in; that one may stay unconnected (they are dropped).
 * With Override, DATA becomes only the envelope found (empty if not found). E.g.: company code in the source system → company in the target.
 *
 * Reads the whole lookup input before yielding the first envelope (it stays in memory). Meanwhile, it holds what arrives
 * on the main input, so it does not deadlock when both inputs come from the same place. Keys are compared as text
 * (`1` matches `"1"`); with a repeated key in the lookup input, the first envelope wins.
 */

export type LookupKey = {main: string; lookup: string};
export type IfNotFound = 'null' | 'output';

export function lookupConfig(config: Record<string, unknown>) {
  return {
    keys: Array.isArray(config.keys) ? (config.keys as LookupKey[]) : [],
    // 'error' (earlier versions: an error for each envelope without a match) became the not found output
    ifNotFound: (config.ifNotFound === 'output' || config.ifNotFound === 'error' ? 'output' : 'null') as IfNotFound,
  };
}

/** A key value as text: 1 matches "1"; a date is its instant (String() would drop the milliseconds). */
const keyText = (value: unknown) => (isDate(value) ? value.toISOString() : String(value));

export const lookup: ComponentLogic = {
  type: 'lookup',
  inputs: 2,
  inputLabels: ['input', 'lookup'],
  // what is looked up and where: one edge each (to join several sources, take them to one component first)
  singleEdgeInputs: true,
  outputs: 1,
  // with the not found output: found and not found (out-1, may stay unconnected); otherwise its one output
  outputsFromConfig: config => (lookupConfig(config).ifNotFound === 'output' ? [{label: 'found'}, {label: 'not found'}] : undefined),
  optionalOutputs: ['out-1'],
  usesOverride: true,
  defaultOutputKey: 'lookup',
  settings: [
    {
      key: 'keys', label: 'Keys', kind: 'list', itemLabel: 'key', required: true,
      item: [
        {key: 'main', label: 'Input', kind: 'expression', required: true, placeholder: '$customerId'},
        {key: 'lookup', label: 'Lookup', kind: 'expression', required: true, placeholder: '$id'},
      ],
    },
    {key: 'ifNotFound', label: 'If not found', kind: 'select', default: 'null', options: [{value: 'null', label: 'Null'}, {value: 'output', label: 'Not found output'}]},
  ],

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
        if (match) found += 1;
        else unmatched += 1;
        // no match, with the not found output: the envelope goes there as it came in
        if (!match && ifNotFound === 'output') {
          yield {port: 'out-1', doc};
          continue;
        }

        const output: Envelope = ctx.node.override
          ? {FLOW_CURRENT_RUN: doc.FLOW_CURRENT_RUN, PARAMETERS: doc.PARAMETERS, DATA: {...match?.DATA}}
          : withKey(doc, ctx.node.outputKey || 'lookup', match ? match.DATA : null);
        yield {port: 'out-0', doc: output};
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    await hold;
    ctx.log('info', `${found} envelope(s) found and ${unmatched} not found in the lookup.`);
  },
};
