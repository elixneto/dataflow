import { Hono } from 'hono';
import { CreateProjectHandler } from '#features/projects/create-project/create-project-handler';
import { toHttpResult } from '#shared/use-cases/to-http-result';
import type { AppEnv } from '../app-env';

/** /projects: HTTP in, handler, HTTP out. No business rules here (like a controller in GRO.Server.Api). */
export function projectsRoutes() {
  return new Hono<AppEnv>()
    .post('/', async c => {
      const body = await c.req.json().catch(() => undefined);
      const result = await new CreateProjectHandler().handle(body, c.get('useCase'));
      return toHttpResult(c, result, 201);
    });
}
