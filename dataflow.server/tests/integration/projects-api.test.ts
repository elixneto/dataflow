import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import { createApp } from '../../api/app';

setDefaultTimeout(30_000);

describe('/projects', () => {
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

  test('400 when icon or color is not a name', async () => {
    const response = await post({ name: 'Bad', icon: '<svg>', color: 'Blue!' });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { fields: object } }).error.fields).toEqual({ icon: 'Invalid', color: 'Invalid' });
  });

  test('GET lists the projects, newest first, with icon and color', async () => {
    await post({ name: 'Finance', icon: 'wallet', color: 'amber' });
    const response = await app.request('/projects', { headers: { 'x-org-id': orgId, 'x-user-id': 'ana' } });

    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: { name: string; icon: string; color: string; createdAt: string }[] };
    expect(items.map(p => p.name)).toEqual(['Finance', 'Sales']);
    expect(items[0]).toMatchObject({ icon: 'wallet', color: 'amber' });
    expect(new Date(items[0]!.createdAt).toISOString()).toBe(items[0]!.createdAt);
  });

  test('PATCH edits, archive moves to ?status=archived, restore brings back', async () => {
    const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };
    const { id } = (await (await post({ name: 'Lifecycle' })).json()) as { id: string };

    const patched = await app.request(`/projects/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ description: 'Edited' }) });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ id, name: 'Lifecycle', description: 'Edited', archivedAt: null });

    expect((await app.request(`/projects/${id}/archive`, { method: 'POST', headers })).status).toBe(200);
    const archived = (await (await app.request('/projects?status=archived', { headers })).json()) as { items: { id: string; archivedAt: string }[] };
    expect(archived.items.map(p => p.id)).toEqual([id]);
    expect(archived.items[0]!.archivedAt).toBeString();

    expect((await app.request(`/projects/${id}/restore`, { method: 'POST', headers })).status).toBe(200);
    expect((await app.request(`/projects/${id}/restore`, { method: 'POST', headers })).status).toBe(404);
  });

  test('PATCH: 409 on a name in use, 404 on an unknown project, 400 on an invalid status', async () => {
    const headers = { 'x-org-id': orgId, 'x-user-id': 'ana', 'content-type': 'application/json' };
    const { id } = (await (await post({ name: 'Renamed later' })).json()) as { id: string };

    const conflict = await app.request(`/projects/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'SALES' }) });
    const missing = await app.request(`/projects/${crypto.randomUUID()}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'X' }) });
    const badStatus = await app.request('/projects?status=deleted', { headers });

    expect([conflict.status, missing.status, badStatus.status]).toEqual([409, 404, 400]);
  });

  test('GET /projects/:id: active or archived, 404 when unknown', async () => {
    const headers = { 'x-org-id': orgId, 'x-user-id': 'ana' };
    const { id } = (await (await post({ name: 'Single' })).json()) as { id: string };

    const active = await app.request(`/projects/${id}`, { headers });
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({ id, name: 'Single', archivedAt: null });

    await app.request(`/projects/${id}/archive`, { method: 'POST', headers });
    const archived = (await (await app.request(`/projects/${id}`, { headers })).json()) as { archivedAt: string | null };
    expect(archived.archivedAt).toBeString();

    expect((await app.request(`/projects/${crypto.randomUUID()}`, { headers })).status).toBe(404);
    const otherOrg = await app.request(`/projects/${id}`, { headers: { 'x-org-id': crypto.randomUUID(), 'x-user-id': 'bia' } });
    expect(otherOrg.status).toBe(404);
  });

  test('401 without the organization', async () => {
    const response = await post({ name: 'Other' }, { 'x-user-id': 'ana' });

    expect(response.status).toBe(401);
  });
});
