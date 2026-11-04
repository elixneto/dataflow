import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { Keyring } from '#shared/crypto/keyring';
import { openDatabase, type Database } from '#shared/database/database';
import { createApp } from '../../api/app';

setDefaultTimeout(30_000);

describe('secrets, variables and connections api', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  const orgId = crypto.randomUUID();
  const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    app = createApp(db, 'DEV', new Keyring([{ version: 't', key: new Uint8Array(32).fill(5) }]));
    projectId = (await call('POST', '/projects', { name: 'Api' })).body.id as string;
  });

  afterAll(async () => {
    await db.close();
  });

  test('secrets: create, list without value, replace, delete', async () => {
    const created = await call('POST', `/projects/${projectId}/secrets`, { name: 'api-token', value: 's3cr3t' });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const listed = await call('GET', `/projects/${projectId}/secrets`);
    expect(JSON.stringify(listed.body)).not.toContain('s3cr3t');
    expect((listed.body.items as { name: string }[]).map(s => s.name)).toEqual(['api-token']);

    expect((await call('PUT', `/secrets/${id}/value`, { value: 'new' })).status).toBe(200);
    expect((await call('POST', `/projects/${projectId}/secrets`, { name: 'API-TOKEN', value: 'x' })).status).toBe(409);
    expect((await call('DELETE', `/secrets/${id}`)).status).toBe(200);
  });

  test('variables: create, list with value, update, delete', async () => {
    const { body } = await call('POST', `/projects/${projectId}/variables`, { name: 'batch-size', value: '500' });
    const id = body.id as string;

    expect((await call('GET', `/projects/${projectId}/variables`)).body.items).toMatchObject([{ name: 'batch-size', value: '500' }]);
    expect((await call('PATCH', `/variables/${id}`, { value: '1000' })).body).toMatchObject({ value: '1000' });
    expect((await call('DELETE', `/variables/${id}`)).status).toBe(200);
  });

  test('connections: create with a new secret, list, update, test, delete', async () => {
    const fields = { name: 'Events', type: 'kafka', config: { bootstrapServers: 'b:9092', security: 'SASL_SSL', mechanism: 'PLAIN', user: 'u', password: 'kafka-pass' } };
    const created = await call('POST', `/projects/${projectId}/connections`, { ...fields, newSecrets: [{ name: 'kafka-pass', value: 'k' }] });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    expect((await call('GET', `/projects/${projectId}/connections`)).body.items).toMatchObject([{ id, name: 'Events', type: 'kafka' }]);
    expect((await call('PUT', `/connections/${id}`, { ...fields, config: { ...fields.config, security: 'SSL' } })).body).toMatchObject({ config: { security: 'SSL' } });
    expect((await call('POST', `/connections/${id}/test`)).status).toBe(200);
    expect((await call('PUT', `/connections/${id}`, { ...fields, config: { ...fields.config, bootstrapServers: '' } })).status).toBe(400);
    expect((await call('DELETE', `/connections/${id}`)).status).toBe(200);
  });
});
