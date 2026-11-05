import { Hono } from 'hono';
import type { Keyring } from '#shared/crypto/keyring';
import type { Database } from '#shared/database/database';
import type { Logger } from '#shared/logging/logger';
import type { AppEnv } from './app-env';
import { accessLog } from './middlewares/access-log';
import { requestContext } from './middlewares/request-context';
import { flowsRoutes, runsRoutes } from './routes/flows.routes';
import { foldersRoutes } from './routes/folders.routes';
import { projectResourcesRoutes } from './routes/project-resources.routes';
import { projectsRoutes } from './routes/projects.routes';

/**
 * The api's routes, without starting a server: server.ts serves it, tests call app.request() directly. The runs go
 * on in the supervisor; what they do reaches the routes through followRunEvents (server.ts). Without a logger (tests),
 * no access log, and an unexpected failure goes to the console.
 */
export function createApp(db: Database, environment: string, keyring?: Keyring, logger?: Logger) {
  const app = new Hono<AppEnv>();
  if (logger) {
    app.use('*', accessLog(logger));
  }

  app.get('/health', c => c.json({ ok: true, environment }));

  app.use('*', requestContext(db, keyring));
  app.route('/projects', projectsRoutes());
  app.route('/folders', foldersRoutes());
  app.route('/flows', flowsRoutes());
  app.route('/runs', runsRoutes());
  app.route('/', projectResourcesRoutes());

  // an unexpected failure (not a UseCaseResult): logged, and the caller gets a 500 without the details
  app.onError((error, c) => {
    if (logger) {
      logger.error(`Unexpected error on ${c.req.method} ${c.req.path}`, { method: c.req.method, path: c.req.path, error });
    } else {
      console.error(error);
    }

    return c.json({ error: { code: 'internal', message: 'Unexpected error.' } }, 500);
  });

  return app;
}
