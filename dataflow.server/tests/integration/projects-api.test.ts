import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import { createApp } from '../../api/app';

setDefaultTimeout(30_000);

describe('POST /projects', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  const orgId = crypto.randomUUID();

  const post = (body: unknown, headers: Record<string, string> = { 'x-org-id': orgId, 'x-user-id': 'ana' }) =>
    app.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2)`, [orgId, 'acme']);
    app = createApp(db, 'DEV');
  });

  afterAll(async () => {
    await db.close();
  });

  test('201 with the new id', async () => {
    const response = await post({ name: 'Sales' });

    expect(response.status).toBe(201);
    expect(((await response.json()) as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('400 with the invalid fields', async () => {
    const response = await post({ name: '' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'validation', message: 'The request has invalid fields.', fields: { name: 'Required' } },
    });
  });

  test('400 when the body is not json', async () => {
    const response = await post('not json');

    expect(response.status).toBe(400);
  });

  test('409 when the name is in use', async () => {
    const response = await post({ name: 'sales' });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('conflict');
  });

  test('401 without the organization', async () => {
    const response = await post({ name: 'Other' }, { 'x-user-id': 'ana' });

    expect(response.status).toBe(401);
  });
});
