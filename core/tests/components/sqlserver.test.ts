import {expect, test} from 'bun:test';
import {COMPONENTS, workflowRunner, sqlServerUsedParameters, sqlServerReadOnlyIssue} from '../../src/index';
import type {ExecutableWorkflow} from '../../src/index';
import {evaluate} from '../helpers';

test('SQL Server Query only accepts read-only queries', () => {
  const ok = ['SELECT * FROM Ticket WHERE id > @last', 'with x as (select 1 as a) select a from x;', "SELECT 'INSERT INTO x' AS text -- DELETE\nFROM [Update]"];
  for (const sql of ok) expect(sqlServerReadOnlyIssue(sql)).toBeNull();
  const bad: [string, string][] = [
    ['DELETE FROM Ticket', 'SELECT or WITH'],
    ['SELECT * INTO copy FROM Ticket', 'INTO'],
    ['SELECT 1; DROP TABLE Ticket', 'more than one statement'],
    ['WITH x AS (SELECT 1 a) UPDATE t SET a = 1', 'UPDATE'],
    ['SELECT * FROM t WHERE 1 = 1 EXEC xp_cmdshell', 'EXEC'],
    ['SELECT sp_who', 'sp_who'],
    // comments and strings: whatever opens first wins, and blocks can be nested (like in SQL Server)
    ['-- header\nUPDATE t SET a = 1', 'SELECT or WITH'],
    ["SELECT '--', 1; DELETE FROM t", 'more than one statement'],
    ["SELECT '/*' AS a; DELETE FROM t --*/", 'more than one statement'],
    ['/* /* nested */ SELECT 1 */ DELETE FROM t', 'SELECT or WITH'],
  ];
  for (const sql of ['/* /* nested */ DELETE */ SELECT 1', "SELECT 'it''s; DELETE' AS a FROM [t]]; DELETE]", '-- author\n/* note */\nSELECT 1']) {
    expect(sqlServerReadOnlyIssue(sql)).toBeNull();
  }
  for (const [sql, excerpt] of bad) expect(sqlServerReadOnlyIssue(sql)).toContain(excerpt);
  expect(sqlServerUsedParameters('SELECT @@ROWCOUNT, @a, @b, @a, \'@c\'')).toEqual(['a', 'b']);
  expect(COMPONENTS.sqlserver.validate({connection: 'X', sql: 'SELECT * FROM t WHERE id = @id', parameters: []}))
    .toEqual(['uses @id, which is not in the parameters.']);
});

test('SQL Server Query yields one envelope per row and sends the evaluated parameters', async () => {
  const queries: unknown[] = [];
  const querySqlServer = async function* (q: {connection: string; sql: string; parameters: Record<string, unknown>}) {
    queries.push({connection: q.connection, parameters: q.parameters});
    // the server takes a moment to send the first row
    await new Promise(resolve => setTimeout(resolve, 30));
    yield {id: 1, name: 'ana'};
    yield {id: 2, name: 'bia'};
  };
  const wfSql: ExecutableWorkflow = {
    project: 'Test', workflow: 'SQL', parameters: [{name: 'since', type: 'number', default: '10'}],
    nodes: [
      {id: 'start', type: 'start', label: 'Start', config: {}},
      {id: 's', type: 'sqlserver', label: 'Customers', override: true, config: {
        connection: 'MY_DB', sql: 'SELECT id, name FROM Customer WHERE id > @since',
        parameters: [{name: 'since', value: '$PARAMETERS.since', expression: true}],
      }},
      {id: 'end', type: 'end', label: 'End', config: {}},
    ],
    edges: [
      {source: 'start', sourcePort: 'out-0', target: 's', targetPort: 'in-0'},
      {source: 's', sourcePort: 'out-0', target: 'end', targetPort: 'in-0'},
    ],
  };
  const r = await workflowRunner(wfSql, {mode: 'execution', id: 'sql', evaluate, databases: {sqlserver: querySqlServer}, secrets: {MY_DB: 'Server=x'}});
  expect(r.status).toBe('completed');
  expect(queries).toEqual([{connection: 'Server=x', parameters: {since: 10}}]);
  const node = r.components.find(c => c.nodeId === 's')!;
  expect(node.outputSample['out-0']).toEqual([{id: 1, name: 'ana'}, {id: 2, name: 'bia'}]);
  // the wait for the server is Waiting (not Active), and the log says how much of the query it was
  expect(node.waitingMs).toBeGreaterThanOrEqual(20);
  expect(node.logs.some(l => /^Query 1: 2 row\(s\) in \d+ ms \(server \d+ ms\)\.$/.test(l.message))).toBe(true);

  // a secret that does not exist: fails the envelope (default policy = stop)
  const noSecret = await workflowRunner(wfSql, {mode: 'execution', id: 'sql2', evaluate, databases: {sqlserver: querySqlServer}, secrets: {}});
  expect(noSecret.status).toBe('failed');
  expect(noSecret.error).toContain('MY_DB');
});
