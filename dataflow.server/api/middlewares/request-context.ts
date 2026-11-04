import { createMiddleware } from 'hono/factory';
import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';
import type { AppEnv } from '../app-env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds the UseCaseContext of the request.
 * PLACEHOLDER until authentication exists: the organization and the user come from the X-Org-Id and X-User-Id
 * headers. The auth middleware will replace this and take both from the logged-in user's token instead; the routes
 * and handlers do not change, they only read c.get('useCase').
 */
export const requestContext = (db: Database, keyring?: Keyring) => createMiddleware<AppEnv>(async (c, next) => {
  const orgId = c.req.header('x-org-id') ?? '';
  const userId = c.req.header('x-user-id') ?? '';
  if (!UUID.test(orgId) || !userId) {
    return c.json({ error: { code: 'unauthenticated', message: 'Missing X-Org-Id (uuid) or X-User-Id.' } }, 401);
  }

  c.set('useCase', { orgId, userId, db, keyring });
  await next();
});
