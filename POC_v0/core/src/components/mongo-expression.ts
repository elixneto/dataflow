import {toError} from '#errors/normalize-error';
import {isDate} from '#envelope/dates';

/*
 * MongoDB text written as Compass and mongosh show it (a pipeline, a filter): a JS expression evaluated on the
 * envelope, with the mongosh helpers in scope. The helpers return Extended JSON ({$oid}, {$date}...), which the runner
 * turns into BSON, so the core needs no MongoDB code. Used by the MongoDB Pipeline and the MongoDB Delete.
 */

/**
 * The mongosh helpers, defined inside the expression (they run where it runs, in the runner's sandbox), returning
 * Extended JSON. `new Date()` is a Date, which `toExtendedJson` turns into {$date}.
 */
const HELPERS = [
  'const ObjectId = id => { if (id === undefined) throw new Error("ObjectId() needs the id, e.g. ObjectId(\\"64f1…\\")."); return {$oid: String(id)}; };',
  'const ISODate = d => ({$date: (d === undefined ? new Date() : new Date(d)).toISOString()});',
  'const NumberLong = n => ({$numberLong: String(n)});',
  'const NumberInt = n => Number(n);',
  'const NumberDecimal = n => ({$numberDecimal: String(n)});',
].join(' ');

/** The text as an expression with the helpers in scope. */
export const mongoExpression = (text: string) => `(() => { ${HELPERS} return (\n${text}\n); })()`;

/** Dates (also from another realm, the sandbox) as {$date}; the rest as it is. */
export function toExtendedJson(value: unknown): unknown {
  if (isDate(value)) return {$date: value.toISOString()};
  if (Array.isArray(value)) return value.map(toExtendedJson);
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toExtendedJson(v)]));
  return value;
}

/**
 * Evaluates the text and gives it back as Extended JSON; an error says what failed (`what`: "pipeline", "filter")
 * without repeating the whole expression and its helpers.
 */
export function evaluateMongo(text: string, what: string, evaluate: (expression: string) => unknown): unknown {
  try {
    return toExtendedJson(evaluate(mongoExpression(text)));
  } catch (e) {
    const error = toError(e);
    const end = error.message.indexOf('})()": ');
    const cleaned = new Error(`The ${what} could not be evaluated: ${end >= 0 ? error.message.slice(end + 7) : error.message}`);
    cleaned.name = error.name;
    throw cleaned;
  }
}
