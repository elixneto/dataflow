import {toError} from '#errors/normalize-error';
import type {ComponentLogic} from '#types/component-logic.type';
import type {Envelope} from '#types/envelope.type';

/**
 * Sort (in Kettle, Sort rows): reads every envelope, sorts them by a list of keys (expression + ascending/descending)
 * and only then yields them, in order. The first key decides; the next ones break ties, and envelopes still tied keep
 * their arrival order (stable). Numbers compare as numbers, booleans false before true, everything else as text;
 * `null` and `undefined` always go last. Holds the whole input in memory.
 */

export type SortDirection = 'asc' | 'desc';
export type SortKey = {value: string; direction: SortDirection};

export function sortKeys(config: Record<string, unknown>): SortKey[] {
  if (!Array.isArray(config.keys)) return [];
  return (config.keys as Partial<SortKey>[]).map(k => ({
    value: typeof k?.value === 'string' ? k.value : '',
    direction: k?.direction === 'desc' ? 'desc' : 'asc',
  }));
}

/** Ascending order of two key values; null and undefined are handled by the caller. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const sort: ComponentLogic = {
  type: 'sort',
  inputs: 1,
  outputs: 1,

  validate(config) {
    const keys = sortKeys(config);
    if (keys.length === 0) return ['has no keys.'];
    const issues: string[] = [];
    keys.forEach((k, i) => {
      if (!k.value.trim()) issues.push(`key ${i + 1} is empty.`);
    });
    return issues;
  },

  async* execute(inputs, config, ctx) {
    const keys = sortKeys(config);
    const held: {values: unknown[]; doc: Envelope}[] = [];
    for await (const doc of inputs['in-0'] ?? []) {
      try {
        held.push({values: keys.map(k => ctx.fieldValue({value: k.value, expression: true}, doc)), doc});
        ctx.holding(held.length, doc);
      } catch (e) {
        yield {error: toError(e), doc};
      }
    }
    held.sort((a, b) => {
      for (let i = 0; i < keys.length; i++) {
        const x = a.values[i];
        const y = b.values[i];
        const xMissing = x === null || x === undefined;
        const yMissing = y === null || y === undefined;
        if (xMissing || yMissing) {
          if (xMissing && yMissing) continue;
          return xMissing ? 1 : -1;
        }
        const order = compareValues(x, y);
        if (order !== 0) return keys[i].direction === 'desc' ? -order : order;
      }
      return 0;
    });
    ctx.log('info', `${held.length} envelope(s) sorted by ${keys.length} key(s).`);
    for (let i = 0; i < held.length; i++) {
      ctx.holding(held.length - i - 1);
      yield {port: 'out-0', doc: held[i].doc};
    }
  },
};
