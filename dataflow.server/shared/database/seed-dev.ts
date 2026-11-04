import type { Database } from './database';

/*
 * PLACEHOLDER until authentication exists: requests carry X-Org-Id (api/middlewares/request-context.ts) and the
 * organization must exist (projects.org_id references it). In DEV the api creates this one on start, and the editor
 * sends its id (dataflow.editor/src/auth/mock-user.ts: keep both the same).
 */

export const DEV_ORG_ID = '00000000-0000-4000-8000-000000000001';

/** creates the DEV organization when it is missing; running it again changes nothing */
export async function seedDev(db: Database): Promise<void> {
  await db.query(`INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [DEV_ORG_ID, 'Dev']);
}
