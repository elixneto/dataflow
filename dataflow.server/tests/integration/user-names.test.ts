import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase, type Database } from '#shared/database/database';
import { DEV_ORG_ID, DEV_USER, seedDev } from '#shared/database/seed-dev';
import { createApp } from '../../api/app';

setDefaultTimeout(30_000);

describe('who changed it, by name', () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const response = await app.request(path, {
      method,
      headers: { 'x-org-id': DEV_ORG_ID, 'x-user-id': user, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    db = await openDatabase('memory://');
    await seedDev(db);
    app = createApp(db, 'DEV');
  });

  afterAll(async () => {
    await db.close();
  });

  test("the lists say the user's name next to the id; someone who is not a user keeps only the id", async () => {
    const projectId = (await call('POST', '/projects', DEV_USER.id, { name: 'Names' })).body.id as string;
    await call('POST', `/projects/${projectId}/variables`, DEV_USER.id, { name: 'REGION', value: 'us' });
    await call('POST', `/projects/${projectId}/variables`, 'script', { name: 'OTHER', value: 'x' });
    await call('POST', `/projects/${projectId}/flows`, DEV_USER.id, { name: 'Orders', folderId: null });

    const variables = (await call('GET', `/projects/${projectId}/variables`, DEV_USER.id)).body.items as { name: string; updatedBy: string; updatedByName?: string }[];
    expect(variables.find(v => v.name === 'REGION')).toMatchObject({ updatedBy: DEV_USER.id, updatedByName: 'Dev' });
    expect(variables.find(v => v.name === 'OTHER')).not.toHaveProperty('updatedByName');

    const flows = (await call('GET', `/projects/${projectId}/contents`, DEV_USER.id)).body.flows as { updatedByName?: string }[];
    expect(flows[0]?.updatedByName).toBe('Dev');
  });
});
