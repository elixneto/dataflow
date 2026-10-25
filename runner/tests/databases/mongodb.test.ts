import {expect, test} from 'bun:test';
import type {DocumentUpsert, UpsertResult} from '@dataflow/core';
import {BSON} from 'mongodb';
import {toEnvelopeValue, upsertInOrder} from '../../src/databases/mongodb';

// a fake updateOne: no MongoDB, only the order and the overlap of the calls

const upsert = (id: number, name: string): DocumentUpsert => ({filter: {_id: id}, document: {name}});
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** records when each call starts and ends, and keeps the last document written per _id */
function fakeCollection(delay: (u: DocumentUpsert) => number = () => 5) {
  const events: string[] = [];
  const stored = new Map<unknown, unknown>();
  const write = async (u: DocumentUpsert): Promise<UpsertResult> => {
    const name = String(u.document.name);
    events.push(`start ${name}`);
    await wait(delay(u));
    if (name.startsWith('fail')) {
      events.push(`fail ${name}`);
      throw new Error(`could not write ${name}`);
    }
    const matched = stored.has(u.filter._id) ? 1 : 0;
    stored.set(u.filter._id, u.document);
    events.push(`end ${name}`);
    return {matched, modified: matched, upsertedId: matched ? null : String(u.filter._id)};
  };
  return {events, stored, write};
}

test('upserts with the same filter go one after the other, in arrival order, and the last one wins', async () => {
  // the first one is the slowest: sent together, it would finish last and win
  const fake = fakeCollection(u => (u.document.name === 'a1' ? 30 : 5));
  await upsertInOrder([upsert(1, 'a1'), upsert(1, 'a2'), upsert(1, 'a3')], fake.write);
  expect(fake.events).toEqual(['start a1', 'end a1', 'start a2', 'end a2', 'start a3', 'end a3']);
  expect(fake.stored.get(1)).toEqual({name: 'a3'});
});

test('upserts with different filters go at the same time', async () => {
  const fake = fakeCollection();
  await upsertInOrder([upsert(1, 'a'), upsert(2, 'b'), upsert(3, 'c')], fake.write);
  expect(fake.events.slice(0, 3)).toEqual(['start a', 'start b', 'start c']);
});

test('the results come back in the order of the batch', async () => {
  // the second filter answers first; the results still follow the input
  const fake = fakeCollection(u => (u.filter._id === 1 ? 20 : 1));
  const results = await upsertInOrder([upsert(1, 'a1'), upsert(2, 'b1'), upsert(1, 'a2')], fake.write);
  expect(results).toEqual([
    {matched: 0, modified: 0, upsertedId: '1'},
    {matched: 0, modified: 0, upsertedId: '2'},
    {matched: 1, modified: 1, upsertedId: null},
  ]);
});

test('an upsert that fails does not stop the next ones of its filter', async () => {
  const fake = fakeCollection();
  const results = await upsertInOrder([upsert(1, 'fail-a1'), upsert(1, 'a2'), upsert(2, 'b1')], fake.write);
  expect(results).toEqual([
    {error: 'could not write fail-a1'},
    {matched: 0, modified: 0, upsertedId: '1'},
    {matched: 0, modified: 0, upsertedId: '2'},
  ]);
  expect(fake.events.indexOf('start a2')).toBeGreaterThan(fake.events.indexOf('fail fail-a1'));
});

test('documents from MongoDB become plain JSON values', () => {
  const {ObjectId, Decimal128, Long, Binary, Int32, Timestamp} = BSON;
  const doc = {
    _id: new ObjectId('64f1a2b3c4d5e6f708091a2b'),
    at: new Date('2026-10-25T18:00:00.000Z'),
    price: Decimal128.fromString('12.3400000000000000001'),
    small: Long.fromNumber(42),
    huge: Long.fromString('9223372036854775807'),
    count: new Int32(7),
    file: new Binary(Buffer.from('hi')),
    items: [{when: new Date('2026-01-01T00:00:00.000Z'), ref: new ObjectId('64f1a2b3c4d5e6f708091a2c')}],
    stamp: new Timestamp({t: 1, i: 2}),
    plain: {text: 'x', n: 1.5, yes: true, none: null},
  };
  expect(toEnvelopeValue(doc)).toEqual({
    _id: '64f1a2b3c4d5e6f708091a2b',
    at: '2026-10-25T18:00:00.000Z',
    price: '12.3400000000000000001',
    small: 42,
    huge: '9223372036854775807',
    count: 7,
    file: 'aGk=',
    items: [{when: '2026-01-01T00:00:00.000Z', ref: '64f1a2b3c4d5e6f708091a2c'}],
    stamp: {$timestamp: {t: 1, i: 2}},
    plain: {text: 'x', n: 1.5, yes: true, none: null},
  });
});
