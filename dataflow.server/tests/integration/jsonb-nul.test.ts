import { afterAll, beforeAll, expect, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import { pgJson, withoutNul } from '#shared/database/jsonb';

/** a run's record may hold a NUL (a binary HTTP response read as text): Postgres refuses it in jsonb */
let db: Database;
beforeAll(async () => {
  db = await openDatabase('memory://');
});
afterAll(async () => {
  await db.close();
});

const record = { status: 'completed', components: [{ outputSample: { 'out-0': [{ body: 'PNG\u0000\u0001end', 'k\u0000ey': 1 }] } }], note: 'a \\u0000 typed by hand' };

test('a NUL in a jsonb value is refused as it is, stored as U+FFFD with pgJson; a backslash and "u0000" typed by hand stay', async () => {
  await expect(db.query('SELECT $1::text::jsonb AS v', [JSON.stringify(record)])).rejects.toThrow();
  const [row] = await db.query<{ v: typeof record }>('SELECT $1::text::jsonb AS v', [pgJson(record)]);
  const sample = row!.v.components[0]!.outputSample['out-0'][0]!;
  expect(sample.body).toBe('PNG\uFFFD\u0001end');
  expect(Object.keys(sample)).toEqual(['body', 'k\uFFFDey']);
  expect(row!.v.note).toBe('a \\u0000 typed by hand');
});

test('withoutNul: the same value when it has none; texts and keys cleaned when it has', () => {
  const clean = { a: ['x', 1, null, { b: true }] };
  expect(withoutNul(clean)).toEqual(clean);
  expect(withoutNul({ 'k\u0000': ['a\u0000b'] })).toEqual({ 'k\uFFFD': ['a\uFFFDb'] });
});
