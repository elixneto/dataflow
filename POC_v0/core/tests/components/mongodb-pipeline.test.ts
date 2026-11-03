import {expect, test} from 'bun:test';
import {COMPONENTS, mongoPipelineIssue, mongoPipelineTextIssue, workflowRunner} from '../../src/index';
import type {DocumentQuery, ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

/** Data Grid (2 codes) → MongoDB Pipeline (one pipeline per code) → End. */
const flow = (pipeline: string, config: Record<string, unknown> = {}): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Mongo', parameters: [{name: 'since', type: 'text', default: '2026-01-01'}],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'grid', type: 'datagrid', label: 'Codes', override: true, config: {columns: [{name: 'code', type: 'text'}], rows: [['A'], ['B']]}},
    {id: 'mongo', type: 'mongodb-pipeline', label: 'Orders', config: {connection: 'MONGO', database: 'crm', collection: 'orders', pipeline, onError: 'continue', ...config}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'grid', targetPort: 'in-0'},
    {source: 'grid', sourcePort: 'out-0', target: 'mongo', targetPort: 'in-0'},
    {source: 'mongo', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

/** A fake driver: answers 2 documents per pipeline, after a moment (the server) */
function fakeMongo() {
  const queries: Omit<DocumentQuery, 'signal'>[] = [];
  const driver = async function* ({signal: _signal, ...query}: DocumentQuery) {
    queries.push(query);
    await new Promise(resolve => setTimeout(resolve, 20));
    yield {_id: 'id-1', total: 10};
    yield {_id: 'id-2', total: 20};
  };
  return {queries, driver};
}

const nodeOf = (r: Awaited<ReturnType<typeof workflowRunner>>) => r.components.find(c => c.nodeId === 'mongo')!;

test('MongoDB Pipeline validates its configuration and refuses stages that write', () => {
  expect(COMPONENTS['mongodb-pipeline'].validate({pipeline: '[]'})).toEqual([
    'has no connection (name of the secret holding the connection string).', 'has no database.', 'has no collection.',
  ]);
  expect(mongoPipelineTextIssue('[{$match: {}}, {$out: "copy"}]')).toBe('cannot use $out (it is read-only)');
  expect(mongoPipelineTextIssue('[{"$merge": {into: "x"}}]')).toBe('cannot use $merge (it is read-only)');
  expect(mongoPipelineTextIssue('[{$match: {output: 1}}]')).toBeNull();
  expect(mongoPipelineIssue({$match: {}})).toBe('is not a list of stages ([ {...}, {...} ])');
  expect(mongoPipelineIssue([{$match: {}}, 3])).toBe('stage 2 is not an object');
  expect(mongoPipelineIssue([{$match: {}}, {$merge: {into: 'x'}}])).toBe('cannot use $merge (it is read-only)');
});

test('MongoDB Pipeline runs once per envelope, with its values, and yields one envelope per document', async () => {
  const mongo = fakeMongo();
  // as Compass shows it: unquoted keys, single quotes, a trailing comma, a mongosh helper
  const pipeline = `[
    { $match: { code: $code, created: { $gte: ISODate($PARAMETERS.since) }, owner: ObjectId('64f1a2b3c4d5e6f708091a2b'), } },
    { $sort: { total: -1 } },
    { $limit: NumberInt('5') },
  ]`;
  const r = await workflowRunner(flow(pipeline), {mode: 'validation', id: 'p1', evaluate, documentQueries: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  expect(r.status).toBe('completed');
  expect(mongo.queries).toEqual(['A', 'B'].map(code => ({
    connection: 'mongodb://x', database: 'crm', collection: 'orders', timeoutMs: 300_000,
    pipeline: [
      {$match: {code, created: {$gte: {$date: '2026-01-01T00:00:00.000Z'}}, owner: {$oid: '64f1a2b3c4d5e6f708091a2b'}}},
      {$sort: {total: -1}},
      {$limit: 5},
    ],
  })));
  const node = nodeOf(r);
  expect(node.outputs['out-0']).toBe(4);
  expect(node.outputSample['out-0'][0]).toEqual({code: 'A', _id: 'id-1', total: 10});
  // the wait for the server is Waiting, and the log says how much of each pipeline it was
  expect(node.waitingMs).toBeGreaterThanOrEqual(20);
  expect(node.logs.filter(l => /^Pipeline \d: 2 document\(s\) in \d+ ms \(server \d+ ms\)\.$/.test(l.message))).toHaveLength(2);
  expect(node.logs.at(-1)?.message).toBe('4 document(s) read from crm.orders in 2 pipeline(s).');
});

test('MongoDB Pipeline: Override keeps only the document, and a new Date() becomes a date', async () => {
  const mongo = fakeMongo();
  const wf = flow('[{ $match: { at: { $lt: new Date("2026-10-25T00:00:00Z") } } }]');
  wf.nodes.find(n => n.id === 'mongo')!.override = true;
  const r = await workflowRunner(wf, {mode: 'validation', id: 'p2', evaluate, documentQueries: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  expect(mongo.queries[0].pipeline).toEqual([{$match: {at: {$lt: {$date: '2026-10-25T00:00:00.000Z'}}}}]);
  expect(nodeOf(r).outputSample['out-0'][0]).toEqual({_id: 'id-1', total: 10});
});

test('MongoDB Pipeline: a pipeline that is not a list, writes or fails to evaluate is an error of the envelope', async () => {
  const mongo = fakeMongo();
  const run = (pipeline: string) => workflowRunner(flow(pipeline), {mode: 'validation', id: 'p3', evaluate, documentQueries: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  const errors = async (pipeline: string) => nodeOf(await run(pipeline)).logs.filter(l => l.level === 'error').map(l => l.message);

  expect(await errors('{ $match: {} }')).toEqual(Array(2).fill('The pipeline is not a list of stages ([ {...}, {...} ]).'));
  expect(await errors('[{ $match: {} }, { [`$` + "out"]: "copy" }]')).toEqual(Array(2).fill('The pipeline cannot use $out (it is read-only).'));
  const broken = await errors('[{ $match: { code: $missing.field } }]');
  expect(broken).toHaveLength(2);
  expect(broken[0]).toStartWith('The pipeline could not be evaluated: ');
  expect(broken[0]).not.toContain('NumberDecimal');
  expect(mongo.queries).toEqual([]);

  const noSecret = await workflowRunner(flow('[]'), {mode: 'validation', id: 'p4', evaluate, documentQueries: {mongodb: mongo.driver}, secrets: {}});
  expect(nodeOf(noSecret).logs.some(l => l.message.includes('"MONGO" does not exist'))).toBe(true);
});

test('MongoDB Pipeline: a date of the document reaches the next component as a Date', async () => {
  const driver = async function* () {
    yield {_id: 'id-1', at: new Date('2026-10-25T18:00:00.000Z'), label: '2026-10-25'};
  };
  const reached: Record<string, unknown>[] = [];
  await workflowRunner(flow('[]'), {mode: 'validation', id: 'p5', evaluate, documentQueries: {mongodb: driver}, secrets: {MONGO: 'mongodb://x'},
    onReachEnd: async doc => void reached.push(doc.DATA)});
  expect(reached[0].at).toBeInstanceOf(Date);
  expect(reached[0].label).toBe('2026-10-25');
});
