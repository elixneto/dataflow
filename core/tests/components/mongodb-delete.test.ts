import {expect, test} from 'bun:test';
import {COMPONENTS, emptyFilterText, workflowRunner} from '../../src/index';
import type {DocumentDelete, ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

/** Data Grid (2 companies) → MongoDB Delete (one deleteMany per company) → Mapper → End. */
const flow = (filter: string, config: Record<string, unknown> = {}): ExecutableWorkflow => ({
  project: 'Test', workflow: 'Delete', parameters: [{name: 'empresaId', type: 'number', default: '107'}],
  nodes: [
    {id: 'start', type: 'start', label: 'Start', config: {}},
    {id: 'grid', type: 'datagrid', label: 'Companies', override: true, config: {columns: [{name: 'id', type: 'number'}], rows: [['107'], ['91']]}},
    {id: 'del', type: 'mongodb-delete', label: 'Staging', outputKey: 'mongodb', config: {connection: 'MONGO', database: 'crm', collection: 'staging', filter, onError: 'continue', ...config}},
    {id: 'after', type: 'mapper', label: 'After', config: {fields: [{target: 'seen', value: 'yes', expression: false}]}},
    {id: 'end', type: 'end', label: 'End', config: {}},
  ],
  edges: [
    {source: 'start', sourcePort: 'out-0', target: 'grid', targetPort: 'in-0'},
    {source: 'grid', sourcePort: 'out-0', target: 'del', targetPort: 'in-0'},
    {source: 'del', sourcePort: 'out-0', target: 'after', targetPort: 'in-0'},
    {source: 'after', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
  ],
});

/** A fake driver: every filter matches 3 documents; records what it was asked */
function fakeMongo() {
  const calls: Omit<DocumentDelete, 'signal'>[] = [];
  const driver = async ({signal: _signal, ...request}: DocumentDelete) => {
    calls.push(request);
    return 3;
  };
  return {calls, driver};
}

const nodeOf = (r: Awaited<ReturnType<typeof workflowRunner>>, id = 'del') => r.components.find(c => c.nodeId === id)!;

test('MongoDB Delete validates its configuration and refuses an empty filter unless Delete all is on', () => {
  expect(COMPONENTS['mongodb-delete'].validate({filter: '{ a: 1 }'})).toEqual([
    'has no connection (name of the secret holding the connection string).', 'has no database.', 'has no collection.',
  ]);
  const base = {connection: 'M', database: 'd', collection: 'c'};
  expect(COMPONENTS['mongodb-delete'].validate({...base, filter: '{ }'}))
    .toEqual(['has an empty filter, which deletes the whole collection: turn on "Delete all" to allow it.']);
  expect(COMPONENTS['mongodb-delete'].validate({...base, filter: '{}', allowAll: true})).toEqual([]);
  expect(emptyFilterText('// tudo\n{  }')).toBe(true);
  expect(emptyFilterText('{ empresaId: $PARAMETERS.empresaId }')).toBe(false);
});

test('MongoDB Delete deletes once per envelope in a real run, with the filter evaluated on it', async () => {
  const mongo = fakeMongo();
  const r = await workflowRunner(flow('{ empresaId: $id, owner: ObjectId("64f1a2b3c4d5e6f708091a2b"), at: { $lt: new Date("2026-10-25T00:00:00Z") } }'),
    {mode: 'execution', id: 'd1', evaluate, documentDeletes: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  expect(r.status).toBe('completed');
  expect(mongo.calls).toEqual([107, 91].map(id => ({
    connection: 'mongodb://x', database: 'crm', collection: 'staging', countOnly: false,
    filter: {empresaId: id, owner: {$oid: '64f1a2b3c4d5e6f708091a2b'}, at: {$lt: {$date: '2026-10-25T00:00:00.000Z'}}},
  })));
  const node = nodeOf(r);
  expect(node.outputSample['out-0']).toEqual([{id: 107, mongodb: {deleted: 3}}, {id: 91, mongodb: {deleted: 3}}]);
  expect(node.logs.filter(l => /^Delete \d: 3 document\(s\) from crm\.staging in \d+ ms\.$/.test(l.message))).toHaveLength(2);
  expect(node.logs.at(-1)?.message).toBe('6 document(s) deleted from crm.staging in 2 delete(s).');
  expect(node.waitingMs).toBeGreaterThan(0);
});

test('MongoDB Delete deletes nothing in a test run: it counts what the filter matches and its branch stops there', async () => {
  const mongo = fakeMongo();
  const r = await workflowRunner(flow('{ empresaId: $PARAMETERS.empresaId }'),
    {mode: 'validation', id: 'd2', evaluate, documentDeletes: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
  // asked only to count
  expect(mongo.calls.every(c => c.countOnly === true)).toBe(true);
  const node = nodeOf(r);
  expect(node.status).toBe('with-warnings');
  expect(node.logs.some(l => l.message === 'Test run: 3 document(s) of crm.staging match the filter {"empresaId":107}; none deleted.')).toBe(true);
  expect(nodeOf(r, 'after').inputs).toEqual({});
});

test('MongoDB Delete: an empty filter at run time, a filter that is not an object or fails is an error of the envelope', async () => {
  const mongo = fakeMongo();
  const errors = async (filter: string, config: Record<string, unknown> = {}) => {
    const r = await workflowRunner(flow(filter, config), {mode: 'execution', id: 'd3', evaluate, documentDeletes: {mongodb: mongo.driver}, secrets: {MONGO: 'mongodb://x'}});
    return nodeOf(r).logs.filter(l => l.level === 'error').map(l => l.message);
  };
  // the text is not empty, but it evaluates to {}
  expect(await errors('$PARAMETERS.nothing ?? {}')).toEqual(Array(2).fill('The filter is empty, which would delete the whole collection: turn on "Delete all" to allow it.'));
  expect(await errors('[1, 2]')).toEqual(Array(2).fill('The filter is not an object ({ field: value }).'));
  const broken = await errors('{ a: $missing.field }');
  expect(broken[0]).toStartWith('The filter could not be evaluated: ');
  expect(mongo.calls).toEqual([]);
  // with Delete all, {} goes
  expect(await errors('{}', {allowAll: true})).toEqual([]);
  expect(mongo.calls.map(c => c.filter)).toEqual([{}, {}]);
});
