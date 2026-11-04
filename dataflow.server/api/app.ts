import { Hono } from 'hono';
import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';
import type { AppEnv } from './app-env';
import { requestContext } from './middlewares/request-context';
import { flowsRoutes } from './routes/flows.routes';
import { foldersRoutes } from './routes/folders.routes';
import { projectResourcesRoutes } from './routes/project-resources.routes';
import { projectsRoutes } from './routes/projects.routes';

/**
 * The api's routes, without starting a server: server.ts serves it, tests call app.request() directly.
 */
export function createApp(db: Database, environment: string, keyring?: Keyring) {
  const app = new Hono<AppEnv>();
  app.get('/health', c => c.json({ ok: true, environment }));

  app.use('*', requestContext(db, keyring));
  app.route('/projects', projectsRoutes());
  app.route('/folders', foldersRoutes());
  app.route('/flows', flowsRoutes());
  app.route('/', projectResourcesRoutes());

  // an unexpected failure (not a UseCaseResult): logged, and the caller gets a 500 without the details
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Unexpected error.' } }, 500);
  });

  return app;
}
