import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase } from '#shared/database/database';
import { DEV_ORG_ID, DEV_USER, seedDev } from '#shared/database/seed-dev';

setDefaultTimeout(30_000);

describe('dev seed', () => {
  test('creates the DEV organization and its user once, however many times it runs', async () => {
    const db = await openDatabase('memory://');
    try {
      await seedDev(db);
      await seedDev(db);

      const rows = await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [DEV_ORG_ID]);
      expect(rows).toEqual([{ name: 'Dev' }]);
      const users = await db.query<{ id: string; org_id: string; name: string; email: string }>('SELECT id, org_id, name, email FROM users');
      expect(users).toEqual([{ id: DEV_USER.id, org_id: DEV_ORG_ID, name: DEV_USER.name, email: DEV_USER.email }]);
    } finally {
      await db.close();
    }
  });
});
