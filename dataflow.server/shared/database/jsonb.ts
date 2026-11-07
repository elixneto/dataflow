import { customType } from 'drizzle-orm/pg-core';

/*
 * Postgres refuses a NUL (\u0000) inside a jsonb text value, and a run can hold one: an HTTP response that is binary (an
 * image) read as text, a file's bytes. The whole write failed with it; it becomes U+FFFD (the replacement character).
 */
const NUL = /\u0000/g;
const REPLACEMENT = '\uFFFD';

/** the value with no NUL in its texts (nor its keys); the same value when it has none */
export function withoutNul(value: unknown): unknown {
  if (typeof value === 'string') return value.includes('\u0000') ? value.replace(NUL, REPLACEMENT) : value;
  if (Array.isArray(value)) return value.map(withoutNul);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(NUL, REPLACEMENT), withoutNul(item)]));
  }
  return value;
}

/**
 * JSON text for a jsonb parameter (`$1::text::jsonb`): a NUL escape (`\u0000`, not an escaped backslash before
 * "u0000") becomes the replacement character's
 */
export const pgJson = (value: unknown): string => JSON.stringify(value).replace(/(?<!\\)((?:\\\\)*)\\u0000/g, '$1\\ufffd');

/**
 * A jsonb column whose value goes to the driver as it is: both drivers (Bun's Postgres client and PGlite) encode a
 * jsonb parameter themselves. Drizzle's own jsonb encodes it first, and Bun's client then encodes that text again: the
 * column held a JSON string instead of the object (PGlite did not, so only real Postgres showed it). For objects,
 * arrays, strings and null (what the columns hold): Bun refuses a bare number or boolean for jsonb. No NUL goes in.
 */
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: value => withoutNul(value),
  fromDriver: value => value,
});
