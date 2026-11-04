import type {EnvelopeData} from '#types/envelope-data.type';

/*
 * The TypeScript type of what reached a component, from the envelopes a run saw there: the editor gives it to a
 * TypeScript component's code (its `$input: Data`) for autocomplete and checks. Objects list their keys (optional
 * when some envelopes lack them), arrays the union of their items, a field seen with several types gets the union.
 */

/** how deep the type goes; past it, `unknown` */
const MAX_DEPTH = 6;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** a key as a property name: as it is when it is an identifier, in quotes otherwise ("first name", "1st") */
const property = (key: string) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** the type of these values together (each one a value seen in the same place) */
function typeOf(values: unknown[], depth: number): string {
  if (depth > MAX_DEPTH) return 'unknown';
  const types = new Set<string>();
  const objects = values.filter(isObject);
  const arrays = values.filter(Array.isArray);
  for (const v of values) {
    if (v === null) types.add('null');
    else if (typeof v === 'string') types.add('string');
    else if (typeof v === 'number') types.add('number');
    else if (typeof v === 'boolean') types.add('boolean');
  }
  if (arrays.length) {
    const item = typeOf(arrays.flat(), depth + 1);
    types.add(item.includes(' | ') ? `(${item})[]` : `${item}[]`);
  }
  if (objects.length) {
    const keys = [...new Set(objects.flatMap(o => Object.keys(o)))];
    const fields = keys.map(key => {
      const present = objects.filter(o => key in o);
      const optional = present.length < objects.length ? '?' : '';
      return `${property(key)}${optional}: ${typeOf(present.map(o => o[key]), depth + 1)}`;
    });
    types.add(fields.length ? `{ ${fields.join('; ')} }` : 'Record<string, unknown>');
  }
  return types.size ? [...types].join(' | ') : 'unknown';
}

/** the type of the DATA of these envelopes; without any, an open record */
export function dataTypeFromSamples(samples: EnvelopeData[]): string {
  return samples.length ? typeOf(samples, 1) : 'Record<string, unknown>';
}
