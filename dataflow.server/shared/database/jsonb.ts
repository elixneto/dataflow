import { customType } from 'drizzle-orm/pg-core';

/**
 * A jsonb column whose value goes to the driver as it is: both drivers (Bun's Postgres client and PGlite) encode a
 * jsonb parameter themselves. Drizzle's own jsonb encodes it first, and Bun's client then encodes that text again: the
 * column held a JSON string instead of the object (PGlite did not, so only real Postgres showed it). For objects,
 * arrays, strings and null (what the columns hold): Bun refuses a bare number or boolean for jsonb.
 */
export const jsonb = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: value => value,
  fromDriver: value => value,
});
