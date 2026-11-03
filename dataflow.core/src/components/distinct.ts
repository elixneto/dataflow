import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';

/**
 * Distinct (in Kettle, Unique rows (HashSet)): lets through only the first envelope of each key and sends the repeated
 * ones to the duplicates output (out-1, may stay unconnected: drops). The key is a list of expressions (e.g. `$email`,
 * `$customer.id`); without any, the whole DATA is the key. Values are compared as JSON: `1` does not match `"1"`, and
 * objects match by content. Streams: each envelope goes out as it arrives; only the keys already seen stay in memory.
 */

export function distinctKeys(config: Record<string, unknown>): string[] {
  return Array.isArray(config.keys) ? config.keys.filter((k): k is string => typeof k === 'string') : [];
}

export const distinct: ComponentLogic = {
  type: 'distinct',
  inputs: 1,
  outputs: 2,
  optionalOutputs: ['out-1'],

  validate(config) {
    const issues: string[] = [];
    distinctKeys(config).forEach((k, i) => {
      if (!k.trim()) issues.push(`key ${i + 1} is empty.`);
    });
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const keys = distinctKeys(config);
    const seen = new Set<string>();
    let duplicates = 0;
    for await (const doc of inputs['in-0'] ?? []) {
      let key: string;
      try {
        key = JSON.stringify(keys.length ? keys.map(k => ctx.fieldValue({value: k, expression: true}, doc) ?? null) : doc.DATA);
      } catch (e) {
        yield {error: toError(e), doc};
        continue;
      }
      if (seen.has(key)) {
        duplicates += 1;
        yield {port: 'out-1', doc};
        continue;
      }
      seen.add(key);
      // holds only the keys, not the envelopes: the Memory shows how many distinct keys there were
      ctx.holding(seen.size);
      yield {port: 'out-0', doc};
    }
    ctx.log('info', `${seen.size} distinct envelope(s) and ${duplicates} duplicate(s).`);
  },
};
