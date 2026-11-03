import {expect, test} from 'bun:test';
import {COMPONENTS, workflowRunner} from '../../src/index';
import type {DocumentBatch, ExecutableWorkflow, UpsertAnswer} from '../../src/index';
import {evaluate} from '../helpers';

/** Data Grid (3 people, the 2nd without email) → MongoDB Upsert (by email) → Mapper → End. */
const flow = (config: Record<string, unknown> = {}): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Mongo', parameters: [],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'grid', type: 'datagrid', label: 'People', override: true, config: {
      columns: [{name: '_id', type: 'number'}, {name: 'email', type: 'text'}, {name: 'name', type: 'text'}],
      rows: [['1', 'ana@x.com', 'Ana'], ['2', '', 'Bia'], ['3', 'caio@x.com', 'Caio']],
    }},
    {id: 'mongo', type: 'mongodb-upsert', label: 'People', config: {onError: 'continue',
      connection: 'MONGO', database: 'crm', collection: 'people',
      filter: [{field: 'email', value: '$email || undefined', expression: true}], batchSize: 2, ...config,
    }},
    {id: 'after', type: 'mapper', label: 'After', config: {fields: [{target: 'seen', value: 'yes', expression: false}]}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'grid', targetPort: 'in-0'},
    {source: 'grid', sourcePort: 'out-0', target: 'mongo', targetPort: 'in-0'},
    {source: 'mongo', sourcePort: 'out-0', target: 'after', targetPort: 'in-0'},
    {source: 'after', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

function fakeMongo(fail?: (filter: Record<string, unknown>) => string | undefined) {
  const batches: Omit<DocumentBatch, 'signal'>[] = [];
  const driver = async (batch: DocumentBatch): Promise<UpsertAnswer> => {
    batches.push({connection: batch.connection, database: batch.database, collection: batch.collection, upserts: batch.upserts});
    const results = batch.upserts.map((u, i) => {
      const error = fail?.(u.filter);
      return error ? {error} : {matched: i % 2, upsertedId: i % 2 ? null : `id-${String(u.filter.email)}`};
    });
    return {results, modified: results.filter(r => 'matched' in r && r.matched).length};
  };
  return {batches, driver};
}

test('MongoDB Upsert validates its configuration', () => {
  expect(COMPONENTS['mongodb-upsert'].validate({})).toEqual([
    'has no connection (name of the secret holding the connection string).', 'has no database.', 'has no collection.',
    'has no filter field (what finds the document to update).',
  ]);
  expect(COMPONENTS['mongodb-upsert'].validate({connection: 'M', database: 'd', collection: 'c', source: 'expression',
    filter: [{field: '$bad', value: 'x', expression: false}, {field: 'a', value: '', expression: false}, {field: 'a', value: '', expression: false}]}))
    .toEqual(['filter field "$bad" is not a valid MongoDB field.', 'has the filter field "a" more than once.', 'has no document expression.']);
});

test('MongoDB Upsert writes in batches in a real run and maps each result to its envelope', async () => {
  const mongo = fakeMongo(filter => (filter.email === 'caio@x.com' ? 'E11000 duplicate key' : undefined));
  const r = await workflowRunner(flow(), {mode: 'execution', id: 'm1', evaluate, documentStores: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  // the 2nd person has no email: an error of that envelope, before anything is sent
  expect(mongo.batches).toEqual([
    {connection: 'mongodb://x', database: 'crm', collection: 'people', upserts: [
      {filter: {email: 'ana@x.com'}, document: {email: 'ana@x.com', name: 'Ana'}},
      {filter: {email: 'caio@x.com'}, document: {email: 'caio@x.com', name: 'Caio'}},
    ]},
  ]);
  const node = r.components.find(c => c.nodeId === 'mongo')!;
  expect(node.status).toBe('with-errors');
  expect(node.logs.filter(l => l.level === 'error').map(l => l.message)).toEqual(['The filter field "email" has no value.', 'E11000 duplicate key']);
  expect(node.logs.some(l => /^Batch 1: 2 upsert\(s\) in \d+ ms \(1 inserted, 0 modified, 0 unchanged, 1 failed\)\.$/.test(l.message))).toBe(true);
  expect(node.waitingMs).toBeGreaterThan(0);
  // continue: the failed envelopes go on unchanged; the written one carries the result
  expect(node.outputSample['out-0']).toEqual([
    {_id: 2, email: null, name: 'Bia'},
    {_id: 1, email: 'ana@x.com', name: 'Ana', mongodb: {matched: 0, upsertedId: 'id-ana@x.com'}},
    {_id: 3, email: 'caio@x.com', name: 'Caio'},
  ]);
});

test('MongoDB Upsert counts inserted, modified and unchanged documents, per batch and in all', async () => {
  // the 1st is new, the 2nd matched and changed, the 3rd matched a document that already had these values
  // the batch of 2 answers 1 modified in total; the batch of 1 matched one that did not change
  const answers: UpsertAnswer[] = [
    {results: [{matched: 0, upsertedId: 'new-1'}, {matched: 1, upsertedId: null}], modified: 1},
    {results: [{matched: 1, upsertedId: null, modified: 0}], modified: 0},
  ];
  let next = 0;
  const driver = async () => answers[next++];
  const r = await workflowRunner(flow({filter: [{field: '_id', value: '$_id', expression: true}]}),
    {mode: 'execution', id: 'm6', evaluate, documentStores: {mongodb: driver}, secrets: {MONGO: 'mongodb://x'}});
  const logs = r.components.find(c => c.nodeId === 'mongo')!.logs.map(l => l.message);
  expect(logs.filter(m => m.startsWith('Batch')).map(m => m.replace(/in \d+ ms/, 'in N ms'))).toEqual([
    'Batch 1: 2 upsert(s) in N ms (1 inserted, 1 modified, 0 unchanged).',
    'Batch 2: 1 upsert(s) in N ms (0 inserted, 0 modified, 1 unchanged).',
  ]);
  expect(logs.at(-1)).toBe('3 document(s) upserted into crm.people: 1 inserted, 1 modified, 1 unchanged (3 sent).');
});

test('MongoDB Upsert writes nothing in a test run and the envelopes go on marked as not sent, unless it is pinned', async () => {
  const mongo = fakeMongo();
  const r = await workflowRunner(flow({filter: [{field: '_id', value: '$_id', expression: true}]}),
    {mode: 'validation', id: 'm2', evaluate, documentStores: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  expect(mongo.batches).toEqual([]);
  const node = r.components.find(c => c.nodeId === 'mongo')!;
  expect(node.status).toBe('completed');
  expect(node.outputs).toEqual({'out-0': 3});
  expect(node.logs.some(l => l.message === 'Would upsert into crm.people: filter {"_id":1}, $set {"email":"ana@x.com","name":"Ana"}')).toBe(true);
  expect(r.components.find(c => c.nodeId === 'after')!.outputSample['out-0'].map(d => d.mongodb)).toEqual(Array(3).fill({notSent: true}));

  const pinned = flow();
  pinned.nodes.find(n => n.id === 'mongo')!.pinned = {'out-0': [{name: 'Pinned'}]};
  const replay = await workflowRunner(pinned, {mode: 'validation', id: 'm3', evaluate, documentStores: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  expect(mongo.batches).toEqual([]);
  expect(replay.components.find(c => c.nodeId === 'after')!.outputSample['out-0']).toEqual([{name: 'Pinned', seen: 'yes'}]);
});

test('MongoDB Upsert: a batch that fails as a whole fails each of its envelopes', async () => {
  const driver = async () => {
    throw new Error('Authentication failed.');
  };
  const r = await workflowRunner(flow({filter: [{field: '_id', value: '$_id', expression: true}]}),
    {mode: 'execution', id: 'm4', evaluate, documentStores: {mongodb: driver}, secrets: {MONGO: 'mongodb://x'}});
  const node = r.components.find(c => c.nodeId === 'mongo')!;
  expect(node.logs.filter(l => l.level === 'error').map(l => l.message)).toEqual(Array(3).fill('Authentication failed.'));

  const noSecret = await workflowRunner(flow(), {mode: 'validation', id: 'm5', evaluate, documentStores: {mongodb: driver}, secrets: {}});
  expect(noSecret.components.find(c => c.nodeId === 'mongo')!.logs.some(l => l.message.includes('"MONGO" does not exist'))).toBe(true);
});

test('MongoDB Upsert writes a Date as a date (also one made in an expression) and leaves date-looking text as text', async () => {
  const batches: DocumentBatch[] = [];
  const driver = async (batch: DocumentBatch) => {
    batches.push(batch);
    return {results: batch.upserts.map(() => ({matched: 0, upsertedId: 'x'})), modified: 0};
  };
  const wf = flow({filter: [{field: '_id', value: '$_id', expression: true}]});
  // the Data Grid gives text; a TypeScript-like expression document brings real dates
  wf.nodes.find(n => n.id === 'mongo')!.config.source = 'expression';
  wf.nodes.find(n => n.id === 'mongo')!.config.document = {value: '({name: $name, at: new Date("2026-10-25T18:00:00.000Z"), nested: {when: new Date(0)}, text: "2026-10-25"})', expression: true};
  await workflowRunner(wf, {mode: 'execution', id: 'm7', evaluate, documentStores: {mongodb: driver}, secrets: {MONGO: 'mongodb://x'}});
  const set = batches[0].upserts[0].document as {at: unknown; nested: {when: unknown}; text: unknown};
  // made in node:vm (another realm), it arrives as a Date of this realm, so the driver writes a BSON date
  expect(set.at).toBeInstanceOf(Date);
  expect((set.at as Date).toISOString()).toBe('2026-10-25T18:00:00.000Z');
  expect(set.nested.when).toBeInstanceOf(Date);
  expect(set.text).toBe('2026-10-25');
});
