import type { Database } from './database';

/*
 * PLACEHOLDER until authentication exists: requests carry X-Org-Id and X-User-Id (api/middlewares/request-context.ts)
 * and the organization must exist (projects.org_id references it). In DEV the api creates this organization and its
 * user on start, and the editor sends their ids (dataflow.editor/src/auth/mock-user.ts: keep both the same).
 */

export const DEV_ORG_ID = '00000000-0000-4000-8000-000000000001';

/** the DEV organization's user (no password: there is no login yet) */
export const DEV_USER = { id: '00000000-0000-4000-8000-000000000002', name: 'Dev', email: 'dev@example.com' };

/** creates the DEV organization and its user when they are missing; running it again changes nothing */
export async function seedDev(db: Database): Promise<void> {
  await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [DEV_ORG_ID, 'Dev']);
  await db.query(`INSERT INTO users (id, org_id, name, email) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [
    DEV_USER.id,
    DEV_ORG_ID,
    DEV_USER.name,
    DEV_USER.email,
  ]);
}
