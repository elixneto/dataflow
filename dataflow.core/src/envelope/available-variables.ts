import type {AvailableVariable} from '#types/available-variable.type';
import type {EnvelopeData} from '#types/envelope-data.type';

/** How deep objects are walked when listing paths ($a.b.c). */
const MAX_DEPTH = 3;
const MAX_EXAMPLE = 40;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One shape from several samples: every key that appeared in any of them, with the first value seen
 * (objects are merged the same way, so a nested field present in only one sample also shows up).
 */
export function mergeSamples(samples: EnvelopeData[]): EnvelopeData {
  const merged: EnvelopeData = {};
  for (const sample of samples) {
    for (const [key, value] of Object.entries(sample)) {
      const previous = merged[key];
      if (previous === undefined || previous === null) merged[key] = value;
      else if (isObject(previous) && isObject(value)) merged[key] = mergeSamples([previous, value]);
    }
  }
  return merged;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function example(value: unknown): string | undefined {
  if (value === undefined || isObject(value)) return undefined;
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_EXAMPLE ? `${text.slice(0, MAX_EXAMPLE - 1)}…` : text;
}

/** The variable at `path` and, for an object, the fields inside it (up to MAX_DEPTH levels). */
export function variablesOf(path: string, value: unknown, depth = 1): AvailableVariable[] {
  const variable: AvailableVariable = {path, type: typeOf(value), example: example(value)};
  if (!isObject(value) || depth >= MAX_DEPTH) return [variable];
  return [variable, ...Object.entries(value).flatMap(([key, inner]) => variablesOf(`${path}.${key}`, inner, depth + 1))];
}

/** Variables of the DATA keys ($key, $key.field...) from a sample shape. */
export function dataVariables(shape: EnvelopeData): AvailableVariable[] {
  return Object.entries(shape).flatMap(([key, value]) => variablesOf(`$${key}`, value));
}
