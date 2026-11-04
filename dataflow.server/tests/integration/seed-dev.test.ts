import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { openDatabase } from '#shared/database/database';
import { DEV_ORG_ID, seedDev } from '#shared/database/seed-dev';

setDefaultTimeout(30_000);

describe('dev seed', () => {
  test('creates the DEV organization once, however many times it runs', async () => {
    const db = await openDatabase('memory://');
    try {
      await seedDev(db);
      await seedDev(db);

      const rows = await db.query<{ name: string }>('SELECT name FROM organizations WHERE id = $1', [DEV_ORG_ID]);
      expect(rows).toEqual([{ name: 'Dev' }]);
    } finally {
      await db.close();
    }
  });
});
