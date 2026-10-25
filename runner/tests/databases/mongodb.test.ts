import {expect, test} from 'bun:test';
import type {DocumentUpsert} from '@dataflow/core';
import {BSON} from 'mongodb';
import {toEnvelopeValue, upsertInRounds, type BulkAnswer, type SingleAnswer} from '../../src/databases/mongodb';

// a fake collection: no MongoDB, only what is sent in each write and how the answers are mapped back

const upsert = (id: number, name: string): DocumentUpsert => ({filter: {_id: id}, document: {name}});

/** records each write (one = updateOne, many = bulkWrite) and keeps the last document written per _id */
function fakeCollection(options: {failName?: string; failOne?: boolean} = {}) {
  const writes: {kind: 'one' | 'many'; names: string[]}[] = [];
  const stored = new Map<unknown, Record<string, unknown>>();
  const apply = (u: DocumentUpsert) => {
    const before = stored.get(u.filter._id);
    stored.set(u.filter._id, {...before, ...u.document});
    return {matched: before ? 1 : 0, modified: before && before.name !== u.document.name ? 1 : 0, upsertedId: before ? null : u.filter._id};
  };
  const writeOne = async (u: DocumentUpsert): Promise<SingleAnswer> => {
    writes.push({kind: 'one', names: [String(u.document.name)]});
    if (options.failOne) throw new Error('could not write it');
    return apply(u);
  };
  const writeMany = async (list: DocumentUpsert[]): Promise<BulkAnswer> => {
    writes.push({kind: 'many', names: list.map(u => String(u.document.name))});
    const answer: BulkAnswer = {upsertedIds: {}, errors: {}, modified: 0};
    list.forEach((u, k) => {
      if (u.document.name === options.failName) {
        answer.errors[k] = `duplicate key for ${String(u.document.name)}`;
        return;
      }
      const r = apply(u);
      if (r.upsertedId !== null) answer.upsertedIds[k] = r.upsertedId;
      answer.modified += r.modified;
    });
    return answer;
  };
  return {writes, stored, writeOne, writeMany};
}

test('a batch goes in one bulk write', async () => {
  const fake = fakeCollection();
  const answer = await upsertInRounds([upsert(1, 'a'), upsert(2, 'b'), upsert(3, 'c')], fake.writeOne, fake.writeMany);
  expect(fake.writes).toEqual([{kind: 'many', names: ['a', 'b', 'c']}]);
  expect(answer).toEqual({modified: 0, results: [
    {matched: 0, upsertedId: '1'}, {matched: 0, upsertedId: '2'}, {matched: 0, upsertedId: '3'},
  ]});
});

test('upserts with the same filter go in later rounds, in arrival order, so the last one wins', async () => {
  const fake = fakeCollection();
  const answer = await upsertInRounds([upsert(1, 'a1'), upsert(2, 'b1'), upsert(1, 'a2'), upsert(3, 'c1'), upsert(1, 'a3'), upsert(2, 'b2')],
    fake.writeOne, fake.writeMany);
  // 1st round: the first of each filter; 2nd: the second ones; 3rd, alone: the third one of _id 1
  expect(fake.writes).toEqual([
    {kind: 'many', names: ['a1', 'b1', 'c1']},
    {kind: 'many', names: ['a2', 'b2']},
    {kind: 'one', names: ['a3']},
  ]);
  expect(fake.stored.get(1)).toEqual({name: 'a3'});
  expect(fake.stored.get(2)).toEqual({name: 'b2'});
  // results in the order of the batch; a matched one from a bulk write does not say whether it changed
  expect(answer.results).toEqual([
    {matched: 0, upsertedId: '1'}, {matched: 0, upsertedId: '2'}, {matched: 1, upsertedId: null},
    {matched: 0, upsertedId: '3'}, {matched: 1, modified: 1, upsertedId: null}, {matched: 1, upsertedId: null},
  ]);
  expect(answer.modified).toBe(3);
});

test('a batch of one goes as updateOne and says whether the document changed', async () => {
  const fake = fakeCollection();
  await upsertInRounds([upsert(1, 'a')], fake.writeOne, fake.writeMany);
  const same = await upsertInRounds([upsert(1, 'a')], fake.writeOne, fake.writeMany);
  expect(fake.writes).toEqual([{kind: 'one', names: ['a']}, {kind: 'one', names: ['a']}]);
  expect(same).toEqual({modified: 0, results: [{matched: 1, modified: 0, upsertedId: null}]});
});

test('a document that fails is an error of its own; the others of the batch are written', async () => {
  const fake = fakeCollection({failName: 'b'});
  const answer = await upsertInRounds([upsert(1, 'a'), upsert(2, 'b'), upsert(3, 'c')], fake.writeOne, fake.writeMany);
  expect(answer.results).toEqual([{matched: 0, upsertedId: '1'}, {error: 'duplicate key for b'}, {matched: 0, upsertedId: '3'}]);
  expect([...fake.stored.keys()]).toEqual([1, 3]);

  const alone = await upsertInRounds([upsert(9, 'z')], fakeCollection({failOne: true}).writeOne, fake.writeMany);
  expect(alone).toEqual({modified: 0, results: [{error: 'could not write it'}]});
});

test('documents from MongoDB become envelope values: dates stay Date, the rest plain JSON', () => {
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
    at: new Date('2026-10-25T18:00:00.000Z'),
    price: '12.3400000000000000001',
    small: 42,
    huge: '9223372036854775807',
    count: 7,
    file: 'aGk=',
    items: [{when: new Date('2026-01-01T00:00:00.000Z'), ref: '64f1a2b3c4d5e6f708091a2c'}],
    stamp: {$timestamp: {t: 1, i: 2}},
    plain: {text: 'x', n: 1.5, yes: true, none: null},
  });
  const converted = toEnvelopeValue(doc) as {at: unknown};
  expect(converted.at).toBeInstanceOf(Date);
});
