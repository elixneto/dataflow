import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { CreateConnectionHandler } from '#features/connections/create-connection/create-connection-handler';
import { safeMessage, type ConnectionTestInput } from '#features/connections/test-connection/connection-test';
import { MongoDbConnectionTest } from '#features/connections/test-connection/mongodb-connection-test';
import { SqlServerConnectionTest } from '#features/connections/test-connection/sqlserver-connection-test';
import { TestConnectionDraftHandler } from '#features/connections/test-connection-draft/test-connection-draft-handler';
import { TestConnectionHandler } from '#features/connections/test-connection/test-connection-handler';
import { ProjectRepository } from '#features/projects/project-repository';
import { Keyring } from '#shared/crypto/keyring';
import { openDatabase, type Database } from '#shared/database/database';
import type { UseCaseContext } from '#shared/use-cases/use-case-context';

setDefaultTimeout(30_000);

describe('test connection (live)', () => {
  let db: Database;
  let ctx: UseCaseContext;
  const keyring = new Keyring([{ version: 'test', key: new Uint8Array(32).fill(5) }]);

  beforeAll(async () => {
    db = await openDatabase('memory://');
    ctx = { orgId: crypto.randomUUID(), userId: 'ana', db, keyring };
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [ctx.orgId, 'org']);
  });

  const newConnection = async (type: string, config: Record<string, string>, newSecrets: { name: string; value: string }[]) => {
    const projectId = (await new ProjectRepository(db, ctx.orgId).insert({ id: crypto.randomUUID(), name: crypto.randomUUID(), description: '' })).id;
    const result = await new CreateConnectionHandler().handle({ projectId, name: 'Db', type, config, newSecrets }, ctx);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }

    return result.value.id;
  };

  const sqlConfig = { host: 'db.example.com', port: '1433', database: 'orders', user: 'app', password: 'sql-pass' };

  test('the tester gets the config and the decrypted secret values; success says what it reached', async () => {
    const id = await newConnection('sqlserver', sqlConfig, [{ name: 'sql-pass', value: 'p@ss' }]);
    const seen: ConnectionTestInput[] = [];
    const handler = new TestConnectionHandler({ sqlserver: { test: async input => (seen.push(input), 'SQL Server 16.0') } });

    expect(await handler.handle({ id }, ctx)).toMatchObject({ ok: true, value: { message: 'Connected to SQL Server 16.0.' } });
    expect(seen).toEqual([{ config: { ...sqlConfig, encrypt: 'on', trustServerCertificate: 'off' }, secrets: { password: 'p@ss' } }]);
  });

  test('a failure is unavailable, with the secret values masked', async () => {
    const id = await newConnection('mongodb', { connectionString: 'mongo-uri', database: 'shop' }, [
      { name: 'mongo-uri', value: 'mongodb://app:s3cret@mongo.example.com/shop' },
    ]);
    const handler = new TestConnectionHandler({
      mongodb: {
        test: async ({ secrets }) => {
          throw new Error(`Authentication failed for ${secrets.connectionString}`);
        },
      },
    });

    const result = await handler.handle({ id }, ctx);
    expect(result).toEqual({ ok: false, error: { code: 'unavailable', message: 'Authentication failed for ***' } });
  });

  test('an incomplete profile is not tested live', async () => {
    const id = await newConnection('sqlserver', sqlConfig, [{ name: 'sql-pass', value: 'p' }]);
    await db.query(`DELETE FROM secrets WHERE name = 'sql-pass' AND org_id = $1`, [ctx.orgId]);
    let called = false;
    const handler = new TestConnectionHandler({ sqlserver: { test: async () => ((called = true), 'x') } });

    expect(await handler.handle({ id }, ctx)).toMatchObject({ ok: false, error: { code: 'validation', message: 'Incomplete: password: Unknown secret.' } });
    expect(called).toBe(false);
  });

  test('from the form (nothing saved): stored secrets decrypted, typed ones used as typed; incomplete fields come back per field', async () => {
    const id = await newConnection('sqlserver', sqlConfig, [{ name: 'sql-pass', value: 'stored' }]);
    const projectId = (await db.query<{ project_id: string }>(`SELECT project_id FROM connections WHERE id = $1`, [id]))[0]!.project_id;
    const seen: ConnectionTestInput[] = [];
    const handler = new TestConnectionDraftHandler({ sqlserver: { test: async input => (seen.push(input), 'SQL Server') } });

    expect(await handler.handle({ projectId, type: 'sqlserver', config: sqlConfig }, ctx)).toMatchObject({ ok: true });
    const typed = { ...sqlConfig, password: 'typed-pass' };
    expect(await handler.handle({ projectId, type: 'sqlserver', config: typed, newSecrets: [{ name: 'typed-pass', value: 'fresh' }] }, ctx)).toMatchObject({ ok: true });
    expect(seen.map(s => s.secrets.password)).toEqual(['stored', 'fresh']);

    expect(await handler.handle({ projectId, type: 'sqlserver', config: { ...sqlConfig, host: '' } }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'validation', fields: { host: 'Required' } },
    });
    expect(await handler.handle({ projectId: crypto.randomUUID(), type: 'sqlserver', config: sqlConfig }, ctx)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await db.query(`SELECT 1 FROM secrets WHERE name = 'typed-pass'`)).toEqual([]);
  });

  test('safe messages: secrets (longest first) and URI credentials masked, one line', () => {
    expect(safeMessage(new Error('bad pass and passport'), ['pass', 'passport'])).toBe('bad *** and ***');
    expect(safeMessage(new Error('connect to mongodb+srv://u:p@host\n  failed'), [])).toBe('connect to mongodb+srv://***@host failed');
    expect(safeMessage('', [])).toBe('Could not connect.');
  });

  test('the real drivers fail (do not hang) when nothing answers', async () => {
    // port 1 on localhost: refused at once, no network needed
    await expect(new SqlServerConnectionTest(2000).test({ config: { ...sqlConfig, host: '127.0.0.1', port: '1' }, secrets: { password: 'x' } })).rejects.toThrow();
    await expect(
      new MongoDbConnectionTest(500).test({ config: { database: 'shop' }, secrets: { connectionString: 'mongodb://127.0.0.1:1/' } }),
    ).rejects.toThrow();
  });
});
