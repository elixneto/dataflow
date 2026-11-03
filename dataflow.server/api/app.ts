import { Hono } from 'hono';
import type { Database } from '#shared/database/database';
import type { AppEnv } from './app-env';
import { requestContext } from './middlewares/request-context';
import { projectsRoutes } from './routes/projects.routes';

/**
 * The api's routes, without starting a server: server.ts serves it, tests call app.request() directly.
 */
export function createApp(db: Database, environment: string) {
  const app = new Hono<AppEnv>();
  app.get('/health', c => c.json({ ok: true, environment }));

  app.use('*', requestContext(db));
  app.route('/projects', projectsRoutes());

  // an unexpected failure (not a UseCaseResult): logged, and the caller gets a 500 without the details
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: { code: 'internal', message: 'Unexpected error.' } }, 500);
  });

  return app;
}
